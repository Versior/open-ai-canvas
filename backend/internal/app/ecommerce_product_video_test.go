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

func productVideoItem(id, title, extra string) json.RawMessage {
	body := `{"id":"` + id + `","title":"` + title + `"`
	if extra != "" {
		body += "," + extra
	}
	return json.RawMessage(body + "}")
}

func TestProductVideoSaveConflictDeleteAndKeepsStudio(t *testing.T) {
	s, db, _, admin := newAdminStorageDeleteTestService(t)
	if _, err := s.SaveEcommerceStudioProduct(admin, "product_aaa", studioProduct("product_aaa", "保温杯", ""), nil); err != nil {
		t.Fatal(err)
	}
	zero, one := int64(0), int64(1)
	if _, err := s.SaveProductVideo(admin, "video_aaa", productVideoItem("video_aaa", "保温杯视频", ""), nil); err == nil {
		t.Fatal("expectedRevision is required")
	}
	created, err := s.SaveProductVideo(admin, "video_aaa", productVideoItem("video_aaa", "保温杯视频", `"revision":42,"result":{"resourceId":"res_final"},"segments":[{"resourceId":"res_clip","keyframeResourceId":"res_frame"}]`), &zero)
	if err != nil || ecommerceStudioProductRevision(created.Item) != 1 {
		t.Fatalf("create: %+v %v", created, err)
	}
	if _, err := s.SaveProductVideo(admin, "video_aaa", productVideoItem("video_aaa", "另一个窗口", ""), &zero); err == nil {
		t.Fatal("second create must conflict")
	} else {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != productVideoConflictReason || appErr.Details["revision"] != int64(1) {
			t.Fatalf("conflict: %#v", err)
		}
	}
	if _, err := s.SaveProductVideo(admin, "video_aaa", productVideoItem("video_aaa", "保温杯视频 v2", `"result":{"resourceId":"res_final"}`), &one); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.ProductVideos(admin)
	if err != nil || len(loaded.Items) != 1 || !strings.Contains(string(loaded.Items[0]), "保温杯视频 v2") {
		t.Fatalf("list: %+v %v", loaded, err)
	}
	if single, err := s.ProductVideo(admin, "video_aaa"); err != nil || ecommerceStudioProductRevision(single.Item) != 2 {
		t.Fatalf("single: %+v %v", single, err)
	}
	studio, err := s.EcommerceStudio(admin)
	if err != nil || len(studio.Products) != 1 {
		t.Fatalf("studio products must survive product video writes: %+v %v", studio, err)
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot(admin.ID, "", []string{"res_final", "res_unused"})
	if err != nil {
		t.Fatal(err)
	}
	referenced := map[string]struct{}{}
	for _, document := range snapshot.Documents {
		for id := range documentReferencedResourceIDs(document.PrimaryJSON, map[string]struct{}{"res_final": {}, "res_unused": {}}) {
			referenced[id] = struct{}{}
		}
	}
	if _, ok := referenced["res_final"]; !ok {
		t.Fatalf("the finished video must stay protected from orphan cleanup: %v", referenced)
	}
	if _, ok := referenced["res_unused"]; ok {
		t.Fatal("unreferenced resource reported as referenced")
	}
	if _, err := s.DeleteProductVideo(admin, "video_aaa"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DeleteProductVideo(admin, "video_aaa"); err != nil {
		t.Fatalf("delete must be idempotent: %v", err)
	}
	if _, err := s.ProductVideo(admin, "video_aaa"); err == nil {
		t.Fatal("deleted item still readable")
	}
	var row model.EcommerceLibrary
	if err := db.First(&row, "user_id = ?", admin.ID).Error; err != nil || !strings.Contains(row.PayloadJSON, `"studio"`) || !strings.Contains(row.PayloadJSON, `"productVideos"`) {
		t.Fatalf("payload keys: %s %v", row.PayloadJSON, err)
	}
}

func TestProductVideoRejectsInvalidItems(t *testing.T) {
	s, _, _, admin := newAdminStorageDeleteTestService(t)
	zero := int64(0)
	for name, test := range map[string]struct {
		id   string
		body string
	}{
		"short id":     {"v1", `{"id":"v1"}`},
		"id mismatch":  {"video_aaa", `{"id":"video_bbb"}`},
		"not object":   {"video_aaa", `["video_aaa"]`},
		"long title":   {"video_aaa", `{"id":"video_aaa","title":"` + strings.Repeat("长", 121) + `"}`},
		"inline media": {"video_aaa", `{"id":"video_aaa","cover":"data:image/png;base64,AAAA"}`},
		"too large":    {"video_aaa", `{"id":"video_aaa","note":"` + strings.Repeat("a", productVideoMaxItemBytes) + `"}`},
	} {
		if _, err := s.SaveProductVideo(admin, test.id, json.RawMessage(test.body), &zero); err == nil {
			t.Fatalf("%s must be rejected", name)
		}
	}
}

func TestPlanProductVideoSegments(t *testing.T) {
	type want struct {
		start, end int64
		boundary   string
	}
	cases := []struct {
		name       string
		start, end int64
		cuts       []int64
		maxMs      int64
		want       []want
	}{
		{name: "short take stays whole", start: 0, end: 9000, maxMs: 15000, want: []want{{0, 9000, "start"}}},
		{
			name: "packs shots up to the limit and breaks at cuts", start: 0, end: 30000, cuts: []int64{4000, 9000, 14000, 20000, 26000}, maxMs: 15000,
			want: []want{{0, 14000, "start"}, {14000, 26000, "cut"}, {26000, 30000, "cut"}},
		},
		{
			name: "splits a long take evenly and lets the last part absorb the next shot", start: 0, end: 35000, cuts: []int64{32000}, maxMs: 15000,
			want: []want{{0, 10666, "start"}, {10666, 21333, "split"}, {21333, 35000, "split"}},
		},
		{
			name: "keeps the next shot apart when the last part is already full", start: 0, end: 40000, cuts: []int64{32000}, maxMs: 15000,
			want: []want{{0, 10666, "start"}, {10666, 21333, "split"}, {21333, 32000, "split"}, {32000, 40000, "cut"}},
		},
		{
			name: "rebalances a short tail that does not fit into its neighbour", start: 1000, end: 12000, cuts: []int64{3000, 6000, 9000}, maxMs: 8000,
			want: []want{{1000, 6500, "start"}, {6500, 12000, "split"}},
		},
		{
			name: "merges a short opening shot into its neighbour when it fits", start: 0, end: 20000, cuts: []int64{3000}, maxMs: 15000,
			want: []want{{0, 11500, "start"}, {11500, 20000, "split"}},
		},
		{
			name: "ignores cuts outside the range or too close to its edges", start: 2000, end: 20000, cuts: []int64{1000, 2100, 10000, 19800, 25000}, maxMs: 15000,
			want: []want{{2000, 10000, "start"}, {10000, 20000, "cut"}},
		},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			segments := planProductVideoSegments(test.start, test.end, test.cuts, test.maxMs, productVideoMinSegmentMs)
			got := make([]want, 0, len(segments))
			for _, segment := range segments {
				got = append(got, want{segment.StartMs, segment.EndMs, segment.Boundary})
				if segment.durationMs() > test.maxMs || (len(segments) > 1 && segment.durationMs() < productVideoMinSegmentMs) {
					t.Fatalf("segment %+v breaks the length limits", segment)
				}
			}
			if !slices.Equal(got, test.want) {
				t.Fatalf("segments = %+v, want %+v", got, test.want)
			}
		})
	}
}

func TestProductVideoClipSize(t *testing.T) {
	for _, test := range []struct{ width, height, wantWidth, wantHeight int }{
		{1080, 1920, 720, 1280},
		{1920, 1080, 1280, 720},
		{320, 568, 320, 568},
		{721, 1281, 720, 1280},
	} {
		if width, height := productVideoClipSize(test.width, test.height); width != test.wantWidth || height != test.wantHeight {
			t.Fatalf("%dx%d -> %dx%d, want %dx%d", test.width, test.height, width, height, test.wantWidth, test.wantHeight)
		}
	}
}

func TestCreateProductVideoSplitTaskValidatesAndReplays(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	// 元素替换并在视频复刻里，跟视频复刻开关走；电商生图台关着也能用。
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"videoReplicationEnabled":false}`}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateProductVideoSplitTask("usr-a", "split-key-0000", ProductVideoSplitRequest{ResourceID: "res-ref", EndMs: 10_000}); err == nil || !strings.Contains(err.Error(), "视频复刻暂未开放") {
		t.Fatalf("closed video replication must refuse splits: %v", err)
	}
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"videoReplicationEnabled":true,"ecommerceStudioEnabled":false}`}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "res-ref", UserID: "usr-a", Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", Size: 1024, DurationMs: 150_000}).Error; err != nil {
		t.Fatal(err)
	}
	seedResource(t, db, "res-image", "usr-a", "image/png")
	if _, err := svc.CreateProductVideoSplitTask("usr-a", "short", ProductVideoSplitRequest{ResourceID: "res-ref"}); err == nil || !strings.Contains(err.Error(), "X-Idempotency-Key") {
		t.Fatalf("short key error = %v", err)
	}
	for _, test := range []struct {
		userID string
		req    ProductVideoSplitRequest
		want   string
	}{
		{"usr-b", ProductVideoSplitRequest{ResourceID: "res-ref", EndMs: 10_000}, "无法读取"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: "res-image", EndMs: 10_000}, "必须是视频"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: "res-ref"}, "4 到 120 秒"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: "res-ref", StartMs: 1000, EndMs: 3000}, "4 到 120 秒"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: "res-ref", StartMs: 140_000, EndMs: 160_000}, "超出"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: "res-ref", EndMs: 10_000, MaxSegmentSeconds: 5}, "每段时长上限"},
		{"usr-a", ProductVideoSplitRequest{ResourceID: " ", EndMs: 10_000}, "必须指定"},
	} {
		if _, err := svc.CreateProductVideoSplitTask(test.userID, "split-key-0001", test.req); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("%+v error = %v, want %q", test.req, err, test.want)
		}
	}
	request := ProductVideoSplitRequest{ResourceID: "res-ref", StartMs: 5000, EndMs: 65_000, MaxSegmentSeconds: 12}
	first, err := svc.CreateProductVideoSplitTask("usr-a", "split-key-0001", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.Type != model.TaskTypeProductVideoSplit || first.Status != model.TaskStatusQueued || first.Provider != "local" {
		t.Fatalf("task = %+v", first)
	}
	if replay, err := svc.CreateProductVideoSplitTask("usr-a", "split-key-0001", request); err != nil || replay.ID != first.ID {
		t.Fatalf("replay = %+v, %v", replay, err)
	}
	request.EndMs = 60_000
	var appErr *AppError
	if _, err := svc.CreateProductVideoSplitTask("usr-a", "split-key-0001", request); !errors.As(err, &appErr) || appErr.Code != CodeIdempotencyConflict {
		t.Fatalf("changed request with the same key = %v", err)
	}
	if got := taskExecutionTimeoutWithPolicy(model.TaskTypeProductVideoSplit, RuntimeTaskPolicy{VideoTimeoutMinutes: 120}); got != productVideoSplitTimeout {
		t.Fatalf("timeout = %v", got)
	}
}

// 真实 ffmpeg 端到端：红白交替 5 段各 3 秒，从 1.5 秒切到结尾、每段不超过 8 秒，
// 应在 9 秒处的切点断开成两段；切点要换算回原视频的位置，片段和封面都存成资源。
func TestProductVideoSplitCutsAtShotBoundaries(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	source := seedProductVideoSource(t, svc, "usr-split")
	inputJSON, _ := json.Marshal(productVideoSplitInput{Version: 1, ResourceID: source.ID, StartMs: 1500, MaxSegmentMs: 8000, Fingerprint: "fp"})
	task := &model.Task{ID: fmt.Sprintf("pv-test-%d", time.Now().UnixNano()), UserID: "usr-split", Type: model.TaskTypeProductVideoSplit, Status: model.TaskStatusRunning, InputJSON: string(inputJSON)}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	if err := newTaskWorkerCoordinator(svc).processProductVideoSplit(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("status = %s, error = %s", stored.Status, stored.Error)
	}
	var result productVideoSplitResult
	if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	if result.StartMs != 1500 || result.EndMs < 14_900 || !result.Source.HasAudio || len(result.Segments) != 2 {
		t.Fatalf("result = %+v", result)
	}
	if first, second := result.Segments[0], result.Segments[1]; first.StartMs != 1500 || first.EndMs < 8900 || first.EndMs > 9100 || second.StartMs != first.EndMs || second.EndMs != result.EndMs {
		t.Fatalf("segments = %+v", result.Segments)
	}
	for _, segment := range result.Segments {
		clip, err := svc.repo.ResourceForUser("usr-split", segment.ResourceID)
		if err != nil || !strings.HasPrefix(clip.MimeType, "video/") || clip.DurationMs < segment.DurationMs-150 || clip.DurationMs > segment.DurationMs+150 || segment.Width != 320 || segment.Height != 568 {
			t.Fatalf("clip %d = %+v, %v", segment.Index, clip, err)
		}
		frame, err := svc.repo.ResourceForUser("usr-split", segment.KeyframeResourceID)
		if err != nil || !strings.HasPrefix(frame.MimeType, "image/") {
			t.Fatalf("keyframe %d = %+v, %v", segment.Index, frame, err)
		}
	}
	// 重新领取同一任务时复用已存的片段，不重复占用存储。
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusRunning, "result_json": ""}).Error; err != nil {
		t.Fatal(err)
	}
	if err := newTaskWorkerCoordinator(svc).processProductVideoSplit(task, context.Background()); err != nil {
		t.Fatalf("reprocess: %v", err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("user_id = ? AND id <> ?", "usr-split", source.ID).Count(&count).Error; err != nil || count != 4 {
		t.Fatalf("resources = %d, %v; want 2 clips + 2 keyframes", count, err)
	}
}

func seedProductVideoSource(t *testing.T, s *Service, userID string) *model.Resource {
	t.Helper()
	resource := &model.Resource{ID: newID(), UserID: userID, Kind: "video", Status: model.ResourceStatusReady, Provider: "local", MimeType: "video/mp4", CreatedAt: time.Now()}
	resource.ObjectKey = userID + "/" + resource.ID + ".mp4"
	path := filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	args := []string{"-v", "error", "-y"}
	colors := []string{"red", "white", "navy", "white", "navy"}
	for _, color := range colors {
		args = append(args, "-f", "lavfi", "-i", "color=c="+color+":s=320x568:r=30:d=3")
	}
	args = append(args, "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=15",
		"-filter_complex", "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v]", "-map", "[v]", "-map", "5:a",
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", path)
	if output, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
		t.Fatalf("generate test video: %v %s", err, output)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	resource.Size = info.Size()
	resource.DurationMs = 15_000
	if err := s.repo.CreateResource(resource); err != nil {
		t.Fatal(err)
	}
	return resource
}
