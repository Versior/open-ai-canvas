package app

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"reflect"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
)

type referenceReplicationShot struct {
	Index     int                    `json:"index"`
	Start     int                    `json:"startMs"`
	End       int                    `json:"endMs"`
	Keyframe  string                 `json:"keyframeResourceId"`
	Treatment string                 `json:"treatment"`
	Dialogue  string                 `json:"dialogue"`
	Speaker   bool                   `json:"speaker"`
	Director  *videoReplicaDirection `json:"director"`
}

type referenceReplicationSnapshot struct {
	Source struct {
		ResourceID string `json:"resourceId"`
		TeardownID string `json:"teardownId"`
		Duration   int    `json:"durationMs"`
		Width      int    `json:"width"`
		Height     int    `json:"height"`
	} `json:"source"`
	Mode        string                     `json:"mode"`
	SourceShots []referenceReplicationShot `json:"sourceShots"`
	Duration    int                        `json:"targetDurationMs"`
	Audio       string                     `json:"audio"`
	Language    string                     `json:"language"`
	People      string                     `json:"people"`
	Brief       string                     `json:"brief"`
	Product     struct {
		Name          string `json:"name"`
		SellingPoints string `json:"sellingPoints"`
		Images        []struct {
			ID         string `json:"id"`
			ResourceID string `json:"resourceId"`
		} `json:"images"`
	} `json:"product"`
}

func (input referenceReplicationSnapshot) validate() error {
	if !slices.Contains([]string{"structure", "style"}, input.Mode) || input.Duration < 1000 || input.Duration > 600000 || input.Mode == "style" && (input.Duration < 5000 || input.Duration > 180000) || utf8.RuneCountInString(input.Brief) > 800 || !validEcommerceStudioID(input.Source.ResourceID) || !validEcommerceStudioID(input.Source.TeardownID) || input.Source.Width < 1 || input.Source.Height < 1 || input.Source.Duration > 600000 {
		return fmt.Errorf("参考方案冻结模式、原片或时长无效")
	}
	if err := validateReferenceSourceShots(input.SourceShots); err != nil {
		return err
	}
	if input.Source.Duration < input.SourceShots[len(input.SourceShots)-1].End || !slices.Contains([]string{"model", "none"}, input.People) || !slices.Contains([]string{"rewrite", "voice", "mute"}, input.Audio) || strings.TrimSpace(input.Product.Name) == "" || len(input.Product.Images) < 1 || len(input.Product.Images) > 4 {
		return fmt.Errorf("参考方案冻结主体、声音方式或原片范围无效")
	}
	for _, image := range input.Product.Images {
		if !validEcommerceStudioID(image.ID) || !validEcommerceStudioID(image.ResourceID) {
			return fmt.Errorf("参考方案冻结主体图片无效")
		}
	}
	return nil
}

type referenceReplicationPlan struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Input     string            `json:"input"`
	Model     string            `json:"model"`
	CreatedAt string            `json:"createdAt"`
	Style     map[string]string `json:"style"`
	Beats     []struct {
		ShotNumber int    `json:"shotNumber"`
		Purpose    string `json:"purpose"`
		Adaptation string `json:"adaptation"`
	} `json:"beats"`
	Shots []referenceReplicationShot `json:"shots"`
}

func validateProductVideoReferenceReplication(raw json.RawMessage) error {
	var head struct {
		Version     int                        `json:"version"`
		Source      json.RawMessage            `json:"source"`
		Creative    json.RawMessage            `json:"creative"`
		Audio       string                     `json:"audio"`
		People      string                     `json:"people"`
		Shots       []referenceReplicationShot `json:"shots"`
		Replication *struct {
			Mode        string                     `json:"mode"`
			SourceShots []referenceReplicationShot `json:"sourceShots"`
			Duration    int                        `json:"targetDurationMs"`
			Brief       string                     `json:"brief"`
			Confirmed   bool                       `json:"confirmed"`
			Plan        *referenceReplicationPlan  `json:"plan"`
			Run         *struct {
				Key              string `json:"key"`
				Input            string `json:"input"`
				Model            string `json:"model"`
				CreatedAt        string `json:"createdAt"`
				ImageCount       int    `json:"imageCount"`
				TargetImageCount int    `json:"targetImageCount"`
				TaskID           string `json:"taskId"`
				RequestSignature string `json:"requestSignature"`
			} `json:"run"`
		} `json:"replication"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return fmt.Errorf("参考复刻合同格式无效")
	}
	r := head.Replication
	if r == nil {
		return nil
	}
	if head.Version != 2 || len(head.Source) == 0 || string(head.Source) == "null" || len(head.Creative) > 0 && string(head.Creative) != "null" {
		return fmt.Errorf("参考复刻必须绑定原片拆解作品")
	}
	if !slices.Contains([]string{"structure", "style"}, r.Mode) || r.Duration < 1000 || r.Duration > 600000 || r.Mode == "style" && (r.Duration < 5000 || r.Duration > 180000) || utf8.RuneCountInString(r.Brief) > 800 {
		return fmt.Errorf("参考复刻模式、时长或改编要求无效")
	}
	if err := validateReferenceSourceShots(r.SourceShots); err != nil {
		return err
	}
	if r.Run != nil {
		if !validEcommerceStudioID(r.Run.Key) || r.Run.Model == "" || len(r.Run.Model) > 200 || r.Run.CreatedAt == "" || len(r.Run.CreatedAt) > 64 || len(r.Run.Input) == 0 || len(r.Run.Input) > 65536 || !json.Valid([]byte(r.Run.Input)) || r.Run.ImageCount < 1 || r.Run.ImageCount > 12 || r.Run.TargetImageCount < 1 || r.Run.TargetImageCount > 4 || r.Run.TaskID != "" && !validEcommerceStudioID(r.Run.TaskID) {
			return fmt.Errorf("参考规划任务记录无效")
		}
		var input referenceReplicationSnapshot
		if json.Unmarshal([]byte(r.Run.Input), &input) != nil {
			return fmt.Errorf("参考规划冻结输入无效")
		}
		if err := input.validate(); err != nil {
			return err
		}
		_, digestError := hex.DecodeString(r.Run.RequestSignature)
		if r.Run.ImageCount > len(input.SourceShots) || r.Run.TargetImageCount > len(input.Product.Images) || len(r.Run.RequestSignature) != 64 || digestError != nil {
			return fmt.Errorf("参考规划图片数量或请求摘要无效")
		}
		if _, err := time.Parse(time.RFC3339Nano, r.Run.CreatedAt); err != nil {
			return fmt.Errorf("参考规划创建时间无效")
		}
	}
	if r.Plan != nil {
		if err := r.Plan.validate(); err != nil {
			return err
		}
	}
	if r.Confirmed {
		if r.Plan == nil || r.Run != nil || head.Audio == "original" || head.People == "original" {
			return fmt.Errorf("参考复刻须确认完整方案并使用目标人物与新口播")
		}
		var current referenceReplicationSnapshot
		if json.Unmarshal(raw, &current) != nil {
			return fmt.Errorf("参考复刻当前资料无效")
		}
		current.Mode, current.SourceShots, current.Duration, current.Brief = r.Mode, r.SourceShots, r.Duration, r.Brief
		if err := current.validate(); err != nil {
			return err
		}
		var document, snapshot map[string]any
		_ = json.Unmarshal(raw, &document)
		_ = json.Unmarshal([]byte(r.Plan.Input), &snapshot)
		for _, key := range []string{"source", "product", "people", "models", "backgrounds", "audio", "language", "note", "campaign"} {
			if !reflect.DeepEqual(document[key], snapshot[key]) {
				return fmt.Errorf("目标资料已变化，请重新规划并应用参考方案")
			}
		}
		for key, value := range map[string]any{"mode": r.Mode, "targetDurationMs": float64(r.Duration), "brief": r.Brief} {
			if !reflect.DeepEqual(snapshot[key], value) {
				return fmt.Errorf("参考设置已变化，请重新应用方案")
			}
		}
		var planned referenceReplicationSnapshot
		_ = json.Unmarshal([]byte(r.Plan.Input), &planned)
		if !reflect.DeepEqual(r.SourceShots, planned.SourceShots) {
			return fmt.Errorf("原片镜头已变化，请重新规划")
		}
		if err := validateReferenceTargetShots(head.Shots, current); err != nil {
			return err
		}
		if err := validateReferenceDialogue(head.Shots, current); err != nil {
			return err
		}
	}
	return nil
}

func validateReferenceSourceShots(shots []referenceReplicationShot) error {
	if len(shots) == 0 || len(shots) > 120 {
		return fmt.Errorf("参考镜头记录须为1至120镜")
	}
	seen := map[int]bool{}
	end := 0
	for _, shot := range shots {
		if shot.Index < 1 || seen[shot.Index] || shot.Start < end || shot.End <= shot.Start || shot.End > 600000 || !validEcommerceStudioID(shot.Keyframe) {
			return fmt.Errorf("原片镜头标识、区间或关键帧无效")
		}
		seen[shot.Index] = true
		end = shot.End
	}
	return nil
}

func validateReferenceTargetShots(shots []referenceReplicationShot, input referenceReplicationSnapshot) error {
	if input.Mode == "structure" && len(shots) != len(input.SourceShots) || input.Mode == "style" && (len(shots) < 2 || len(shots) > 12) {
		return fmt.Errorf("目标镜头数量不符合复刻合同")
	}
	end := 0
	for index, shot := range shots {
		if shot.Treatment != "remake" || shot.Director == nil {
			return fmt.Errorf("结构与风格复刻必须按目标分镜重新生成")
		}
		if err := shot.Director.validate(); err != nil {
			return err
		}
		for _, value := range []string{shot.Director.Action, shot.Director.Purpose, shot.Director.Start, shot.Director.End, shot.Director.Lighting} {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("目标镜头必须包含动作、叙事作用、动作始末与布光")
			}
		}
		if input.Mode == "structure" {
			original := input.SourceShots[index]
			if shot.Index != original.Index || shot.Start != original.Start || shot.End != original.End {
				return fmt.Errorf("结构复刻镜头顺序与切点须对应原片")
			}
		} else if shot.Index != index+1 || shot.Start != end || shot.End-shot.Start < 1000 || shot.End-shot.Start > 15000 {
			return fmt.Errorf("风格复刻须使用连续目标时间线，单镜1至15秒")
		}
		end = shot.End
	}
	if input.Mode == "style" && end != input.Duration {
		return fmt.Errorf("风格复刻时间线须覆盖完整目标时长")
	}
	return nil
}

func (p referenceReplicationPlan) validate() error {
	if !validEcommerceStudioID(p.ID) || p.Title == "" || utf8.RuneCountInString(p.Title) > 80 || p.Model == "" || len(p.Model) > 200 || p.CreatedAt == "" || len(p.CreatedAt) > 64 || len(p.Input) == 0 || len(p.Input) > 65536 {
		return fmt.Errorf("参考方案标识、模型或输入记录无效")
	}
	var input referenceReplicationSnapshot
	if json.Unmarshal([]byte(p.Input), &input) != nil {
		return fmt.Errorf("参考方案冻结输入无效")
	}
	if err := input.validate(); err != nil {
		return err
	}
	for _, key := range []string{"palette", "lighting", "texture", "composition", "camera", "editing", "sound"} {
		if strings.TrimSpace(p.Style[key]) == "" || utf8.RuneCountInString(p.Style[key]) > 300 {
			return fmt.Errorf("参考方案风格资料须完整，每项至多300字")
		}
	}
	if len(p.Beats) != len(input.SourceShots) {
		return fmt.Errorf("参考方案须覆盖全部原镜头作用")
	}
	seen := map[int]bool{}
	for _, beat := range p.Beats {
		if seen[beat.ShotNumber] || !slices.ContainsFunc(input.SourceShots, func(s referenceReplicationShot) bool { return s.Index == beat.ShotNumber }) || strings.TrimSpace(beat.Purpose) == "" || strings.TrimSpace(beat.Adaptation) == "" || utf8.RuneCountInString(beat.Purpose) > 200 || utf8.RuneCountInString(beat.Adaptation) > 200 {
			return fmt.Errorf("原镜头作用或迁移依据无效")
		}
		seen[beat.ShotNumber] = true
	}
	if err := validateReferenceTargetShots(p.Shots, input); err != nil {
		return err
	}
	return validateReferenceDialogue(p.Shots, input)
}

func validateReferenceDialogue(shots []referenceReplicationShot, input referenceReplicationSnapshot) error {
	cps, ok := map[string]int{"zh": 4, "en": 14, "ja": 7, "ko": 6, "es": 14, "pt": 14, "id": 14, "th": 10, "vi": 12, "fr": 14, "de": 13}[input.Language]
	if !ok || !slices.Contains([]string{"rewrite", "voice", "mute", "original"}, input.Audio) {
		return fmt.Errorf("参考方案口播语言或方式无效")
	}
	facts := []string{}
	for _, line := range strings.Split(input.Product.SellingPoints, "\n") {
		if fact := strings.TrimSpace(videoDirectorFactPrefix.ReplaceAllString(line, "")); fact != "" {
			facts = append(facts, fact)
		}
	}
	for _, shot := range shots {
		if utf8.RuneCountInString(shot.Dialogue) > (shot.End-shot.Start)*cps/1000 || input.Audio != "rewrite" && shot.Speaker || slices.Contains([]string{"mute", "original"}, input.Audio) && strings.TrimSpace(shot.Dialogue) != "" {
			return fmt.Errorf("目标口播超出预算或与声音方式不一致")
		}
		if shot.Director.Evidence != "" && !slices.Contains(facts, shot.Director.Evidence) || shot.Director.Beat == "proof" && shot.Director.Evidence == "" {
			return fmt.Errorf("目标证明镜头须逐字引用一条已给事实")
		}
	}
	return nil
}
