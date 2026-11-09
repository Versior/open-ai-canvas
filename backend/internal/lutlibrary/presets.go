package lutlibrary

import (
	_ "embed"
	"encoding/json"
)

//go:embed presets.json
var presetsJSON []byte

// Preset 是前端预览、后端编码和初始滤镜库共用的预设。
type Preset struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Hint       string     `json:"hint"`
	Contrast   float64    `json:"contrast"`
	Saturation float64    `json:"saturation"`
	Lift       [3]float64 `json:"lift"`
	Gain       [3]float64 `json:"gain"`
	Gamma      [3]float64 `json:"gamma"`
}

func Presets() []Preset {
	var result []Preset
	if err := json.Unmarshal(presetsJSON, &result); err != nil {
		panic(err)
	}
	return result
}
