package interior

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"
)

// 辅助图层保存在项目文档中；只接受数据，不接受可执行代码或媒体。
func validateDesignDocument(raw json.RawMessage) error {
	if len(raw) == 0 || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	var plan struct {
		Version int `json:"version"`
		Marks   []struct {
			ID     string      `json:"id"`
			Floor  int         `json:"floor"`
			Layer  string      `json:"layer"`
			Label  string      `json:"label"`
			Points [][]float64 `json:"points"`
			Height float64     `json:"height"`
			Depth  float64     `json:"depth"`
			Closed bool        `json:"closed"`
		} `json:"marks"`
		Prices map[string]struct {
			Material *float64 `json:"material"`
			Labor    *float64 `json:"labor"`
			Waste    float64  `json:"waste"`
		} `json:"prices"`
		Budget *float64 `json:"budget"`
	}
	if err := json.Unmarshal(raw, &plan); err != nil || plan.Version != 1 || plan.Marks == nil || plan.Prices == nil || len(plan.Marks) > 300 || len(plan.Prices) > 1000 {
		return fmt.Errorf("设计辅助图层格式无效")
	}
	validMoney := func(value *float64) bool {
		return value == nil || (!math.IsNaN(*value) && !math.IsInf(*value, 0) && *value >= 0 && *value <= 100000000)
	}
	if !validMoney(plan.Budget) {
		return fmt.Errorf("设计预算须为非负金额")
	}
	for _, price := range plan.Prices {
		if !validMoney(price.Material) || !validMoney(price.Labor) || math.IsNaN(price.Waste) || price.Waste < 0 || price.Waste > 50 {
			return fmt.Errorf("设计单价或损耗无效")
		}
	}
	layers := map[string]bool{"layout": true, "flooring": true, "ceiling": true, "power": true, "lighting": true, "network": true, "water": true, "drain": true, "custom": true, "demolition": true}
	ids := map[string]bool{}
	for _, mark := range plan.Marks {
		if strings.TrimSpace(mark.ID) == "" || len(mark.ID) > 80 || ids[mark.ID] || mark.Floor < 0 || mark.Floor >= 5 || !layers[mark.Layer] || strings.TrimSpace(mark.Label) == "" || utf8.RuneCountInString(mark.Label) > 40 || len(mark.Points) < 1 || len(mark.Points) > 80 || mark.Height < 0 || mark.Depth < 0.01 || mark.Height+mark.Depth > 8 {
			return fmt.Errorf("设计点位或轮廓格式无效")
		}
		ids[mark.ID] = true
		for _, point := range mark.Points {
			if len(point) != 2 || math.Abs(point[0]) > 60 || math.Abs(point[1]) > 60 {
				return fmt.Errorf("设计坐标超出范围")
			}
		}
		if mark.Closed && (len(mark.Points) < 3 || (mark.Layer != "ceiling" && mark.Layer != "custom" && mark.Layer != "flooring")) {
			return fmt.Errorf("封闭轮廓图层无效")
		}
	}
	return nil
}
