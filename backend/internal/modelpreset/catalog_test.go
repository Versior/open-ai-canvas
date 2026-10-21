package modelpreset

import "testing"

func TestModelFamilyIdentity(t *testing.T) {
	for _, item := range [][3]string{{"models/Gemini_9_Image-preview", "Gemini", "Gemini"}, {"flux.1-dev", "FLUX", "Flux"}, {"sora-2-pro", "Sora", "Sora"}, {"veo-3.1", "Veo", "Gemini"}, {"gpt-image-1", "GPT", "OpenAI"}, {"unknown-model", "", ""}, {"stepfather", "", ""}} {
		category, icon := Identity(item[0])
		if category != item[1] || icon != item[2] {
			t.Fatalf("identity %q = %q/%q", item[0], category, icon)
		}
	}
}

func TestFuzzyMetadataMatching(t *testing.T) {
	canonical, ok := Find("gemini-2.5-flash")
	if !ok {
		t.Fatal("canonical model missing")
	}
	for _, id := range []string{"models/Gemini_2.5_Flash", "Gemini 2.5 Flash", "gemini-2.5-flash-high"} {
		got, found := Find(id)
		if !found || got.Context != canonical.Context || got.Output != canonical.Output || got.Vision != canonical.Vision {
			t.Fatalf("alias %q did not match canonical metadata: %+v", id, got)
		}
	}
	for _, pair := range [][2]string{{"gemini-3.8-flash", "gemini-3.7-flash"}, {"gemini-2.5-pro", "gemini-2.5-flash"}, {"gpt-5-mini", "gpt-5"}} {
		if MatchScore(pair[0], pair[1], false) != 0 {
			t.Fatalf("different model limits matched: %v", pair)
		}
	}
	if MatchScore("gemini-3.5-flash", "gemini-2.5-flash", true) != 1 {
		t.Fatal("family price template did not match")
	}
	if _, found := Find("completely-unknown-123"); found {
		t.Fatal("unknown model should not receive catalog limits")
	}
}
