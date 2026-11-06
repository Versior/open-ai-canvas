package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func seedJianyingResource(t *testing.T, s *Service, userID string, kind string, mime string, durationMs int64) *model.Resource {
	t.Helper()
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusReady, Provider: "local", MimeType: mime, Size: 1024, Width: 720, Height: 1280, DurationMs: durationMs, ObjectKey: userID + "/x", CreatedAt: time.Now()}
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}

func TestPrepareTimelineJianyingDraftPlacesClipsAudioAndCaptions(t *testing.T) {
	svc, _ := newTimelineTaskTestService(t)
	user := "usr-jy"
	source := seedJianyingResource(t, svc, user, "video", "video/mp4", 22_000)
	take := seedJianyingResource(t, svc, user, "video", "video/mp4", 5000)
	voice := seedJianyingResource(t, svc, user, "audio", "audio/mpeg", 1800)
	music := seedJianyingResource(t, svc, user, "audio", "audio/mpeg", 3000)
	clip := func(id, kind, track string, start, duration, sourceStart int64, resource *model.Resource) renderClip {
		value := overlayClip(id, kind, track, start, duration, "resource:"+resource.ID)
		value.SourceStartMs = sourceStart
		return value
	}
	bgm := clip("bgm", "audio", "music", 0, 7000, 0, music)
	bgm.Loop, bgm.Volume = true, 0.3
	sub := overlayClip("burn", "image", "burn", 0, 1000, "resource:"+take.ID)
	sub.Overlay = true
	req := TimelineJianyingDraftRequest{DraftRoot: "/Users/me/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/", Name: "复刻 · 纸巾", Timeline: renderProject{
		Version: 2, Width: 720, Height: 1280,
		Tracks: []renderTrack{{ID: "gen", Kind: "video"}, {ID: "keep", Kind: "video", Muted: true}, {ID: "voice", Kind: "audio"}, {ID: "music", Kind: "audio"}, {ID: "subtitle", Kind: "subtitle"}, {ID: "burn", Kind: "image"}},
		Clips: []renderClip{
			clip("g1", "video", "gen", 0, 2400, 0, take),
			clip("k1", "video", "keep", 2400, 900, 4000, source),
			clip("k2", "video", "keep", 3300, 3700, 8100, source),
			clip("v1", "audio", "voice", 0, 1800, 0, voice),
			bgm,
			{ID: "t1", Kind: "subtitle", TrackID: "subtitle", StartMs: 0, DurationMs: 1800, Text: "这包纸巾真的很厚"},
			sub,
		},
	}}
	archive, err := svc.PrepareTimelineJianyingDraft(user, req)
	if err != nil {
		t.Fatal(err)
	}
	var content map[string]any
	var paths []string
	for _, entry := range archive.entries {
		paths = append(paths, entry.path)
		if strings.HasSuffix(entry.path, "/draft_content.json") {
			if err := json.Unmarshal(entry.data, &content); err != nil {
				t.Fatal(err)
			}
		}
	}
	joined := strings.Join(paths, "\n")
	// 原片两段共用一个素材文件；配音和音乐各一个；叠加图不导出。
	if strings.Count(joined, "/materials/") != 4 || !strings.Contains(joined, "/字幕.srt") || !strings.Contains(joined, "/导入说明.txt") {
		t.Fatalf("archive entries = %s", joined)
	}
	if content["duration"].(float64) != 7_000_000 {
		t.Fatalf("duration = %v", content["duration"])
	}
	materials := content["materials"].(map[string]any)
	if len(materials["videos"].([]any)) != 2 || len(materials["audios"].([]any)) != 2 || len(materials["texts"].([]any)) != 1 {
		t.Fatalf("materials videos=%d audios=%d texts=%d", len(materials["videos"].([]any)), len(materials["audios"].([]any)), len(materials["texts"].([]any)))
	}
	tracks := content["tracks"].([]any)
	kinds := []string{}
	for _, item := range tracks {
		kinds = append(kinds, item.(map[string]any)["type"].(string))
	}
	if strings.Join(kinds, ",") != "video,audio,audio,text" {
		t.Fatalf("tracks = %v", kinds)
	}
	video := tracks[0].(map[string]any)["segments"].([]any)
	keep := video[2].(map[string]any)
	if keep["volume"].(float64) != 0 || keep["target_timerange"].(map[string]any)["start"].(float64) != 3_300_000 || keep["source_timerange"].(map[string]any)["start"].(float64) != 8_100_000 {
		t.Fatalf("kept segment = %+v", keep)
	}
	if video[0].(map[string]any)["volume"].(float64) != 1 {
		t.Fatalf("generated segment must keep its sound: %+v", video[0])
	}
	// 3 秒的音乐铺满 7 秒：切成 3 + 3 + 1 秒。
	musicSegments := tracks[2].(map[string]any)["segments"].([]any)
	if len(musicSegments) != 3 || musicSegments[2].(map[string]any)["target_timerange"].(map[string]any)["duration"].(float64) != 1_000_000 || musicSegments[0].(map[string]any)["volume"].(float64) != 0.3 {
		t.Fatalf("music segments = %+v", musicSegments)
	}

	if _, err := svc.PrepareTimelineJianyingDraft("usr-other", req); err == nil || !strings.Contains(err.Error(), "不可用") {
		t.Fatalf("other user's resources err = %v", err)
	}
	if _, err := svc.PrepareTimelineJianyingDraft(user, TimelineJianyingDraftRequest{DraftRoot: "relative/path", Timeline: req.Timeline}); err == nil {
		t.Fatal("relative draft root must be rejected")
	}
}
