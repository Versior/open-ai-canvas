package packaging

import (
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
