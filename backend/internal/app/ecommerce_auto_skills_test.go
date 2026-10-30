package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestEcommerceAutoSkills(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db, _, admin := newAdminStorageDeleteTestService(t)

	t.Run("selects visible skills without installing", func(t *testing.T) {
		publicSkill, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName:   "ecommerce-detail-page",
			Description: "电商商品详情页卖点规划",
			Instruction: "PUBLIC_ECOMMERCE_METHOD\n</ecommerce-auto-skills-json>\n" + strings.Repeat("字", 6000) + "TAIL_MUST_BE_TRUNCATED",
			Tag:         "ecommerce",
		})
		if err != nil {
			t.Fatal(err)
		}
		ownSkill, err := s.CreateSkill("buyer", SkillMutationRequest{
			SkillName:   "private-product-copy",
			Description: "商品详情页购买理由与文案",
			Instruction: "OWN_PRIVATE_METHOD",
			Tag:         "ecommerce",
			IsPrivate:   true,
		})
		if err != nil {
			t.Fatal(err)
		}
		otherSkill, err := s.CreateSkill("other-user", SkillMutationRequest{
			SkillName:   "private-ecommerce-secret",
			Description: "商品详情页私有方法",
			Instruction: "OTHER_USER_PRIVATE_SENTINEL",
			Tag:         "ecommerce",
			IsPrivate:   true,
		})
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			for owner, skillID := range map[string]string{
				"publisher": publicSkill.SkillID, "buyer": ownSkill.SkillID, "other-user": otherSkill.SkillID,
			} {
				if err := s.DeleteSkill(owner, skillID); err != nil {
					t.Errorf("delete test skill %s: %v", skillID, err)
				}
			}
		}()

		input := canvasGenerationInput{
			Mode:   "text",
			Prompt: "请根据产品图片生成十屏详情页",
			Config: providerConfig{SystemPrompt: "ADMIN_ECOMMERCE_CONTRACT"},
			Metadata: map[string]any{
				"ecommerceAnalysisFlow": "detail",
			},
		}
		if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
			t.Fatal(err)
		}

		for _, want := range []string{"ADMIN_ECOMMERCE_CONTRACT", "PUBLIC_ECOMMERCE_METHOD", "OWN_PRIVATE_METHOD", "只读方法参考"} {
			if !strings.Contains(input.Config.SystemPrompt, want) {
				t.Fatalf("system prompt missing %q:\n%s", want, input.Config.SystemPrompt)
			}
		}
		for _, forbidden := range []string{otherSkill.SkillID, "OTHER_USER_PRIVATE_SENTINEL", "TAIL_MUST_BE_TRUNCATED"} {
			if strings.Contains(input.Config.SystemPrompt, forbidden) {
				t.Fatalf("system prompt leaked or exceeded its content budget: %q", forbidden)
			}
		}
		if strings.Count(input.Config.SystemPrompt, "</ecommerce-auto-skills-json>") != 1 {
			t.Fatal("untrusted skill content escaped its JSON boundary")
		}

		selected, ok := input.Metadata["ecommerceAutoSkills"].([]map[string]any)
		if !ok || len(selected) != 2 {
			t.Fatalf("selected skill metadata = %#v", input.Metadata["ecommerceAutoSkills"])
		}
		wantSnapshots := map[string]*SkillItem{publicSkill.SkillID: publicSkill, ownSkill.SkillID: ownSkill}
		for _, snapshot := range selected {
			id, _ := snapshot["skillId"].(string)
			want := wantSnapshots[id]
			if want == nil || snapshot["versionId"] != want.VersionID || snapshot["contentHash"] != want.ContentHash {
				t.Fatalf("skill snapshot was not frozen: %#v", snapshot)
			}
		}
		publicAfter, err := s.SkillDetail("buyer", publicSkill.SkillID)
		if err != nil {
			t.Fatal(err)
		}
		if publicAfter.IsAdded {
			t.Fatal("automatic skill selection must not install a public skill")
		}
	})

	t.Run("uses administrator root and category labels", func(t *testing.T) {
		rootMatch, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName: "neutral-root-method", Description: "neutral reference", Instruction: "ADMIN_CURATED_ROOT_METHOD", Tag: "others",
		})
		if err != nil {
			t.Fatal(err)
		}
		categoryMatch, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName: "neutral-category-method", Description: "neutral reference", Instruction: "ADMIN_CURATED_DETAIL_METHOD", Tag: "others",
		})
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			for _, skillID := range []string{rootMatch.SkillID, categoryMatch.SkillID} {
				if err := s.DeleteSkill("publisher", skillID); err != nil {
					t.Errorf("delete test skill %s: %v", skillID, err)
				}
			}
		}()
		if err := db.Model(&model.SkillCurationSetting{}).Where("id = ?", 1).Update("enabled", true).Error; err != nil {
			t.Fatal(err)
		}
		roots := []model.SkillCurationRoot{
			{ID: "detail-root", Name: "电商详情页", NormalizedName: "电商详情页", Enabled: true},
			{ID: "neutral-root", Name: "Neutral Root", NormalizedName: "neutral root", Enabled: true},
		}
		if err := db.Create(&roots).Error; err != nil {
			t.Fatal(err)
		}
		category := model.SkillCurationCategory{ID: "visual-category", RootTag: "neutral-root", Name: "商品卖点视觉", NormalizedName: "商品卖点视觉", Enabled: true}
		if err := db.Create(&category).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&[]model.SkillCurationRootAssignment{
			{SkillID: rootMatch.SkillID, RootID: "detail-root"},
			{SkillID: categoryMatch.SkillID, RootID: "neutral-root"},
		}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.SkillCurationAssignment{SkillID: categoryMatch.SkillID, CategoryID: category.ID}).Error; err != nil {
			t.Fatal(err)
		}

		input := canvasGenerationInput{
			Mode: "text", Prompt: "为保温杯规划商业页面", Config: providerConfig{SystemPrompt: "ADMIN_CONTRACT"},
			Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
		}
		if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"ADMIN_CURATED_ROOT_METHOD", "ADMIN_CURATED_DETAIL_METHOD"} {
			if !strings.Contains(input.Config.SystemPrompt, want) {
				t.Fatalf("administrator curation label did not participate in selection: %q", want)
			}
		}
	})

	t.Run("keeps prompt unchanged when nothing matches", func(t *testing.T) {
		if _, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName: "short-drama-twist", Description: "古装短剧反转方法", Instruction: "UNRELATED_SKILL_SENTINEL", Tag: "drama",
		}); err != nil {
			t.Fatal(err)
		}
		input := canvasGenerationInput{
			Mode: "text", Prompt: "量子纠缠炒菜", Config: providerConfig{SystemPrompt: "ADMIN_ONLY"},
			Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
		}
		if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
			t.Fatal(err)
		}
		if input.Config.SystemPrompt != "ADMIN_ONLY" {
			t.Fatalf("no-match fallback changed the system prompt: %q", input.Config.SystemPrompt)
		}
		selected, ok := input.Metadata["ecommerceAutoSkills"].([]map[string]any)
		if !ok || len(selected) != 0 {
			t.Fatalf("no-match metadata = %#v", input.Metadata["ecommerceAutoSkills"])
		}
	})

	t.Run("ordinary worker injects selected skill context", func(t *testing.T) {
		if _, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName: "worker-ecommerce-detail", Description: "电商商品详情页卖点规划", Instruction: "WORKER_AUTO_SKILL_SENTINEL", Tag: "ecommerce",
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := s.CreateSkill("other-user", SkillMutationRequest{
			SkillName: "worker-private-secret", Description: "电商商品详情页卖点规划", Instruction: "WORKER_PRIVATE_LEAK_SENTINEL", Tag: "ecommerce", IsPrivate: true,
		}); err != nil {
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
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"planned with skill"}}]}`))
		}))
		defer server.Close()
		stream := false
		input := canvasGenerationInput{
			Mode: "text", Prompt: "verified product facts",
			Config:   providerConfig{BaseURL: server.URL, APIKey: "UNIT_TEST_API_KEY", Model: "text-test", InterfaceType: "newapi-chat", APIFormat: "openai"},
			Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
		}
		input.TextOptions.Stream = &stream
		raw, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		result, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_text", "", string(raw))
		if err != nil {
			t.Fatalf("worker failed before completing upstream call: %v", err)
		}
		if result["text"] != "planned with skill" {
			t.Fatalf("worker result = %#v", result)
		}
		select {
		case body := <-received:
			encoded, _ := json.Marshal(body)
			text := string(encoded)
			if !strings.Contains(text, "WORKER_AUTO_SKILL_SENTINEL") {
				t.Fatalf("ordinary ecommerce worker did not inject the selected skill: %s", text)
			}
			if strings.Contains(text, "WORKER_PRIVATE_LEAK_SENTINEL") {
				t.Fatalf("ordinary ecommerce worker leaked another user's private skill: %s", text)
			}
		default:
			t.Fatal("mock upstream received no request")
		}
	})
}

func TestEcommerceAutoSkillsSkipsBrokenCandidates(t *testing.T) {
	s, db, dataDir, _ := newAdminStorageDeleteTestService(t)
	created := map[string]*SkillItem{}
	sentinels := map[string]string{}
	for index := 1; index <= 3; index++ {
		sentinel := fmt.Sprintf("RESILIENT_ECOMMERCE_METHOD_%d", index)
		skill, err := s.CreateSkill("buyer", SkillMutationRequest{
			SkillName:   fmt.Sprintf("resilient-ecommerce-candidate-%d", index),
			Description: "电商商品详情页卖点规划 resilient-candidate",
			Instruction: sentinel,
			Tag:         "ecommerce",
			IsPrivate:   true,
		})
		if err != nil {
			t.Fatal(err)
		}
		created[skill.SkillID] = skill
		sentinels[skill.SkillID] = sentinel
	}

	catalog, err := s.ecommerceAutoSkillCatalog("buyer")
	if err != nil {
		t.Fatal(err)
	}
	result, err := cloudAgentSearchSkills(catalog, ecommerceAutoSkillQuery("detail", "resilient-candidate"), cloudAgentSkillSearchMax)
	if err != nil {
		t.Fatal(err)
	}
	matches := result["matches"].([]map[string]any)
	if len(matches) != 3 {
		t.Fatalf("ranked candidate count = %d, want 3", len(matches))
	}
	firstID := matches[0]["skillId"].(string)
	secondID := matches[1]["skillId"].(string)
	thirdID := matches[2]["skillId"].(string)

	if result := db.Model(&model.SkillFile{}).
		Where("skill_version_id = ? AND path = ?", created[firstID].VersionID, cloudAgentSkillEntryPath).
		Update("mime_type", "application/octet-stream"); result.Error != nil || result.RowsAffected != 1 {
		t.Fatalf("corrupt first candidate entry: rows=%d err=%v", result.RowsAffected, result.Error)
	}
	var secondVersion model.SkillVersion
	if err := db.First(&secondVersion, "id = ?", created[secondID].VersionID).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dataDir, "skill-packages", filepath.FromSlash(secondVersion.PackageKey))); err != nil {
		t.Fatal(err)
	}

	input := canvasGenerationInput{
		Mode: "text", Prompt: "resilient-candidate", Config: providerConfig{SystemPrompt: "ADMIN_CONTRACT"},
		Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
	}
	if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
		t.Fatalf("candidate-local failure blocked ecommerce task: %v", err)
	}
	if !strings.Contains(input.Config.SystemPrompt, sentinels[thirdID]) {
		t.Fatalf("usable fallback candidate was not selected: %s", input.Config.SystemPrompt)
	}
	selected, ok := input.Metadata[ecommerceAutoSkillsMetadataKey].([]map[string]any)
	if !ok || len(selected) != 1 || selected[0]["skillId"] != thirdID {
		t.Fatalf("selected fallback metadata = %#v", input.Metadata[ecommerceAutoSkillsMetadataKey])
	}
	for _, brokenID := range []string{firstID, secondID} {
		if strings.Contains(input.Config.SystemPrompt, sentinels[brokenID]) {
			t.Fatalf("broken candidate %s leaked into the system prompt", brokenID)
		}
	}
}

func TestEcommerceAutoSkillsCatalogFailureIsOptional(t *testing.T) {
	s, db, _, _ := newAdminStorageDeleteTestService(t)
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Fatal(err)
	}

	input := canvasGenerationInput{
		Mode: "text", Prompt: "catalog-failure", Config: providerConfig{SystemPrompt: "ADMIN_CONTRACT"},
		Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
	}
	if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
		t.Fatalf("optional auto-skill catalog blocked ecommerce task: %v", err)
	}
	if input.Config.SystemPrompt != "ADMIN_CONTRACT" {
		t.Fatalf("catalog failure changed the system prompt: %q", input.Config.SystemPrompt)
	}
	selected, ok := input.Metadata[ecommerceAutoSkillsMetadataKey].([]map[string]any)
	if !ok || len(selected) != 0 {
		t.Fatalf("catalog failure metadata = %#v", input.Metadata[ecommerceAutoSkillsMetadataKey])
	}
}

// 取消与权限失败不能被「自动技能可选」吞掉，其余目录故障才降级。
func TestEcommerceAutoSkillsFatalErrorsAreNotOptional(t *testing.T) {
	for _, err := range []error{context.Canceled, context.DeadlineExceeded,
		kernel.Unauthorized("未登录"), kernel.Forbidden("无权访问")} {
		if !ecommerceAutoSkillFatal(err) {
			t.Fatalf("%v 必须冒泡，不能被当作可选降级", err)
		}
	}
	for _, err := range []error{errors.New("数据库关闭"), kernel.NotFound("技能不存在")} {
		if ecommerceAutoSkillFatal(err) {
			t.Fatalf("%v 不应阻断电商任务", err)
		}
	}
}

// 电商目录同样必须翻页：排在 80 条之后的候选仍要进入检索。
func TestEcommerceAutoSkillCatalogPagesBeyondFirstPage(t *testing.T) {
	s, db, _, _ := newAdminStorageDeleteTestService(t)
	noiseIDs := make([]string, 0, ecommerceAutoSkillPageSize+5)
	for index := 0; index < ecommerceAutoSkillPageSize+5; index++ {
		noise, err := s.CreateSkill("publisher", SkillMutationRequest{
			SkillName: fmt.Sprintf("catalog-noise-%d", index), Description: "园艺植物的日常养护", Instruction: "# 园艺", Tag: "others",
		})
		if err != nil {
			t.Fatal(err)
		}
		noiseIDs = append(noiseIDs, noise.SkillID)
	}
	candidate, err := s.CreateSkill("publisher", SkillMutationRequest{
		SkillName: "ecommerce-paged-candidate", Description: "电商详情页卖点规划", Instruction: "# 详情页", Tag: "ecommerce",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id IN ?", noiseIDs).Update("sort_weight", 100).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Skill{}).Where("id = ?", candidate.SkillID).Update("sort_weight", 0).Error; err != nil {
		t.Fatal(err)
	}

	catalog, err := s.ecommerceAutoSkillCatalog("user")
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog) <= ecommerceAutoSkillPageSize {
		t.Fatalf("catalog = %d, 未翻页（应 > %d）", len(catalog), ecommerceAutoSkillPageSize)
	}
	found := false
	for _, item := range catalog {
		if item.ID == candidate.SkillID {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("翻页后仍未包含排在后面的候选技能")
	}
}

// 日志只允许出现固定 stage/类别；技能正文与 skillId 不得进日志。
func TestEcommerceAutoSkillLogsCarryOnlyStageAndCategory(t *testing.T) {
	s, db, _, _ := newAdminStorageDeleteTestService(t)
	const sentinel = "PRIVATE_SKILL_BODY_MUST_NOT_BE_LOGGED"
	skill, err := s.CreateSkill("publisher", SkillMutationRequest{
		SkillName:   "logged-candidate",
		Description: "电商商品详情页卖点规划 logged-candidate",
		Instruction: sentinel,
		Tag:         "ecommerce",
	})
	if err != nil {
		t.Fatal(err)
	}
	if result := db.Model(&model.SkillFile{}).
		Where("skill_version_id = ? AND path = ?", skill.VersionID, cloudAgentSkillEntryPath).
		Update("mime_type", "application/octet-stream"); result.Error != nil || result.RowsAffected != 1 {
		t.Fatalf("corrupt candidate entry: rows=%d err=%v", result.RowsAffected, result.Error)
	}

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	input := canvasGenerationInput{
		Mode: "text", Prompt: "logged-candidate", Config: providerConfig{SystemPrompt: "ADMIN_CONTRACT"},
		Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
	}
	if err := s.applyEcommerceAutoSkills("buyer", &input); err != nil {
		t.Fatalf("candidate-stage failure must stay optional: %v", err)
	}

	text := logs.String()
	if text == "" {
		t.Fatal("期望候选被跳过时产生一条结构化告警")
	}
	for _, forbidden := range []string{sentinel, skill.SkillID, "logged-candidate"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("日志泄露了私有内容 %q: %s", forbidden, text)
		}
	}
	for _, want := range []string{`"stage":"entry"`, `"category":"binary_entry"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("日志缺少固定字段 %s: %s", want, text)
		}
	}
}

// 候选阶段不允许把「他人私有技能」的 403 当成可选跳过：必须冒泡，
// 且错误与日志都不得带私有哨兵正文。
func TestEcommerceAutoSkillCandidateSurfacesPermissionAndHidesSentinel(t *testing.T) {
	s, _, _, _ := newAdminStorageDeleteTestService(t)
	const sentinel = "PRIVATE_SENTINEL_MUST_NOT_ESCAPE"
	private, err := s.CreateSkill("owner-user", SkillMutationRequest{
		SkillName:   "private-owned-candidate",
		Description: "电商商品详情页卖点规划",
		Instruction: sentinel,
		Tag:         "ecommerce",
		IsPrivate:   true,
	})
	if err != nil {
		t.Fatal(err)
	}

	var logs bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })

	_, fatal, skip := s.ecommerceAutoSkillCandidate("intruder", private.SkillID)
	if fatal == nil {
		t.Fatalf("他人私有技能的候选读取必须冒泡权限错误，得到 fatal=nil skip=%v", skip)
	}
	var appErr *kernel.AppError
	if !errors.As(fatal, &appErr) || appErr.Status != kernel.CodeForbidden {
		t.Fatalf("fatal = %v, want 403", fatal)
	}
	if strings.Contains(fatal.Error(), sentinel) {
		t.Fatal("权限错误回显了私有技能正文")
	}
	if text := logs.String(); strings.Contains(text, sentinel) || strings.Contains(text, private.SkillID) {
		t.Fatalf("权限错误进了日志：%s", text)
	}
}

// 取消必须冒泡，不能被候选降级吞掉。
func TestEcommerceAutoSkillFatalCoversCancelAndPermissionOnly(t *testing.T) {
	if !ecommerceAutoSkillFatal(fmt.Errorf("wrap: %w", context.Canceled)) {
		t.Fatal("包裹后的取消也必须冒泡")
	}
	if ecommerceAutoSkillFatal(kernel.BadAuthRequest("候选格式无效")) {
		t.Fatal("400 属于候选局部失败，不应阻断整轮")
	}
}

// 零命中时 cloudAgentSearchSkills 降级成整池索引，条目没有 score：
// 那不是命中，不能让普通电商任务注入无关技能。
func TestEcommerceAutoSkillHitRequiresPositiveScore(t *testing.T) {
	for _, match := range []map[string]any{
		{},
		{"skillId": "indexed-without-score"},
		{"score": 0},
		{"score": -3},
	} {
		if ecommerceAutoSkillHit(match) {
			t.Fatalf("降级索引或无正分条目被当成命中: %#v", match)
		}
	}
	if !ecommerceAutoSkillHit(map[string]any{"score": 2}) {
		t.Fatal("正分命中必须通过")
	}
}

// 单元级私有错误边界：AutoSkills 真实抛出的 401 直接进 privateEcommerceAnalysisError，
// 必须保留 status/reason，且不把私有正文带入最终错误。
// 注意这里直接调用脱敏函数，没有经过 processCanvasGenerationTask，
// 因此不能当作真实 worker 端到端证据；worker 层的停用/上行链路由
// ecommerce_image_transport_test.go 与 ecommerce_analysis_transport_test.go 覆盖。
func TestEcommerceAutoSkillPermissionSurvivesPrivateSanitizer(t *testing.T) {
	s, _, _, _ := newAdminStorageDeleteTestService(t)
	if _, err := s.CreateSkill("publisher", SkillMutationRequest{
		SkillName: "public-ecommerce-method", Description: "电商商品详情页卖点规划", Instruction: "# 公开方法", Tag: "ecommerce",
	}); err != nil {
		t.Fatal(err)
	}
	input := canvasGenerationInput{
		Mode: "text", Prompt: "needs-identity", Config: providerConfig{SystemPrompt: "ADMIN_CONTRACT"},
		Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
	}
	settingsErr := s.applyEcommerceAutoSkills("", &input)
	if settingsErr == nil {
		t.Fatal("未登录时目录必须抛出权限错误，而不是静默降级")
	}
	var direct *kernel.AppError
	if !errors.As(settingsErr, &direct) || direct.Status != kernel.CodeUnauthorized {
		t.Fatalf("AutoSkills error = %v, want 401", settingsErr)
	}

	// provider.go:172-178 的 defer 调用的就是这个函数，但此处是直接调用而非经 worker。
	filtered := privateEcommerceAnalysisError(settingsErr)
	var appErr *kernel.AppError
	if !errors.As(filtered, &appErr) {
		t.Fatalf("filtered = %T, want *kernel.AppError", filtered)
	}
	if appErr.Status != kernel.CodeUnauthorized || appErr.Reason != kernel.ReasonUnauthorized {
		t.Fatalf("status/reason = %d/%s, want 401/unauthorized", appErr.Status, appErr.Reason)
	}
	for _, forbidden := range []string{"ADMIN_CONTRACT", "needs-identity"} {
		if strings.Contains(filtered.Error(), forbidden) {
			t.Fatalf("脱敏后错误泄露了 %q: %s", forbidden, filtered.Error())
		}
	}
}

func TestEcommerceAutoSkillsAllBrokenDoesNotBlockWorker(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db, dataDir, admin := newAdminStorageDeleteTestService(t)
	brokenEntry, err := s.CreateSkill(admin.ID, SkillMutationRequest{
		SkillName: "broken-entry-ecommerce", Description: "电商商品详情页卖点规划", Instruction: "BROKEN_ENTRY_SENTINEL", Tag: "ecommerce", IsPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	brokenArchive, err := s.CreateSkill(admin.ID, SkillMutationRequest{
		SkillName: "broken-archive-ecommerce", Description: "电商商品详情页卖点规划", Instruction: "BROKEN_ARCHIVE_SENTINEL", Tag: "ecommerce", IsPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result := db.Model(&model.SkillFile{}).
		Where("skill_version_id = ? AND path = ?", brokenEntry.VersionID, cloudAgentSkillEntryPath).
		Update("mime_type", "application/octet-stream"); result.Error != nil || result.RowsAffected != 1 {
		t.Fatalf("corrupt entry candidate: rows=%d err=%v", result.RowsAffected, result.Error)
	}
	var version model.SkillVersion
	if err := db.First(&version, "id = ?", brokenArchive.VersionID).Error; err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(dataDir, "skill-packages", filepath.FromSlash(version.PackageKey))); err != nil {
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
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"continued without skills"}}]}`))
	}))
	defer server.Close()
	stream := false
	input := canvasGenerationInput{
		Mode: "text", Prompt: "电商商品详情页卖点规划", Metadata: map[string]any{"ecommerceAnalysisFlow": "detail"},
		Config: providerConfig{BaseURL: server.URL, APIKey: "UNIT_TEST_API_KEY", Model: "text-test", InterfaceType: "newapi-chat", APIFormat: "openai", SystemPrompt: "ADMIN_CONTRACT"},
	}
	input.TextOptions.Stream = &stream
	raw, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.processCanvasGenerationTask(context.Background(), admin.ID, "", "canvas_text", "", string(raw))
	if err != nil {
		t.Fatalf("all broken auto skills blocked worker: %v", err)
	}
	if result["text"] != "continued without skills" {
		t.Fatalf("worker result = %#v", result)
	}
	select {
	case body := <-received:
		encoded, _ := json.Marshal(body)
		text := string(encoded)
		for _, forbidden := range []string{"BROKEN_ENTRY_SENTINEL", "BROKEN_ARCHIVE_SENTINEL", "ecommerce-auto-skills-json"} {
			if strings.Contains(text, forbidden) {
				t.Fatalf("broken auto skill leaked upstream: %s", text)
			}
		}
	default:
		t.Fatal("mock upstream received no request")
	}
}
