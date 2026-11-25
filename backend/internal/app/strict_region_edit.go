package app

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"io"
	"os"
	"strings"

	"yingce/backend/internal/model"
)

const strictRegionEdit = "region-strict"
const strictRegionPixels = 8 << 20
const strictRegionBytes = 40 << 20

var strictRegionAdmission = make(chan struct{}, 2)

func wantsStrictRegion(input map[string]any) bool {
	metadata, _ := input["metadata"].(map[string]any)
	return metadataString(metadata, "edit") == strictRegionEdit
}

// A strict edit uses immutable, owned resources in the same (already oriented)
// pixel grid as the selection. Never hydrate an external URL or a preview.
type strictRegionInputs struct{ original, mask *image.NRGBA }

func strictPNG(r io.Reader) (*image.NRGBA, error) {
	data, err := io.ReadAll(io.LimitReader(r, strictRegionBytes+1))
	if err != nil {
		return nil, err
	}
	c, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil || len(data) > strictRegionBytes || int64(c.Width)*int64(c.Height) > strictRegionPixels || data[24] > 8 {
		return nil, errors.New("严格局改只接受最多 8388608 像素、40 MiB 的 8 位以内 PNG")
	}
	// Refuse animation or EXIF orientation rather than assuming the browser and
	// provider displayed the encoded pixel order. The UI can normalize to PNG.
	for p := 8; p+12 <= len(data); {
		n := int64(binary.BigEndian.Uint32(data[p:]))
		if n > int64(len(data)-p-12) {
			return nil, errors.New("PNG 数据不完整")
		}
		switch string(data[p+4 : p+8]) {
		case "eXIf", "acTL":
			return nil, errors.New("请先将有方向标记或多帧的图片导出为静态 PNG")
		}
		p += int(n) + 12
	}
	im, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if nrgba, ok := im.(*image.NRGBA); ok {
		return nrgba, nil
	}
	out := image.NewNRGBA(im.Bounds())
	if pal, ok := im.(*image.Paletted); ok {
		// Going through premultiplied RGBA loses invisible RGB in indexed PNGs.
		for y := 0; y < c.Height; y++ {
			for x := 0; x < c.Width; x++ {
				out.SetNRGBA(x, y, color.NRGBAModel.Convert(pal.At(x, y)).(color.NRGBA))
			}
		}
	} else {
		draw.Draw(out, out.Bounds(), im, im.Bounds().Min, draw.Src)
	}
	return out, nil
}

func (s *Service) strictRegionResource(userID string, media providerMedia) (*image.NRGBA, error) {
	id, ok := strings.CutPrefix(media.StorageKey, "resource:")
	if !ok || id == "" || media.URL != "" || media.DataURL != "" {
		return nil, BadAuthRequest("严格局改需要已上传的原图和蒙版")
	}
	r, err := s.repo.ResourceForUser(userID, id)
	if err != nil || r.Status != model.ResourceStatusReady || r.Kind != "image" || r.Size > strictRegionBytes {
		return nil, BadAuthRequest("局改素材不存在、不是就绪图片或超出限制")
	}
	f, err := s.openResourceRange(userID, r, "")
	if err != nil {
		return nil, err
	}
	defer f.Body.Close()
	return strictPNG(f.Body)
}

func (s *Service) loadStrictRegionInputs(userID string, input canvasGenerationInput) (*strictRegionInputs, error) {
	if input.Mode != "image" || input.Mask == nil || len(input.ReferenceImages) == 0 {
		return nil, BadAuthRequest("严格局改缺少原图或蒙版")
	}
	source, err := s.strictRegionResource(userID, input.ReferenceImages[0])
	if err != nil {
		return nil, err
	}
	mask, err := s.strictRegionResource(userID, *input.Mask)
	if err != nil {
		return nil, err
	}
	if source.Rect != mask.Rect {
		return nil, BadAuthRequest("原图与蒙版的像素尺寸不一致")
	}
	editable := 0
	for i := 3; i < len(mask.Pix); i += 4 {
		switch mask.Pix[i] {
		case 0:
			editable++
		case 255:
		default:
			return nil, BadAuthRequest("严格局改需要明确的二值蒙版")
		}
	}
	if editable == 0 || editable == len(mask.Pix)/4 {
		return nil, BadAuthRequest("选区不能为空或覆盖整张图")
	}
	return &strictRegionInputs{source, mask}, nil
}

func (s *Service) storedMediaTaskInput(task *model.Task) (canvasGenerationInput, error) {
	var input canvasGenerationInput
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return input, err
	}
	err = json.Unmarshal([]byte(raw), &input)
	return input, err
}

// Public upload identities and ordinary task keys are hex digests. A reserved
// prefix means a retry can only reuse a resource written after composition.
func strictRegionUploadKey(taskID string) *string {
	digest := *mediaUploadKey(taskID, 0)
	key := "region:" + digest[:57]
	return &key
}

func (s *Service) composeStrictRegionFile(path string, inputs *strictRegionInputs) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	candidate, err := strictPNG(f)
	f.Close()
	if err != nil {
		return "", err
	}
	if candidate.Rect != inputs.original.Rect {
		return "", errors.New("候选图未按原图尺寸返回，未保存整图重绘")
	}
	for i := 0; i < len(candidate.Pix); i += 4 {
		if inputs.mask.Pix[i+3] != 0 {
			copy(candidate.Pix[i:i+4], inputs.original.Pix[i:i+4])
		}
	}
	var out bytes.Buffer
	if err := png.Encode(&out, candidate); err != nil {
		return "", err
	}
	decoded, err := strictPNG(bytes.NewReader(out.Bytes()))
	if err != nil {
		return "", err
	}
	if !bytes.Equal(decoded.Pix, candidate.Pix) {
		return "", errors.New("局改成品 PNG 像素校验失败")
	}
	return s.stageInlineMedia(out.Bytes())
}
