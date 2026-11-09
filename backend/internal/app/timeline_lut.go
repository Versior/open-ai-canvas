package app

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strings"
)

//go:embed timeline_lut_presets.json
var timelineLutPresetsJSON []byte

type renderLutPreset struct {
	ID         string     `json:"id"`
	Contrast   float64    `json:"contrast"`
	Saturation float64    `json:"saturation"`
	Lift       [3]float64 `json:"lift"`
	Gain       [3]float64 `json:"gain"`
	Gamma      [3]float64 `json:"gamma"`
}

type renderCubeLut struct {
	Size      int       `json:"size"`
	Values    []float64 `json:"values"`
	DomainMin []float64 `json:"domainMin"`
	DomainMax []float64 `json:"domainMax"`
}

type renderLut struct {
	Name     string         `json:"name"`
	Strength float64        `json:"strength"`
	Preset   string         `json:"preset,omitempty"`
	Cube     *renderCubeLut `json:"cube,omitempty"`
}

func renderLutPresets() []renderLutPreset {
	var presets []renderLutPreset
	if err := json.Unmarshal(timelineLutPresetsJSON, &presets); err != nil {
		panic(err)
	}
	return presets
}

func validateRenderLut(lut *renderLut) error {
	if lut == nil {
		return nil
	}
	if len([]rune(lut.Name)) > 120 || math.IsNaN(lut.Strength) || math.IsInf(lut.Strength, 0) || lut.Strength < 0 || lut.Strength > 1 {
		return fmt.Errorf("LUT 名称或强度无效")
	}
	if lut.Preset != "" && lut.Cube == nil {
		for _, preset := range renderLutPresets() {
			if preset.ID == lut.Preset {
				return nil
			}
		}
		return fmt.Errorf("未知的 LUT 预设")
	}
	cube := lut.Cube
	if lut.Preset != "" || cube == nil || cube.Size < 2 || cube.Size > 33 || len(cube.Values) != cube.Size*cube.Size*cube.Size*3 {
		return fmt.Errorf("LUT 必须是 2–33 阶的 3D 色彩表")
	}
	for _, v := range cube.Values {
		if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 || v > 1 {
			return fmt.Errorf("仅支持输出范围 0–1 的 SDR LUT")
		}
	}
	if len(cube.DomainMin) != 3 || len(cube.DomainMax) != 3 {
		return fmt.Errorf("LUT 输入范围无效")
	}
	for i, min := range cube.DomainMin {
		max := cube.DomainMax[i]
		if math.IsNaN(min) || math.IsNaN(max) || math.IsInf(min, 0) || math.IsInf(max, 0) || min >= max || math.IsInf(max-min, 0) {
			return fmt.Errorf("LUT 输入范围无效")
		}
	}
	return nil
}

func renderLutCube(lut *renderLut) *renderCubeLut {
	if lut.Cube != nil {
		return lut.Cube
	}
	var preset renderLutPreset
	for _, p := range renderLutPresets() {
		if p.ID == lut.Preset {
			preset = p
			break
		}
	}
	cube := &renderCubeLut{Size: 17, DomainMin: []float64{0, 0, 0}, DomainMax: []float64{1, 1, 1}}
	clamp := func(v float64) float64 { return math.Max(0, math.Min(1, v)) }
	for b := 0; b < 17; b++ {
		for g := 0; g < 17; g++ {
			for r := 0; r < 17; r++ {
				rgb := [3]float64{(float64(r)/16-0.5)*preset.Contrast + 0.5, (float64(g)/16-0.5)*preset.Contrast + 0.5, (float64(b)/16-0.5)*preset.Contrast + 0.5}
				luma := rgb[0]*0.2126 + rgb[1]*0.7152 + rgb[2]*0.0722
				for i, v := range rgb {
					cube.Values = append(cube.Values, clamp(math.Pow(clamp(luma+(v-luma)*preset.Saturation+preset.Lift[i]), preset.Gamma[i])*preset.Gain[i]))
				}
			}
		}
	}
	return cube
}

// 文件名固定且只写经过校验的数字；客户端不能指定服务器路径或 FFmpeg 表达式。
func writeRenderLut(workDir string, lut *renderLut) error {
	if err := validateRenderLut(lut); err != nil {
		return err
	}
	if lut == nil || lut.Strength == 0 {
		return nil
	}
	cube := renderLutCube(lut)
	var text strings.Builder
	fmt.Fprintf(&text, "LUT_3D_SIZE %d\nDOMAIN_MIN %.9g %.9g %.9g\nDOMAIN_MAX %.9g %.9g %.9g\n", cube.Size, cube.DomainMin[0], cube.DomainMin[1], cube.DomainMin[2], cube.DomainMax[0], cube.DomainMax[1], cube.DomainMax[2])
	for i := 0; i < len(cube.Values); i += 3 {
		fmt.Fprintf(&text, "%.9f %.9f %.9f\n", cube.Values[i], cube.Values[i+1], cube.Values[i+2])
	}
	return os.WriteFile(filepath.Join(workDir, "timeline-lut.cube"), []byte(text.String()), 0o600)
}
