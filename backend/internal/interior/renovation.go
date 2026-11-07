package interior

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// RenovationSpec 保持毫米尺寸、材料选择和报价输入；不持有模型凭据。
type RenovationSpec struct {
	Scope         string  `json:"scope"`
	Stage         string  `json:"stage"`
	WidthMM       float64 `json:"widthMm"`
	HeightMM      float64 `json:"heightMm"`
	Material      string  `json:"material"`
	Finish        string  `json:"finish"`
	Pattern       string  `json:"pattern"`
	SlabWidthMM   float64 `json:"slabWidthMm"`
	SlabHeightMM  float64 `json:"slabHeightMm"`
	SeamMM        float64 `json:"seamMm"`
	WastePercent  float64 `json:"wastePercent"`
	MaterialPrice float64 `json:"materialPrice"`
	LaborPrice    float64 `json:"laborPrice"`
	Budget        float64 `json:"budget"`
	Preserve      string  `json:"preserve"`
	Lighting      string  `json:"lighting"`
	Texture       *struct {
		ResourceID string `json:"resourceId"`
	} `json:"texture,omitempty"`
}

var renovationLabels = []map[string]string{
	{"room": "空间整体", "wall": "背景墙", "floor": "地面铺装", "countertop": "厨房或卫浴台面"},
	{"refresh": "软装焕新", "renovation": "旧房改造", "new": "毛坯装修"},
	{"marble": "天然大理石", "sintered": "岩板", "quartz": "石英石", "tile": "瓷砖", "wood": "木材"},
	{"honed": "哑光磨面", "polished": "抛光", "textured": "纹理面"},
	{"straight": "顺纹直铺", "bookmatch": "左右对纹", "fourway": "四向对纹", "staggered": "错缝铺装"},
	{"daylight": "自然日光", "warm": "暖光氛围", "neutral": "中性工作光"},
}

func (s RenovationSpec) Validate() error {
	for index, value := range []string{s.Scope, s.Stage, s.Material, s.Finish, s.Pattern, s.Lighting} {
		if renovationLabels[index][value] == "" {
			return fmt.Errorf("装修方案选项无效")
		}
	}
	for _, number := range []float64{s.WidthMM, s.HeightMM, s.SlabWidthMM, s.SlabHeightMM} {
		if !finiteRange(number, 100, 30000) {
			return fmt.Errorf("装修尺寸须在 100–30000 mm 以内")
		}
	}
	if !finiteRange(s.SeamMM, 0, 20) || !finiteRange(s.WastePercent, 0, 50) {
		return fmt.Errorf("装修拼缝或损耗无效")
	}
	for _, number := range []float64{s.MaterialPrice, s.LaborPrice, s.Budget} {
		if !finiteRange(number, 0, 10000000) {
			return fmt.Errorf("装修报价或预算无效")
		}
	}
	if utf8.RuneCountInString(s.Preserve) > 300 {
		return fmt.Errorf("保留要求不能超过 300 字")
	}
	if s.Texture != nil && (s.Texture.ResourceID == "" || len(s.Texture.ResourceID) > 128 || strings.TrimSpace(s.Texture.ResourceID) != s.Texture.ResourceID) {
		return fmt.Errorf("石材照片标识无效")
	}
	return nil
}

func finiteRange(number, min, max float64) bool {
	return !math.IsNaN(number) && !math.IsInf(number, 0) && number >= min && number <= max
}

func (s RenovationSpec) RenderPrompt() string {
	return fmt.Sprintf("\n【装修与材料方案】\n%s，范围%s；设计区域 %.1f×%.1f mm，%s、%s、%s；板幅 %.1f×%.1f mm，拼缝 %.1f mm。%s。保留要求：%s。按实际板幅表现材料比例、分缝和收口。左右或四向对纹仅表示设计方向，不宣称工厂能按单张照片加工。空间原图确定门窗、承重结构与透视，材料照片只确定纹理与色泽，不用于替换空间。不要画报价文字、施工图或凭空拆改承重结构。", renovationLabels[1][s.Stage], renovationLabels[0][s.Scope], s.WidthMM, s.HeightMM, renovationLabels[2][s.Material], renovationLabels[3][s.Finish], renovationLabels[4][s.Pattern], s.SlabWidthMM, s.SlabHeightMM, s.SeamMM, renovationLabels[5][s.Lighting], s.Preserve)
}
