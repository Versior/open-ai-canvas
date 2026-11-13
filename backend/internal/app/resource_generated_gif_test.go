package app

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"os"
	"path/filepath"
	"testing"
)

func TestGeneratedGIFPreservesAnimation(t *testing.T) {
	palette := color.Palette{color.Black, color.White}
	first := image.NewPaletted(image.Rect(0, 0, 16, 16), palette)
	second := image.NewPaletted(first.Rect, palette)
	second.SetColorIndex(0, 0, 1)
	var source bytes.Buffer
	if err := gif.EncodeAll(&source, &gif.GIF{Image: []*image.Paletted{first, second}, Delay: []int{10, 20}, LoopCount: 0}); err != nil {
		t.Fatal(err)
	}
	images, err := imageDataURLs(imageResponse{Data: []map[string]interface{}{{"b64_json": base64.StdEncoding.EncodeToString(source.Bytes())}}})
	if err != nil {
		t.Fatal(err)
	}
	svc := newResourceTestService(t)
	stored, err := svc.persistGeneratedMediaResult("user-1", map[string]interface{}{"mode": "image", "images": images})
	if err != nil {
		t.Fatal(err)
	}
	result := stored["images"].([]interface{})[0].(map[string]interface{})
	if result["mimeType"] != "image/gif" {
		t.Fatalf("generated MIME = %v, want image/gif", result["mimeType"])
	}
	resource, err := svc.repo.Resource(result["resourceId"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Ext(resource.ObjectKey) != ".gif" {
		t.Fatalf("generated extension = %s", filepath.Ext(resource.ObjectKey))
	}
	saved, err := os.ReadFile(filepath.Join(svc.dataDir, "resources", resource.ObjectKey))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, source.Bytes()) {
		t.Fatal("generation storage changed GIF bytes")
	}
	animation, err := gif.DecodeAll(bytes.NewReader(saved))
	if err != nil {
		t.Fatal(err)
	}
	if len(animation.Image) != 2 || animation.Delay[1] != 20 || animation.LoopCount != 0 {
		t.Fatal("generation storage lost frames, timing or looping")
	}
}
