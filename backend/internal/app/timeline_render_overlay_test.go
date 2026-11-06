package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func overlayClip(id string, kind string, track string, start int64, duration int64, key string) renderClip {
	clip := renderClip{ID: id, Kind: kind, TrackID: track, StartMs: start, DurationMs: duration}
	clip.DirectMedia = &struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	}{ID: id, Kind: kind, StorageKey: key}
	return clip
}

func TestRenderImageOverlaysSortAndTrim(t *testing.T) {
	images := []renderSegment{
		{Clip: renderClip{ID: "b", StartMs: 1500, DurationMs: 1000}, DurationMs: 1000},
		{Clip: renderClip{ID: "a", StartMs: 0, DurationMs: 2000}, DurationMs: 2000},
		{Clip: renderClip{ID: "c", StartMs: 1800, DurationMs: 500}, DurationMs: 500},
	}
	got := renderImageOverlays(images)
	if len(got) != 2 || got[0].Clip.ID != "a" || got[1].Clip.ID != "b" || got[1].Clip.StartMs != 2000 || got[1].DurationMs != 500 {
		t.Fatalf("overlays = %+v", got)
	}
}

func TestBuildRenderPlanRoutesOverlayImagesAndLoopedAudio(t *testing.T) {
	video := overlayClip("v", "video", "gen", 0, 3000, "resource:res-v")
	sub := overlayClip("s1", "image", "subtitle", 500, 1000, "resource:res-s")
	sub.Overlay = true
	plain := overlayClip("img", "image", "gen", 3000, 1000, "resource:res-i")
	music := overlayClip("bgm", "audio", "music", 0, 4000, "resource:res-m")
	music.Loop, music.Volume, music.FadeOutMs = true, 0.3, 1000
	tracks := []renderTrack{{ID: "gen", Kind: "video"}, {ID: "subtitle", Kind: "image"}, {ID: "music", Kind: "audio"}}
	plan := buildRenderPlan(renderProject{Version: 2, Width: 720, Height: 1280, Tracks: tracks, Clips: []renderClip{video, sub, plain, music}})
	if len(plan.Segments) != 2 || plan.Segments[1].Clip.ID != "img" {
		t.Fatalf("segments = %+v: overlay image must not join the main sequence", plan.Segments)
	}
	if len(plan.ImageOverlays) != 1 || plan.ImageOverlays[0].Clip.ID != "s1" || len(plan.AudioOverlays) != 1 {
		t.Fatalf("overlays = %+v / %+v", plan.ImageOverlays, plan.AudioOverlays)
	}
	for i := range plan.Segments {
		plan.Segments[i].Source = &renderSource{Path: "seg.mp4", HasAudio: true}
	}
	plan.ImageOverlays[0].Source = &renderSource{Path: "sub.png"}
	plan.AudioOverlays[0].Source = &renderSource{Path: "bgm.mp3"}
	args := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	for _, want := range []string{
		"-stream_loop -1 -t 4.000 -i bgm.mp3",
		"-loop 1 -t 1.000 -i sub.png",
		"afade=t=out:st=3.000:d=1.000",
		"amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]",
		"color=c=black@0.0:s=720x1280:r=30:d=0.500",
		"concat=n=2:v=1:a=0[subs]",
		"[vbase][subs]overlay=0:0:eof_action=pass,format=yuv420p[vout]",
		"concat=n=2:v=1:a=1[vbase][abase]",
	} {
		if !strings.Contains(args, want) {
			t.Fatalf("args missing %q:\n%s", want, args)
		}
	}
}

func writeTestPNG(t *testing.T, path string, width int, height int) {
	t.Helper()
	canvas := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := height * 3 / 4; y < height*7/8; y++ {
		for x := width / 4; x < width*3/4; x++ {
			canvas.Set(x, y, color.NRGBA{R: 0, G: 0, B: 255, A: 255})
		}
	}
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, canvas); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
}

func seedLocalFileResource(t *testing.T, s *Service, userID string, kind string, mime string, ext string, write func(path string)) *model.Resource {
	t.Helper()
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusReady, Provider: "local", MimeType: mime, CreatedAt: time.Now()}
	resource.ObjectKey = userID + "/" + resource.ID + ext
	path := filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	write(path)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	resource.Size = info.Size()
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}

// 读成片某一时刻某个像素的 RGB。
func frameColorAt(t *testing.T, path string, seconds string, x int, y int) [3]byte {
	t.Helper()
	output, err := exec.Command("ffmpeg", "-v", "error", "-ss", seconds, "-i", path, "-frames:v", "1", "-vf", "crop=1:1:"+strconv.Itoa(x)+":"+strconv.Itoa(y)+",format=rgb24", "-f", "rawvideo", "-").Output()
	if err != nil || len(output) < 3 {
		t.Fatalf("read frame at %s: %v (%d bytes)", seconds, err, len(output))
	}
	return [3]byte{output[0], output[1], output[2]}
}

// 真实 ffmpeg：字幕 PNG 只在 0.5–1.5 秒出现在画面下方，背景音乐 0.4 秒的素材循环铺满 2 秒成片。
func TestTimelineRenderBurnsOverlayAndLoopsMusic(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	user := "usr-render-test"
	first := seedLocalVideoResource(t, svc, user, 320, 568, nil)
	second := seedLocalVideoResource(t, svc, user, 320, 568, nil)
	sub := seedLocalFileResource(t, svc, user, "image", "image/png", ".png", func(path string) { writeTestPNG(t, path, 320, 568) })
	music := seedLocalFileResource(t, svc, user, "audio", "audio/mpeg", ".mp3", func(path string) {
		if output, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", "-c:a", "libmp3lame", path).CombinedOutput(); err != nil {
			t.Skipf("本机 ffmpeg 不能编码 mp3：%v %s", err, output)
		}
	})
	visible := true
	subClip := overlayClip("s1", "image", "subtitle", 500, 1000, "resource:"+sub.ID)
	subClip.Overlay = true
	bgm := overlayClip("bgm", "audio", "music", 0, 2000, "resource:"+music.ID)
	bgm.Loop, bgm.Volume, bgm.FadeOutMs = true, 0.5, 300
	project := renderProject{
		Version: 2, Width: 320, Height: 568, DurationMs: 2000,
		Tracks: []renderTrack{{ID: "gen", Kind: "video", Visible: &visible}, {ID: "subtitle", Kind: "image"}, {ID: "music", Kind: "audio"}},
		Clips:  []renderClip{overlayClip("v1", "video", "gen", 0, 1000, "resource:"+first.ID), overlayClip("v2", "video", "gen", 1000, 1000, "resource:"+second.ID), subClip, bgm},
	}
	task := seedRunningRenderTask(t, db, renderInputJSON(t, project))
	if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("status = %s, error = %s", stored.Status, stored.Error)
	}
	var result timelineRenderOutput
	if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	output, err := svc.repo.ResourceForUser(user, result.ResourceID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(svc.dataDir, "resources", filepath.FromSlash(output.ObjectKey))
	// 字幕区域在 0.5–1.5 秒是蓝的，之前和之后是原画面的红色；字幕区域外一直是红色。
	isBlue := func(c [3]byte) bool { return c[2] > 180 && c[0] < 90 }
	isRed := func(c [3]byte) bool { return c[0] > 180 && c[2] < 90 }
	if c := frameColorAt(t, path, "1.0", 160, 460); !isBlue(c) {
		t.Fatalf("subtitle area at 1.0s = %v, want blue", c)
	}
	if c := frameColorAt(t, path, "0.2", 160, 460); !isRed(c) {
		t.Fatalf("subtitle area at 0.2s = %v, want red (not shown yet)", c)
	}
	if c := frameColorAt(t, path, "1.8", 160, 460); !isRed(c) {
		t.Fatalf("subtitle area at 1.8s = %v, want red (already gone)", c)
	}
	if c := frameColorAt(t, path, "1.0", 160, 100); !isRed(c) {
		t.Fatalf("transparent area at 1.0s = %v, want red", c)
	}
	// 循环的背景音乐在 1.5 秒仍有声音（素材只有 0.4 秒）。
	probe, err := exec.Command("ffmpeg", "-hide_banner", "-ss", "1.4", "-t", "0.2", "-i", path, "-af", "volumedetect", "-f", "null", "-").CombinedOutput()
	if err != nil {
		t.Fatalf("volumedetect: %v %s", err, probe)
	}
	if !strings.Contains(string(probe), "mean_volume") || strings.Contains(string(probe), "mean_volume: -91") {
		t.Fatalf("music not looped, volumedetect = %s", probe)
	}
	if len(result.Sources) != 4 {
		t.Fatalf("sources = %+v, want 2 videos + music + subtitle", result.Sources)
	}
}
