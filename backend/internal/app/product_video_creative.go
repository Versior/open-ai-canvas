package app

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/trends"
)

type productCreativeBrief struct {
	Scene     string `json:"scene"`
	Tone      string `json:"tone"`
	Seconds   int    `json:"seconds"`
	Audience  string `json:"audience"`
	Objective string `json:"objective"`
	Brand     string `json:"brand"`
	Topic     *struct {
		Source    string `json:"source"`
		Title     string `json:"title"`
		URL       string `json:"url"`
		FetchedAt string `json:"fetchedAt"`
	} `json:"topic,omitempty"`
}

var productCreativeScenes = []string{"selling", "promotion", "seeding", "problem", "demo", "discover", "visit", "signature", "groupbuy", "showcase", "benefit", "creative-ad", "concept", "dialogue", "twist", "suspense", "emotion", "placement", "documentary", "craft", "city", "nature", "interview", "daily", "travel", "food", "sports", "pet", "knowledge", "tutorial", "unboxing", "comparison", "fashion-film", "music-video", "asmr", "animation", "surreal", "festival"}
var productCreativeTones = []string{"natural", "clean", "cinematic", "energetic", "premium", "warm", "documentary", "realism", "reportage", "noir", "retro", "hongkong", "ink", "anime", "animation3d", "stopmotion", "clay", "cyber", "dream", "editorial", "food", "sports"}

func validateCreativeCast(scene, people, audio string, identity bool) error {
	if slices.Contains([]string{"selling", "dialogue", "twist", "suspense", "emotion", "placement", "documentary", "interview", "daily", "sports", "fashion-film"}, scene) && people != "model" {
		return fmt.Errorf("当前视频用途需要人物出镜")
	}
	if people == "model" && !identity {
		return fmt.Errorf("人物出镜需要身份参考，姿势图不能固定身份")
	}
	if slices.Contains([]string{"selling", "dialogue", "interview"}, scene) && audio != "rewrite" {
		return fmt.Errorf("当前视频用途需要人物口播声音")
	}
	return nil
}

func (b productCreativeBrief) validate() error {
	if !slices.Contains(productCreativeScenes, b.Scene) || !slices.Contains(productCreativeTones, b.Tone) || b.Seconds < 4 || b.Seconds > 60 {
		return fmt.Errorf("商品视频内容类型、风格或时长无效")
	}
	if topic := b.Topic; topic != nil {
		_, timeErr := time.Parse(time.RFC3339, topic.FetchedAt)
		if strings.TrimSpace(topic.Title) == "" || utf8.RuneCountInString(topic.Title) > 100 || len(topic.URL) > 2048 || !trends.ValidTopicURL(topic.Source, topic.URL) || timeErr != nil {
			return fmt.Errorf("热点选题来源、标题或抓取时间无效")
		}
	}
	for _, text := range []string{b.Audience, b.Objective, b.Brand} {
		if utf8.RuneCountInString(text) > 300 {
			return fmt.Errorf("商品视频创作要求不能超过300字")
		}
	}
	return nil
}

type productCreativeShot struct {
	Index     int                    `json:"index"`
	Start     int                    `json:"startMs"`
	End       int                    `json:"endMs"`
	Plot      string                 `json:"plot"`
	Dialogue  string                 `json:"dialogue"`
	Speaker   bool                   `json:"speaker"`
	Text      string                 `json:"onScreenText"`
	Treatment string                 `json:"treatment"`
	Director  *videoReplicaDirection `json:"director"`
}

func validateCreativeShots(shots []productCreativeShot, facts, language, audio string, seconds int) error {
	if len(shots) < 2 || len(shots) > 12 {
		return fmt.Errorf("商品脚本须有2–12镜头")
	}
	cps, ok := map[string]int{"zh": 4, "en": 14, "ja": 7, "ko": 6, "es": 14, "pt": 14, "id": 14, "th": 10, "vi": 12, "fr": 14, "de": 13}[language]
	if !ok || !slices.Contains([]string{"mute", "voice", "rewrite"}, audio) {
		return fmt.Errorf("商品视频语言或声音模式无效")
	}
	evidence := []string{}
	for _, line := range strings.Split(facts, "\n") {
		if text := strings.TrimSpace(videoDirectorFactPrefix.ReplaceAllString(line, "")); text != "" {
			evidence = append(evidence, text)
		}
	}
	cursor := 0
	for index, shot := range shots {
		if shot.Index != index+1 || shot.Start != cursor || shot.End-shot.Start < 1000 || shot.End-shot.Start > 15000 || strings.TrimSpace(shot.Plot) == "" || utf8.RuneCountInString(shot.Plot) > 400 || utf8.RuneCountInString(shot.Text) > 120 || !slices.Contains([]string{"remake", "skip"}, shot.Treatment) {
			return fmt.Errorf("商品视频镜头编号、时序或做法无效")
		}
		if utf8.RuneCountInString(shot.Dialogue) > (shot.End-shot.Start)*cps/1000 || audio == "mute" && strings.TrimSpace(shot.Dialogue) != "" {
			return fmt.Errorf("商品镜头台词超过时长预算或声音模式不一致")
		}
		if shot.Director == nil {
			return fmt.Errorf("商品镜头缺少导演动作")
		}
		d := shot.Director
		if err := d.validate(); err != nil {
			return err
		}
		for _, value := range []string{d.Action, d.Purpose, d.Start, d.End, d.Lighting} {
			if strings.TrimSpace(value) == "" {
				return fmt.Errorf("商品镜头须有用途、动作始末与布光")
			}
		}
		if d.Beat == "proof" && d.Evidence == "" || d.Evidence != "" && !slices.Contains(evidence, d.Evidence) {
			return fmt.Errorf("商品镜头证明依据须引用确认资料")
		}
		cursor = shot.End
	}
	if seconds > 0 && cursor != seconds*1000 {
		return fmt.Errorf("商品脚本总时长与目标不一致")
	}
	return nil
}

type productCreativePlan struct {
	ID       string                `json:"id"`
	Input    string                `json:"input"`
	Title    string                `json:"title"`
	Strategy videoReplicaStrategy  `json:"strategy"`
	Shots    []productCreativeShot `json:"shots"`
}

func (p productCreativePlan) validate() error {
	if !validEcommerceStudioID(p.ID) || len(p.Input) > 64<<10 || strings.TrimSpace(p.Title) == "" || utf8.RuneCountInString(p.Title) > 100 {
		return fmt.Errorf("商品视频方案标识或名称无效")
	}
	if err := p.Strategy.validate(); err != nil {
		return err
	}
	var snapshot []json.RawMessage
	if json.Unmarshal([]byte(p.Input), &snapshot) != nil || len(snapshot) != 9 {
		return fmt.Errorf("商品视频策划输入快照无效")
	}
	var factJSON, language, audio, name, people, note string
	var facts []json.RawMessage
	var images, backgrounds []string
	var models [][]json.RawMessage
	var campaign *videoReplicaCampaign
	var selling string
	var brief productCreativeBrief
	if json.Unmarshal(snapshot[0], &factJSON) != nil || json.Unmarshal([]byte(factJSON), &facts) != nil || len(facts) != 3 || json.Unmarshal(facts[0], &name) != nil || json.Unmarshal(facts[1], &selling) != nil || json.Unmarshal(facts[2], &images) != nil || json.Unmarshal(snapshot[1], &brief) != nil || json.Unmarshal(snapshot[2], &campaign) != nil || json.Unmarshal(snapshot[3], &people) != nil || json.Unmarshal(snapshot[4], &models) != nil || json.Unmarshal(snapshot[5], &backgrounds) != nil || json.Unmarshal(snapshot[6], &audio) != nil || json.Unmarshal(snapshot[7], &language) != nil || json.Unmarshal(snapshot[8], &note) != nil {
		return fmt.Errorf("商品视频事实或设置快照无效")
	}
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 60 || utf8.RuneCountInString(selling) > 400 || len(images) < 1 || len(images) > 4 || len(models) > 3 || len(backgrounds) > 3 || !slices.Contains([]string{"none", "model"}, people) || utf8.RuneCountInString(note) > 300 || campaign == nil {
		return fmt.Errorf("商品视频策划素材快照无效")
	}
	if err := campaign.validate(); err != nil {
		return err
	}
	if campaign.Style != "auto" && campaign.Style != p.Strategy.Method || campaign.Narrative != "" && campaign.Narrative != "auto" && campaign.Narrative != p.Strategy.Narrative {
		return fmt.Errorf("商品策划拍法或叙事与冻结设置不一致")
	}
	identity := false
	for _, image := range models {
		var id string
		var role *string
		if len(image) != 2 || json.Unmarshal(image[0], &id) != nil || json.Unmarshal(image[1], &role) != nil || role != nil && !slices.Contains([]string{"figure", "face", "pose"}, *role) {
			return fmt.Errorf("商品策划人物参考无效")
		}
		images = append(images, id)
		identity = identity || role == nil || *role != "pose"
	}
	for _, id := range append(images, backgrounds...) {
		if id == "" || assets.ValidID(id) != id {
			return fmt.Errorf("商品策划素材标识无效")
		}
	}
	if err := brief.validate(); err != nil {
		return err
	}
	if err := validateCreativeCast(brief.Scene, people, audio, identity); err != nil {
		return err
	}
	if slices.Contains([]string{"selling", "dialogue", "interview"}, brief.Scene) && !slices.ContainsFunc(p.Shots, func(shot productCreativeShot) bool { return shot.Speaker && strings.TrimSpace(shot.Dialogue) != "" }) {
		return fmt.Errorf("人物口播方案缺少实际说话镜头和台词")
	}
	return validateCreativeShots(p.Shots, selling, language, audio, brief.Seconds)
}
func validateProductVideoCreative(raw json.RawMessage) error {
	var work struct {
		Version  int             `json:"version"`
		Source   json.RawMessage `json:"source"`
		People   string          `json:"people"`
		Audio    string          `json:"audio"`
		Language string          `json:"language"`
		Product  struct {
			Name          string `json:"name"`
			SellingPoints string `json:"sellingPoints"`
			Images        []struct {
				ResourceID string `json:"resourceId"`
			} `json:"images"`
		} `json:"product"`
		Shots    []productCreativeShot `json:"shots"`
		Creative *struct {
			Brief          productCreativeBrief  `json:"brief"`
			ConfirmedInput string                `json:"confirmedInput"`
			Plans          []productCreativePlan `json:"plans"`
			ActivePlan     string                `json:"activePlanId"`
			Analysis       *struct {
				Input       string   `json:"input"`
				Observation string   `json:"observation"`
				Missing     []string `json:"missing"`
			} `json:"analysis"`
			Run *struct {
				ID      string   `json:"id"`
				Kind    string   `json:"kind"`
				Input   string   `json:"input"`
				Prompt  string   `json:"prompt"`
				Model   string   `json:"model"`
				Images  []string `json:"imageResourceIds"`
				Count   int      `json:"count"`
				Status  string   `json:"status"`
				Settled bool     `json:"settled"`
				TaskID  string   `json:"taskId"`
			} `json:"run"`
		} `json:"creative"`
		Units []struct {
			Input *struct {
				Model      string   `json:"model"`
				Ratio      string   `json:"ratio"`
				Resolution string   `json:"resolution"`
				Seconds    int      `json:"seconds"`
				Audio      string   `json:"audio"`
				Prompt     string   `json:"prompt"`
				Images     []string `json:"imageResourceIds"`
				VideoID    string   `json:"videoResourceId"`
			} `json:"input"`
		} `json:"units"`
	}
	if json.Unmarshal(raw, &work) != nil {
		return fmt.Errorf("商品视频作品结构无效")
	}
	for _, unit := range work.Units {
		if input := unit.Input; input != nil {
			if input.Model == "" || utf8.RuneCountInString(input.Model) > 200 || input.Seconds < 1 || input.Seconds > 120 || !slices.Contains([]string{"model", "mute"}, input.Audio) || input.Prompt == "" || utf8.RuneCountInString(input.Prompt) > 12000 || len(input.Images) < 1 || len(input.Images) > 10 {
				return fmt.Errorf("视频生成输入快照无效")
			}
			for _, id := range append(append([]string{}, input.Images...), input.VideoID) {
				if id != "" && assets.ValidID(id) != id {
					return fmt.Errorf("视频输入素材标识无效")
				}
			}
		}
	}
	c := work.Creative
	if c == nil {
		return nil
	}
	if work.Version != 2 || len(work.Source) > 0 && string(work.Source) != "null" || !slices.Contains([]string{"model", "none"}, work.People) || !slices.Contains([]string{"rewrite", "voice", "mute"}, work.Audio) {
		return fmt.Errorf("商品新创作不能使用原视频、原人物或原声")
	}
	if err := c.Brief.validate(); err != nil {
		return err
	}
	if utf8.RuneCountInString(work.Product.Name) > 60 || utf8.RuneCountInString(work.Product.SellingPoints) > 400 || len(work.Product.Images) > 4 || len(c.ConfirmedInput) > 64000 || len(c.Plans) > 7 {
		return fmt.Errorf("商品视频素材或计划超限")
	}
	for _, image := range work.Product.Images {
		if image.ResourceID == "" || assets.ValidID(image.ResourceID) != image.ResourceID {
			return fmt.Errorf("商品图须先上传为资源")
		}
	}
	ids := map[string]bool{}
	for _, plan := range c.Plans {
		if ids[plan.ID] {
			return fmt.Errorf("商品策划版本重复")
		}
		ids[plan.ID] = true
		if err := plan.validate(); err != nil {
			return err
		}
	}
	if c.ActivePlan != "" && !ids[c.ActivePlan] {
		return fmt.Errorf("选用的商品策划不存在")
	}
	if len(work.Shots) > 0 {
		// 配方允许暂存过期脚本；每个镜头仍按生成它的已选方案事实和语言校验。
		selected := slices.IndexFunc(c.Plans, func(p productCreativePlan) bool { return p.ID == c.ActivePlan })
		if selected < 0 {
			return fmt.Errorf("商品镜头须来自选用的脚本")
		}
		var snapshot []json.RawMessage
		_ = json.Unmarshal([]byte(c.Plans[selected].Input), &snapshot)
		var factsJSON, audio, language, selling string
		var facts []json.RawMessage
		_ = json.Unmarshal(snapshot[0], &factsJSON)
		_ = json.Unmarshal([]byte(factsJSON), &facts)
		_ = json.Unmarshal(facts[1], &selling)
		_ = json.Unmarshal(snapshot[6], &audio)
		_ = json.Unmarshal(snapshot[7], &language)
		if err := validateCreativeShots(work.Shots, selling, language, audio, 0); err != nil {
			return err
		}
	}
	if a := c.Analysis; a != nil {
		if a.Input == "" || len(a.Input) > 64000 || a.Observation == "" || utf8.RuneCountInString(a.Observation) > 800 || len(a.Missing) > 8 {
			return fmt.Errorf("商品素材分析结构无效")
		}
		for _, missing := range a.Missing {
			if utf8.RuneCountInString(missing) > 200 {
				return fmt.Errorf("商品待补资料超长")
			}
		}
	}
	if r := c.Run; r != nil {
		if !validEcommerceStudioID(r.ID) || !slices.Contains([]string{"analysis", "plan"}, r.Kind) || !slices.Contains([]string{"running", "succeeded", "failed"}, r.Status) || r.Input == "" || len(r.Input) > 64000 || r.Prompt == "" || utf8.RuneCountInString(r.Prompt) > 12000 || r.Model == "" || utf8.RuneCountInString(r.Model) > 200 || len(r.Images) > 10 || !slices.Contains([]int{2, 3, 4, 5, 6}, r.Count) || r.Status == "succeeded" && (!r.Settled || r.TaskID == "") {
			return fmt.Errorf("商品策划任务输入无效")
		}
		for _, id := range r.Images {
			if id == "" || assets.ValidID(id) != id {
				return fmt.Errorf("商品策划参考图无效")
			}
		}
	}
	return nil
}

func (s *Service) validateCreativeWorkResources(userID string, raw json.RawMessage) error {
	var head struct {
		Creative         json.RawMessage `json:"creative"`
		Replication      json.RawMessage `json:"replication"`
		ComparisonRender json.RawMessage `json:"comparisonRender"`
		Units            []struct {
			Input json.RawMessage `json:"input"`
		} `json:"units"`
	}
	if json.Unmarshal(raw, &head) != nil {
		return BadAuthRequest("视频作品结构无效")
	}
	hasInput := slices.ContainsFunc(head.Units, func(u struct {
		Input json.RawMessage `json:"input"`
	}) bool {
		return len(u.Input) > 0
	})
	if len(head.Creative) == 0 && len(head.Replication) == 0 && !hasInput && len(head.ComparisonRender) == 0 {
		return nil
	}
	refs, err := assets.CollectDocumentResourceReferences(string(raw))
	if err != nil {
		return BadAuthRequest("视频素材引用无效")
	}
	resources := map[string]*model.Resource{}
	for _, ref := range refs {
		path := strings.TrimPrefix(strings.TrimPrefix(ref.Path, "replication.run.input."), "replication.plan.input.")
		resource := resources[ref.ResourceID]
		if resource == nil {
			resource, err = s.repo.ResourceForUser(userID, ref.ResourceID)
			if err != nil || resource == nil || resource.Status != model.ResourceStatusReady {
				return BadAuthRequest("视频素材不存在、尚未就绪或不属于当前用户")
			}
			resources[ref.ResourceID] = resource
		}
		expectedKind := ""
		switch {
		case strings.HasPrefix(path, "product.images["), strings.HasPrefix(path, "models["), strings.HasPrefix(path, "backgrounds["), strings.Contains(path, "imageResourceIds["), strings.Contains(path, "keyframeResourceId"), strings.HasPrefix(path, "subtitleImages."), strings.HasPrefix(path, "editSubtitleImages["):
			expectedKind = "image"
		case strings.HasPrefix(path, "music."), strings.HasPrefix(path, "voiceLines["):
			expectedKind = "audio"
		case strings.HasPrefix(path, "source."), strings.HasPrefix(path, "render."), strings.HasPrefix(path, "editRender."), strings.HasPrefix(path, "comparisonRender."), strings.HasSuffix(path, ".videoResourceId"), strings.HasSuffix(path, ".clipResourceId"), strings.Contains(path, ".takes["):
			expectedKind = "video"
		}
		if expectedKind != "" && resource.Kind != expectedKind {
			return BadAuthRequest("视频素材类型与用途不一致")
		}
	}
	var document any
	_ = json.Unmarshal(raw, &document)
	var reference struct {
		Replication *struct {
			Run *struct {
				TaskID string `json:"taskId"`
			} `json:"run"`
		} `json:"replication"`
	}
	_ = json.Unmarshal(raw, &reference)
	if reference.Replication != nil && reference.Replication.Run != nil && reference.Replication.Run.TaskID != "" {
		task, err := s.repo.Task(reference.Replication.Run.TaskID)
		if err != nil || task.UserID != userID || task.Type != "canvas_text" {
			return BadAuthRequest("参考规划必须引用当前用户的文本任务")
		}
	}
	checkedTasks := map[string]bool{}
	var checkReferences func(any, string) error
	checkReferences = func(value any, field string) error {
		if slices.Contains([]string{"resourceId", "resourceIds", "keyframeResourceId", "imageResourceIds", "videoResourceId", "clipResourceId"}, field) {
			switch item := value.(type) {
			case string:
				if item != "" && assets.ValidID(item) != item {
					return BadAuthRequest("视频素材标识无效")
				}
			case []any:
				if field != "resourceIds" && field != "imageResourceIds" {
					return BadAuthRequest("视频素材标识不能是列表")
				}
			default:
				return BadAuthRequest("视频素材标识无效")
			}
		}
		switch item := value.(type) {
		case map[string]any:
			for key, child := range item {
				if key == "taskId" {
					id, ok := child.(string)
					if !ok || id != "" && assets.ValidID(id) != id {
						return BadAuthRequest("视频任务标识无效")
					}
					if id != "" && !checkedTasks[id] {
						task, err := s.repo.Task(id)
						if err != nil || task.UserID != userID {
							return BadAuthRequest("视频任务不存在或不属于当前用户")
						}
						checkedTasks[id] = true
					}
				}
				if err := checkReferences(child, key); err != nil {
					return err
				}
			}
		case []any:
			for _, child := range item {
				if err := checkReferences(child, field); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return checkReferences(document, "")
}
