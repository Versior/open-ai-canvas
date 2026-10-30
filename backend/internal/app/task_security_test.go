package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// metadata.ecommerceTextMode 是客户端在创建时冻结的请求字段，落库后重试不得从实时
// store 重新猜测。这里覆盖真实往返：标准化 -> 密钥加密 -> 建任务 -> 读库 -> 详情输出。
func TestEcommerceTextModeSurvivesTaskPersistenceAndSecretProtection(t *testing.T) {
	for _, mode := range []string{"model", "local"} {
		t.Run(mode, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
			input, err := normalizeTaskInput(map[string]any{
				"mode": "image",
				"metadata": map[string]any{
					"source":            "canvas",
					"ecommerceTextMode": mode,
				},
				"config": providerConfig{ChannelID: "channel-1", Model: "image-model", APIKey: "placeholder-api-key"},
			})
			if err != nil {
				t.Fatal(err)
			}
			metadata, _ := input["metadata"].(map[string]any)
			if metadata["ecommerceTextMode"] != mode {
				t.Fatalf("normalized ecommerceTextMode = %#v", metadata["ecommerceTextMode"])
			}
			if err := svc.protectTaskSecrets(input); err != nil {
				t.Fatal(err)
			}
			config, _ := input["config"].(map[string]any)
			protected, _ := config["apiKey"].(string)
			if !strings.HasPrefix(protected, encryptedSettingPrefix) {
				t.Fatalf("apiKey was not encrypted before persistence: %q", protected)
			}
			encoded, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "task-" + mode, UserID: "user-1", Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: string(encoded)}
			if err := svc.repo.Create(&task); err != nil {
				t.Fatal(err)
			}
			stored, err := svc.repo.Task(task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(stored.InputJSON, "placeholder-api-key") {
				t.Fatal("plaintext credential reached the database")
			}
			var detail map[string]any
			if err := json.Unmarshal([]byte(taskForOutput(*stored).InputJSON), &detail); err != nil {
				t.Fatalf("public task input is not valid JSON: %v", err)
			}
			detailMetadata, _ := detail["metadata"].(map[string]any)
			if detailMetadata["ecommerceTextMode"] != mode {
				t.Fatalf("detail lost ecommerceTextMode: %#v", detail)
			}
			if _, exists := detail["config"]; exists {
				t.Fatalf("detail exposed provider config: %#v", detail)
			}
		})
	}
}

func TestNormalizeTaskInputMakesTypedProviderConfigBillable(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	ensureTestUsers(t, db, "user-1")
	channelModel := model.ChannelModel{
		ID: "model-1", ChannelID: "channel-1", ModelKey: "text-model", Capability: "text",
		BillingMode: "fixed_request", UnitPriceMicrocredits: 100_000, PriceConfigured: true, Enabled: true,
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	input, err := normalizeTaskInput(map[string]any{
		"mode":   "text",
		"config": providerConfig{ChannelID: "channel-1", Model: "text-model", APIKey: "system"},
	})
	if err != nil {
		t.Fatal(err)
	}
	order, err := svc.taskBillingOrder("user-1", &model.Task{ID: "task-1", Type: "canvas_text"}, input)
	if err != nil {
		t.Fatal(err)
	}
	if order == nil || order.ChannelID != "channel-1" || order.AmountMicrocredits != 100_000 {
		t.Fatalf("taskBillingOrder() = %#v", order)
	}
}

func TestNormalizeTaskInputStillAllowsSecretProtection(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"config": providerConfig{BaseURL: "https://example.com", APIKey: "private-key", Model: "text-model"},
	})
	if err != nil {
		t.Fatal(err)
	}
	config, ok := input["config"].(map[string]any)
	if !ok || config["apiKey"] != "private-key" {
		t.Fatalf("normalized config = %#v", input["config"])
	}
	svc := &Service{dataDir: t.TempDir()}
	if err := svc.protectTaskSecrets(input); err != nil {
		t.Fatal(err)
	}
	protected, _ := config["apiKey"].(string)
	if protected == "private-key" || !strings.HasPrefix(protected, encryptedSettingPrefix) {
		t.Fatalf("protected apiKey = %q", protected)
	}
}

func TestTaskInputRejectsInlineMedia(t *testing.T) {
	input, err := normalizeTaskInput(map[string]any{
		"referenceImages": []providerMedia{{DataURL: testReferenceImageDataURL}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !containsInlineMediaDataURL(input) {
		t.Fatal("containsInlineMediaDataURL() = false")
	}
}

// metadata.ecommerceTextMode 只接受精确的 model / local：其余取值或类型在标准化时删除，
// 缺失时不得补默认值，同层其他 metadata 必须原样往返。
func TestEcommerceTextModeDroppedWhenNotFrozenEnum(t *testing.T) {
	for _, tc := range []struct {
		name    string
		value   any
		present bool
		keep    bool
	}{
		{"model", "model", true, true},
		{"local", "local", true, true},
		{"other-string", "cloud", true, false},
		{"empty-string", "", true, false},
		{"uppercase", "MODEL", true, false},
		{"number", float64(1), true, false},
		{"object", map[string]any{"mode": "model"}, true, false},
		{"array", []any{"model"}, true, false},
		{"null", nil, true, false},
		{"missing", nil, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			others := map[string]any{"source": "canvas", "nodeId": "node-1", "layerDecomposition": false, "edit": "keep"}
			metadata := map[string]any{}
			for key, value := range others {
				metadata[key] = value
			}
			if tc.present {
				metadata["ecommerceTextMode"] = tc.value
			}
			input, err := normalizeTaskInput(map[string]any{"mode": "image", "metadata": metadata})
			if err != nil {
				t.Fatal(err)
			}
			normalized, _ := input["metadata"].(map[string]any)
			value, exists := normalized["ecommerceTextMode"]
			if tc.keep {
				if !exists || value != tc.value {
					t.Fatalf("normalized ecommerceTextMode = %#v (exists=%v), want %#v", value, exists, tc.value)
				}
			} else if exists {
				t.Fatalf("invalid ecommerceTextMode survived normalization: %#v", value)
			}
			for key, want := range others {
				if normalized[key] != want {
					t.Fatalf("normalizeTaskInput changed metadata[%q] = %#v, want %#v", key, normalized[key], want)
				}
			}
		})
	}
}

// 真实往返：CreateTask -> 落库 InputJSON -> 详情读模型，非法值不得到达任何一段。
func TestEcommerceTextModeRoundTripsCreateTaskAndDetail(t *testing.T) {
	for _, tc := range []struct {
		name  string
		value any
		keep  bool
	}{
		{"model", "model", true},
		{"local", "local", true},
		{"other-string", "cloud", false},
		{"number", float64(1), false},
		{"object", map[string]any{"mode": "model"}, false},
		{"array", []any{"model"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			req := creationTextRequest()
			req.Input["metadata"] = map[string]any{"source": "canvas", "nodeId": "node-1", "ecommerceTextMode": tc.value}
			task, err := s.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}

			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
				t.Fatal(err)
			}
			var persisted map[string]any
			if err := json.Unmarshal([]byte(stored.InputJSON), &persisted); err != nil {
				t.Fatalf("persisted input is not valid JSON: %v", err)
			}
			persistedMetadata, _ := persisted["metadata"].(map[string]any)
			assertEcommerceTextMode(t, "persisted", persistedMetadata, tc.value, tc.keep)

			detail, err := s.Task("user", task.ID)
			if err != nil {
				t.Fatal(err)
			}
			var detailInput map[string]any
			if err := json.Unmarshal([]byte(detail.InputJSON), &detailInput); err != nil {
				t.Fatalf("detail input is not valid JSON: %v", err)
			}
			detailMetadata, _ := detailInput["metadata"].(map[string]any)
			assertEcommerceTextMode(t, "detail", detailMetadata, tc.value, tc.keep)
			if detailMetadata["source"] != "canvas" || detailMetadata["nodeId"] != "node-1" {
				t.Fatalf("detail metadata changed: %#v", detailMetadata)
			}
		})
	}
}

func assertEcommerceTextMode(t *testing.T, stage string, metadata map[string]any, want any, keep bool) {
	t.Helper()
	value, exists := metadata["ecommerceTextMode"]
	if keep {
		if !exists || value != want {
			t.Fatalf("%s ecommerceTextMode = %#v (exists=%v), want %#v", stage, value, exists, want)
		}
		return
	}
	if exists {
		t.Fatalf("%s kept invalid ecommerceTextMode: %#v", stage, value)
	}
}
