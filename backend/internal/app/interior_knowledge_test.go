package app

import (
	"errors"
	"slices"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func adminKnowledgeByKey(t *testing.T, svc *Service, key string) AdminInteriorKnowledgeView {
	t.Helper()
	all, _, err := svc.AdminInteriorKnowledge(videoReplicationTestAdmin)
	if err != nil {
		t.Fatal(err)
	}
	index := slices.IndexFunc(all, func(item AdminInteriorKnowledgeView) bool { return item.Key == key })
	if index < 0 {
		t.Fatalf("knowledge %s not found", key)
	}
	return all[index]
}

func knowledgeInputFrom(view AdminInteriorKnowledgeView) InteriorKnowledgeInput {
	return InteriorKnowledgeInput{Key: view.Key, Kind: view.Kind, Title: view.Title, Guidance: view.Guidance, Scopes: view.Scopes, Rooms: view.Rooms, Styles: view.Styles, Tags: view.Tags, SortOrder: view.SortOrder, Enabled: view.Enabled, Version: view.Version}
}

func TestInteriorKnowledgeAdminEditsReachRetrievalAndSurviveReseeding(t *testing.T) {
	svc, _ := newTimelineTaskTestService(t)
	inserted, refreshed, err := svc.EnsureBuiltinInteriorKnowledge()
	if err != nil || inserted < 50 || refreshed != 0 {
		t.Fatalf("seed inserted=%d refreshed=%d err=%v", inserted, refreshed, err)
	}
	if inserted, refreshed, err := svc.EnsureBuiltinInteriorKnowledge(); err != nil || inserted != 0 || refreshed != 0 {
		t.Fatalf("second seed inserted=%d refreshed=%d err=%v", inserted, refreshed, err)
	}
	features := platform.DefaultFeatureAvailability()
	features.InteriorEnabled = true
	if _, err := svc.UpdateFeatureAvailability(videoReplicationTestAdmin, features); err != nil {
		t.Fatal(err)
	}
	user := &model.User{ID: "usr-knowledge"}
	query := InteriorKnowledgeQuery{Scope: "building", Text: "三层别墅"}
	picked := func() []string {
		views, err := svc.InteriorKnowledge(user, query)
		if err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(views))
		for _, view := range views {
			ids = append(ids, view.ID)
		}
		return ids
	}
	if !slices.Contains(picked(), "build-storey") {
		t.Fatalf("builtin storey knowledge not retrieved: %v", picked())
	}

	// 修改内置条目的正文：标成已修改，前台取到新正文，重新补齐也不会覆盖。
	storey := adminKnowledgeByKey(t, svc, "build-storey")
	input := knowledgeInputFrom(storey)
	input.Guidance = "本站要求：住宅层高按 3.2 米做。"
	edited, err := svc.UpdateInteriorKnowledge(videoReplicationTestAdmin, storey.ID, input)
	if err != nil || !edited.Edited || edited.Version != storey.Version+1 || edited.Key != "build-storey" {
		t.Fatalf("edit = %+v, %v", edited, err)
	}
	if _, refreshed, err := svc.EnsureBuiltinInteriorKnowledge(); err != nil || refreshed != 0 {
		t.Fatalf("reseed refreshed=%d err=%v", refreshed, err)
	}
	views, err := svc.InteriorKnowledge(user, query)
	if err != nil || !slices.ContainsFunc(views, func(view InteriorKnowledgeView) bool { return view.Guidance == input.Guidance }) {
		t.Fatalf("edited guidance not retrieved: %+v, %v", views, err)
	}

	// 版本号过期时 409，不覆盖别人的修改。
	var appErr *AppError
	if _, err := svc.UpdateInteriorKnowledge(videoReplicationTestAdmin, storey.ID, input); !errors.As(err, &appErr) || appErr.Status != 409 {
		t.Fatalf("stale update err = %v", err)
	}

	// 停用后前台取不到；只改启用不算改内容。
	input = knowledgeInputFrom(*edited)
	input.Enabled = false
	disabled, err := svc.UpdateInteriorKnowledge(videoReplicationTestAdmin, storey.ID, input)
	if err != nil || disabled.Enabled {
		t.Fatalf("disable = %+v, %v", disabled, err)
	}
	if slices.Contains(picked(), "build-storey") {
		t.Fatal("disabled knowledge still retrieved")
	}

	// 恢复内置内容：正文回到程序自带的，之后又跟随版本更新；启用状态不动。
	reset, err := svc.ResetInteriorKnowledge(videoReplicationTestAdmin, storey.ID, disabled.Version)
	if err != nil || reset.Edited || reset.Guidance == input.Guidance || reset.Enabled {
		t.Fatalf("reset = %+v, %v", reset, err)
	}

	// 新增、删除管理员自己的条目；内置条目不能删。
	custom, err := svc.CreateInteriorKnowledge(videoReplicationTestAdmin, InteriorKnowledgeInput{Key: "site-garage", Kind: "building", Title: "车库", Guidance: "别墅车库净宽不小于 3.5 米。", Scopes: []string{"building"}, Tags: []string{"车库", "别墅"}, SortOrder: 5, Enabled: true})
	if err != nil || custom.Builtin {
		t.Fatalf("create = %+v, %v", custom, err)
	}
	query.Text = "三层别墅带车库"
	if !slices.Contains(picked(), "site-garage") {
		t.Fatalf("custom knowledge not retrieved: %v", picked())
	}
	var authErr *AuthError
	if _, err := svc.CreateInteriorKnowledge(videoReplicationTestAdmin, InteriorKnowledgeInput{Key: "site-garage", Kind: "building", Title: "重复", Guidance: "x"}); !errors.As(err, &authErr) || authErr.Status != 400 {
		t.Fatalf("duplicate key err = %v", err)
	}
	for name, bad := range map[string]InteriorKnowledgeInput{
		"kind":  {Key: "k1", Kind: "garden", Title: "t", Guidance: "g"},
		"scope": {Key: "k2", Kind: "building", Title: "t", Guidance: "g", Scopes: []string{"garden"}},
		"room":  {Key: "k3", Kind: "dimension", Title: "t", Guidance: "g", Rooms: []string{"Living Room"}},
		"empty": {Key: "k4", Kind: "building", Title: "t"},
	} {
		if _, err := svc.CreateInteriorKnowledge(videoReplicationTestAdmin, bad); !errors.As(err, &authErr) || authErr.Status != 400 {
			t.Fatalf("%s err = %v", name, err)
		}
	}
	if err := svc.DeleteInteriorKnowledge(videoReplicationTestAdmin, reset.ID, reset.Version); !errors.As(err, &authErr) || authErr.Status != 400 {
		t.Fatalf("delete builtin err = %v", err)
	}
	if err := svc.DeleteInteriorKnowledge(videoReplicationTestAdmin, custom.ID, custom.Version); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(picked(), "site-garage") {
		t.Fatal("deleted knowledge still retrieved")
	}

	// 普通用户不能改。
	member := &model.User{ID: "usr-member", Role: model.UserRoleUser}
	if _, err := svc.CreateInteriorKnowledge(member, InteriorKnowledgeInput{Key: "k5", Kind: "building", Title: "t", Guidance: "g"}); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("member create err = %v", err)
	}
}
