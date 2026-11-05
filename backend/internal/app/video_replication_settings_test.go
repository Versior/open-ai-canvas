package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

var videoReplicationTestAdmin = &model.User{ID: "usr-vr-admin", Username: "vr-admin", Role: model.UserRoleAdmin}

func setVideoReplicationFeatures(t *testing.T, svc *Service, replication, linkImport bool) {
	t.Helper()
	value := platform.DefaultFeatureAvailability()
	value.VideoReplicationEnabled, value.SocialVideoImportEnabled = replication, linkImport
	if _, err := svc.UpdateFeatureAvailability(videoReplicationTestAdmin, value); err != nil {
		t.Fatal(err)
	}
}

func intPointer(value int) *int    { return &value }
func boolPointer(value bool) *bool { return &value }

func TestVideoReplicationSettingsDefaultsPatchAndAudit(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	settings, err := svc.videoReplicationSettings()
	if err != nil || settings != (VideoReplicationSettings{MaxDurationSeconds: 180, MaxShots: 60, TranscribeEnabled: true}) {
		t.Fatalf("defaults = %+v, %v", settings, err)
	}
	var authErr *AuthError
	if _, err := svc.UpdateVideoReplicationSettings(&model.User{ID: "usr-a", Role: model.UserRoleUser}, VideoReplicationSettingsPatch{MaxShots: intPointer(10)}); !errors.As(err, &authErr) || authErr.Status != 403 {
		t.Fatalf("non-admin update err = %v", err)
	}
	// 只改时长，其余字段保持默认值。
	saved, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxDurationSeconds: intPointer(90)})
	if err != nil || saved != (VideoReplicationSettings{MaxDurationSeconds: 90, MaxShots: 60, TranscribeEnabled: true}) {
		t.Fatalf("patched = %+v, %v", saved, err)
	}
	saved, err = svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxShots: intPointer(24), TranscribeEnabled: boolPointer(false)})
	if err != nil || saved != (VideoReplicationSettings{MaxDurationSeconds: 90, MaxShots: 24, TranscribeEnabled: false}) {
		t.Fatalf("second patch = %+v, %v", saved, err)
	}
	for name, patch := range map[string]VideoReplicationSettingsPatch{
		"too short":  {MaxDurationSeconds: intPointer(5)},
		"too long":   {MaxDurationSeconds: intPointer(181)},
		"zero shots": {MaxShots: intPointer(0)},
		"many shots": {MaxShots: intPointer(61)},
	} {
		if _, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, patch); !errors.As(err, &authErr) || authErr.Status != 400 {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	if current, _ := svc.videoReplicationSettings(); current != saved {
		t.Fatalf("rejected patches changed the settings: %+v", current)
	}
	// 没有变化的保存不再记审计。
	if again, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxShots: intPointer(24)}); err != nil || again != saved {
		t.Fatalf("unchanged patch = %+v, %v", again, err)
	}
	var audits int64
	if err := db.Model(&model.AdminAuditEvent{}).Where("action = ?", "video_replication.settings.update").Count(&audits).Error; err != nil || audits != 2 {
		t.Fatalf("audits = %d, %v", audits, err)
	}

	// 缺字段的配置以默认值为底，0 用默认值，超范围的收回范围内。
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: videoReplicationSettingsKey, ValueJSON: `{"maxDurationSeconds":999,"maxShots":0}`}); err != nil {
		t.Fatal(err)
	}
	if current, err := svc.videoReplicationSettings(); err != nil || current != (VideoReplicationSettings{MaxDurationSeconds: 180, MaxShots: 60, TranscribeEnabled: true}) {
		t.Fatalf("normalized stored settings = %+v, %v", current, err)
	}
	// 写路径同样以默认值为底：超范围的存量值不挡住只改别的字段的修改。
	if saved, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{TranscribeEnabled: boolPointer(false)}); err != nil || saved != (VideoReplicationSettings{MaxDurationSeconds: 180, MaxShots: 60, TranscribeEnabled: false}) {
		t.Fatalf("patch over out-of-range stored settings = %+v, %v", saved, err)
	}
	// 存量配置缺 transcribeEnabled 时，只改镜头数不会把它写成 false，也不会动时长。
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: videoReplicationSettingsKey, ValueJSON: `{"maxDurationSeconds":60,"maxShots":20}`}); err != nil {
		t.Fatal(err)
	}
	if saved, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxShots: intPointer(30)}); err != nil || saved != (VideoReplicationSettings{MaxDurationSeconds: 60, MaxShots: 30, TranscribeEnabled: true}) {
		t.Fatalf("patch over a row missing fields = %+v, %v", saved, err)
	}
	if got := []string{videoReplicationDurationLabel(180), videoReplicationDurationLabel(45), videoReplicationDurationLabel(90)}; strings.Join(got, "|") != "3 分钟|45 秒|1 分 30 秒" {
		t.Fatalf("duration labels = %v", got)
	}
}

func TestVideoTeardownFollowsReplicationSettingsAndFeatureSwitch(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	t.Setenv(whisperLangEnv, "http://whisper.invalid")
	for _, resource := range []model.Resource{
		{ID: "res-short", UserID: "usr-a", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", Size: 1024, DurationMs: 20_000},
		{ID: "res-45s", UserID: "usr-a", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", Size: 1024, DurationMs: 45_000},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	config, err := svc.VideoReplicationConfig()
	if err != nil || *config != (VideoReplicationConfig{MaxDurationSeconds: 180, MaxShots: 60, TranscribeAvailable: true}) {
		t.Fatalf("default config = %+v, %v", config, err)
	}
	if _, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxDurationSeconds: intPointer(30), MaxShots: intPointer(12), TranscribeEnabled: boolPointer(false)}); err != nil {
		t.Fatal(err)
	}
	config, err = svc.VideoReplicationConfig()
	if err != nil || config.MaxDurationSeconds != 30 || config.MaxShots != 12 || config.TranscribeAvailable || !strings.Contains(config.TranscribeNote, "后台已关闭口播识别") {
		t.Fatalf("config = %+v, %v", config, err)
	}

	if _, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0001", VideoTeardownRequest{ResourceID: "res-45s"}); err == nil || !strings.Contains(err.Error(), "超过 30 秒") {
		t.Fatalf("long video err = %v", err)
	}
	if _, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0002", VideoTeardownRequest{ResourceID: "res-short", MaxShots: 13}); err == nil || !strings.Contains(err.Error(), "1 到 12") {
		t.Fatalf("max shots err = %v", err)
	}
	created, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0003", VideoTeardownRequest{ResourceID: "res-short"})
	if err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", created.ID).Error; err != nil || !strings.Contains(stored.InputJSON, `"maxShots":12`) {
		t.Fatalf("stored input = %s, %v", stored.InputJSON, err)
	}
	// 后台改了设置以后，同一幂等键、同一请求的重放仍返回原任务，不被新的上限拦下或判成冲突。
	if _, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxDurationSeconds: intPointer(10), MaxShots: intPointer(6)}); err != nil {
		t.Fatal(err)
	}
	if replay, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0003", VideoTeardownRequest{ResourceID: "res-short"}); err != nil || replay.ID != created.ID {
		t.Fatalf("replay after settings change = %+v, %v", replay, err)
	}
	if _, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0005", VideoTeardownRequest{ResourceID: "res-short"}); err == nil || !strings.Contains(err.Error(), "超过 10 秒") {
		t.Fatalf("new request after lowering the limit err = %v", err)
	}
	// 后台关了口播识别：有音轨也不调转写服务，拆解照常完成并提示原因。
	transcript := svc.transcribeVideoTeardown(context.Background(), VideoReplicationSettings{TranscribeEnabled: false}, "/missing.mp4", "video/mp4", true, "")
	if transcript.Source != "none" || !strings.Contains(transcript.Note, "后台已关闭口播识别") {
		t.Fatalf("transcript = %+v", transcript)
	}
	// 原因面向用户：服务没配置时不把服务器的配置项名写出来。
	features := platform.DefaultFeatureAvailability()
	features.TimelineTranscriptionEnabled = true
	if _, err := svc.UpdateFeatureAvailability(videoReplicationTestAdmin, features); err != nil {
		t.Fatal(err)
	}
	t.Setenv(whisperLangEnv, "")
	if missing := svc.transcribeVideoTeardown(context.Background(), VideoReplicationSettings{TranscribeEnabled: true}, "/missing.mp4", "video/mp4", true, ""); missing.Note != "服务器没有配置转写服务" {
		t.Fatalf("missing service note = %q", missing.Note)
	}

	finished := seedSucceededTeardownTask(t, db, "usr-a", 2)
	setVideoReplicationFeatures(t, svc, false, true)
	var authErr *AuthError
	for name, call := range map[string]func() error{
		"create": func() error {
			_, err := svc.CreateVideoTeardownTask("usr-a", "settings-key-0004", VideoTeardownRequest{ResourceID: "res-short"})
			return err
		},
		"list":   func() error { _, err := svc.VideoReplications("usr-a"); return err },
		"detail": func() error { _, err := svc.VideoReplication("usr-a", created.ID); return err },
		"config": func() error { _, err := svc.VideoReplicationConfig(); return err },
	} {
		if err := call(); !errors.As(err, &authErr) || authErr.Status != 403 || authErr.Message != "视频复刻暂未开放" {
			t.Fatalf("%s with the feature off: err = %v", name, err)
		}
	}
	// 关闭前已经开始的分析已经计费，结果照常能存下来。
	if _, err := svc.SaveVideoReplicationAnalysis("usr-a", finished.ID, teardownAnalysisPayload("关闭后保存", 1, 2)); err != nil {
		t.Fatalf("saving an in-flight analysis with the feature off: %v", err)
	}
}

// 排队期间后台调低了镜头数上限、关了口播识别：执行时按新设置切镜，也不调用转写服务。
func TestReplicationTeardownAppliesCurrentSettings(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	t.Setenv(whisperLangEnv, "http://whisper.invalid")
	source := seedTeardownVideoResource(t, svc, "usr-teardown")
	inputJSON, _ := json.Marshal(videoTeardownInput{Version: 1, ResourceID: source.ID, Transcribe: true, MaxShots: 60, Fingerprint: "fp"})
	task := &model.Task{ID: "vt-current-settings", UserID: "usr-teardown", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning, Stage: "已领取", InputJSON: string(inputJSON)}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{MaxShots: intPointer(2), TranscribeEnabled: boolPointer(false)}); err != nil {
		t.Fatal(err)
	}
	if err := newTaskWorkerCoordinator(svc).processReplicationTeardown(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil || stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("stored = %+v, %v", stored, err)
	}
	var bundle videoTeardownBundle
	if err := json.Unmarshal([]byte(stored.ResultJSON), &bundle); err != nil {
		t.Fatal(err)
	}
	if len(bundle.Shots) != 2 || bundle.Transcript.Source != "none" || len(bundle.Warnings) != 0 || !strings.Contains(bundle.Transcript.Note, "后台已关闭口播识别") {
		t.Fatalf("shots = %d, transcript = %+v, warnings = %v", len(bundle.Shots), bundle.Transcript, bundle.Warnings)
	}
}

func TestSocialVideoImportFollowsLinkImportSwitch(t *testing.T) {
	svc, _ := newSocialVideoImportTestService(t)
	seedSocialVideoParseAPIs(t, svc, socialVideoParseAPI{ID: "ks", Platforms: []string{"kuaishou"}, Enabled: true})
	setVideoReplicationFeatures(t, svc, true, false)

	platforms, err := svc.SocialVideoPlatforms()
	if err != nil {
		t.Fatal(err)
	}
	for _, platform := range platforms {
		if platform.Available {
			t.Fatalf("platform %s is available while link import is off", platform.ID)
		}
	}
	// 后台接口管理仍按接口池显示哪些平台有接口。
	views, err := svc.socialVideoPlatformViews()
	if err != nil {
		t.Fatal(err)
	}
	for _, view := range views {
		if view.ID == "kuaishou" && !view.Available {
			t.Fatal("parse admin lost kuaishou availability")
		}
	}
	var authErr *AuthError
	if _, err := svc.CreateSocialVideoImportTask("usr-a", "link-import-0001", SocialVideoImportRequest{URL: "https://v.kuaishou.com/AbCd12"}); !errors.As(err, &authErr) || authErr.Status != 403 || authErr.Message != "视频链接导入暂未开放" {
		t.Fatalf("import with link import off: err = %v", err)
	}
}
