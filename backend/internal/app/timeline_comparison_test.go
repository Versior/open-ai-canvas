package app

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"math"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func comparisonFixture(t *testing.T) renderProject {
	t.Helper()
	var project renderProject
	err := json.Unmarshal([]byte(`{"version":2,"width":640,"height":360,"tracks":[{"id":"video","kind":"video"}],"clips":[{"id":"render","kind":"video","trackId":"video","startMs":0,"durationMs":2000,"directMedia":{"storageKey":"resource:render"}}],"comparison":{"authorized":true,"audio":"render","clips":[{"id":"ref-a","kind":"video","startMs":0,"durationMs":1000,"sourceStartMs":500,"directMedia":{"storageKey":"resource:original"}},{"id":"ref-b","kind":"video","startMs":1000,"durationMs":1000,"sourceStartMs":3000,"directMedia":{"storageKey":"resource:original"}}]}}`), &project)
	if err != nil {
		t.Fatal(err)
	}
	return project
}

func TestTimelineComparisonRejectsInvalidInput(t *testing.T) {
	cases := []struct {
		name   string
		change func(*renderProject)
	}{
		{"authorization", func(p *renderProject) { p.Comparison.Authorized = false }},
		{"audio", func(p *renderProject) { p.Comparison.Audio = "both" }},
		{"odd pane", func(p *renderProject) { p.Width = 642 }},
		{"reference missing", func(p *renderProject) { p.Comparison.Clips = nil }},
		{"reference overlap", func(p *renderProject) { p.Comparison.Clips[1].StartMs = 500 }},
		{"reference short", func(p *renderProject) { p.Comparison.Clips[1].DurationMs = 500 }},
		{"negative source", func(p *renderProject) { p.Comparison.Clips[0].SourceStartMs = -1 }},
		{"missing media", func(p *renderProject) { p.Comparison.Clips[0].DirectMedia = nil }},
		{"render overlap", func(p *renderProject) { p.Clips = append(p.Clips, p.Clips[0]) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			project := comparisonFixture(t)
			tc.change(&project)
			if validateRenderComparison(project) == nil {
				t.Fatal("invalid comparison accepted")
			}
		})
	}
}

func TestTimelineComparisonChecksResourceOwnershipBeforeQueue(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	project := comparisonFixture(t)
	for _, resource := range []model.Resource{
		{ID: "render", UserID: "usr-render-test", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "original", UserID: "another-user", Kind: "video", Status: model.ResourceStatusReady},
	} {
		if err := svc.repo.CreateResource(&resource); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{Timeline: project}); err == nil {
		t.Fatal("foreign original accepted")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 0 {
		t.Fatal("invalid request entered queue")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "original").Update("user_id", "usr-render-test").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "original").Update("kind", "image").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{Timeline: project}); err == nil {
		t.Fatal("image cannot be used as the original video")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "original").Update("kind", "video").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{Timeline: project}); err != nil {
		t.Fatal(err)
	}
}

func TestTimelineComparisonRechecksActualSourceDuration(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	resource := seedLocalVideoResource(t, svc, "usr-render-test", 180, 320, nil)
	project := comparisonFixture(t)
	project.Clips[0].DurationMs = 1000
	project.Clips[0].DirectMedia.StorageKey = "resource:" + resource.ID
	project.Comparison.Clips = project.Comparison.Clips[:1]
	project.Comparison.Clips[0].DirectMedia.StorageKey = "resource:" + resource.ID
	// 资源记录没有时长，实际文件只有1秒。左侧0.5–1.5秒必须在Worker中拒绝。
	task := seedRunningRenderTask(t, db, renderInputJSON(t, project))
	if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || !strings.Contains(stored.Error, "实际时长") {
		t.Fatalf("range outside actual video accepted: %s %s", stored.Status, stored.Error)
	}
}

func TestTimelineComparisonRendersAlignedPanesAndAudio(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	user := "usr-render-test"
	original := seedLocalFileResource(t, svc, user, "video", "video/mp4", ".mp4", func(path string) {
		args := []string{"-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=180x320:r=30:d=3", "-f", "lavfi", "-i", "color=c=lime:s=180x320:r=30:d=1", "-f", "lavfi", "-i", "sine=frequency=880:duration=4", "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path}
		if out, err := exec.Command("ffmpeg", args...).CombinedOutput(); err != nil {
			t.Fatalf("source: %v %s", err, out)
		}
	})
	render := seedLocalFileResource(t, svc, user, "video", "video/mp4", ".mp4", func(path string) {
		if out, err := exec.Command("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path).CombinedOutput(); err != nil {
			t.Fatalf("render: %v %s", err, out)
		}
	})
	for _, audio := range []string{"render", "reference", "mute"} {
		t.Run(audio, func(t *testing.T) {
			project := comparisonFixture(t)
			project.Clips[0].DirectMedia.StorageKey = "resource:" + render.ID
			for i := range project.Comparison.Clips {
				project.Comparison.Clips[i].DirectMedia.StorageKey = "resource:" + original.ID
			}
			project.Comparison.Audio = audio
			task := seedRunningRenderTask(t, db, renderInputJSON(t, project))
			if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
				t.Fatal(err)
			}
			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusSucceeded {
				t.Fatalf("render status %s: %s", stored.Status, stored.Error)
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
			info, err := probeMediaFile(context.Background(), path)
			if err != nil || info.Width != 640 || info.Height != 360 || info.DurationMs < 1990 || info.DurationMs > 2040 {
				t.Fatalf("output dimensions/duration: %+v %v", info, err)
			}
			if c := frameColorAt(t, path, "0.3", 160, 180); c[0] < 180 || c[1] > 80 {
				t.Fatalf("left before cut: %v", c)
			}
			if c := frameColorAt(t, path, "1.3", 160, 180); c[1] < 180 || c[0] > 80 {
				t.Fatalf("left after skipped range: %v", c)
			}
			if c := frameColorAt(t, path, "1.3", 480, 180); c[2] < 180 || c[0] > 80 {
				t.Fatalf("right render: %v", c)
			}
			if c := frameColorAt(t, path, "0.3", 480, 20); c[0] > 10 || c[1] > 10 || c[2] > 10 {
				t.Fatalf("landscape render must be padded, not cropped: %v", c)
			}
			pcm, err := exec.Command("ffmpeg", "-v", "error", "-ss", "0.2", "-i", path, "-t", "0.3", "-ac", "1", "-ar", "44100", "-f", "f32le", "-").Output()
			if err != nil {
				t.Fatal(err)
			}
			var peak, previous float32
			crossings := 0
			for i := 0; i+4 <= len(pcm); i += 4 {
				value := math.Float32frombits(binary.LittleEndian.Uint32(pcm[i : i+4]))
				peak = max(peak, float32(math.Abs(float64(value))))
				if previous < 0 && value >= 0 {
					crossings++
				}
				previous = value
			}
			frequency := float64(crossings) / (float64(len(pcm)/4) / 44100)
			want := 440.0
			if audio == "reference" {
				want = 880
			}
			if audio == "mute" {
				if peak > 0.0001 {
					t.Fatalf("mute peak %f", peak)
				}
			} else if peak < 0.05 || math.Abs(frequency-want) > 15 {
				t.Fatalf("audio frequency %.1f, want %.0f", frequency, want)
			}
			if len(result.Sources) != 3 || result.AIGC == "" {
				t.Fatal("source provenance missing")
			}
		})
	}
}

func TestTimelineComparisonUsesParallelPanes(t *testing.T) {
	plan := buildRenderPlan(comparisonFixture(t))
	args := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	if !strings.Contains(args, "hstack=inputs=2") {
		t.Fatal("comparison must place original and render side by side, not concatenate them")
	}
	if planDurationMs(plan) != 2000 {
		t.Fatal("comparison must keep the render duration")
	}
}
