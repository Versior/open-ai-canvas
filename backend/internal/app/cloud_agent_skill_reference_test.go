package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

// 本轮参考技能（SkillReferences）的两条接缝契约：
// 1. 冻结去重：同一技能在同一轮里只能冻结一次，否则 state 校验会拒绝整轮。
// 2. 缓存回放复核：冻结 key 不能代替实时可见性/版本复核，停用或更新后不得回放旧正文。

// skillReferenceFixture 建一个本轮可见、可被 skill_search 冻结的用户技能，
// 并用真实检索链路完成冻结，返回服务、技能 ID 与本轮运行时状态。
func skillReferenceFixture(t *testing.T) (*Service, string, *cloudAgentRuntime) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	created, err := s.CreateSkill("user", SkillMutationRequest{
		SkillName:   "剧本撰写",
		Description: "短剧剧本工作法",
		Instruction: "# 剧本撰写\n\n先定钩子，再写反转。",
		Tag:         "drama",
		IsPrivate:   true,
	})
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{}
	if _, err := cloudAgentReadTool(nil, "user", state, skillSearchCall(`{"keyword":"剧本 撰写","limit":4}`), s); err != nil {
		t.Fatal(err)
	}
	if len(state.SkillReferences) != 1 || state.SkillReferences[0].ID != created.SkillID {
		t.Fatalf("fixture did not freeze exactly one reference: %+v", state.SkillReferences)
	}
	return s, created.SkillID, state
}

func skillSearchCall(arguments string) cloudAgentCall {
	call := cloudAgentCall{ID: "skill-search"}
	call.Function.Name = "skill_search"
	call.Function.Arguments = arguments
	return call
}

// 广场技能在冻结后被改名/改简介（版本不变）：用新关键词再搜一次，不得把同一技能重复冻结。
// 重复冻结会让 state.SkillReferences 出现重复 ID，checkpoint 校验直接判整轮失败。
func TestCloudAgentSkillReferenceDiscoveryDoesNotFreezeDuplicates(t *testing.T) {
	s, id, state := skillReferenceFixture(t)

	row, err := s.repo.Skill(id)
	if err != nil {
		t.Fatal(err)
	}
	row.Name = "带货口播"
	row.Description = "带货口播转化结构"
	if err := s.repo.SaveSkill(row); err != nil {
		t.Fatal(err)
	}

	if _, err := cloudAgentReadTool(nil, "user", state, skillSearchCall(`{"keyword":"口播 转化","limit":4}`), s); err != nil {
		t.Fatal(err)
	}
	if len(state.SkillReferences) != 1 {
		t.Fatalf("renamed reference skill was frozen twice: %+v", state.SkillReferences)
	}
	seen := map[string]bool{}
	for _, ref := range state.SkillReferences {
		if seen[ref.ID] {
			t.Fatalf("duplicate frozen reference id %q", ref.ID)
		}
		seen[ref.ID] = true
	}
}

// 参考技能被停用后，同参缓存回放必须失败，不能把已下线的正文再交给模型。
// 这里读的是 SKILL.md 正文，撤销后的断言检查的是「正文不再可达」，不是目录清单。
func TestCloudAgentSkillReferenceReplayHonorsDisabledSkill(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(id, cloudAgentSkillEntryPath)

	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	body, ok := first.(map[string]any)
	content, hasContent := body["content"].(string)
	if !ok || !hasContent || content == "" {
		t.Fatalf("reference SKILL.md was not readable: %#v", first)
	}
	// 真实运行时会先把结果写进 canonical transcript；按同一合同复现回放前提。
	cloudAgentToolResult("", state, call, first, nil)
	replay, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatalf("unchanged reference must still replay: %v", err)
	}
	if receipt, ok := replay.(map[string]any); !ok || receipt["cacheReplay"] != true {
		t.Fatalf("unchanged reference did not replay from cache: %#v", replay)
	}

	row, err := s.repo.Skill(id)
	if err != nil {
		t.Fatal(err)
	}
	row.Status = 0
	if err := s.repo.SaveSkill(row); err != nil {
		t.Fatal(err)
	}
	result, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err == nil {
		t.Fatalf("cached body of a disabled reference skill was replayed: %#v", result)
	}
}

// 参考技能在本轮开始后更新（版本与哈希变化）：缓存回放必须按冻结版本报冲突。
func TestCloudAgentSkillReferenceReplayHonorsFrozenVersion(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(id, cloudAgentSkillEntryPath)
	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	cloudAgentToolResult("", state, call, first, nil)

	frozen := state.SkillReferences[0]
	if _, err := s.UpdateSkill("user", id, SkillMutationRequest{
		SkillName:   "剧本撰写",
		Description: "短剧剧本工作法",
		Instruction: "# 剧本撰写\n\n改版：先写反转，再补钩子。",
		Tag:         "drama",
		IsPrivate:   true,
	}); err != nil {
		t.Fatal(err)
	}
	detail, err := s.SkillDetail("user", id)
	if err != nil {
		t.Fatal(err)
	}
	if detail.VersionID == frozen.Version || detail.ContentHash == frozen.Hash {
		t.Fatalf("fixture did not change the frozen version: %+v -> %+v", frozen, detail)
	}

	result, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err == nil {
		t.Fatalf("cached body survived a frozen-version mismatch: %#v", result)
	}
}

// 没有技能服务能复核可见性时，参考技能不得回放正文；普通画布/偏好缓存不受影响。
func TestCloudAgentSkillReferenceReplayRequiresService(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(id, "")
	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	cloudAgentToolResult("", state, call, first, nil)

	result, err := cloudAgentReadToolCached(nil, "user", state, call)
	if err == nil {
		t.Fatalf("reference body replayed without any visibility check: %#v", result)
	}

	profile := cloudAgentCall{ID: "profile"}
	profile.Function.Name = "agent_profile_read"
	profile.Function.Arguments = `{"scope":"user"}`
	state.Profile = cloudAgentProfileSnapshot{Layers: []AgentProfileLayer{{Scope: model.AgentProfileScopeUser, Content: "固定偏好"}}}
	if _, err := cloudAgentReadToolCached(nil, "user", state, profile); err != nil {
		t.Fatalf("non-skill read must not require the skill service: %v", err)
	}
	if _, err := cloudAgentReadToolCached(nil, "user", state, profile); err != nil {
		t.Fatalf("non-skill replay must stay unaffected: %v", err)
	}
}

// skillId 带空白也必须复核：现读会 TrimSpace 后成功，回放若按原始参数匹配就能绕过复核。
func TestCloudAgentSkillReferenceReplayTrimsSkillID(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(" "+id+" ", cloudAgentSkillEntryPath)

	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatalf("padded skillId must resolve like the fresh read does: %v", err)
	}
	body, ok := first.(map[string]any)
	content, hasContent := body["content"].(string)
	if !ok || !hasContent || content == "" {
		t.Fatalf("padded skillId did not read the frozen body: %#v", first)
	}
	cloudAgentToolResult("", state, call, first, nil)

	if _, err := cloudAgentReadToolCached(nil, "user", state, call, s); err != nil {
		t.Fatalf("unchanged reference must replay: %v", err)
	}

	row, err := s.repo.Skill(id)
	if err != nil {
		t.Fatal(err)
	}
	row.Status = 0
	if err := s.repo.SaveSkill(row); err != nil {
		t.Fatal(err)
	}
	result, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err == nil {
		t.Fatalf("padded skillId bypassed reference revalidation: %#v", result)
	}
}

// 回放不消耗真实读取预算（原有合同，改动后必须保持）。
func TestCloudAgentSkillReferenceReplayKeepsReadBudget(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(id, cloudAgentSkillEntryPath)
	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	cloudAgentToolResult("", state, call, first, nil)
	if state.ReadToolCalls != 1 {
		t.Fatalf("first read consumed %d budget units", state.ReadToolCalls)
	}
	if _, err := cloudAgentReadToolCached(nil, "user", state, call, s); err != nil {
		t.Fatal(err)
	}
	if state.ReadToolCalls != 1 {
		t.Fatalf("cache replay consumed real-read budget: %d", state.ReadToolCalls)
	}
}

// 冻结快照必须是「路径占位 + 空正文」，回放复核不能借机把正文塞进 state。
func TestCloudAgentSkillReferenceReplayDoesNotInlineContent(t *testing.T) {
	s, id, state := skillReferenceFixture(t)
	call := skillFeedbackCall(id, cloudAgentSkillEntryPath)
	first, err := cloudAgentReadToolCached(nil, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	cloudAgentToolResult("", state, call, first, nil)
	encoded, err := json.Marshal(state.SkillReferences)
	if err != nil {
		t.Fatal(err)
	}
	if len(encoded) == 0 {
		t.Fatal("empty reference snapshot")
	}
	for _, ref := range state.SkillReferences {
		if ref.Instruction != "" {
			t.Fatalf("reference inlined instruction: %+v", ref)
		}
		for path, content := range ref.Files {
			if content != "" {
				t.Fatalf("reference inlined %s: %q", path, content)
			}
		}
	}
}
