package agentpet

import (
	"bytes"
	"image"
	"image/draw"
	"image/png"

	"golang.org/x/image/webp"
	"yingce/backend/internal/kernel"
)

// PreviewFrame 解码图集，取指定动作行里第一格有画面的帧（通常是待机首帧），编码成 PNG。
// 商店、换形象菜单和后台列表用它当静态缩略图，悬停或选中时才加载整张图集。
// row 超出图集行数时按第 0 行处理；这一行全是空格时也退回第 0 行。
func PreviewFrame(data []byte, row int) ([]byte, error) {
	sheet, err := InspectSheet(data)
	if err != nil {
		return nil, err
	}
	var img image.Image
	if sheet.MimeType == "image/png" {
		img, err = png.Decode(bytes.NewReader(data))
	} else {
		img, err = webp.Decode(bytes.NewReader(data))
	}
	if err != nil {
		return nil, kernel.BadAuthRequest("形象图集无法解码")
	}
	if row < 0 || row >= sheet.Height/CellHeight {
		row = 0
	}
	frame := image.NewNRGBA(image.Rect(0, 0, CellWidth, CellHeight))
	draw.Draw(frame, frame.Bounds(), img, firstFilledCell(img, row).Min, draw.Src)
	var out bytes.Buffer
	if err := (&png.Encoder{CompressionLevel: png.BestCompression}).Encode(&out, frame); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

// firstFilledCell 返回该行第一个有不透明像素的格子；整行为空时退回第 0 行，仍为空就用左上角第一格。
func firstFilledCell(img image.Image, row int) image.Rectangle {
	origin := img.Bounds().Min
	for _, candidate := range []int{row, 0} {
		for column := 0; column < Columns; column++ {
			cell := image.Rect(column*CellWidth, candidate*CellHeight, (column+1)*CellWidth, (candidate+1)*CellHeight).Add(origin)
			if cellHasPixels(img, cell) {
				return cell
			}
		}
	}
	return image.Rect(0, 0, CellWidth, CellHeight).Add(origin)
}

// cellHasPixels 每隔 4 像素采样一次透明度，与前端帧检测同一精度。
func cellHasPixels(img image.Image, cell image.Rectangle) bool {
	for y := cell.Min.Y; y < cell.Max.Y; y += 4 {
		for x := cell.Min.X; x < cell.Max.X; x += 4 {
			if _, _, _, alpha := img.At(x, y).RGBA(); alpha > 16*0x101 {
				return true
			}
		}
	}
	return false
}
