package agentpet

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

func TestBuiltinCatalogIsValid(t *testing.T) {
	list, err := Builtins()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) < 60 {
		t.Fatalf("builtin pets = %d", len(list))
	}
	versions := map[int]int{}
	for _, item := range list {
		if item.Name == "" || item.Description == "" || item.Revision == "" || item.Tone == "" || len(item.Lines) == 0 {
			t.Fatalf("builtin %s is incomplete: %+v", item.ID, item)
		}
		data, sheet, err := BuiltinSheet(item.ID)
		if err != nil || len(data) == 0 || sheet.MimeType != "image/webp" || sheet.Version != item.SpriteVersion {
			t.Fatalf("builtin sheet %s: version=%d sheet=%+v err=%v", item.ID, item.SpriteVersion, sheet, err)
		}
		versions[item.SpriteVersion]++
	}
	if versions[1] == 0 || versions[2] == 0 {
		t.Fatalf("builtin versions = %v, want both v1 and v2", versions)
	}
	if _, ok := LookupBuiltin("missing"); ok {
		t.Fatal("unknown builtin found")
	}
	if ValidBuiltinID(UploadIDPrefix+"abc") || ValidBuiltinID("Has_Upper") || !ValidBuiltinID("pingo") {
		t.Fatal("builtin ID validation is wrong")
	}
}

func transparentPNG(t *testing.T, width, height int, opaque bool) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	if opaque {
		for y := 0; y < height; y++ {
			for x := 0; x < width; x++ {
				img.SetNRGBA(x, y, color.NRGBA{R: 10, G: 20, B: 30, A: 255})
			}
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, img); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func webpHeader(chunk string, payload []byte) []byte {
	data := []byte("RIFF\x00\x00\x00\x00WEBP" + chunk)
	data = binary.LittleEndian.AppendUint32(data, uint32(len(payload)))
	return append(data, payload...)
}

func TestInspectSheetFormats(t *testing.T) {
	if sheet, err := InspectSheet(transparentPNG(t, 1536, 1872, false)); err != nil || sheet.Version != 1 || sheet.MimeType != "image/png" {
		t.Fatalf("v1 png = %+v, %v", sheet, err)
	}
	if sheet, err := InspectSheet(transparentPNG(t, 1536, 2288, false)); err != nil || sheet.Version != 2 {
		t.Fatalf("v2 png = %+v, %v", sheet, err)
	}
	if _, err := InspectSheet(transparentPNG(t, 1536, 2288, true)); err == nil || !strings.Contains(err.Error(), "透明") {
		t.Fatalf("opaque png accepted: %v", err)
	}
	if _, err := InspectSheet(transparentPNG(t, 1536, 2496, false)); err == nil || !strings.Contains(err.Error(), "1536×2496") {
		t.Fatalf("v3-sized png accepted: %v", err)
	}

	vp8x := func(flags byte, width, height int) []byte {
		payload := []byte{flags, 0, 0, 0}
		payload = append(payload, byte(width-1), byte((width-1)>>8), byte((width-1)>>16))
		payload = append(payload, byte(height-1), byte((height-1)>>8), byte((height-1)>>16))
		return webpHeader("VP8X", payload)
	}
	if sheet, err := InspectSheet(vp8x(0x10, 1536, 2288)); err != nil || sheet.Version != 2 || sheet.MimeType != "image/webp" {
		t.Fatalf("vp8x alpha = %+v, %v", sheet, err)
	}
	if _, err := InspectSheet(vp8x(0x00, 1536, 2288)); err == nil {
		t.Fatal("vp8x without alpha accepted")
	}
	if _, err := InspectSheet(vp8x(0x12, 1536, 2288)); err == nil || !strings.Contains(err.Error(), "动图") {
		t.Fatalf("animated webp accepted: %v", err)
	}
	vp8l := func(alpha bool) []byte {
		bits := uint32(1536-1) | uint32(1872-1)<<14
		if alpha {
			bits |= 1 << 28
		}
		payload := binary.LittleEndian.AppendUint32([]byte{0x2f}, bits)
		return webpHeader("VP8L", append(payload, 0, 0, 0, 0, 0))
	}
	if sheet, err := InspectSheet(vp8l(true)); err != nil || sheet.Version != 1 {
		t.Fatalf("vp8l alpha = %+v, %v", sheet, err)
	}
	if _, err := InspectSheet(vp8l(false)); err == nil {
		t.Fatal("vp8l without alpha accepted")
	}
	lossy := webpHeader("VP8 ", []byte{0, 0, 0, 0x9d, 0x01, 0x2a, 0x00, 0x06, 0xf0, 0x08})
	if _, err := InspectSheet(lossy); err == nil {
		t.Fatal("simple lossy webp without alpha accepted")
	}
	if _, err := InspectSheet([]byte("GIF89a not a sheet at all, padding padding")); err == nil {
		t.Fatal("gif accepted")
	}
}

func zipOf(t *testing.T, files map[string][]byte) []byte {
	t.Helper()
	var out bytes.Buffer
	writer := zip.NewWriter(&out)
	for name, data := range files {
		part, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(data); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return out.Bytes()
}

func TestReadUploadPackages(t *testing.T) {
	sheet := transparentPNG(t, 1536, 2288, false)
	manifest := []byte(`{"id":"x","displayName":"  Pixel\nFox  ","description":"A fox","spriteVersionNumber":2,"spritesheetPath":"spritesheet.png","author":"ignored"}`)
	pkg, err := ReadUpload(zipOf(t, map[string][]byte{"fox/pet.json": manifest, "fox/spritesheet.png": sheet, "__MACOSX/fox/._pet.json": []byte("x")}), "fox.zip")
	if err != nil || pkg.Name != "Pixel Fox" || pkg.Description != "A fox" || pkg.Sheet.Version != 2 || !bytes.Equal(pkg.Data, sheet) {
		t.Fatalf("folder package = %+v, %v", pkg.Sheet, err)
	}
	pkg, err = ReadUpload(zipOf(t, map[string][]byte{"pet.json": []byte(`{"displayName":"Root"}`), "spritesheet.png": sheet}), "root.zip")
	if err != nil || pkg.Name != "Root" {
		t.Fatalf("root package without spritesheetPath = %+v, %v", pkg.Name, err)
	}
	pkg, err = ReadUpload(sheet, `C:\pets\Lucky Cat.png`)
	if err != nil || pkg.Name != "Lucky Cat" || pkg.Sheet.Version != 2 {
		t.Fatalf("plain sheet upload = %+v, %v", pkg.Name, err)
	}
	for name, files := range map[string]map[string][]byte{
		"missing manifest": {"spritesheet.png": sheet},
		"two manifests":    {"a/pet.json": manifest, "b/pet.json": manifest, "a/spritesheet.png": sheet},
		"nested manifest":  {"a/b/pet.json": manifest, "a/b/spritesheet.png": sheet},
		"traversal":        {"pet.json": []byte(`{"spritesheetPath":"../spritesheet.png"}`), "spritesheet.png": sheet},
		"missing sheet":    {"pet.json": []byte(`{"spritesheetPath":"other.webp"}`), "spritesheet.png": sheet},
		"version mismatch": {"pet.json": []byte(`{"spriteVersionNumber":1}`), "spritesheet.png": sheet},
		"bad json":         {"pet.json": []byte(`{`), "spritesheet.png": sheet},
	} {
		if _, err := ReadUpload(zipOf(t, files), "pet.zip"); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	if _, err := ReadUpload(append([]byte("PK\x03\x04"), make([]byte, 32)...), "broken.zip"); err == nil {
		t.Fatal("broken zip accepted")
	}
}

func TestAccessPolicy(t *testing.T) {
	if _, err := NormalizeAccess(AccessVIP, 0, 0, nil); err == nil {
		t.Fatal("vip without groups accepted")
	}
	if _, err := NormalizeAccess(AccessPaid, 0, 0, nil); err == nil {
		t.Fatal("paid without price accepted")
	}
	if _, err := NormalizeAccess(AccessPaid, MaxPriceMicrocredits+1, 0, nil); err == nil {
		t.Fatal("price above limit accepted")
	}
	if _, err := NormalizeAccess("gift", 0, 0, nil); err == nil {
		t.Fatal("unknown access accepted")
	}
	if _, err := NormalizeAccess(AccessFree, 0, 0, []string{"Bad Code"}); err == nil {
		t.Fatal("invalid group code accepted")
	}
	free, err := NormalizeAccess(AccessFree, 99, 99, []string{"vip"})
	if err != nil || free.PriceMicrocredits != 0 || len(free.GroupCodes) != 0 {
		t.Fatalf("free access keeps price or groups: %+v %v", free, err)
	}
	paid, err := NormalizeAccess(AccessPaid, 5_000_000, 0, []string{" SVIP ", "vip", "vip"})
	if err != nil || strings.Join(paid.GroupCodes, ",") != "svip,vip" {
		t.Fatalf("paid groups = %+v %v", paid, err)
	}
	vip, _ := NormalizeAccess(AccessVIP, 0, 0, []string{"vip"})
	if _, err := NormalizeAccess(AccessSpend, 0, 0, nil); err == nil {
		t.Fatal("spend without threshold accepted")
	}
	spend, err := NormalizeAccess(AccessSpend, 7, 100_000_000, []string{"svip"})
	if err != nil || spend.PriceMicrocredits != 0 || spend.UnlockMicrocredits != 100_000_000 {
		t.Fatalf("spend access = %+v %v", spend, err)
	}
	cases := []struct {
		name   string
		access Access
		group  string
		owned  bool
		spent  int64
		want   Entitlement
	}{
		{"free", free, "default", false, 0, Entitlement{Usable: true}},
		{"vip member", vip, "vip", false, 0, Entitlement{Usable: true}},
		{"vip outsider", vip, "default", false, 0, Entitlement{}},
		{"vip outsider who bought before", vip, "default", true, 0, Entitlement{Usable: true}},
		{"paid member", paid, "svip", false, 0, Entitlement{Usable: true, MemberFree: true}},
		{"paid outsider", paid, "default", false, 0, Entitlement{Purchasable: true}},
		{"paid owner", paid, "default", true, 0, Entitlement{Usable: true}},
		{"spend below threshold", spend, "default", false, 99_999_999, Entitlement{}},
		{"spend reached", spend, "default", false, 100_000_000, Entitlement{Usable: true, Claimable: true}},
		{"spend claimed", spend, "default", true, 0, Entitlement{Usable: true}},
		{"spend member", spend, "svip", false, 0, Entitlement{Usable: true, MemberFree: true}},
	}
	for _, tc := range cases {
		if got := Entitle(tc.access, tc.group, tc.owned, tc.spent); got != tc.want {
			t.Errorf("%s: got %+v want %+v", tc.name, got, tc.want)
		}
	}
	if rows, err := NormalizeStateRows(map[string]string{"running": "review", "completed": "waving"}); err != nil || rows["running"] != "review" {
		t.Fatalf("state rows = %v %v", rows, err)
	}
	for _, invalid := range []map[string]string{{"sleeping": "idle"}, {"running": "dance"}} {
		if _, err := NormalizeStateRows(invalid); err == nil {
			t.Fatalf("invalid state rows accepted: %v", invalid)
		}
	}
}
