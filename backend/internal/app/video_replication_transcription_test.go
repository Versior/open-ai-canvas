package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

// 后台选了转写模型：保存时校验模型，状态显示走模型渠道，拆解时按 OpenAI 的 /audio/transcriptions 调用并记调用日志。
func TestVideoReplicationTranscribesWithChannelModel(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	svc.coordinator = platform.NewCoordinatorWithRedis(nil, "vr-transcribe-test")
	svc.platform = platform.New(svc.repo, svc.coordinator, platformHost{svc: svc})
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv(whisperLangEnv, "")
	features := platform.DefaultFeatureAvailability()
	features.VideoReplicationEnabled, features.TimelineTranscriptionEnabled = true, true
	if _, err := svc.UpdateFeatureAvailability(videoReplicationTestAdmin, features); err != nil {
		t.Fatal(err)
	}

	textOnly := false
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/audio/transcriptions" || r.Header.Get("Authorization") != "Bearer asr-key" {
			t.Errorf("request target/auth: %s %s", r.URL.Path, r.Header.Get("Authorization"))
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Errorf("multipart: %v", err)
		}
		if got := []string{r.FormValue("model"), r.FormValue("response_format"), r.FormValue("timestamp_granularities[]"), r.FormValue("language")}; strings.Join(got, "|") != "whisper-1|verbose_json|segment|zh" {
			t.Errorf("form fields = %v", got)
		}
		if _, header, err := r.FormFile("file"); err != nil || header.Filename != "audio16k.wav" {
			t.Errorf("file part = %v, %v", header, err)
		}
		if textOnly {
			_ = json.NewEncoder(w).Encode(map[string]any{"text": "整段文字"})
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"language": "chinese", "text": "你好 欢迎", "segments": []map[string]any{{"start": 0, "end": 1.25, "text": " 你好 "}, {"start": 1.25, "end": 2.5, "text": "  "}, {"start": 2.5, "end": 4, "text": "欢迎"}}})
	}))
	defer upstream.Close()

	channel := model.ModelChannel{ID: "asr-channel", Scope: model.ChannelScopeSystem, Enabled: true, Name: "转写渠道", BaseURL: upstream.URL + "/v1", APIKey: "asr-key", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	asr := model.ChannelModel{ID: "asr-model", ChannelID: channel.ID, ModelKey: "whisper", ProviderModelKey: "whisper-1", DisplayName: "Whisper", Capability: "audio", Protocol: model.ChannelInterfaceOpenAIAudio, Enabled: true}
	text := model.ChannelModel{ID: "asr-text-model", ChannelID: channel.ID, ModelKey: "gpt-4o-mini", Capability: "text", Protocol: model.ChannelInterfaceChatCompletion, Enabled: true}
	for _, item := range []*model.ChannelModel{&asr, &text} {
		if err := svc.repo.SaveChannelModel(item); err != nil {
			t.Fatal(err)
		}
	}

	var authErr *AuthError
	for name, id := range map[string]string{"text model": text.ID, "missing": "no-such-model"} {
		if _, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{TranscriptionChannelModelID: &id}); !errors.As(err, &authErr) || authErr.Status != 400 {
			t.Fatalf("%s: err = %v", name, err)
		}
	}
	selected := " " + asr.ID + " "
	saved, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{TranscriptionChannelModelID: &selected})
	if err != nil || saved.TranscriptionChannelModelID != asr.ID {
		t.Fatalf("saved = %+v, %v", saved, err)
	}
	view, err := svc.AdminVideoReplicationSettings(videoReplicationTestAdmin)
	if err != nil || !view.Transcription.Available || view.Transcription.Engine != "channel" || view.Transcription.Model != "Whisper · 转写渠道" {
		t.Fatalf("admin view = %+v, %v", view, err)
	}
	if config, err := svc.VideoReplicationConfig(); err != nil || !config.TranscribeAvailable || config.TranscribeNote != "" {
		t.Fatalf("config = %+v, %v", config, err)
	}

	wavPath := filepath.Join(t.TempDir(), "audio16k.wav")
	if err := os.WriteFile(wavPath, []byte("RIFF-fake-wav"), 0o600); err != nil {
		t.Fatal(err)
	}
	task := &model.Task{ID: "vt-asr", UserID: "usr-asr", Type: model.TaskTypeReplicationTeardown}
	choice, issue, err := svc.videoReplicationTranscriptionModel(asr.ID)
	if err != nil || issue != "" || choice == nil {
		t.Fatalf("choice = %+v, %q, %v", choice, issue, err)
	}
	segments, language, err := svc.transcribeWithChannelModel(context.Background(), task, *choice, wavPath, "zh-CN")
	if err != nil || language != "chinese" || len(segments) != 2 || segments[0] != (timelineTranscriptionSegment{StartMs: 0, EndMs: 1250, Text: "你好"}) || segments[1].StartMs != 2500 {
		t.Fatalf("segments = %+v, %q, %v", segments, language, err)
	}
	var logs []model.ApiCallLog
	if err := db.Where("task_id = ?", task.ID).Find(&logs).Error; err != nil || len(logs) != 1 || logs[0].Operation != videoTeardownTranscribeOperation || logs[0].ChannelID != channel.ID || logs[0].Status != model.ApiCallStatusSucceeded {
		t.Fatalf("call logs = %+v, %v", logs, err)
	}
	// 只返回整段文字的模型分不了镜头，明确报错，不把整段口播塞进一个镜头。
	textOnly = true
	if _, _, err := svc.transcribeWithChannelModel(context.Background(), task, *choice, wavPath, "zh"); err == nil || !strings.Contains(err.Error(), "没有返回分句时间") {
		t.Fatalf("text-only err = %v", err)
	}

	// 渠道停用后：状态和拆解都说明转写模型不可用，不去读音轨。
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", channel.ID).Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	view, err = svc.AdminVideoReplicationSettings(videoReplicationTestAdmin)
	if err != nil || view.Transcription.Available || view.Transcription.ModelIssue != "转写模型所在的渠道已停用" || !strings.Contains(view.Transcription.Note, "后台选的转写模型不可用") {
		t.Fatalf("view after disabling = %+v, %v", view.Transcription, err)
	}
	if transcript := svc.transcribeVideoTeardown(context.Background(), task, saved, "/missing.mp4", "video/mp4", true, ""); transcript.Source != "none" || transcript.Note != "后台选的转写模型不可用" {
		t.Fatalf("transcript = %+v", transcript)
	}
	// 自建 whisper 服务还在时退回用它。
	t.Setenv(whisperLangEnv, "http://whisper.invalid")
	if view, err = svc.AdminVideoReplicationSettings(videoReplicationTestAdmin); err != nil || !view.Transcription.Available || view.Transcription.Engine != "whisper" {
		t.Fatalf("whisper fallback = %+v, %v", view.Transcription, err)
	}
	// 清空选择改回自建服务。
	empty := ""
	if saved, err := svc.UpdateVideoReplicationSettings(videoReplicationTestAdmin, VideoReplicationSettingsPatch{TranscriptionChannelModelID: &empty}); err != nil || saved.TranscriptionChannelModelID != "" {
		t.Fatalf("cleared = %+v, %v", saved, err)
	}
}
