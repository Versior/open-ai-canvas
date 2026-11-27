package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/workbench"
)

func TestEcommerceArtworkTaskReachesOpenAIImageEdit(t *testing.T) {
	allowLoopbackProviderTest(t)
	const owner, channelID, modelKey = "user", "commerce-image-channel", "gpt-image-2"
	const detail = `生成淘宝 / 天猫的手机端商品详情页成品。第 2/6 屏，回答镜腿连接处是什么样。先识别商品原图，展示可见铰链和镜腿的连接，证据为商品原图中的金属连接件。必须在成品中创作日文短文案，图文关系与排版由图片模型决定。`
	const layoutGuidance = "沿商品可见的轮廓安排文字的节奏。"
	for _, test := range []struct{ name, kind, role, prompt string }{
		{"studio/detail", "detail", "detail-closeup", detail},
		{"studio/main", "main", "main-selling", "淘宝 / 天猫搜索列表主图，从商品图识别透明眼镜，让小缩略图里的镜框轮廓能认清。用日文写一个短信息，文字与布局由图片模型完成。"},
		{"studio/poster", "single", "detail-hero", "淘宝 / 天猫的商品海报，用透明眼镜轮廓做主视觉，不是搜索主图或局部特写。用日文写短文案，摄影、字形、布局与材质效果由图片模型完成。"},
		{"agent/detail", "", "", detail},
	} {
		t.Run(test.name, func(t *testing.T) {
			prompt := test.prompt
			svc, db, _, _ := ecommerceCreationTestService(t)
			svc.coordinator = platform.NewCoordinatorWithRedis(nil, t.Name())
			svc.platform = platform.New(svc.repo, svc.coordinator, platformHost{svc: svc})
			features := defaultFeatureAvailability()
			features.EcommerceEnabled, features.EcommerceStudioEnabled, features.ImageWorkbenchEnabled = true, true, true
			saveAdmissionFeatures(t, svc, features)
			encoded := strings.TrimPrefix(testGeminiReferenceImageDataURL, "data:image/png;base64,")
			pixels, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				t.Fatal(err)
			}
			product, _, err := svc.storeResource(owner, "image", "product.png", "image/png", int64(len(pixels)), 1, 1, 0, bytes.NewReader(pixels), nil, true)
			if err != nil {
				t.Fatal(err)
			}
			upstream, requests := newEcommerceImageEditCapture(t, encoded, pixels)
			channel := model.ModelChannel{ID: channelID, Name: "Fixture image channel", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream + "/v1", APIKey: "loopback-fixture", APIFormat: "openai"}
			imageModel := model.ChannelModel{ID: "commerce-image-model", ChannelID: channelID, ModelKey: modelKey, ProviderModelKey: modelKey, Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, PriceConfigured: true}
			profile := DefaultModelCapabilityConfigForModel(string(imageModel.Protocol), imageModel.ModelKey)
			profile.Image.Size.DefaultTier = "1k"
			imageModel.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
			tier := newSelectionPriceTier("commerce-image-tier", "{}", modelKey, "fixed_request")
			tier.ChannelModelID = imageModel.ID
			for _, record := range []any{&channel, &imageModel, &tier} {
				if err := db.Create(record).Error; err != nil {
					t.Fatal(err)
				}
			}

			var task *model.Task
			if test.kind != "" {
				if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
					t.Fatal(err)
				}
				if err := db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", kb20LayoutID).Update("content_json", `{"guidance":"`+layoutGuidance+`"}`).Error; err != nil {
					t.Fatal(err)
				}
				setting := defaultEcommerceSetting()
				setting.Capabilities["detail-plan"] = EcommerceFlowSetting{Enabled: true, DirectorPrompt: "管理员策划专用：固定左图右文"}
				admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
				if err := db.Create(admin).Error; err != nil {
					t.Fatal(err)
				}
				if _, err := svc.UpdateEcommerceSetting(admin, setting); err != nil {
					t.Fatal(err)
				}
				const attemptID = "studio-attempt"
				task, err = svc.CreateTask(owner, CreateTaskRequest{
					Type: "canvas_image", Operation: "image", Prompt: prompt, Model: modelKey, IdempotencyKey: attemptID,
					Input: map[string]any{
						"mode": "image", "prompt": prompt,
						"config": map[string]any{"channelId": channelID, "model": modelKey, "size": "3:4", "count": 1},
						"metadata": map[string]any{
							"source": "ecommerce-studio", "studioStep": "image", "studioDetailContract": studioDetailContract, "studioUseDesignKnowledge": true,
							"studioPlatform": "taobao", "studioPlanKind": test.kind, "studioProductName": "透明眼镜", "studioCategory": "眼镜", "studioFamily": "eyewear", "studioMaterials": "金属镜腿",
							"studioScreenIndex": 2, "studioScreenCount": 6, "studioPurchaseQuestion": "镜腿连接处是什么样？", "studioDisplayContent": "展示可见铰链和镜腿连接", "studioVisualFocus": "金属连接件",
							"studioRole":      test.role,
							"studioProductId": "studio-product", "studioShotId": "studio-shot", "studioAttemptId": attemptID, "studioRunId": "studio-run",
							"ecommercePlanningKnowledgeVersion": ecommerceagent.CreativeKnowledgeVersion,
							"ecommercePlanningKnowledgeIds":     []string{kb20MethodID},
						},
						"referenceImages": []map[string]any{{"id": product.ID, "resourceId": product.ID, "storageKey": "resource:" + product.ID}},
					},
				})
			} else {
				project, createErr := svc.CreateEcommerceProject(owner)
				if createErr != nil {
					t.Fatal(createErr)
				}
				task, err = svc.CreateWorkbenchTask(owner, WorkbenchTaskInput{
					Kind: WorkbenchKindImage, EcommerceProjectID: project.ID, Prompt: prompt, Model: modelKey, ChannelID: channelID,
					Parameters: map[string]any{"size": "3:4", "count": 1},
					References: []workbench.TaskReference{{ResourceID: product.ID, Kind: "image", Role: "reference"}},
				}, "", "")
			}
			if err != nil {
				t.Fatalf("creating detail task: %v", err)
			}
			stored, err := svc.repo.TaskForUser(owner, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Prompt != prompt || strings.Contains(stored.InputJSON, "设计参考方法") || strings.Contains(stored.InputJSON, layoutGuidance) {
				t.Fatal("worker design knowledge must not be saved as task input")
			}
			result, _, err := svc.processTask(context.Background(), *stored)
			if err != nil {
				t.Fatalf("processing detail task: %v", err)
			}
			if images, _ := result["images"].([]any); len(images) != 1 {
				t.Fatalf("image result = %#v", result)
			}
			select {
			case sent := <-requests:
				if test.kind != "" {
					const heading = "【设计参考方法，不是商品事实】"
					if !strings.HasPrefix(sent.prompt, prompt+"\n\n"+heading) || strings.Count(sent.prompt, heading) != 1 || strings.Count(sent.prompt, layoutGuidance) != 1 {
						t.Errorf("edit must receive the seller's brief followed by design guidance once: %q", sent.prompt)
					}
					if strings.Contains(sent.prompt, "固定左图右文") || strings.Contains(sent.prompt, "简体中文") {
						t.Errorf("edit overrode the selected language or inherited planning instructions: %q", sent.prompt)
					}
				} else if sent.prompt != prompt {
					t.Errorf("model did not receive the original detail brief: %q", sent.prompt)
				}
			default:
				t.Fatal("image edits did not receive the detail task")
			}
		})
	}
}

type capturedEcommerceImageEdit struct {
	prompt string
	size   string
}

func newEcommerceImageEditCapture(t *testing.T, responsePNG string, productPixels []byte) (string, <-chan capturedEcommerceImageEdit) {
	t.Helper()
	requests := make(chan capturedEcommerceImageEdit, 1)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/v1/images/edits" {
			t.Errorf("provider request = %s %s, want POST /v1/images/edits", request.Method, request.URL.Path)
		}
		if err := request.ParseMultipartForm(1 << 20); err != nil {
			t.Error(err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		defer request.MultipartForm.RemoveAll()
		files := request.MultipartForm.File["image"]
		if len(files) != 1 {
			t.Errorf("product image count = %d, want 1", len(files))
		} else if file, err := files[0].Open(); err != nil {
			t.Error(err)
		} else {
			pixels, err := io.ReadAll(file)
			_ = file.Close()
			if err != nil || !bytes.Equal(pixels, productPixels) {
				t.Errorf("provider did not receive unchanged product pixels: %v", err)
			}
		}
		select {
		case requests <- capturedEcommerceImageEdit{prompt: request.FormValue("prompt"), size: request.FormValue("size")}:
		default:
			t.Error("provider received a duplicate edit request")
		}
		writer.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(writer).Encode(map[string]any{"data": []map[string]string{{"b64_json": responsePNG}}}); err != nil {
			t.Error(err)
		}
	}))
	t.Cleanup(server.Close)
	return server.URL, requests
}

// 图片能力（model-cast / pattern）的私有指令只存在于 worker 内存 SystemPrompt 中，
// 只有走完 processCanvasGenerationTask 才能证明它真的到达上游。协议单测覆盖不了
// 声明式适配器的模板映射，因此这里用真实 httptest 上游观察请求体。
func TestEcommerceImageWorkerSendsAdminInstructionUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, capability := range []string{"model-cast", "pattern"} {
		t.Run(capability, func(t *testing.T) {
			s, _, _, admin := newAdminStorageDeleteTestService(t)
			marker := "管理员私有指令标记-" + capability
			setting := defaultEcommerceSetting()
			setting.Capabilities[capability] = EcommerceFlowSetting{Enabled: true, DirectorPrompt: marker}
			if _, err := s.UpdateEcommerceSetting(admin, setting); err != nil {
				t.Fatal(err)
			}

			received := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				received <- body
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="}}]}}]}`))
			}))
			defer server.Close()

			input := canvasGenerationInput{
				Mode:   "image",
				Prompt: "product photo on a clean backdrop",
				Config: providerConfig{
					BaseURL: server.URL, APIKey: "test-only",
					Model: "gemini-3-pro-image", InterfaceType: "gemini-image",
				},
				ReferenceImages: []providerMedia{{DataURL: testGeminiReferenceImageDataURL}},
				Metadata:        map[string]any{"ecommerceCapability": capability},
			}
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			result, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_image", "", string(raw))
			if err != nil {
				t.Fatalf("image task stopped before the upstream call: %v", err)
			}
			if images, _ := result["images"].([]any); len(images) != 1 {
				t.Fatalf("image result = %#v", result)
			}
			select {
			case body := <-received:
				encoded, _ := json.Marshal(body)
				if !strings.Contains(string(encoded), marker) {
					t.Fatalf("upstream request lost the administrator instruction: %s", encoded)
				}
				instruction, _ := body["systemInstruction"].(map[string]any)
				parts, _ := instruction["parts"].([]any)
				if len(parts) == 0 {
					t.Fatalf("Gemini systemInstruction parts missing: %s", encoded)
				}
				if !strings.Contains(string(encoded), "iVBORw0KGgo") {
					t.Fatal("upstream did not receive reference image pixels")
				}
			default:
				t.Fatal("mock upstream received no request")
			}
		})
	}
}

// 普通画布请求没有管理员指令时，出站 prompt 必须与用户输入逐字节一致，
// 不能因为模板改成 $concat 就残留分隔符。
func TestEcommerceImageWorkerKeepsPromptWithoutInstruction(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	const userPrompt = "extract the flat pattern"
	bodies := make(chan map[string]any, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		bodies <- body
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="}]}`))
	}))
	defer server.Close()

	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: userPrompt,
		Config: providerConfig{
			BaseURL: server.URL, APIKey: "test-only",
			Model: "gpt-image-2", InterfaceType: "openai-image", Size: "1024x1024",
		},
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_image", "", string(raw)); err != nil {
		t.Fatalf("plain image task stopped before the upstream call: %v", err)
	}
	select {
	case body := <-bodies:
		prompt, _ := body["prompt"].(string)
		if prompt != userPrompt {
			t.Fatalf("prompt without instruction = %q, want %q", prompt, userPrompt)
		}
	default:
		t.Fatal("mock upstream received no request")
	}
}

// OpenAI Images 没有独立的 system 字段：管理员指令在协议映射边界并入出站 prompt，
// 因此必须同时验证「两个上游路径都带指令」和「指令不回写结果」。
func TestEcommerceImageWorkerReachesOpenAIImagesUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, route := range []struct {
		name     string
		images   []providerMedia
		wantPath string
	}{
		{"generation", nil, "/v1/images/generations"},
		{"edit", []providerMedia{{DataURL: testGeminiReferenceImageDataURL}}, "/v1/images/edits"},
	} {
		t.Run(route.name, func(t *testing.T) {
			s, _, _, admin := newAdminStorageDeleteTestService(t)
			marker := "管理员私有指令标记-pattern"
			setting := defaultEcommerceSetting()
			setting.Capabilities["pattern"] = EcommerceFlowSetting{Enabled: true, DirectorPrompt: marker}
			if _, err := s.UpdateEcommerceSetting(admin, setting); err != nil {
				t.Fatal(err)
			}

			paths := make(chan string, 1)
			bodies := make(chan map[string]any, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				// 上游把有参考图的编辑改成 multipart（37d219c8）；文本字段放进同一个 map 里比较。
				body := map[string]any{}
				if strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
					if err := r.ParseMultipartForm(32 << 20); err != nil {
						t.Error(err)
						w.WriteHeader(http.StatusBadRequest)
						return
					}
					for key, values := range r.MultipartForm.Value {
						if len(values) > 0 {
							body[key] = values[0]
						}
					}
					// 参考图作为文件上传：记下每个文件字段是否是 PNG 像素，替代 JSON 里的 data URL。
					for key, files := range r.MultipartForm.File {
						for _, header := range files {
							file, err := header.Open()
							if err != nil {
								t.Error(err)
								continue
							}
							head := make([]byte, 8)
							n, _ := file.Read(head)
							_ = file.Close()
							if bytes.HasPrefix(head[:n], []byte("\x89PNG")) {
								body["file:"+key] = "png"
							}
						}
					}
				} else if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				paths <- r.URL.Path
				bodies <- body
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="}]}`))
			}))
			defer server.Close()

			input := canvasGenerationInput{
				Mode:   "image",
				Prompt: "extract the flat pattern",
				Config: providerConfig{
					BaseURL: server.URL, APIKey: "test-only",
					// OpenAI Images 只收 WIDTHxHEIGHT，默认档位必须显式给出像素尺寸，
					// 否则会在输入边界被"缺少明确的像素尺寸映射"拒绝。
					Model: "gpt-image-2", InterfaceType: "openai-image", Size: "1024x1024",
				},
				ReferenceImages: route.images,
				Metadata:        map[string]any{"ecommerceCapability": "pattern"},
			}
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			result, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_image", "", string(raw))
			if err != nil {
				t.Fatalf("openai-image task stopped before the upstream call: %v", err)
			}
			if images, _ := result["images"].([]any); len(images) != 1 {
				t.Fatalf("image result = %#v", result)
			}
			if encoded, _ := json.Marshal(result); strings.Contains(string(encoded), marker) {
				t.Fatalf("administrator instruction leaked into the persisted result: %s", encoded)
			}
			select {
			case path := <-paths:
				if path != route.wantPath {
					t.Fatalf("openai-image path = %q, want %q", path, route.wantPath)
				}
				body := <-bodies
				encoded, _ := json.Marshal(body)
				if !strings.Contains(string(encoded), "extract the flat pattern") {
					t.Fatalf("upstream lost the prompt: %s", encoded)
				}
				if len(route.images) > 0 && !strings.Contains(string(encoded), "data:image/png;base64,") && body["file:image"] != "png" {
					t.Fatalf("upstream lost the reference pixels: %s", encoded)
				}
				prompt, _ := body["prompt"].(string)
				if !strings.Contains(prompt, marker) {
					t.Fatalf("upstream prompt lost the administrator instruction: %s", encoded)
				}
			default:
				t.Fatal("mock upstream received no request")
			}
		})
	}
}

// 停用是写路径上的强校验：必须在上游之前拒绝，且不产生任何请求。
func TestEcommerceImageWorkerRejectsDisabledCapabilityBeforeUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	setting := defaultEcommerceSetting()
	setting.Capabilities["model-cast"] = EcommerceFlowSetting{Enabled: false}
	if _, err := s.UpdateEcommerceSetting(admin, setting); err != nil {
		t.Fatal(err)
	}

	var calls int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"aGVsbG8="}}]}}]}`))
	}))
	defer server.Close()

	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: "product photo on a clean backdrop",
		Config: providerConfig{
			BaseURL: server.URL, APIKey: "test-only",
			Model: "gemini-3-pro-image", InterfaceType: "gemini-image",
		},
		Metadata: map[string]any{"ecommerceCapability": "model-cast"},
	}
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_image", "", string(raw))
	if err == nil || !strings.Contains(err.Error(), "已停用") {
		t.Fatalf("disabled capability was not rejected in the worker: %v", err)
	}
	if got := atomic.LoadInt32(&calls); got != 0 {
		t.Fatalf("disabled capability reached upstream %d time(s)", got)
	}
}

func TestEcommerceImageWorkerKeepsPrivateInstructionsOutOfTaskResultsAndLogs(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, status := range []struct {
		name string
		code int
	}{{"success", http.StatusOK}, {"upstream error", http.StatusBadRequest}} {
		t.Run(status.name, func(t *testing.T) {
			s, db, _, admin := newAdminStorageDeleteTestService(t)
			if err := db.AutoMigrate(&model.Task{}, &model.ApiCallLog{}, &model.ModelPricing{}); err != nil {
				t.Fatal(err)
			}
			const marker = "private-admin-instruction-sentinel"
			const userPrompt = "extract the flat pattern"
			setting := defaultEcommerceSetting()
			setting.Capabilities["pattern"] = EcommerceFlowSetting{Enabled: true, DirectorPrompt: marker}
			if _, err := s.UpdateEcommerceSetting(admin, setting); err != nil {
				t.Fatal(err)
			}
			received := make(chan string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				prompt, _ := body["prompt"].(string)
				received <- prompt
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status.code)
				response := map[string]any{"error": map[string]string{"message": marker, "type": "invalid_request_error"}}
				if status.code == http.StatusOK {
					response = map[string]any{"data": []map[string]string{{
						"b64_json":       strings.TrimPrefix(testGeminiReferenceImageDataURL, "data:image/png;base64,"),
						"revised_prompt": marker,
					}}}
				}
				if err := json.NewEncoder(w).Encode(response); err != nil {
					t.Error(err)
				}
			}))
			defer server.Close()
			input := canvasGenerationInput{
				Mode: "image", Prompt: userPrompt,
				Config:   providerConfig{BaseURL: server.URL, APIKey: "test-api-key", Model: "gpt-image-2", InterfaceType: "openai-image", Size: "1024x1024"},
				Metadata: map[string]any{"ecommerceCapability": "pattern"},
			}
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "private-image-outbound", UserID: admin.ID, Type: "canvas_image", Status: model.TaskStatusQueued, Prompt: userPrompt, InputJSON: string(raw)}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			// 走真实任务入口，覆盖 analytics 上下文和持久日志，而非只测 provider。
			result, _, taskErr := s.processTask(context.Background(), task)
			if status.code == http.StatusOK {
				if taskErr != nil {
					t.Fatal(taskErr)
				}
				if images, _ := result["images"].([]any); len(images) != 1 {
					t.Fatal("successful task lost its image")
				}
			} else {
				var upstream providerHTTPError
				if !errors.As(taskErr, &upstream) || upstream.StatusCode != status.code || upstream.Body != "" || strings.Contains(taskErr.Error(), marker) {
					t.Fatal("private failure lost its status or exposed the echoed instruction")
				}
			}
			encoded, err := json.Marshal(result)
			if err != nil || strings.Contains(string(encoded), marker) {
				t.Fatal("task output exposed the private instruction")
			}
			var logs []model.ApiCallLog
			if err := db.Where("task_id = ?", task.ID).Find(&logs).Error; err != nil || len(logs) != 1 {
				t.Fatalf("expected one persisted provider log: %v", err)
			}
			if logs[0].StatusCode != status.code || logs[0].RequestBody != "[REDACTED: private ecommerce analysis]" || logs[0].ResponseBody != "[REDACTED: private ecommerce analysis]" || strings.Contains(logs[0].Error, marker) {
				t.Fatal("provider log exposed private text or lost the upstream status")
			}
			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil || stored.InputJSON != string(raw) || stored.Prompt != userPrompt {
				t.Fatalf("worker rewrote the persisted task input: %v", err)
			}
			select {
			case prompt := <-received:
				if !strings.Contains(prompt, marker) || !strings.HasSuffix(prompt, "\n\n"+userPrompt) {
					t.Fatal("upstream prompt lost the private instruction or user prompt")
				}
			default:
				t.Fatal("mock upstream received no request")
			}
		})
	}
}
