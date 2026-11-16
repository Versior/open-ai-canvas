package packaging

import (
	"encoding/json"
	"math"
	"testing"
)

func TestPackagingBuiltinCatalogValid(t *testing.T) {
	catalog := DefaultCatalog()
	if err := ValidateCatalog(catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Templates) != 12 {
		t.Fatal("missing structures")
	}
	for _, template := range catalog.Templates {
		d := Document{Version: 1, Template: template, Parameters: template.Defaults, Material: catalog.Materials[0], Artworks: []Artwork{}, View: View{Fold: 1, Layout: "split", Background: "dark", Projection: "perspective", Finish: "paper", Light: 1.3}}
		if err := ValidateDocument(d); err != nil {
			t.Fatalf("%s: %v", template.Name, err)
		}
	}
}

func TestNativeLayersAndSurfaceContract(t *testing.T) {
	c := DefaultCatalog()
	d := Document{Version: 1, Template: c.Templates[0], Parameters: c.Templates[0].Defaults, Material: c.Materials[0], View: View{Fold: 1, Layout: "split", Background: "dark", Projection: "perspective", Finish: "paper", Light: 1}, Surface: &Surface{Paper: "linen", Film: "soft", Studio: "commerce", Inspection: "deboss", Quality: 2048, Depth: 0.2, FoilColor: "#ddbb66", SilverColor: "#eeeeee"}}
	for _, role := range Roles {
		fontSize, lineHeight, tracking, wrap := 4.0, 1.5, 0.0, false
		d.Artworks = []Artwork{{ID: "native", PanelID: "box-front", Role: role, Width: 50, Height: 20, Opacity: 1, Content: &LayerContent{Kind: "text", Value: "包装品牌", Font: "serif", Weight: 700, Align: "center", Color: "#222222", FontSize: &fontSize, LineHeight: &lineHeight, LetterSpacing: &tracking, Wrap: &wrap}}}
		if err := ValidateDocument(d); err != nil {
			t.Fatalf("%s: %v", role, err)
		}
	}
	for _, mutate := range []func(*Document){
		func(d *Document) { d.Artworks[0].ResourceID = "foreign-resource" },
		func(d *Document) { d.Artworks[0].Content.Font = "untrusted-font-url" },
		func(d *Document) { d.Artworks[0].Content.Kind = "html" },
		func(d *Document) { *d.Artworks[0].Content.FontSize = 0 },
		func(d *Document) { *d.Artworks[0].Content.FontSize = 2001 },
		func(d *Document) { *d.Artworks[0].Content.LineHeight = 0.9 },
		func(d *Document) { *d.Artworks[0].Content.LineHeight = 3.1 },
		func(d *Document) { *d.Artworks[0].Content.LetterSpacing = -1 },
		func(d *Document) { *d.Artworks[0].Content.LetterSpacing = 21 },
		func(d *Document) { d.Surface.Quality = 100000 },
		func(d *Document) { d.Surface.Depth = math.NaN() },
	} {
		raw, _ := json.Marshal(d)
		var copy Document
		if err := json.Unmarshal(raw, &copy); err != nil {
			t.Fatal(err)
		}
		mutate(&copy)
		if ValidateDocument(copy) == nil {
			t.Fatal("invalid native layer/surface accepted")
		}
	}
	d.Artworks[0].Content.Value = ""
	raw, _ := json.Marshal(d)
	var copy Document
	if err := json.Unmarshal(raw, &copy); err != nil || copy.Artworks[0].Content.Value != "" {
		t.Fatal("empty editable text did not round trip")
	}
	if *copy.Artworks[0].Content.FontSize != 4 || *copy.Artworks[0].Content.LineHeight != 1.5 || *copy.Artworks[0].Content.LetterSpacing != 0 || *copy.Artworks[0].Content.Wrap {
		t.Fatal("typography fields did not round trip")
	}
}

func TestPackagingRejectsInvalidGeometryAndArtwork(t *testing.T) {
	c := DefaultCatalog()
	for _, mutate := range []func(*Parameters){func(p *Parameters) { p.Length = math.NaN() }, func(p *Parameters) { p.Thickness = 20 }, func(p *Parameters) { p.WindowWidth = 20 }, func(p *Parameters) { p.FrontHeight = p.Height + 1 }, func(p *Parameters) { p.Glue = -2 }} {
		p := c.Templates[0].Defaults
		mutate(&p)
		if ValidateParameters(p) == nil {
			t.Fatal("invalid dimensions accepted")
		}
	}
	d := Document{Version: 1, Template: c.Templates[0], Parameters: c.Templates[0].Defaults, Material: c.Materials[0], View: View{Fold: 1, Layout: "split", Background: "dark", Projection: "perspective", Finish: "paper", Light: 1}}
	d.Artworks = []Artwork{{ID: "one", ResourceID: "https://foreign.test/image", Role: "artwork", Width: 100, Height: 100, Opacity: 1}}
	if ValidateDocument(d) == nil {
		t.Fatal("external artwork URL accepted")
	}
}
