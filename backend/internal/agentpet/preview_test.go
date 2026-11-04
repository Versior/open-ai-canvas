package agentpet

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"
)

func TestPreviewFrameCropsTheFirstFilledIdleCell(t *testing.T) {
	// 内置图集是 WebP：解码后取待机第一帧，输出单格大小的 PNG，体积远小于整张图集。
	sheet, _, err := BuiltinSheet("pingo")
	if err != nil {
		t.Fatal(err)
	}
	data, err := PreviewFrame(sheet, 0)
	if err != nil {
		t.Fatal(err)
	}
	frame, err := png.Decode(bytes.NewReader(data))
	if err != nil || frame.Bounds().Dx() != CellWidth || frame.Bounds().Dy() != CellHeight {
		t.Fatalf("preview = %v, %v", frame.Bounds(), err)
	}
	if !cellHasPixels(frame, frame.Bounds()) {
		t.Fatal("preview of the idle frame is empty")
	}
	if len(data) >= len(sheet)/4 {
		t.Fatalf("preview is %d bytes, sheet %d", len(data), len(sheet))
	}

	// PNG 图集：指定行的第一格为空时取同一行下一格；行号越界按第 0 行。
	img := image.NewNRGBA(image.Rect(0, 0, SheetWidth, CellHeight*v1Rows))
	paint := func(row, column int, value color.NRGBA) {
		for y := row*CellHeight + 40; y < row*CellHeight+80; y++ {
			for x := column*CellWidth + 40; x < column*CellWidth+80; x++ {
				img.SetNRGBA(x, y, value)
			}
		}
	}
	paint(0, 0, color.NRGBA{R: 255, A: 255})
	paint(3, 2, color.NRGBA{B: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	for row, want := range map[int]color.NRGBA{3: {B: 255, A: 255}, 0: {R: 255, A: 255}, 99: {R: 255, A: 255}, 5: {R: 255, A: 255}} {
		data, err := PreviewFrame(encoded.Bytes(), row)
		if err != nil {
			t.Fatal(err)
		}
		frame, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		if got := color.NRGBAModel.Convert(frame.At(60, 60)).(color.NRGBA); got != want {
			t.Fatalf("row %d preview pixel = %v, want %v", row, got, want)
		}
	}

	if _, err := PreviewFrame([]byte("not an image at all, padding padding padding"), 0); err == nil {
		t.Fatal("invalid sheet accepted")
	}
}
