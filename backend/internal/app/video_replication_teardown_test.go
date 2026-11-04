package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestParseVideoTeardownCutsReadsSelectedFrameTimes(t *testing.T) {
	stderr := strings.Join([]string{
		"[Parsed_showinfo_2 @ 0x600003a4c000] config in time_base: 1/15360, frame_rate: 30/1",
		"[Parsed_showinfo_2 @ 0x600003a4c000] n:   0 pts:  23040 pts_time:1.5     duration:    512 duration_time:0.0333333 fmt:yuv420p",
		"[Parsed_showinfo_2 @ 0x600003a4c000]   color_range:tv color_space:unknown",
		"[Parsed_showinfo_2 @ 0x600003a4c000] n:   1 pts:  46080 pts_time:3       duration:    512",
		"[Parsed_showinfo_2 @ 0x600003a4c000] n:   2 pts:  46080 pts_time:3       duration:    512",
		"[out#0/null @ 0x600002b4c180] video:0KiB audio:0KiB subtitle:0KiB other streams:0KiB",
		"frame=  135 fps=0.0 q=-0.0 Lsize=N/A time=00:00:04.50 pts_time:9.9",
	}, "\n")
	if got := parseVideoTeardownCuts([]byte(stderr)); !slices.Equal(got, []int64{1500, 3000}) {
		t.Fatalf("cuts = %v, want [1500 3000]", got)
	}
}

func TestBuildVideoTeardownSegments(t *testing.T) {
	type want struct {
		start, end int64
		boundary   string
	}
	cases := []struct {
		name     string
		duration int64
		cuts     []int64
		maxShots int
		want     []want
	}{
		{name: "single take", duration: 6000, maxShots: 60, want: []want{{0, 6000, "start"}}},
		{
			name: "drops cuts too close to the previous cut or the end", duration: 6000, cuts: []int64{2200, 2000, 4000, 5800}, maxShots: 60,
			want: []want{{0, 2000, "start"}, {2000, 4000, "cut"}, {4000, 6000, "cut"}},
		},
		{
			name: "splits a long take into parts no longer than ten seconds", duration: 25000, maxShots: 60,
			want: []want{{0, 8333, "start"}, {8333, 16666, "split"}, {16666, 25000, "split"}},
		},
		{
			// 6 镜并成 3 镜：500ms 并入前一镜，600ms 并入前一镜，最后 1500ms 的第一镜并入后一镜。
			name: "caps the shot count by merging the shortest shots", duration: 10000, cuts: []int64{1000, 1500, 4000, 4600, 8000}, maxShots: 3,
			want: []want{{0, 4600, "start"}, {4600, 8000, "cut"}, {8000, 10000, "cut"}},
		},
		{
			name: "merges split parts before real cuts", duration: 22000, cuts: []int64{20000}, maxShots: 2,
			want: []want{{0, 20000, "start"}, {20000, 22000, "cut"}},
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			segments := buildVideoTeardownSegments(test.duration, test.cuts, test.maxShots)
			got := make([]want, 0, len(segments))
			for _, segment := range segments {
				got = append(got, want{segment.StartMs, segment.EndMs, segment.Boundary})
			}
			if !slices.Equal(got, test.want) {
				t.Fatalf("segments = %+v, want %+v", got, test.want)
			}
		})
	}
}

func TestVideoTeardownFrameTimesStayInsideTheShotAndBeforeTheLastFrame(t *testing.T) {
	cases := []struct {
		segment  videoTeardownSegment
		duration int64
		want     [3]int64
	}{
		{videoTeardownSegment{StartMs: 0, EndMs: 2000}, 6000, [3]int64{200, 1000, 1800}},
		{videoTeardownSegment{StartMs: 2000, EndMs: 2300}, 6000, [3]int64{2040, 2150, 2260}},
		{videoTeardownSegment{StartMs: 4000, EndMs: 6000}, 6000, [3]int64{4200, 5000, 5800}},
		{videoTeardownSegment{StartMs: 0, EndMs: 30000}, 30000, [3]int64{500, 15000, 29500}},
		{videoTeardownSegment{StartMs: 5900, EndMs: 6000}, 6000, [3]int64{5940, 5950, 5950}},
	}
	for _, test := range cases {
		if got := videoTeardownFrameTimes(test.segment, test.duration); got != test.want {
			t.Fatalf("frame times for %+v = %v, want %v", test.segment, got, test.want)
		}
	}
}

func TestReplicationTeardownUsesItsOwnTimeout(t *testing.T) {
	if got := taskExecutionTimeoutWithPolicy(model.TaskTypeReplicationTeardown, RuntimeTaskPolicy{VideoTimeoutMinutes: 120}); got != 10*time.Minute {
		t.Fatalf("timeout = %v, want 10m", got)
	}
}

func TestCreateVideoTeardownTaskValidatesTheVideoAndReplays(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	seedResource(t, db, "res-video", "usr-a", "video/mp4")
	seedResource(t, db, "res-image", "usr-a", "image/png")
	if err := db.Create(&model.Resource{ID: "res-long", UserID: "usr-a", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", Size: 1024, DurationMs: 181_000}).Error; err != nil {
		t.Fatal(err)
	}

	if _, err := svc.CreateVideoTeardownTask("usr-a", "short", VideoTeardownRequest{ResourceID: "res-video"}); err == nil || !strings.Contains(err.Error(), "X-Idempotency-Key") {
		t.Fatalf("short key error = %v", err)
	}
	for _, test := range []struct {
		userID string
		req    VideoTeardownRequest
		want   string
	}{
		{"usr-b", VideoTeardownRequest{ResourceID: "res-video"}, "无法读取"},
		{"usr-a", VideoTeardownRequest{ResourceID: "res-image"}, "只能拆解视频"},
		{"usr-a", VideoTeardownRequest{ResourceID: "res-long"}, "超过 3 分钟"},
		{"usr-a", VideoTeardownRequest{ResourceID: " "}, "必须指定"},
		{"usr-a", VideoTeardownRequest{ResourceID: "res-video", MaxShots: 61}, "镜头数上限"},
		{"usr-a", VideoTeardownRequest{ResourceID: "res-video", Language: "中文"}, "口播语言"},
	} {
		if _, err := svc.CreateVideoTeardownTask(test.userID, "request-key-0001", test.req); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("%+v error = %v, want %q", test.req, err, test.want)
		}
	}

	transcribe := false
	first, err := svc.CreateVideoTeardownTask("usr-a", "request-key-0001", VideoTeardownRequest{ResourceID: "res-video", Transcribe: &transcribe, Language: "zh", MaxShots: 20})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if first.Type != model.TaskTypeReplicationTeardown || first.Status != model.TaskStatusQueued || first.Provider != "local" || first.Model != "ffmpeg" {
		t.Fatalf("task = %+v", first)
	}
	storedInput := func(id string) videoTeardownInput {
		t.Helper()
		var stored model.Task
		if err := db.First(&stored, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		var input videoTeardownInput
		if err := json.Unmarshal([]byte(stored.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		return input
	}
	if input := storedInput(first.ID); input.ResourceID != "res-video" || input.Transcribe || input.Language != "zh" || input.MaxShots != 20 || input.Fingerprint == "" {
		t.Fatalf("input = %+v", input)
	}
	replay, err := svc.CreateVideoTeardownTask("usr-a", "request-key-0001", VideoTeardownRequest{ResourceID: "res-video", Transcribe: &transcribe, Language: "zh", MaxShots: 20})
	if err != nil || replay.ID != first.ID {
		t.Fatalf("replay = %+v, %v", replay, err)
	}
	_, err = svc.CreateVideoTeardownTask("usr-a", "request-key-0001", VideoTeardownRequest{ResourceID: "res-video"})
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Code != CodeIdempotencyConflict {
		t.Fatalf("changed request with the same key = %v", err)
	}
	defaults, err := svc.CreateVideoTeardownTask("usr-a", "request-key-0002", VideoTeardownRequest{ResourceID: "res-video"})
	if err != nil {
		t.Fatal(err)
	}
	if input := storedInput(defaults.ID); !input.Transcribe || input.MaxShots != videoTeardownDefaultMaxShots {
		t.Fatalf("default input = %+v", input)
	}
}

// 真实 ffmpeg 端到端：红、白、深蓝三段各 1.5 秒，应切成三个镜头，宫格一张，关键帧都存成图片资源。
func TestReplicationTeardownSplitsShotsAndSavesKeyframes(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	t.Setenv(whisperLangEnv, "")
	source := seedTeardownVideoResource(t, svc, "usr-teardown")
	inputJSON, _ := json.Marshal(videoTeardownInput{Version: 1, ResourceID: source.ID, Transcribe: true, MaxShots: 60, Fingerprint: "fp"})
	task := &model.Task{ID: fmt.Sprintf("vt-test-%d", time.Now().UnixNano()), UserID: "usr-teardown", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning, Stage: "已领取", InputJSON: string(inputJSON)}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}

	if err := newTaskWorkerCoordinator(svc).processReplicationTeardown(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("status = %s, error = %s", stored.Status, stored.Error)
	}
	var bundle videoTeardownBundle
	if err := json.Unmarshal([]byte(stored.ResultJSON), &bundle); err != nil {
		t.Fatal(err)
	}
	if bundle.Source.ResourceID != source.ID || bundle.Source.Width != 320 || bundle.Source.Height != 568 || !bundle.Source.HasAudio {
		t.Fatalf("source = %+v", bundle.Source)
	}
	if len(bundle.Shots) != 3 {
		t.Fatalf("shots = %+v", bundle.Shots)
	}
	for index, cut := range []int64{0, 1500, 3000} {
		shot := bundle.Shots[index]
		if shot.Index != index+1 || shot.StartMs < cut-100 || shot.StartMs > cut+100 || shot.KeyframeTimeMs <= shot.StartMs || shot.KeyframeTimeMs >= shot.EndMs {
			t.Fatalf("shot %d = %+v", index+1, shot)
		}
		if wantBoundary := map[bool]string{true: "start", false: "cut"}[index == 0]; shot.Boundary != wantBoundary {
			t.Fatalf("shot %d boundary = %q, want %q", index+1, shot.Boundary, wantBoundary)
		}
		keyframe, err := svc.repo.ResourceForUser("usr-teardown", shot.KeyframeResourceID)
		if err != nil || !strings.HasPrefix(keyframe.MimeType, "image/") || shot.KeyframeWidth != 288 || shot.KeyframeHeight != 512 {
			t.Fatalf("keyframe %d = %+v (%dx%d), %v", index+1, keyframe, shot.KeyframeWidth, shot.KeyframeHeight, err)
		}
	}
	// 一行一个镜头、三列开头 / 中间 / 结尾：3 × 288 + 白边 32 = 896 宽，3 × 512 + 32 = 1568 高。
	if len(bundle.Grids) != 1 || !slices.Equal(bundle.Grids[0].ShotIndexes, []int{1, 2, 3}) || bundle.Grids[0].Width != 896 || bundle.Grids[0].Height != 1568 {
		t.Fatalf("grids = %+v", bundle.Grids)
	}
	if bundle.Transcript.Source != "none" || len(bundle.Transcript.Segments) != 0 || len(bundle.Warnings) != 1 {
		t.Fatalf("transcript = %+v, warnings = %v", bundle.Transcript, bundle.Warnings)
	}

	// 同一任务被重新领取时复用已存的关键帧，不重复占用存储。
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusRunning, "result_json": ""}).Error; err != nil {
		t.Fatal(err)
	}
	task.Status = model.TaskStatusRunning
	if err := newTaskWorkerCoordinator(svc).processReplicationTeardown(task, context.Background()); err != nil {
		t.Fatalf("reprocess: %v", err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("user_id = ? AND mime_type LIKE ?", "usr-teardown", "image/%").Count(&count).Error; err != nil || count != 4 {
		t.Fatalf("image resources = %d, %v; want 3 keyframes + 1 grid", count, err)
	}
}

func TestReplicationTeardownFailsWhenTheVideoIsGone(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	inputJSON, _ := json.Marshal(videoTeardownInput{Version: 1, ResourceID: "missing", Transcribe: false, MaxShots: 60, Fingerprint: "fp"})
	task := &model.Task{ID: "vt-missing", UserID: "usr-teardown", Type: model.TaskTypeReplicationTeardown, Status: model.TaskStatusRunning, InputJSON: string(inputJSON)}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if err := newTaskWorkerCoordinator(svc).processReplicationTeardown(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.Error == "" {
		t.Fatalf("task = %s / %q, want failed with a reason", stored.Status, stored.Error)
	}
}

func seedTeardownVideoResource(t *testing.T, s *Service, userID string) *model.Resource {
	t.Helper()
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", CreatedAt: time.Now()}
	resource.ObjectKey = userID + "/" + resource.ID + ".mp4"
	path := filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	args := []string{"-v", "error", "-y"}
	// 场景分数主要看亮度：相邻两段亮度要拉开（纯红和纯绿亮度几乎一样，检测不到切点）。
	for _, color := range []string{"red", "white", "navy"} {
		args = append(args, "-f", "lavfi", "-i", "color=c="+color+":s=320x568:r=30:d=1.5")
	}
	args = append(args, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=4.5",
		"-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-map", "3:a",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", path)
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("generate test video: %v %s", err, output)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	resource.Size = info.Size()
	resource.DurationMs = 4500
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}
