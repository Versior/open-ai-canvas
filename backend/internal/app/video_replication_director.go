package app

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

// 两种复刻入口共用导演合同；旧的元素替换作品没有导演字段。
func validateProductVideoDirector(raw json.RawMessage) error {
	var head struct {
		Campaign      *videoReplicaCampaign `json:"campaign"`
		DirectorPlans []videoDirectorPlan   `json:"directorPlans"`
		Shots         []struct {
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
	if len(head.DirectorPlans) > 3 {
		return fmt.Errorf("最多保存三份导演策划")
	}
	for _, plan := range head.DirectorPlans {
		if err := plan.validate(); err != nil {
			return err
		}
	}
	return nil
}

type videoReplicaCampaign struct {
	Platform   string `json:"platform"`
	Goal       string `json:"goal"`
	Style      string `json:"style"`
	Continuity string `json:"continuity"`
	Audience   string `json:"audience,omitempty"`
	Focus      string `json:"focus,omitempty"`
	Narrative  string `json:"narrative,omitempty"`
}

type videoReplicaDirection struct {
	Beat       string `json:"beat"`
	Framing    string `json:"framing"`
	Camera     string `json:"camera"`
	Action     string `json:"action"`
	Evidence   string `json:"evidence"`
	Sound      string `json:"sound"`
	Transition string `json:"transition"`
	Purpose    string `json:"purpose,omitempty"`
	Start      string `json:"start,omitempty"`
	End        string `json:"end,omitempty"`
	Lighting   string `json:"lighting,omitempty"`
}

var videoDirectorPlatforms = []string{"douyin", "xiaohongshu", "kuaishou", "wechat", "tiktok", "shorts", "reels", "amazon"}
var videoDirectorGoals = []string{"conversion", "education", "brand", "consideration", "engagement", "launch"}
var videoDirectorStyles = []string{"auto", "demo", "story", "studio", "ugc", "unboxing", "tutorial", "comparison", "macro", "lifestyle", "interview", "stopmotion", "documentary"}
var videoDirectorNarratives = []string{"auto", "feature", "problem", "howto", "objection", "experience", "reveal", "story"}

func (c videoReplicaCampaign) validate() error {
	if !slices.Contains(videoDirectorPlatforms, c.Platform) || !slices.Contains(videoDirectorGoals, c.Goal) || !slices.Contains(videoDirectorStyles, c.Style) || c.Narrative != "" && !slices.Contains(videoDirectorNarratives, c.Narrative) {
		return fmt.Errorf("视频平台或导演策略无效")
	}
	if utf8.RuneCountInString(c.Continuity) > 300 {
		return fmt.Errorf("连续性要求不能超过 300 字")
	}
	if utf8.RuneCountInString(c.Audience) > 200 || utf8.RuneCountInString(c.Focus) > 200 {
		return fmt.Errorf("观众或策划重点不能超过200字")
	}
	return nil
}

func (d videoReplicaDirection) validate() error {
	if !slices.Contains([]string{"hook", "problem", "demo", "proof", "action", "context", "objection", "reveal"}, d.Beat) || !slices.Contains([]string{"wide", "medium", "close", "macro"}, d.Framing) || !slices.Contains([]string{"locked", "push", "pan", "handheld", "pull", "track", "tilt", "orbit", "topdown"}, d.Camera) || !slices.Contains([]string{"cut", "match", "dissolve"}, d.Transition) {
		return fmt.Errorf("导演镜头选项无效")
	}
	if utf8.RuneCountInString(d.Action) > 300 || utf8.RuneCountInString(d.Evidence) > 200 || utf8.RuneCountInString(d.Sound) > 120 {
		return fmt.Errorf("导演镜头描述超出长度限制")
	}
	for _, value := range []string{d.Purpose, d.Start, d.End, d.Lighting} {
		if utf8.RuneCountInString(value) > 200 {
			return fmt.Errorf("导演动作状态或布光描述不能超过200字")
		}
	}
	return nil
}

type videoReplicaStrategy struct {
	Audience    string   `json:"audience"`
	Insight     string   `json:"insight"`
	Proposition string   `json:"proposition"`
	Hook        string   `json:"hook"`
	Method      string   `json:"method"`
	Narrative   string   `json:"narrative"`
	Rationale   string   `json:"rationale"`
	Visual      string   `json:"visual"`
	Sound       string   `json:"sound"`
	CTA         string   `json:"cta"`
	Missing     []string `json:"missing"`
}

func (s videoReplicaStrategy) validate() error {
	if s.Method == "auto" || !slices.Contains(videoDirectorStyles, s.Method) || s.Narrative == "auto" || !slices.Contains(videoDirectorNarratives, s.Narrative) {
		return fmt.Errorf("策划必须选择明确拍法与叙事")
	}
	for _, value := range []string{s.Audience, s.Insight, s.Proposition, s.Hook, s.Rationale, s.Visual, s.Sound, s.CTA} {
		if strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > 400 {
			return fmt.Errorf("全片策划内容须完整且每项不超过400字")
		}
	}
	if len(s.Missing) > 8 {
		return fmt.Errorf("待补资料最多八项")
	}
	for _, value := range s.Missing {
		if utf8.RuneCountInString(value) > 200 {
			return fmt.Errorf("待补资料每项不超过200字")
		}
	}
	return nil
}

type videoDirectorPlan struct {
	ID       string               `json:"id"`
	Input    string               `json:"input"`
	Strategy videoReplicaStrategy `json:"strategy"`
	Lines    []struct {
		ShotNumber   int                    `json:"shotNumber"`
		Dialogue     string                 `json:"dialogue"`
		OnScreenText string                 `json:"onScreenText"`
		Director     *videoReplicaDirection `json:"director"`
	} `json:"lines"`
}

func (p videoDirectorPlan) validate() error {
	if p.ID == "" || len(p.ID) > 128 || p.Input == "" || len(p.Input) > 64<<10 || len(p.Lines) == 0 {
		return fmt.Errorf("导演策划版本或输入记录无效")
	}
	if err := p.Strategy.validate(); err != nil {
		return err
	}
	var snapshot []json.RawMessage
	if err := json.Unmarshal([]byte(p.Input), &snapshot); err != nil || len(snapshot) < 9 {
		return fmt.Errorf("导演策划输入记录无效")
	}
	var product struct {
		SellingPoints string `json:"sellingPoints"`
	}
	var shots []struct {
		Index     int    `json:"index"`
		Treatment string `json:"treatment"`
	}
	if json.Unmarshal(snapshot[0], &product) != nil || json.Unmarshal(snapshot[8], &shots) != nil {
		return fmt.Errorf("导演策划商品或镜头输入无效")
	}
	facts := []string{}
	for _, line := range strings.Split(product.SellingPoints, "\n") {
		if fact := strings.TrimSpace(videoDirectorFactPrefix.ReplaceAllString(line, "")); fact != "" {
			facts = append(facts, fact)
		}
	}
	treatments := map[int]string{}
	for _, shot := range shots {
		if shot.Treatment != "skip" {
			treatments[shot.Index] = shot.Treatment
		}
	}
	if len(p.Lines) != len(treatments) {
		return fmt.Errorf("导演策划必须包含全部保留镜头")
	}
	seen := map[int]bool{}
	for _, line := range p.Lines {
		if line.ShotNumber < 1 || seen[line.ShotNumber] || utf8.RuneCountInString(line.Dialogue) > 300 || utf8.RuneCountInString(line.OnScreenText) > 120 {
			return fmt.Errorf("导演策划的镜头编号或台词无效")
		}
		seen[line.ShotNumber] = true
		treatment, exists := treatments[line.ShotNumber]
		if !exists || treatment == "remake" && line.Director == nil || treatment != "remake" && line.Director != nil {
			return fmt.Errorf("导演策划不得改动镜头做法")
		}
		if line.Director != nil {
			if err := line.Director.validate(); err != nil {
				return err
			}
			if strings.TrimSpace(line.Director.Action) == "" || strings.TrimSpace(line.Director.Purpose) == "" || strings.TrimSpace(line.Director.Start) == "" || strings.TrimSpace(line.Director.End) == "" || strings.TrimSpace(line.Director.Lighting) == "" {
				return fmt.Errorf("策划镜头须有用途、动作始末与布光")
			}
			if line.Director.Beat == "proof" && line.Director.Evidence == "" || line.Director.Evidence != "" && !slices.Contains(facts, line.Director.Evidence) {
				return fmt.Errorf("策划证明依据须引用商品输入中的原文卖点")
			}
		}
	}
	return nil
}

var videoDirectorFactPrefix = regexp.MustCompile(`^\s*(?:[-*·•]\s*|\d+[.、)]\s*)`)
