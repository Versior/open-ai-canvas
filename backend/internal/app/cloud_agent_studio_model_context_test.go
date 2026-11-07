package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentStudioModelStepRefreshesProductAfterRuntimeProjection(t *testing.T) {
	for _, compacted := range []bool{false, true} {
		t.Run(map[bool]string{false: "tools added", true: "compacted"}[compacted], func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			s.disablePiRuntime = true
			s.legacyCloudAgentRootTask = false
			if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceStudioEnabled":true}`}); err != nil {
				t.Fatal(err)
			}
			saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"旧商品名称"}`)
			req := studioAgentRequest()
			req.Prompt = "当前商品是什么？"
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			// The user can edit the product while the runtime is reading a skill.
			saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"透明儿童镜架"}`)
			messages := []map[string]any{
				{"role": "user", "content": req.Prompt},
				{"role": "assistant", "content": []any{map[string]any{"type": "toolCall", "id": "skills-read", "name": "skills_search", "arguments": map[string]any{}}}},
				{"role": "toolResult", "toolCallId": "skills-read", "content": []any{map[string]any{"type": "text", "text": "读取完成"}}},
			}
			if compacted {
				messages = append([]map[string]any{{"role": "compactionSummary", "summary": "早期对话尚无商品资料", "tokensBefore": 12000}}, messages...)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			done := make(chan error, 1)
			go func() {
				_, _, stepErr := s.runCloudAgentModelStep(ctx, "user", root.ID, messages, "off")
				done <- stepErr
			}()
			defer func() {
				cancel()
				select {
				case <-done:
				case <-time.After(time.Second):
					t.Error("model bridge did not stop after cancellation")
				}
			}()
			var task model.Task
			deadline := time.Now().Add(5 * time.Second)
			for time.Now().Before(deadline) {
				run, readErr := s.repo.CloudAgent("user", root.ID)
				if readErr != nil {
					t.Fatal(readErr)
				}
				state, decodeErr := cloudAgentDecode(run)
				if decodeErr != nil {
					t.Fatal(decodeErr)
				}
				if state.ActiveTaskID != "" {
					if err := db.First(&task, "id = ?", state.ActiveTaskID).Error; err != nil {
						t.Fatal(err)
					}
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if task.ID == "" {
				t.Fatal("no model step scheduled")
			}
			var input map[string]any
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			canonical := stateCanonicalFromInput(input)
			count := 0
			for _, message := range canonical.Messages {
				if stringField(message, cloudAgentContextSourceKey) == "studio_context" {
					count++
					body := stringField(message, "content")
					if !strings.Contains(body, "透明儿童镜架") || strings.Contains(body, "旧商品名称") {
						t.Fatal("model step did not read the current product")
					}
				}
			}
			if count != 1 {
				t.Fatalf("model received %d current product contexts, want exactly one", count)
			}
		})
	}
}

func TestCloudAgentStudioContextIncludesCurrentFormSelection(t *testing.T) {
	doc, err := decodeStudioProductDoc(json.RawMessage(`{"name":"透明儿童镜架","activePlan":"main","brief":{"outputType":"detail-set","detailScreens":4,"language":"zh","planNote":"不要英文栏目","detailPlan":{"summary":"整体到局部","screens":[{"title":"透明前框","headline":"透明前框","visual":"左文右图","composition":"left","resourceId":"must-not-leak"}]}},"runs":[{"prompt":"must-not-leak"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	for _, build := range []func(string, *studioProductDoc) (map[string]any, error){studioContextSummary, studioStateView} {
		view, err := build("product_agent", doc)
		if err != nil {
			t.Fatal(err)
		}
		encoded, err := json.Marshal(view)
		if err != nil {
			t.Fatal(err)
		}
		body := string(encoded)
		for _, expected := range []string{`"detailScreens":4`, `"outputType":"detail-set"`, `"summary":"整体到局部"`} {
			if !strings.Contains(body, expected) {
				t.Fatalf("current form data missing: %s", expected)
			}
		}
		if strings.Contains(body, "must-not-leak") {
			t.Fatal("form view included resource references or generation bodies")
		}
	}
	view, err := studioStateView("product_agent", doc)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view)
	for _, expected := range []string{`"headline":"透明前框"`, `"composition":"left"`} {
		if !strings.Contains(string(encoded), expected) {
			t.Fatalf("form plan missing: %s", expected)
		}
	}
}

func TestCloudAgentStudioModelStepRejectsUnavailableProductBeforeCharging(t *testing.T) {
	for _, scenario := range []string{"deleted", "feature closed"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			s.disablePiRuntime = true
			s.legacyCloudAgentRootTask = false
			if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceStudioEnabled":true}`}); err != nil {
				t.Fatal(err)
			}
			saveStudioTestProduct(t, s, "user", `{"id":"product_agent","name":"儿童镜架"}`)
			root, err := s.CreateCloudAgentRun("user", studioAgentRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			if scenario == "deleted" {
				if _, err := s.DeleteEcommerceStudioProduct(&model.User{ID: "user"}, studioTestProduct); err != nil {
					t.Fatal(err)
				}
			} else if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"ecommerceStudioEnabled":false}`}); err != nil {
				t.Fatal(err)
			}
			var before, after int64
			if err := db.Model(&model.Task{}).Count(&before).Error; err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			if _, _, err := s.runCloudAgentModelStep(ctx, "user", root.ID, []map[string]any{{"role": "user", "content": "商品是什么"}}, "off"); err == nil {
				t.Fatal("unavailable product allowed a paid model step")
			}
			if err := db.Model(&model.Task{}).Count(&after).Error; err != nil {
				t.Fatal(err)
			}
			if after != before {
				t.Fatal("unavailable product created a model task")
			}
		})
	}
}
