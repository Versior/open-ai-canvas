package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentImageReadReachesMultimodalContext(t *testing.T) {
	for _, tool := range []string{"image_text_detect", "canvas_read_image"} {
		t.Run(tool, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"product","type":"image","title":"商品图","metadata":{"storageKey":"resource:product-image","status":"success"}}]}`}
			for _, row := range []any{&canvas, &model.Resource{ID: "product-image", UserID: "user", Status: "ready", MimeType: "image/png", Width: 1440, Height: 1440}} {
				if err := db.Create(row).Error; err != nil {
					t.Fatal(err)
				}
			}
			state := cloudAgentRuntime{Request: agentTestRequest()}
			state.Request.Prompt = "识别图片中的商品，不要猜测"
			state.Canonical = cloudAgentCanonical("policy", nil, state.Request.Prompt, state.Request)
			call := cloudAgentCall{ID: "read-image"}
			call.Function.Name, call.Function.Arguments = tool, `{"nodeId":"product"}`
			state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []cloudAgentCall{call}})
			result, err := cloudAgentReadTool(s.repo, "user", &state, call, s)
			if err != nil {
				t.Fatal(err)
			}
			cloudAgentToolResult("run", &state, call, result, nil)
			canonical, err := s.cloudAgentModelContext(&model.CloudAgentExecution{ID: "run", UserID: "user"}, &state, defaultCloudAgentContextBudget())
			if err != nil {
				t.Fatal(err)
			}
			encoded, _ := json.Marshal(canonical)
			if !strings.Contains(string(encoded), `"image_url":{"url":"resource:product-image"}`) {
				t.Fatalf("successful image read only returned metadata, not a model image part: %s", encoded)
			}
			if got := cloudAgentLatestUserInstruction(canonical.Messages); got != state.Request.Prompt {
				t.Fatalf("image context replaced user instruction: %q", got)
			}
			refs := cloudAgentImageReferences(&canonical)
			if len(refs) != 1 {
				t.Fatalf("missing admission image references: %#v", refs)
			}
			input := canvasGenerationInput{ReferenceImages: []providerMedia{{StorageKey: "resource:product-image", DataURL: "data:image/png;base64,aW1hZ2U="}}, AgentRequests: &agentToolRequests{Canonical: &canonical}}
			if err := validateAgentResourcePlaceholders(input); err != nil {
				t.Fatal(err)
			}
			hydrated, err := resolveAgentResourcePlaceholders(input, true)
			if err != nil {
				t.Fatal(err)
			}
			requests, err := expandCanonicalAgentRequest(hydrated.AgentRequests.Canonical, providerConfig{Model: "vision"}, true)
			if err != nil {
				t.Fatal(err)
			}
			for name, body := range map[string]any{"chat": requests.ChatCompletion, "responses": requests.Responses, "claude": requests.Claude, "gemini": requests.Gemini} {
				wire, _ := json.Marshal(body)
				if !strings.Contains(string(wire), "aW1hZ2U=") {
					t.Fatalf("%s dropped image pixels", name)
				}
			}
			stored, _ := json.Marshal(state.Canonical)
			if strings.Contains(string(stored), `"type":"image_url"`) || strings.Contains(string(stored), "data:image") {
				t.Fatal("ephemeral visual projection polluted durable transcript")
			}
		})
	}
}

func TestCloudAgentImageReadQueuesReferencesWithNextModelTask(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.References.MaxImages = 4
	capability.Text.References.MaxImageBytes = 1 << 20
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"product","type":"image","metadata":{"storageKey":"resource:product-image"}}]}`},
		&model.Resource{ID: "product-image", UserID: "user", Status: "ready", MimeType: "image/png", Size: 100},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: "inspect-product"}
	call.Function.Name, call.Function.Arguments = "canvas_read_image", `{"nodeId":"product"}`
	result, _ := json.Marshal(map[string]any{"toolCalls": []cloudAgentCall{call}})
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		run, err := s.repo.CloudAgent("user", root.ID)
		if err != nil {
			t.Fatal(err)
		}
		if err := s.advanceCloudAgent(run); err != nil {
			t.Fatal(err)
		}
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if run.ActiveTaskID == "" || run.ActiveTaskID == root.ID {
		t.Fatalf("next model task not queued: %+v", run)
	}
	task, err := s.repo.TaskForUser("user", run.ActiveTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 1 || input.ReferenceImages[0].StorageKey != "resource:product-image" {
		t.Fatalf("task lost image admission: %s", task.InputJSON)
	}
	if err := validateAgentResourcePlaceholders(input); err != nil {
		t.Fatal(err)
	}
	if input.AgentRequests == nil || input.AgentRequests.Canonical == nil {
		t.Fatal("canonical request missing")
	}
}

func TestCloudAgentImageReaderRejectsForeignOrInvalidResources(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	for _, row := range []any{
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"foreign","type":"image","metadata":{"storageKey":"resource:foreign"}},{"id":"missing","type":"image","metadata":{"storageKey":"resource:missing"}},{"id":"text","type":"text"},{"id":"external","type":"image","metadata":{"storageKey":"https://example.invalid/image.png"}}]}`},
		&model.Resource{ID: "foreign", UserID: "other", Status: "ready", MimeType: "image/png"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	state := cloudAgentRuntime{Request: agentTestRequest()}
	for _, id := range []string{"foreign", "missing", "text", "external", "absent"} {
		call := cloudAgentCall{ID: "read"}
		call.Function.Name, call.Function.Arguments = "canvas_read_image", fmt.Sprintf(`{"nodeId":%q}`, id)
		if _, err := cloudAgentReadTool(s.repo, "user", &state, call, s); err == nil {
			t.Fatalf("accepted invalid target %s", id)
		}
	}
}

func TestCloudAgentVisualProjectionBoundsImagesAndIgnoresMetadata(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	request := canonicalAgentRequest{}
	add := func(index int, tool string, failed bool) {
		key, id := fmt.Sprintf("resource:image-%d", index), fmt.Sprintf("read-%d-%d", index, len(request.Messages))
		body := map[string]any{"nodeId": fmt.Sprintf("node-%d", index), "status": "ready_for_visual_inspection", "reference": map[string]any{"storageKey": key}}
		if failed {
			body["error"] = "unavailable"
		}
		data, _ := json.Marshal(body)
		request.Messages = append(request.Messages,
			map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": id, "function": map[string]any{"name": tool}}}},
			map[string]any{"role": "tool", "tool_call_id": id, "content": string(data)})
	}
	for i := 0; i < 6; i++ {
		if err := db.Create(&model.Resource{ID: fmt.Sprintf("image-%d", i), UserID: "user", Status: "ready", MimeType: "image/png"}).Error; err != nil {
			t.Fatal(err)
		}
		add(i, "canvas_read_image", false)
	}
	add(0, "canvas_get_state", false) // metadata is not a request to expose pixels
	add(0, "canvas_read_image", true)
	add(3, "canvas_read_image", false) // deduplicate, keep newest read last
	if err := s.attachCloudAgentVisualContext("user", &request); err != nil {
		t.Fatal(err)
	}
	refs := cloudAgentImageReferences(&request)
	data, _ := json.Marshal(refs)
	if len(refs) != 4 || strings.Contains(string(data), "resource:image-0") || strings.Contains(string(data), "resource:image-1") {
		t.Fatalf("unbounded or unauthorized projection: %s", data)
	}
	if refs[3].(map[string]any)["storageKey"] != "resource:image-3" {
		t.Fatal("latest explicit read lost")
	}
	if err := validateCanonicalAgentContent(request.Messages[len(request.Messages)-1]["content"]); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(request)
	estimated, err := cloudAgentRequestEstimatedTokens(&request)
	if err != nil || estimated < cloudAgentEstimatedTokens(raw)+4*4096 {
		t.Fatal("image context tokens not reserved")
	}
}

func TestCloudAgentImageReaderIsReadOnlyAndScoped(t *testing.T) {
	req := agentTestRequest()
	if !cloudAgentToolAllowed(req, "canvas_read_image") || cloudAgentWrite("canvas_read_image") {
		t.Fatal("read-only Agent has no general image-reading tool")
	}
	req.ContextScope = nil
	if cloudAgentToolAllowed(req, "canvas_read_image") {
		t.Fatal("image reader bypasses canvas scope")
	}
}
