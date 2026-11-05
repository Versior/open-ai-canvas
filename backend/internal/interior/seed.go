package interior

import (
	_ "embed"
	"encoding/json"
	"fmt"
)

//go:embed seed.json
var seedJSON []byte

// Seed 是随程序发布的默认模式、风格和空间。启动时只补齐缺失项，不覆盖管理员改过的内容。
type Seed struct {
	Modes   []ModeInput   `json:"modes"`
	Presets []PresetInput `json:"presets"`
}

func BuiltinSeed() (Seed, error) {
	var seed Seed
	if err := json.Unmarshal(seedJSON, &seed); err != nil {
		return seed, fmt.Errorf("室内设计内置数据格式无效：%w", err)
	}
	for index, mode := range seed.Modes {
		normalized, err := NormalizeModeInput(mode)
		if err != nil {
			return seed, fmt.Errorf("内置模式 %s 无效：%w", mode.Key, err)
		}
		normalized.SortOrder = (index + 1) * 10
		seed.Modes[index] = normalized
	}
	for index, preset := range seed.Presets {
		normalized, err := NormalizePresetInput(preset)
		if err != nil {
			return seed, fmt.Errorf("内置预设 %s/%s 无效：%w", preset.Type, preset.Key, err)
		}
		normalized.SortOrder = (index + 1) * 10
		seed.Presets[index] = normalized
	}
	return seed, nil
}
