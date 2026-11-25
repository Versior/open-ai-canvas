package app

import (
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strings"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const legacyStudioDetailImagePrompt = `【页面身份】
为淘宝 / 天猫制作手机端商品详情页连续长图成品图。
页面位置：第 2/10 屏；画幅：3:4。
商品详情区单屏，不是搜索主图。
平台名、屏序与屏型标记不印入画面。

【这一屏的画面】
展示键盘的紧凑布局。`

func TestStudioDetailContractAdmission(t *testing.T) {
	service, db, _, _ := ecommerceCreationTestService(t)
	features := defaultFeatureAvailability()
	features.EcommerceStudioEnabled, features.EcommerceEnabled, features.ImageWorkbenchEnabled = true, true, true
	saveAdmissionFeatures(t, service, features)
	imageModel := model.ChannelModel{ID: "studio-detail-image", ChannelID: "channel", ModelKey: "gpt-image-2", ProviderModelKey: "gpt-image-2", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, Enabled: true, PriceConfigured: true}
	profile := DefaultModelCapabilityConfigForModel(string(imageModel.Protocol), imageModel.ModelKey)
	profile.Image.Size.DefaultTier = "1k"
	imageModel.CapabilityConfigJSON = mustEncodeModelCapabilityConfig(t, profile)
	tier := newSelectionPriceTier("studio-detail-image-tier", "{}", imageModel.ModelKey, "fixed_request")
	tier.ChannelModelID = imageModel.ID
	for _, record := range []any{&imageModel, &tier} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	plan := creationTextRequest()
	plan.Input["metadata"] = map[string]any{
		"source": "ecommerce-studio", "ecommerceCapability": "detail-plan", "ecommerceAnalysisFlow": "cap:detail-plan", "studioStep": "plan",
		"studioPlanScope": "detail", "studioPlanKind": "detail", "studioPlanCount": 6, "studioPlanRoles": []string{"detail-hero", "detail-scene"},
	}
	image := CreateTaskRequest{Type: "canvas_image", Operation: "image", Prompt: legacyStudioDetailImagePrompt, Model: imageModel.ModelKey, Input: map[string]any{
		"mode": "image", "prompt": legacyStudioDetailImagePrompt,
		"config":   map[string]any{"channelId": "channel", "model": imageModel.ModelKey, "size": "3:4", "count": 1},
		"metadata": map[string]any{"source": "ecommerce-studio", "studioRole": "detail-scene"},
	}}
	project, err := service.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name     string
		request  CreateTaskRequest
		changes  map[string]any
		prompt   string
		fallback bool
		stale    bool
	}{
		{name: "old plan", request: plan, stale: true},
		{name: "old image", request: image, stale: true},
		{name: "old image fallback prompt", request: image, fallback: true, stale: true},
		{name: "old image CRLF", request: image, prompt: strings.ReplaceAll(legacyStudioDetailImagePrompt, "\n", "\r\n"), stale: true},
		{name: "string version", request: image, changes: map[string]any{"studioDetailContract": "3"}, stale: true},
		{name: "v2 plan", request: plan, changes: map[string]any{"studioDetailContract": 2}, stale: true},
		{name: "v2 image", request: image, changes: map[string]any{"studioDetailContract": 2}, prompt: "旧版设计提示", stale: true},
		{name: "new plan", request: plan, changes: map[string]any{"studioDetailContract": studioDetailContract}},
		{name: "new image", request: image, changes: map[string]any{"studioDetailContract": studioDetailContract}},
		{name: "new explicit no-text image", request: image, changes: map[string]any{"studioDetailContract": studioDetailContract}, prompt: legacyStudioDetailImagePrompt + "\n\n【图内文案】\n用户明确要求无字。"},
		{name: "template plan", request: plan, changes: map[string]any{"studioPlanScope": "template", "studioTemplateId": "suite-id", "studioTemplateSource": "library"}},
		{name: "main plan", request: plan, changes: map[string]any{"studioPlanScope": "main", "studioPlanKind": "main", "studioPlanCount": 5}},
		{name: "direction selection", request: plan, changes: map[string]any{"studioStep": "directions"}},
		{name: "template image", request: image, prompt: strings.Replace(legacyStudioDetailImagePrompt, "商品详情区单屏，不是搜索主图。", "商品详情区单屏，不是搜索主图、素材照或截图。", 1)},
		{name: "main image with detail role", request: image, prompt: "【页面身份】\n商品主图套图，首图用于搜索列表。"},
		{name: "marker in seller note", request: image, prompt: "【页面身份】\n商品主图套图。\n\n【卖家补充】\n商品详情区单屏，不是搜索主图。"},
		{name: "agent image", request: image, changes: map[string]any{"source": "ecommerce-agent", "ecommerceProjectId": project.ID}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := tc.request
			request.Input = maps.Clone(request.Input)
			metadata := maps.Clone(request.Input["metadata"].(map[string]any))
			maps.Copy(metadata, tc.changes)
			request.Input["metadata"] = metadata
			request.IdempotencyKey = t.Name()
			if tc.prompt != "" {
				request.Prompt, request.Input["prompt"] = tc.prompt, tc.prompt
			}
			if tc.fallback {
				delete(request.Input, "prompt")
			}
			before := studioDetailAdmissionEffects(t, db)
			task, err := service.CreateTask("user", request)
			after := studioDetailAdmissionEffects(t, db)
			if tc.stale {
				var appErr *AppError
				if task != nil || !errors.As(err, &appErr) || appErr.Status != http.StatusUnprocessableEntity || appErr.Code != http.StatusUnprocessableEntity || appErr.Reason != "studio_detail_contract_outdated" || appErr.Retryable {
					t.Errorf("old submission was not rejected as outdated: task created=%v, err=%#v", task != nil, err)
				}
				if before != after {
					t.Errorf("old submission changed task or billing state: before %+v, after %+v", before, after)
				}
				return
			}
			if err != nil || task == nil || task.BillingOrderID == "" || after.tasks != before.tasks+1 || after.orders != before.orders+1 {
				t.Fatalf("compatible submission did not enter the queue with a billing reservation: %v; before %+v, after %+v", err, before, after)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", model.TaskStatusSucceeded).Error; err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestStudioDetailContractRetainsAcceptedOldSubmission(t *testing.T) {
	service, db, _, _ := ecommerceCreationTestService(t)
	request := CreateTaskRequest{Type: "canvas_image", Prompt: legacyStudioDetailImagePrompt, IdempotencyKey: "old-browser-attempt", Input: map[string]any{
		"mode": "image", "prompt": legacyStudioDetailImagePrompt, "metadata": map[string]any{"source": "ecommerce-studio", "studioRole": "detail-scene", "studioDetailContract": 2},
	}}
	storedInput, err := json.Marshal(request.Input)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := service.submitPersonalTask("user", request.IdempotencyKey, "task", request, func(submission *personalTaskSubmission) (*model.Task, error) {
		task := &model.Task{UserID: "user", Type: request.Type, Prompt: request.Prompt, InputJSON: string(storedInput), Status: model.TaskStatusQueued}
		submission.assign(task)
		return task, db.Create(task).Error
	})
	if err != nil {
		t.Fatal(err)
	}
	before := studioDetailAdmissionEffects(t, db)
	if replayed, err := service.CreateTask("user", request); err != nil || replayed.ID != accepted.ID || replayed.Prompt != request.Prompt {
		t.Fatalf("accepted old request did not replay the existing task: %v", err)
	}
	request.Input["metadata"].(map[string]any)["studioDetailContract"] = studioDetailContract
	if _, err := service.CreateTask("user", request); !isSubmissionConflict(err) {
		t.Fatalf("adding a version to a frozen attempt did not conflict: %v", err)
	}
	stored, err := service.repo.TaskForUser("user", accepted.ID)
	if err != nil || stored.InputJSON != string(storedInput) {
		t.Fatalf("replay changed frozen task input: %v", err)
	}
	if after := studioDetailAdmissionEffects(t, db); after != before {
		t.Fatalf("replay changed task or billing state: before %+v, after %+v", before, after)
	}
}

type studioDetailEffects struct{ tasks, orders, ledger, available, reserved int64 }

func studioDetailAdmissionEffects(t *testing.T, db *gorm.DB) studioDetailEffects {
	t.Helper()
	var effects studioDetailEffects
	for table, result := range map[any]*int64{&model.Task{}: &effects.tasks, &model.BillingOrder{}: &effects.orders, &model.CreditLedgerEntry{}: &effects.ledger} {
		if err := db.Model(table).Count(result).Error; err != nil {
			t.Fatal(err)
		}
	}
	var account model.CreditAccount
	if err := db.First(&account, "user_id = ?", "user").Error; err != nil {
		t.Fatal(err)
	}
	effects.available, effects.reserved = account.AvailableMicrocredits, account.ReservedMicrocredits
	return effects
}
