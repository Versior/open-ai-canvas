package app

import (
	"context"
	"encoding/json"
	"math"
	"path/filepath"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestRenderLutValidation(t *testing.T) {
	for _, p := range renderLutPresets() {
		lut := &renderLut{Name: p.ID, Preset: p.ID, Strength: 1}
		if err := validateRenderLut(lut); err != nil {
			t.Fatal(err)
		}
		cube := renderLutCube(lut)
		if len(cube.Values) != 17*17*17*3 {
			t.Fatal("wrong cube size")
		}
		for _, v := range cube.Values {
			if v < 0 || v > 1 {
				t.Fatal("out of range")
			}
		}
	}
	svc, _ := newTimelineTaskTestService(t)
	for _, lut := range []*renderLut{{Preset: "warm;movie=/etc/passwd", Strength: 1}, {Preset: "warm", Strength: -1}, {Preset: "warm", Strength: math.NaN()}, {Cube: &renderCubeLut{Size: 33}, Strength: 1}, {Cube: &renderCubeLut{Size: 100000}, Strength: 1}} {
		if validateRenderLut(lut) == nil {
			t.Fatalf("accepted invalid LUT: %+v", lut)
		}
		project := renderTestProject("resource:missing")
		project.ColorLut = lut
		if _, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{Timeline: project}); err == nil || !strings.Contains(err.Error(), "LUT") {
			t.Fatalf("API did not reject LUT: %v", err)
		}
	}
}

// 真实编码验证：整片调色、强度0还原、音轨/画幅保留，蓝色字幕不被黑白LUT染色。
func TestTimelineRenderLutChangesPixelsAndPreservesSubtitles(t *testing.T) {
	requireFFmpegTools(t)
	for _, scenario := range []struct {
		name     string
		strength float64
		custom   bool
	}{{"original", 0, false}, {"half", 0.5, false}, {"mono", 1, false}, {"custom", 1, true}} {
		t.Run(scenario.name, func(t *testing.T) {
			strength := scenario.strength
			svc, db := newTimelineTaskTestService(t)
			svc.dataDir = t.TempDir()
			user := "usr-render-test"
			source := seedLocalVideoResource(t, svc, user, 320, 568, nil)
			sub := seedLocalFileResource(t, svc, user, "image", "image/png", ".png", func(path string) { writeTestPNG(t, path, 320, 568) })
			project := renderTestProject("resource:" + source.ID)
			project.Width, project.Height = 320, 568
			project.ColorLut = &renderLut{Name: "mono", Preset: "mono", Strength: strength}
			if scenario.custom {
				project.ColorLut = &renderLut{Name: "invert.cube", Strength: 1, Cube: &renderCubeLut{Size: 2, DomainMin: []float64{0, 0, 0}, DomainMax: []float64{1, 1, 1}, Values: []float64{1, 1, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0}}}
			}
			overlay := overlayClip("sub", "image", "subs", 0, 1000, "resource:"+sub.ID)
			overlay.Overlay = true
			project.Tracks = append(project.Tracks, renderTrack{ID: "subs", Kind: "image"})
			project.Clips = append(project.Clips, overlay)
			task := seedRunningRenderTask(t, db, renderInputJSON(t, project))
			if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
				t.Fatal(err)
			}
			var stored model.Task
			if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Status != model.TaskStatusSucceeded {
				t.Fatalf("render failed: %s", stored.Error)
			}
			var result timelineRenderOutput
			if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
				t.Fatal(err)
			}
			if result.Width != 320 || result.Height != 568 {
				t.Fatal("LUT changed dimensions")
			}
			output, err := svc.repo.ResourceForUser(user, result.ResourceID)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(svc.dataDir, "resources", filepath.FromSlash(output.ObjectKey))
			pixel := frameColorAt(t, path, "0.5", 160, 100)
			if strength == 0 && !(pixel[0] > 180 && pixel[2] < 90) {
				t.Fatalf("zero strength changed original: %v", pixel)
			}
			difference := int(pixel[0]) - int(pixel[2])
			if !scenario.custom && strength == 1 && math.Abs(float64(difference)) > 8 {
				t.Fatalf("mono did not remove color: %v", pixel)
			}
			if strength == 0.5 && (difference < 80 || difference > 170) {
				t.Fatalf("half strength not blended: %v", pixel)
			}
			if scenario.custom && !(pixel[0] < 90 && pixel[1] > 180 && pixel[2] > 180) {
				t.Fatalf("custom LUT not applied: %v", pixel)
			}
			subtitle := frameColorAt(t, path, "0.5", 160, 460)
			if subtitle[2] < 180 || subtitle[0] > 90 {
				t.Fatalf("LUT recolored subtitle: %v", subtitle)
			}
			if hasAudio, err := probeHasAudioStream(context.Background(), path); err != nil || !hasAudio {
				t.Fatalf("audio lost: %v", err)
			}
		})
	}
}
