package protocol

import (
	"context"
	"testing"
)

func TestImageResponsesPreserveGIF(t *testing.T) {
	const encoded = "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="
	const inline = "data:image/gif;base64," + encoded
	for _, item := range []map[string]any{
		{"b64_json": encoded},
		{"b64_json": encoded, "output_format": "gif"},
		{"b64_json": inline},
	} {
		values := []any{item}
		result, err := parseImageResponse(map[string]any{"data": values})
		if err != nil {
			t.Fatal(err)
		}
		if len(result.Result.Images) != 1 || result.Result.Images[0].DataURL != inline {
			t.Fatalf("image response lost GIF type: %+v", result.Result.Images)
		}
		images := mediaFromArray(values, CapabilityImage)
		if len(images) != 1 || images[0].DataURL != inline {
			t.Fatalf("array response lost GIF type: %+v", images)
		}
	}
	if got := NormalizeInlineMediaDataURL(encoded, "image", "png"); got != inline {
		t.Fatal("GIF signature must override the default PNG format")
	}
	if got := NormalizeInlineMediaDataURL("YWJj", "image", "webp"); got != "data:image/webp;base64,YWJj" {
		t.Fatal("explicit format was lost")
	}
}

func TestOfficialImagePluginPreservesGIF(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-images.yingce-plugin", "openai-image")
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"b64_json":"R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Result.Images[0].DataURL != "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" {
		t.Fatal("official plugin mislabeled GIF as PNG")
	}
}
