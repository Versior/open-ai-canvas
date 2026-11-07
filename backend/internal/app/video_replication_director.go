package app

import (
	"encoding/json"
	"fmt"
	"slices"
	"unicode/utf8"
)

// 两种复刻入口共用导演合同；旧的元素替换作品没有导演字段。
func validateProductVideoDirector(raw json.RawMessage) error {
	var head struct {
		Campaign *videoReplicaCampaign `json:"campaign"`
		Shots    []struct {
			Director *videoReplicaDirection `json:"director"`
		} `json:"shots"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return fmt.Errorf("导演方案格式无效")
	}
	if head.Campaign != nil {
		if err := head.Campaign.validate(); err != nil {
			return err
		}
	}
	for _, shot := range head.Shots {
		if shot.Director != nil {
			if err := shot.Director.validate(); err != nil {
				return err
			}
		}
	}
	return nil
}

type videoReplicaCampaign struct {
	Platform   string `json:"platform"`
	Goal       string `json:"goal"`
	Style      string `json:"style"`
	Continuity string `json:"continuity"`
}

type videoReplicaDirection struct {
	Beat       string `json:"beat"`
	Framing    string `json:"framing"`
	Camera     string `json:"camera"`
	Action     string `json:"action"`
	Evidence   string `json:"evidence"`
	Sound      string `json:"sound"`
	Transition string `json:"transition"`
}

func (c videoReplicaCampaign) validate() error {
	if !slices.Contains([]string{"douyin", "xiaohongshu", "amazon"}, c.Platform) || !slices.Contains([]string{"conversion", "education", "brand"}, c.Goal) || !slices.Contains([]string{"demo", "story", "studio"}, c.Style) {
		return fmt.Errorf("视频平台或导演策略无效")
	}
	if utf8.RuneCountInString(c.Continuity) > 300 {
		return fmt.Errorf("连续性要求不能超过 300 字")
	}
	return nil
}

func (d videoReplicaDirection) validate() error {
	if !slices.Contains([]string{"hook", "problem", "demo", "proof", "action"}, d.Beat) || !slices.Contains([]string{"wide", "medium", "close", "macro"}, d.Framing) || !slices.Contains([]string{"locked", "push", "pan", "handheld"}, d.Camera) || !slices.Contains([]string{"cut", "match", "dissolve"}, d.Transition) {
		return fmt.Errorf("导演镜头选项无效")
	}
	if utf8.RuneCountInString(d.Action) > 300 || utf8.RuneCountInString(d.Evidence) > 200 || utf8.RuneCountInString(d.Sound) > 120 {
		return fmt.Errorf("导演镜头描述超出长度限制")
	}
	return nil
}
