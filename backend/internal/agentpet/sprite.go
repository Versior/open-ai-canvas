// Package agentpet 实现智能体形象（Codex 宠物图集）的格式校验、内置形象库和访问策略。
// 图集格式：8 列，单格 192×208；v1 共 9 行动作，v2 另加 2 行 16 个视线方向。
package agentpet

import (
	"bytes"
	"encoding/binary"
	"fmt"

	"yingce/backend/internal/kernel"
)

const (
	CellWidth     = 192
	CellHeight    = 208
	Columns       = 8
	SheetWidth    = CellWidth * Columns
	v1Rows        = 9
	v2Rows        = 11
	MaxSheetBytes = 16 << 20
)

// Sheet 是只读文件头得到的图集信息，不解码像素。
type Sheet struct {
	MimeType string
	Width    int
	Height   int
	Version  int
}

var pngSignature = []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n'}

// InspectSheet 校验图集是带透明通道的 WebP 或 PNG，且尺寸符合 v1 / v2 布局。
func InspectSheet(data []byte) (Sheet, error) {
	if len(data) > MaxSheetBytes {
		return Sheet{}, kernel.BadAuthRequest("形象图集不能超过 16 MiB")
	}
	sheet, alpha, err := sheetHeader(data)
	if err != nil {
		return Sheet{}, err
	}
	if !alpha {
		return Sheet{}, kernel.BadAuthRequest("形象图集需要透明背景")
	}
	switch {
	case sheet.Width == SheetWidth && sheet.Height == CellHeight*v1Rows:
		sheet.Version = 1
	case sheet.Width == SheetWidth && sheet.Height == CellHeight*v2Rows:
		sheet.Version = 2
	default:
		return Sheet{}, kernel.BadAuthRequest(fmt.Sprintf("形象图集尺寸须为 1536×1872（v1）或 1536×2288（v2），当前为 %d×%d", sheet.Width, sheet.Height))
	}
	return sheet, nil
}

func sheetHeader(data []byte) (Sheet, bool, error) {
	if len(data) >= 26 && bytes.Equal(data[:8], pngSignature) && string(data[12:16]) == "IHDR" {
		sheet := Sheet{MimeType: "image/png", Width: int(binary.BigEndian.Uint32(data[16:20])), Height: int(binary.BigEndian.Uint32(data[20:24]))}
		colorType := data[25]
		return sheet, colorType == 4 || colorType == 6 || pngHasTransparencyChunk(data), nil
	}
	if len(data) >= 30 && string(data[0:4]) == "RIFF" && string(data[8:12]) == "WEBP" {
		payload := data[20:]
		switch string(data[12:16]) {
		case "VP8X":
			if payload[0]&0x02 != 0 {
				return Sheet{}, false, kernel.BadAuthRequest("形象图集不能是 WebP 动图")
			}
			width := int(payload[4]) | int(payload[5])<<8 | int(payload[6])<<16
			height := int(payload[7]) | int(payload[8])<<8 | int(payload[9])<<16
			return Sheet{MimeType: "image/webp", Width: width + 1, Height: height + 1}, payload[0]&0x10 != 0, nil
		case "VP8L":
			if payload[0] != 0x2f {
				break
			}
			bits := binary.LittleEndian.Uint32(payload[1:5])
			return Sheet{MimeType: "image/webp", Width: int(bits&0x3fff) + 1, Height: int(bits>>14&0x3fff) + 1}, bits>>28&1 == 1, nil
		case "VP8 ":
			// 简单有损格式没有 alpha 通道。
			if payload[3] == 0x9d && payload[4] == 0x01 && payload[5] == 0x2a {
				return Sheet{MimeType: "image/webp", Width: int(binary.LittleEndian.Uint16(payload[6:8]) & 0x3fff), Height: int(binary.LittleEndian.Uint16(payload[8:10]) & 0x3fff)}, false, nil
			}
		}
	}
	return Sheet{}, false, kernel.BadAuthRequest("形象图集仅支持 WebP 或 PNG")
}

// pngHasTransparencyChunk 检查调色板 / RGB PNG 在图像数据之前是否声明了 tRNS 透明色。
func pngHasTransparencyChunk(data []byte) bool {
	for offset := 8; offset+8 <= len(data); {
		length := int(binary.BigEndian.Uint32(data[offset : offset+4]))
		chunk := string(data[offset+4 : offset+8])
		if chunk == "tRNS" {
			return true
		}
		if chunk == "IDAT" || length < 0 || length > len(data) {
			return false
		}
		offset += 12 + length
	}
	return false
}
