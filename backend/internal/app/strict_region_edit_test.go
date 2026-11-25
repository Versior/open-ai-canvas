package app

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func regionFixture(t *testing.T, width int, colors ...color.NRGBA) []byte {
	t.Helper()
	im := image.NewNRGBA(image.Rect(0, 0, width, len(colors)/width))
	for i, c := range colors {
		im.SetNRGBA(i%width, i/width, c)
	}
	var data bytes.Buffer
	if err := png.Encode(&data, im); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestStrictRegionEditRecoveryPublishesOnlyProtectedPNG(t *testing.T) {
	face := color.NRGBA{R: 57, G: 101, B: 187, A: 95}
	hidden := color.NRGBA{R: 79, G: 13, B: 46}
	pants := color.NRGBA{B: 210, A: 255}
	changed := color.NRGBA{R: 190, A: 127}
	protected := color.NRGBA{A: 255}
	edit := color.NRGBA{}
	source := regionFixture(t, 3, face, pants, hidden)
	candidate := regionFixture(t, 3, changed, changed, changed)
	for _, tc := range []struct {
		name            string
		mask, candidate []byte
		ok              bool
	}{
		{"pants-only", regionFixture(t, 3, protected, edit, protected), candidate, true},
		{"empty", regionFixture(t, 3, protected, protected, protected), candidate, false},
		{"whole-image", regionFixture(t, 3, edit, edit, edit), candidate, false},
		{"misaligned-mask", regionFixture(t, 2, edit, protected), candidate, false},
		{"misaligned-result", regionFixture(t, 3, protected, edit, protected), regionFixture(t, 1, changed), false},
		{"corrupt-result", regionFixture(t, 3, protected, edit, protected), []byte("not a picture"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := seedMediaTask(t, db, providerConfig{})
			ref := func(data []byte) providerMedia {
				t.Helper()
				r, _, err := s.storeResource(task.UserID, "image", "input.png", "image/png", int64(len(data)), 0, 0, 0, bytes.NewReader(data), nil, true)
				if err != nil {
					t.Fatal(err)
				}
				return providerMedia{StorageKey: "resource:" + r.ID}
			}
			original, mask := ref(source), ref(tc.mask)
			input, _ := json.Marshal(canvasGenerationInput{Mode: "image", ReferenceImages: []providerMedia{original}, Mask: &mask, Metadata: map[string]any{"edit": "region-strict"}})
			task.InputJSON = string(input)
			if err := db.Model(task).Update("input_json", task.InputJSON).Error; err != nil {
				t.Fatal(err)
			}
			staged, err := s.stageInlineMedia(tc.candidate)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.saveMediaCheckpoint(task, &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: staged, MIMEType: "image/png"}}}, "local_save"); err != nil {
				t.Fatal(err)
			}
			// No live page, cached mask or in-memory generation context after a restart.
			restarted := &Service{repo: s.repo, dataDir: s.dataDir, activeCancels: make(map[string]context.CancelFunc)}
			out, err := restarted.resumeTaskMedia(context.Background(), task)
			if !tc.ok {
				if err == nil || out != nil {
					t.Fatal("invalid edit released a candidate")
				}
				r, err := s.resourceForUploadKey(task.UserID, strictRegionUploadKey(task.ID))
				if err != nil || r != nil {
					t.Fatalf("invalid output was registered: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := restarted.finishTaskMediaRecovery(task, out, nil); err != nil {
				t.Fatal(err)
			}
			r, err := s.resourceForUploadKey(task.UserID, strictRegionUploadKey(task.ID))
			if err != nil || r == nil || r.Status != model.ResourceStatusReady || r.MimeType != "image/png" {
				t.Fatalf("missing final PNG: %v", err)
			}
			stream, err := s.OpenResourceRange(task.UserID, r.ID, "")
			if err != nil {
				t.Fatal(err)
			}
			defer stream.Body.Close()
			im, err := png.Decode(stream.Body)
			if err != nil {
				t.Fatal(err)
			}
			for x, want := range []color.NRGBA{face, changed, hidden} {
				if got := color.NRGBAModel.Convert(im.At(x, 0)); got != want {
					t.Errorf("delivered pixel %d: got %v, want %v", x, got, want)
				}
			}
		})
	}
}

func TestStrictRegionNeedsExplicitChannelAcceptance(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-1")
	input := canvasGenerationInput{Mode: "image", Config: providerConfig{ChannelID: "catalog", InterfaceType: "openai-image"}, Mask: &providerMedia{}, ReferenceImages: []providerMedia{{}}, Metadata: map[string]any{"edit": "region-strict"}}
	if err := validateImageTask(profile, input); err == nil {
		t.Fatal("mask support alone advertised a tested strict channel")
	}
	intent := ModelRequestIntentFromTaskInput(map[string]any{"mode": "image", "metadata": map[string]any{"edit": "region-strict"}}, "canvas_image", "image")
	if intent.Inputs["strictmask"] != 1 {
		t.Fatal("routing could select a channel without strict acceptance")
	}
	profile.References.StrictRegionVerified = true
	if err := validateImageTask(profile, input); err != nil {
		t.Fatalf("verified system channel rejected: %v", err)
	}
	input.Config.Count = "2"
	if err := validateImageTask(profile, input); err == nil {
		t.Fatal("multiple provider results must not pass admission for a single strict task")
	}
}

func TestStrictRegionLiveAndResumedDelivery(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	keep, edit := color.NRGBA{G: 70, A: 255}, color.NRGBA{R: 135, A: 255}
	ref := func(owner string, data []byte) providerMedia {
		t.Helper()
		r, _, err := s.storeResource(owner, "image", "sample.png", "image/png", int64(len(data)), 0, 0, 0, bytes.NewReader(data), nil, true)
		if err != nil {
			t.Fatal(err)
		}
		return providerMedia{StorageKey: "resource:" + r.ID}
	}
	source := ref(task.UserID, regionFixture(t, 2, keep, keep))
	mask := ref(task.UserID, regionFixture(t, 2, color.NRGBA{A: 255}, color.NRGBA{}))
	input := canvasGenerationInput{Mode: "image", ReferenceImages: []providerMedia{source}, Mask: &mask, Metadata: map[string]any{"edit": strictRegionEdit}}
	if _, err := s.loadStrictRegionInputs("other-owner", input); err == nil {
		t.Fatal("foreign original was accepted")
	}
	foreignMask := ref("other-owner", regionFixture(t, 2, color.NRGBA{A: 255}, color.NRGBA{}))
	input.Mask = &foreignMask
	if _, err := s.loadStrictRegionInputs(task.UserID, input); err == nil {
		t.Fatal("foreign mask was accepted")
	}
	input.Mask = &mask
	raw, _ := json.Marshal(input)
	task.InputJSON = string(raw)
	if err := db.Model(task).Update("input_json", task.InputJSON).Error; err != nil {
		t.Fatal(err)
	}
	candidate := regionFixture(t, 2, edit, edit)
	// An ordinary ready image with the same task/index is not proof of composition.
	if _, _, err := s.storeResource(task.UserID, "image", "ordinary.png", "image/png", int64(len(candidate)), 2, 1, 0, bytes.NewReader(candidate), mediaUploadKey(task.ID, 0), true); err != nil {
		t.Fatal(err)
	}
	live, handled, err := recoverProtocolMedia(context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task), providerConfig{}, "image", []protocol.MediaReference{{DataURL: dataURL("image/png", candidate), Name: "raw-candidate", Metadata: map[string]any{"preview": "raw-candidate"}}})
	if !handled || err != nil {
		t.Fatalf("live delivery: %v", err)
	}
	loaded, err := s.repo.Task(task.ID)
	if err != nil {
		t.Fatal(err)
	}
	restarted := &Service{repo: s.repo, dataDir: s.dataDir}
	resumed, err := restarted.resumeTaskMedia(context.Background(), loaded)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := json.Marshal(live)
	b, _ := json.Marshal(resumed)
	if !bytes.Equal(a, b) || strings.Contains(string(a), "raw-candidate") || strings.Contains(string(a), "base64,") {
		t.Fatalf("result exposes a candidate or changed on resume: %s", a)
	}
	item := live["images"].([]any)[0].(map[string]any)
	stream, err := s.OpenResourceRange(task.UserID, item["resourceId"].(string), "")
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Body.Close()
	im, err := png.Decode(stream.Body)
	if err != nil || color.NRGBAModel.Convert(im.At(0, 0)) != keep || color.NRGBAModel.Convert(im.At(1, 0)) != edit {
		t.Fatal("stored download and preview are not the composed result")
	}
	// A stale or wrong-mode checkpoint must never fall back to ordinary media.
	bad := &mediaCheckpoint{Mode: "video", Items: []mediaCheckpointItem{{ResourceID: item["resourceId"].(string)}}}
	if out, err := s.materializeTaskMedia(context.Background(), loaded, providerConfig{}, bad); err == nil || out != nil {
		t.Fatal("wrong-mode checkpoint exposed a strict task as ordinary media")
	}
}
