package skills

import (
	"errors"
	"path/filepath"
	"regexp"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestDoubaoAudioBuiltinUsesSupportedCategory(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range packages {
		if item.skill.ID == "doubao-audio-prompt" {
			if item.skill.Tag != "creative" {
				t.Fatalf("doubao audio category = %q, want creative", item.skill.Tag)
			}
			return
		}
	}
	t.Fatal("doubao-audio-prompt builtin is missing")
}

// 总纲名录里写死的 `cards/…` 路径会被 Agent 直接交给 skill_read_file；
// 包里缺卡时只会在运行时报「读取参考资料失败」，所以在这里提前拦住。
func TestBuiltinPackagesShipReferencedCards(t *testing.T) {
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	// 只认具体文件名；`cards/<slug>.md` 这类占位写法不算引用。
	reference := regexp.MustCompile("`(cards/[^`<>\\s]+\\.md)`")
	for _, item := range packages {
		for _, match := range reference.FindAllStringSubmatch(string(item.archive.Files["SKILL.md"]), -1) {
			if _, ok := item.archive.Files[match[1]]; !ok {
				t.Errorf("builtin skill %s (%s) references missing %s", item.skill.ID, item.skill.Name, match[1])
			}
		}
	}
}

func TestBuiltinMarkdownPackagesPreserveHistoryAndUserState(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}, &model.User{}, &model.UserIdentity{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	const historyID = "16000000000081"
	state := model.UserSkillState{ID: "test-state", UserID: "test-user", SkillID: historyID, Added: true, Liked: true}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Skill{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != int64(len(packages)) {
		t.Fatalf("builtin skill count = %d, want %d", count, len(packages))
	}
	var saved model.UserSkillState
	if err := db.First(&saved, "id = ?", state.ID).Error; err != nil {
		t.Fatal(err)
	}
	if !saved.Added || !saved.Liked {
		t.Fatalf("user state lost: %#v", saved)
	}
	var skill model.Skill
	if err := db.First(&skill, "id = ?", historyID).Error; err != nil {
		t.Fatal(err)
	}
	if skill.CurrentVersionID == "" || skill.FileCount < 1 {
		t.Fatalf("history skill package not initialized: %#v", skill)
	}
}

// 管理员删掉的内置技能必须留下墓碑，重启同步不能把它装回来；否则用户删一次、
// 服务重启就复活一次，历史和收藏也会被清掉重来。
func TestBuiltinSkillTombstoneSurvivesResync(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "skills.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Skill{}, &model.UserSkillState{}, &model.SkillVersion{}, &model.SkillFile{}, &model.BuiltinSkillTombstone{}); err != nil {
		t.Fatal(err)
	}
	svc := New(repository.New(db), t.TempDir(), nil)
	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	const target = "14811816982028"
	var found bool
	for _, item := range packages {
		if item.skill.ID == target {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("内置技能 %s 不在技能包里，测试前提已变", target)
	}
	if err := db.Create(&model.BuiltinSkillTombstone{SkillID: target, DeletedBy: "test-admin"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.Skill{}, "id = ?", target).Error; err != nil {
		t.Fatal(err)
	}
	var before int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", target).Count(&before).Error; err != nil {
		t.Fatal(err)
	}

	if err := svc.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}

	var saved model.Skill
	err = db.First(&saved, "id = ?", target).Error
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("已删除的内置技能被同步复活: err = %v, skill = %#v", err, saved)
	}
	var after int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ?", target).Count(&after).Error; err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("墓碑技能被写入新版本: before=%d after=%d", before, after)
	}
}

func TestBuiltinSkillPackageMetadataParser(t *testing.T) {
	body := []byte("---\nname: 测试\ndescription: 描述\nmetadata:\n  version: \"1.0.0\"\n  tag: drama\n---\n\n正文\n")
	metadata, err := parseBuiltinSkillMetadata(body)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Name != "测试" || metadata.Description != "描述" || metadata.Version != "1.0.0" || metadata.Tag != "drama" {
		t.Fatalf("metadata = %#v", metadata)
	}
	if _, err := parseBuiltinSkillMetadata([]byte("# no frontmatter")); err == nil {
		t.Fatal("expected missing frontmatter error")
	}
}

// 电商自动注入只取 SKILL.md 的前 5000 个字符（ecommerceAutoSkillMaxRunes，见
// backend/internal/app/ecommerce_auto_skills.go）。原技能改写自外部即梦库，
// 开头是即梦工具表；若电商短分支被挤到截断窗口之外，Agent 拿到的就只有不存在的
// 工具名。这里钉住三件事：短分支在窗口内、契约关键词齐全、工具名覆盖声明先于工具表。
func TestSeriesSuiteBuiltinKeepsEcommerceBranchInsideTruncatedWindow(t *testing.T) {
	const (
		skillID    = "14811816982028"
		maxRunes   = 5000
		ecommerceB = "电商短分支"
	)

	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	var body string
	for _, item := range packages {
		if item.skill.ID == skillID {
			body = string(item.archive.Files["SKILL.md"])
			break
		}
	}
	if body == "" {
		t.Fatalf("内置技能 %s 缺失", skillID)
	}

	runes := []rune(body)
	if len(runes) <= maxRunes {
		t.Fatalf("技能正文只有 %d 字符，无需截断，测试前提已变", len(runes))
	}
	window := string(runes[:maxRunes])

	start := strings.Index(window, ecommerceB)
	if start < 0 {
		t.Fatalf("注入窗口内没有「%s」标记：Agent 读到的是即梦工具表而非本仓库电商契约", ecommerceB)
	}
	for _, want := range []string{
		"十屏",
		"3:4",
		"产品身份锁",
		"事实闸门",
		"未识别",
		"待补充",
		"skill_read_file",
		"generate_media",
	} {
		if !strings.Contains(window[start:], want) {
			t.Errorf("电商短分支缺少关键约束 %q", want)
		}
	}

	// 即梦工具名在本仓库不存在；覆盖声明必须排在工具表前面，模型才不会照着调用。
	override := strings.Index(window, "本仓库不存在")
	toolTable := strings.Index(window, `generate\_form\_for\_info\_collection`)
	if override < 0 {
		t.Fatal("缺少「本仓库不存在即梦工具」的覆盖声明")
	}
	if toolTable >= 0 && override > toolTable {
		t.Fatalf("覆盖声明位于即梦工具表之后（%d > %d），模型会先读到即梦工具名", override, toolTable)
	}
}

// 画布电商合同（见 web/src/lib/ecommerce/ecommerce-contract.ts 的 compileEcommercePrompt
// 与 backend/internal/app/ecommerce_settings.go 的运行时输出合同）：
//   - 文字模式由渲染配置决定：model 由图片模型直接画 row.copy；local 只出无字底图、本地叠一次。
//     不能统称「价格不交给图片模型」——事实闸门管的是「不造无依据的价格与宣称」。
//   - 槽位与主题由调用方传入的行给出，尊重用户删空/改删，不另立一套固定屏序。
//   - 本分支只是只读规划增强，不规定 ask_user -> generate_media -> OCR 之类的执行序列。
//   - 第九段 prompt 只写视觉/摆放/风格/负面；row.copy 是图上营销文字唯一来源，七项由共享编译器合成。
func TestSeriesSuiteEcommerceBranchMatchesCanvasCopyContract(t *testing.T) {
	const (
		skillID  = "14811816982028"
		maxRunes = 5000
		marker   = "电商短分支"
	)
	packages, err := loadBuiltinSkillPackages(nil)
	if err != nil {
		t.Fatal(err)
	}
	var body string
	for _, item := range packages {
		if item.skill.ID == skillID {
			body = string(item.archive.Files["SKILL.md"])
			break
		}
	}
	if body == "" {
		t.Fatalf("内置技能 %s 缺失", skillID)
	}

	runes := []rune(body)
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	window := string(runes)
	start := strings.Index(window, marker)
	if start < 0 {
		t.Fatalf("注入窗口内没有「%s」标记", marker)
	}
	// 只审本分支，别把后面那份即梦正文当成合同的一部分。
	branch := window[start:]
	if end := strings.Index(branch, "## 0. 角色定位"); end > 0 {
		branch = branch[:end]
	}

	for _, want := range []string{
		"`model`",
		"`local`",
		"无字底图",
		"本地叠",
		"row.copy",
		"第九段",
		"七项",
		"共享编译器",
		"槽位",
		"skill_read_file",
		"generate_media",
	} {
		if !strings.Contains(branch, want) {
			t.Errorf("电商短分支缺少合同要素 %q", want)
		}
	}

	// 这几条都是被指出过的合同冲突，写回去等于把 bug 重新引入。
	for _, forbidden := range []string{
		"价格、法律文字",
		"顺序骨架",
		"动手顺序",
		"ask_user",
		"image_text_detect",
		"不交给图片模型",
	} {
		if strings.Contains(branch, forbidden) {
			t.Errorf("电商短分支仍含合同冲突表述 %q", forbidden)
		}
	}
}
