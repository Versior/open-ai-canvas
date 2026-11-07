package app

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// Agent 对生图台商品的批量修改。整批先校验再落地：任何一项不合法都不写入。
// 证据规则与页面一致：只有「图片可见」和「已确认」能上图；卖点的证据由它引用的事实推导，
// 模型不能自己宣称卖点已确认。

type studioChange struct {
	Fields          []string `json:"fields"`
	Details         []string `json:"details"`
	Warnings        []string `json:"warnings,omitempty"`
	CreatedFactIDs  []string `json:"createdFactIds,omitempty"`
	CreatedPointIDs []string `json:"createdPointIds,omitempty"`
	CreatedShotIDs  []string `json:"createdShotIds,omitempty"`
}

func (c *studioChange) field(name string) {
	if !studioContains(c.Fields, name) {
		c.Fields = append(c.Fields, name)
	}
}

func (c *studioChange) detail(format string, args ...any) {
	if len(c.Details) < 16 {
		c.Details = append(c.Details, truncateRunes(fmt.Sprintf(format, args...), 180))
	}
}

func (c *studioChange) check(label, text string) {
	for _, rule := range studioComplianceRules {
		if hit := rule.pattern.FindString(text); hit != "" && len(c.Warnings) < 12 {
			c.Warnings = append(c.Warnings, fmt.Sprintf("%s含「%s」：%s", label, hit, rule.reason))
		}
	}
}

// 合规提示只是提醒，不阻止写入；页面上的完整检查仍按 ecommerce-compliance 规则展示。
var studioComplianceRules = []struct {
	pattern *regexp.Regexp
	reason  string
}{
	{regexp.MustCompile(`国家级|世界级|全球级|最高级|最佳|最优|最好|最强|最先进|第一|唯一|首个|首家|首创|顶级|极致|王牌|冠军`), "绝对化用语，广告法禁止"},
	{regexp.MustCompile(`100%|百分百|绝对|永不|永久|终身`), "绝对化承诺，无法验证"},
	{regexp.MustCompile(`治疗|治愈|根治|疗效|防癌|抗癌|降血压|降血糖`), "普通商品不得宣称治疗或疾病功效"},
	{regexp.MustCompile(`无效退款|保证有效|立竿见影|一次见效`), "效果承诺需要依据"},
}

func studioText(field, value string, max int, required bool) (string, error) {
	value = strings.TrimSpace(value)
	if required && value == "" {
		return "", cloudAgentFieldError(field, "required", field+" 不能为空")
	}
	if utf8.RuneCountInString(value) > max {
		return "", cloudAgentFieldError(field, "too_long", fmt.Sprintf("%s 不能超过 %d 个字", field, max))
	}
	if strings.HasPrefix(value, "data:") {
		return "", cloudAgentFieldError(field, "invalid_value", field+" 不能是内嵌数据地址")
	}
	return value, nil
}

func studioEnum(field, value string, allowed []string) error {
	if !studioContains(allowed, value) {
		return cloudAgentFieldError(field, "invalid_value", fmt.Sprintf("%s 只能是：%s", field, strings.Join(allowed, "、")))
	}
	return nil
}

func studioTextList(field string, values []string, maxItems, maxRunes int) ([]string, error) {
	if len(values) > maxItems {
		return nil, cloudAgentFieldError(field, "item_count", fmt.Sprintf("%s 最多 %d 条", field, maxItems))
	}
	result := make([]string, 0, len(values))
	for index, value := range values {
		text, err := studioText(fmt.Sprintf("%s[%d]", field, index), value, maxRunes, false)
		if err != nil {
			return nil, err
		}
		if text != "" {
			result = append(result, text)
		}
	}
	return result, nil
}

func studioIDList(field string, values []string, maxItems int, known func(string) bool) ([]string, error) {
	if len(values) > maxItems {
		return nil, cloudAgentFieldError(field, "item_count", fmt.Sprintf("%s 最多 %d 个", field, maxItems))
	}
	result := make([]string, 0, len(values))
	for index, value := range values {
		id := strings.TrimSpace(value)
		if !known(id) {
			return nil, cloudAgentFieldError(fmt.Sprintf("%s[%d]", field, index), "not_found", fmt.Sprintf("%s[%d] 不存在，请使用 studio_get_state 返回的真实 ID", field, index))
		}
		if !studioContains(result, id) {
			result = append(result, id)
		}
	}
	return result, nil
}

func studioRevisionArg(revision *int64) (int64, error) {
	if revision == nil || *revision < 0 {
		return 0, cloudAgentFieldError("revision", "required", "revision 必填：使用 studio_get_state 返回的最新 revision")
	}
	return *revision, nil
}

// ---------- 档案、卖点与文案 ----------

type studioDossierArgs struct {
	Revision *int64 `json:"revision"`
	Dossier  *struct {
		Name     *string `json:"name"`
		Category *string `json:"category"`
		Family   *string `json:"family"`
		Summary  *string `json:"summary"`
	} `json:"dossier"`
	Facts []struct {
		FactID   string `json:"factId"`
		Group    string `json:"group"`
		Label    string `json:"label"`
		Value    string `json:"value"`
		Evidence string `json:"evidence"`
		Source   string `json:"source"`
	} `json:"facts"`
	RemoveFactIDs []string  `json:"removeFactIds"`
	Invariants    *[]string `json:"invariants"`
	Questions     *[]string `json:"questions"`
	SellingPoints []struct {
		PointID string   `json:"pointId"`
		Title   string   `json:"title"`
		Detail  string   `json:"detail"`
		FactIDs []string `json:"factIds"`
		Enabled *bool    `json:"enabled"`
	} `json:"sellingPoints"`
	RemovePointIDs []string `json:"removePointIds"`
	Copy           *struct {
		Headline     *string   `json:"headline"`
		Subhead      *string   `json:"subhead"`
		ListingTitle *string   `json:"listingTitle"`
		Bullets      *[]string `json:"bullets"`
	} `json:"copy"`
}

func decodeStudioDossierArgs(raw string) (studioDossierArgs, error) {
	var args studioDossierArgs
	if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if _, err := studioRevisionArg(args.Revision); err != nil {
		return args, err
	}
	if args.Dossier == nil && len(args.Facts) == 0 && len(args.RemoveFactIDs) == 0 && args.Invariants == nil && args.Questions == nil && len(args.SellingPoints) == 0 && len(args.RemovePointIDs) == 0 && args.Copy == nil {
		return args, cloudAgentFieldError("facts", "required", "没有任何修改：至少提供 dossier、facts、sellingPoints、copy 等其中一项")
	}
	return args, nil
}

// studioPointEvidence 按卖点引用的事实推导证据：没有依据是待确认，有任一事实不可用是推断，
// 全部可用时只要有卖家确认过的事实就算已确认。
func studioPointEvidence(factIDs []string, facts map[string]studioFact) string {
	if len(factIDs) == 0 {
		return "pending"
	}
	confirmed := false
	for _, id := range factIDs {
		fact, ok := facts[id]
		if !ok || !studioUsableEvidence(fact.Evidence) {
			return "inferred"
		}
		confirmed = confirmed || fact.Evidence == "confirmed"
	}
	if confirmed {
		return "confirmed"
	}
	return "visible"
}

func applyStudioDossierArgs(doc *studioProductDoc, args studioDossierArgs) (*studioChange, error) {
	change := &studioChange{}
	dossier, err := doc.dossier()
	if err != nil {
		return nil, err
	}
	dossierTouched := args.Dossier != nil || len(args.Facts) > 0 || len(args.RemoveFactIDs) > 0 || args.Invariants != nil || args.Questions != nil
	if dossier == nil && dossierTouched {
		dossier = &studioDossierDoc{Family: "generic", Facts: []studioFact{}, Invariants: []string{}, Questions: []string{}, RecognizedAt: studioNow(), RecognizedWith: "agent"}
		change.detail("新建商品档案")
	}
	if args.Dossier != nil {
		if err := applyStudioDossierBasics(dossier, args, change); err != nil {
			return nil, err
		}
	}
	changedFacts := map[string]bool{}
	if dossierTouched {
		if err := applyStudioFacts(dossier, args, change, changedFacts); err != nil {
			return nil, err
		}
		if args.Invariants != nil {
			list, err := studioTextList("invariants", *args.Invariants, 10, 120)
			if err != nil {
				return nil, err
			}
			dossier.Invariants = list
			change.field("外观要点")
			change.detail("出图时不能改动：%s", strings.Join(list, "、"))
		}
		if args.Questions != nil {
			list, err := studioTextList("questions", *args.Questions, 10, 120)
			if err != nil {
				return nil, err
			}
			dossier.Questions = list
			change.field("待确认问题")
		}
	}
	pointsTouched := len(args.SellingPoints) > 0 || len(args.RemovePointIDs) > 0 || len(changedFacts) > 0
	if pointsTouched {
		if err := applyStudioPoints(doc, dossier, args, change, changedFacts); err != nil {
			return nil, err
		}
	}
	if args.Copy != nil {
		if err := applyStudioCopy(doc, args, change); err != nil {
			return nil, err
		}
	}
	if dossierTouched {
		if err := doc.set("dossier", dossier); err != nil {
			return nil, err
		}
		if strings.TrimSpace(doc.str("name")) == "" && dossier.Name != "" {
			if err := doc.set("name", dossier.Name); err != nil {
				return nil, err
			}
		}
	}
	return change, nil
}

func applyStudioDossierBasics(dossier *studioDossierDoc, args studioDossierArgs, change *studioChange) error {
	patch := args.Dossier
	if patch.Name != nil {
		value, err := studioText("dossier.name", *patch.Name, 60, false)
		if err != nil {
			return err
		}
		dossier.Name = value
	}
	if patch.Category != nil {
		value, err := studioText("dossier.category", *patch.Category, 40, false)
		if err != nil {
			return err
		}
		dossier.Category = value
	}
	if patch.Family != nil {
		if err := studioEnum("dossier.family", *patch.Family, studioFamilies); err != nil {
			return err
		}
		dossier.Family = *patch.Family
	}
	if patch.Summary != nil {
		value, err := studioText("dossier.summary", *patch.Summary, 120, false)
		if err != nil {
			return err
		}
		dossier.Summary = value
	}
	change.field("档案基本信息")
	change.detail("品类：%s（%s）", firstNonEmpty(dossier.Category, "未填写"), dossier.Family)
	return nil
}

func applyStudioFacts(dossier *studioDossierDoc, args studioDossierArgs, change *studioChange, changed map[string]bool) error {
	for index, id := range args.RemoveFactIDs {
		position := -1
		for i, fact := range dossier.Facts {
			if fact.ID == id {
				position = i
				break
			}
		}
		if position < 0 {
			return cloudAgentFieldError(fmt.Sprintf("removeFactIds[%d]", index), "not_found", "要删除的事实不存在，请使用 studio_get_state 返回的 factId")
		}
		change.detail("删除事实：%s", dossier.Facts[position].Label)
		dossier.Facts = append(dossier.Facts[:position], dossier.Facts[position+1:]...)
		changed[id] = true
		change.field("事实")
	}
	for index, input := range args.Facts {
		path := fmt.Sprintf("facts[%d]", index)
		if err := studioEnum(path+".group", input.Group, studioFactGroups); err != nil {
			return err
		}
		if err := studioEnum(path+".evidence", input.Evidence, studioEvidenceLevels); err != nil {
			return err
		}
		label, err := studioText(path+".label", input.Label, 40, true)
		if err != nil {
			return err
		}
		value, err := studioText(path+".value", input.Value, 240, true)
		if err != nil {
			return err
		}
		source, err := studioText(path+".source", input.Source, 40, false)
		if err != nil {
			return err
		}
		// 「已确认」专指卖家说过的事实；模型自己的观察最多是「图片可见」。
		if input.Evidence == "confirmed" && source != "卖家" && source != "用户" {
			return cloudAgentFieldError(path+".evidence", "invalid_value", "只有用户在对话里明确说过的事实才能标 confirmed，并把 source 写成「卖家」；照片上看到的写 visible")
		}
		fact := studioFact{Group: input.Group, Label: label, Value: value, Evidence: input.Evidence, Source: source}
		if id := strings.TrimSpace(input.FactID); id != "" {
			position := -1
			for i, existing := range dossier.Facts {
				if existing.ID == id {
					position = i
					break
				}
			}
			if position < 0 {
				return cloudAgentFieldError(path+".factId", "not_found", "factId 不存在；新增事实时不要传 factId")
			}
			fact.ID = id
			dossier.Facts[position] = fact
			changed[id] = true
			change.detail("修改事实：%s = %s（%s）", label, truncateRunes(value, 40), input.Evidence)
		} else {
			fact.ID = studioNewID()
			dossier.Facts = append(dossier.Facts, fact)
			change.CreatedFactIDs = append(change.CreatedFactIDs, fact.ID)
			change.detail("新增事实：%s = %s（%s）", label, truncateRunes(value, 40), input.Evidence)
		}
		change.field("事实")
	}
	if len(dossier.Facts) > 40 {
		return cloudAgentFieldError("facts", "item_count", "一个商品最多 40 条事实，请合并或删除重复的条目")
	}
	return nil
}

func applyStudioPoints(doc *studioProductDoc, dossier *studioDossierDoc, args studioDossierArgs, change *studioChange, changedFacts map[string]bool) error {
	points, err := doc.sellingPoints()
	if err != nil {
		return err
	}
	facts := map[string]studioFact{}
	if dossier != nil {
		for _, fact := range dossier.Facts {
			facts[fact.ID] = fact
		}
	}
	for index, id := range args.RemovePointIDs {
		position := -1
		for i, point := range points {
			if point.ID == id {
				position = i
				break
			}
		}
		if position < 0 {
			return cloudAgentFieldError(fmt.Sprintf("removePointIds[%d]", index), "not_found", "要删除的卖点不存在，请使用 studio_get_state 返回的 pointId")
		}
		change.detail("删除卖点：%s", points[position].Title)
		points = append(points[:position], points[position+1:]...)
		change.field("卖点")
	}
	// 依据被删或被改的卖点重新推导证据；不再可用的自动停用，避免未核实的说法上图。
	for i := range points {
		kept := points[i].FactIDs[:0]
		affected := false
		for _, id := range points[i].FactIDs {
			if _, ok := facts[id]; ok {
				kept = append(kept, id)
			} else {
				affected = true
			}
			affected = affected || changedFacts[id]
		}
		points[i].FactIDs = kept
		if affected {
			points[i].Evidence = studioPointEvidence(kept, facts)
			points[i].Enabled = points[i].Enabled && studioUsableEvidence(points[i].Evidence)
		}
	}
	for index, input := range args.SellingPoints {
		path := fmt.Sprintf("sellingPoints[%d]", index)
		title, err := studioText(path+".title", input.Title, 24, true)
		if err != nil {
			return err
		}
		detail, err := studioText(path+".detail", input.Detail, 60, false)
		if err != nil {
			return err
		}
		factIDs, err := studioIDList(path+".factIds", input.FactIDs, 6, func(id string) bool { _, ok := facts[id]; return ok })
		if err != nil {
			return err
		}
		evidence := studioPointEvidence(factIDs, facts)
		point := studioSellingPoint{Title: title, Detail: detail, FactIDs: factIDs, Evidence: evidence, Enabled: (input.Enabled == nil || *input.Enabled) && studioUsableEvidence(evidence)}
		if id := strings.TrimSpace(input.PointID); id != "" {
			position := -1
			for i, existing := range points {
				if existing.ID == id {
					position = i
					break
				}
			}
			if position < 0 {
				return cloudAgentFieldError(path+".pointId", "not_found", "pointId 不存在；新增卖点时不要传 pointId")
			}
			point.ID = id
			points[position] = point
			change.detail("修改卖点：%s（%s）", title, evidence)
		} else {
			point.ID = studioNewID()
			points = append(points, point)
			change.CreatedPointIDs = append(change.CreatedPointIDs, point.ID)
			change.detail("新增卖点：%s（%s）", title, evidence)
		}
		if !point.Enabled && (input.Enabled == nil || *input.Enabled) {
			change.Warnings = append(change.Warnings, fmt.Sprintf("卖点「%s」没有可用的事实依据，已保存但不上图；请卖家在档案里确认依据后再启用", title))
		}
		change.check("卖点「"+title+"」", title+" "+detail)
		change.field("卖点")
	}
	if len(points) > 6 {
		return cloudAgentFieldError("sellingPoints", "item_count", "一个商品最多 6 条卖点")
	}
	return doc.set("sellingPoints", points)
}

func applyStudioCopy(doc *studioProductDoc, args studioDossierArgs, change *studioChange) error {
	copyDoc, err := doc.copyDoc()
	if err != nil {
		return err
	}
	if copyDoc == nil {
		copyDoc = &studioCopyDoc{Bullets: []string{}}
	}
	patch := args.Copy
	for _, item := range []struct {
		field  string
		label  string
		value  *string
		max    int
		target *string
	}{
		{"copy.headline", "主标题", patch.Headline, 30, &copyDoc.Headline},
		{"copy.subhead", "副标题", patch.Subhead, 48, &copyDoc.Subhead},
		{"copy.listingTitle", "商品标题", patch.ListingTitle, 120, &copyDoc.ListingTitle},
	} {
		if item.value == nil {
			continue
		}
		text, err := studioText(item.field, *item.value, item.max, false)
		if err != nil {
			return err
		}
		*item.target = text
		change.detail("%s：%s", item.label, firstNonEmpty(text, "（清空）"))
		change.check(item.label, text)
	}
	if patch.Bullets != nil {
		list, err := studioTextList("copy.bullets", *patch.Bullets, 6, 80)
		if err != nil {
			return err
		}
		copyDoc.Bullets = list
		for index, bullet := range list {
			change.check(fmt.Sprintf("要点 %d", index+1), bullet)
		}
		change.detail("要点 %d 条", len(list))
	}
	change.field("文案")
	return doc.set("copy", copyDoc)
}

// ---------- 方案与镜头 ----------

type studioShotInput struct {
	Role            string   `json:"role"`
	Title           string   `json:"title"`
	Ratio           string   `json:"ratio"`
	Headline        string   `json:"headline"`
	Subline         string   `json:"subline"`
	Lines           []string `json:"lines"`
	SellingPointIDs []string `json:"sellingPointIds"`
}

type studioShotUpdate struct {
	ShotID          string    `json:"shotId"`
	Title           *string   `json:"title"`
	Ratio           *string   `json:"ratio"`
	Headline        *string   `json:"headline"`
	Subline         *string   `json:"subline"`
	Lines           *[]string `json:"lines"`
	SellingPointIDs *[]string `json:"sellingPointIds"`
	Tweaks          *[]string `json:"tweaks"`
}

type studioPlanArgs struct {
	Revision *int64             `json:"revision"`
	Kind     string             `json:"kind"`
	Action   string             `json:"action"`
	Platform string             `json:"platform"`
	Style    string             `json:"style"`
	TextMode string             `json:"textMode"`
	Shots    []studioShotInput  `json:"shots"`
	Updates  []studioShotUpdate `json:"updates"`
}

var studioRatioPattern = regexp.MustCompile(`^[1-9][0-9]?:[1-9][0-9]?$`)

func decodeStudioPlanArgs(raw string) (studioPlanArgs, error) {
	var args studioPlanArgs
	if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if _, err := studioRevisionArg(args.Revision); err != nil {
		return args, err
	}
	if err := studioEnum("kind", args.Kind, []string{"main", "detail"}); err != nil {
		return args, err
	}
	if err := studioEnum("action", args.Action, []string{"replace", "update"}); err != nil {
		return args, err
	}
	for field, check := range map[string]struct {
		value   string
		allowed []string
	}{"platform": {args.Platform, studioPlatforms}, "style": {args.Style, studioStyles}, "textMode": {args.TextMode, []string{"model"}}} {
		if check.value != "" {
			if err := studioEnum(field, check.value, check.allowed); err != nil {
				return args, err
			}
		}
	}
	if args.Action == "replace" && (len(args.Shots) == 0 || len(args.Updates) > 0) {
		return args, cloudAgentFieldError("shots", "required", "action=replace 时必须提供 shots，且不能同时提供 updates")
	}
	if args.Action == "update" && (len(args.Shots) > 0 || (len(args.Updates) == 0 && args.Platform == "" && args.Style == "" && args.TextMode == "")) {
		return args, cloudAgentFieldError("updates", "required", "action=update 时用 updates 按 shotId 修改镜头，不能提供 shots")
	}
	return args, nil
}

func studioShotCopyFields(path string, headline, subline string, lines []string) (string, string, []string, error) {
	headline, err := studioText(path+".headline", headline, 30, false)
	if err != nil {
		return "", "", nil, err
	}
	subline, err = studioText(path+".subline", subline, 48, false)
	if err != nil {
		return "", "", nil, err
	}
	list, err := studioTextList(path+".lines", lines, 8, 80)
	if err != nil {
		return "", "", nil, err
	}
	return headline, subline, list, nil
}

func applyStudioPlanArgs(doc *studioProductDoc, args studioPlanArgs) (*studioChange, error) {
	change := &studioChange{}
	points, err := doc.sellingPoints()
	if err != nil {
		return nil, err
	}
	knownPoint := func(id string) bool {
		for _, point := range points {
			if point.ID == id {
				return true
			}
		}
		return false
	}
	plans, err := doc.plans()
	if err != nil {
		return nil, err
	}
	position := -1
	for index, raw := range plans {
		if studioPlanKind(raw) == args.Kind {
			position = index
			break
		}
	}
	label := map[string]string{"main": "主图套图", "detail": "一键详情页"}[args.Kind]
	var plan map[string]any
	if args.Action == "replace" {
		if position >= 0 {
			_, shots, err := decodeStudioPlan(plans[position])
			if err != nil {
				return nil, err
			}
			for _, shot := range shots {
				if attempts, _ := shot["attempts"].([]any); len(attempts) > 0 {
					return nil, cloudAgentFieldError("action", "plan_has_images", label+"已经出过图，不能整套替换；请用 action=update 改镜头文案，或请用户在页面上重新排方案")
				}
			}
		}
		plan, err = buildStudioPlan(doc, args, knownPoint, change)
		if err != nil {
			return nil, err
		}
		if err := doc.set("activePlan", args.Kind); err != nil {
			return nil, err
		}
	} else {
		if position < 0 {
			return nil, cloudAgentFieldError("kind", "not_found", label+"还没有方案，请先用 action=replace 排一套")
		}
		var shots []map[string]any
		plan, shots, err = decodeStudioPlan(plans[position])
		if err != nil {
			return nil, err
		}
		if err := applyStudioShotUpdates(shots, args.Updates, knownPoint, change); err != nil {
			return nil, err
		}
		if args.TextMode != "" {
			plan["textMode"] = "model"
			change.detail("图上文字：模型整体设计图文")
		}
		plan["shots"] = shots
	}
	encoded, err := json.Marshal(plan)
	if err != nil {
		return nil, err
	}
	if position >= 0 {
		plans[position] = encoded
	} else {
		plans = append(plans, encoded)
	}
	if err := doc.set("plans", plans); err != nil {
		return nil, err
	}
	for field, value := range map[string]string{"platform": args.Platform, "style": args.Style} {
		if value != "" {
			if err := doc.set(field, value); err != nil {
				return nil, err
			}
			change.detail("%s：%s", map[string]string{"platform": "平台", "style": "风格"}[field], value)
		}
	}
	change.field(label)
	return change, nil
}

func buildStudioPlan(doc *studioProductDoc, args studioPlanArgs, knownPoint func(string) bool, change *studioChange) (map[string]any, error) {
	roles, limit := studioMainRoles, 8
	if args.Kind == "detail" {
		roles, limit = studioDetailRoles, 16
	}
	if len(args.Shots) > limit {
		return nil, cloudAgentFieldError("shots", "item_count", fmt.Sprintf("这套方案最多 %d 张", limit))
	}
	family := ""
	if dossier, err := doc.dossier(); err == nil && dossier != nil {
		family = dossier.Family
	}
	textMode := "model"
	shots := make([]any, 0, len(args.Shots))
	for index, input := range args.Shots {
		path := fmt.Sprintf("shots[%d]", index)
		if err := studioEnum(path+".role", input.Role, roles); err != nil {
			return nil, err
		}
		title := studioRoleTitles[input.Role]
		if input.Role == "detail-size" && family == "apparel" {
			title = "尺码参考"
		}
		if strings.TrimSpace(input.Title) != "" {
			value, err := studioText(path+".title", input.Title, 24, false)
			if err != nil {
				return nil, err
			}
			title = value
		}
		ratio := firstNonEmpty(strings.TrimSpace(input.Ratio), map[string]string{"main": "1:1", "detail": "3:4"}[args.Kind])
		if !studioRatioPattern.MatchString(ratio) {
			return nil, cloudAgentFieldError(path+".ratio", "invalid_value", "ratio 写成「宽:高」，如 1:1、3:4")
		}
		headline, subline, lines, err := studioShotCopyFields(path, input.Headline, input.Subline, input.Lines)
		if err != nil {
			return nil, err
		}
		pointIDs, err := studioIDList(path+".sellingPointIds", input.SellingPointIDs, 6, knownPoint)
		if err != nil {
			return nil, err
		}
		id := studioNewID()
		shots = append(shots, map[string]any{"id": id, "role": input.Role, "title": title, "ratio": ratio, "headline": headline, "subline": subline, "lines": lines, "sellingPointIds": pointIDs, "tweaks": []string{}, "attempts": []any{}})
		change.CreatedShotIDs = append(change.CreatedShotIDs, id)
		change.detail("%02d %s（%s）%s", index+1, title, ratio, headline)
		change.check(fmt.Sprintf("第 %d 张文案", index+1), strings.Join(append([]string{headline, subline}, lines...), " "))
	}
	return map[string]any{"id": studioNewID(), "kind": args.Kind, "createdAt": studioNow(), "textMode": textMode, "shots": shots}, nil
}

func applyStudioShotUpdates(shots []map[string]any, updates []studioShotUpdate, knownPoint func(string) bool, change *studioChange) error {
	if len(updates) > 16 {
		return cloudAgentFieldError("updates", "item_count", "一次最多修改 16 张镜头")
	}
	for index, update := range updates {
		path := fmt.Sprintf("updates[%d]", index)
		var shot map[string]any
		for _, candidate := range shots {
			if stringValue(candidate["id"]) == strings.TrimSpace(update.ShotID) {
				shot = candidate
				break
			}
		}
		if shot == nil {
			return cloudAgentFieldError(path+".shotId", "not_found", "shotId 不在这套方案里，请使用 studio_get_state 返回的真实 shotId")
		}
		if update.Title != nil {
			value, err := studioText(path+".title", *update.Title, 24, true)
			if err != nil {
				return err
			}
			shot["title"] = value
		}
		if update.Ratio != nil {
			if attempts, _ := shot["attempts"].([]any); len(attempts) > 0 {
				return cloudAgentFieldError(path+".ratio", "invalid_value", "这张镜头已经出过图，不能再改画幅")
			}
			if !studioRatioPattern.MatchString(*update.Ratio) {
				return cloudAgentFieldError(path+".ratio", "invalid_value", "ratio 写成「宽:高」，如 1:1、3:4")
			}
			shot["ratio"] = *update.Ratio
		}
		headline, subline, lines := stringValue(shot["headline"]), stringValue(shot["subline"]), studioStringList(shot["lines"])
		if update.Headline != nil {
			headline = *update.Headline
		}
		if update.Subline != nil {
			subline = *update.Subline
		}
		if update.Lines != nil {
			lines = *update.Lines
		}
		headline, subline, lines, err := studioShotCopyFields(path, headline, subline, lines)
		if err != nil {
			return err
		}
		shot["headline"], shot["subline"], shot["lines"] = headline, subline, lines
		if update.SellingPointIDs != nil {
			ids, err := studioIDList(path+".sellingPointIds", *update.SellingPointIDs, 6, knownPoint)
			if err != nil {
				return err
			}
			shot["sellingPointIds"] = ids
		}
		if update.Tweaks != nil {
			tweaks, err := studioIDList(path+".tweaks", *update.Tweaks, len(studioTweaks), func(id string) bool { return studioContains(studioTweaks, id) })
			if err != nil {
				return err
			}
			shot["tweaks"] = tweaks
		}
		change.detail("修改 %s：%s", stringValue(shot["title"]), firstNonEmpty(headline, "（无文字）"))
		change.check("「"+stringValue(shot["title"])+"」文案", strings.Join(append([]string{headline, subline}, lines...), " "))
	}
	return nil
}

// ---------- 交给用户确认的出图请求 ----------

type studioGenerationArgs struct {
	Revision *int64   `json:"revision"`
	Kind     string   `json:"kind"`
	ShotIDs  []string `json:"shotIds"`
	Note     string   `json:"note"`
}

func decodeStudioGenerationArgs(raw string) (studioGenerationArgs, error) {
	var args studioGenerationArgs
	if err := decodeCloudAgentJSONObject(raw, &args); err != nil {
		return args, cloudAgentJSONArgumentError(err)
	}
	if _, err := studioRevisionArg(args.Revision); err != nil {
		return args, err
	}
	if err := studioEnum("kind", args.Kind, []string{"main", "detail"}); err != nil {
		return args, err
	}
	if len(args.ShotIDs) == 0 || len(args.ShotIDs) > 16 {
		return args, cloudAgentFieldError("shotIds", "item_count", "shotIds 需要 1 到 16 个镜头")
	}
	return args, nil
}

func applyStudioGenerationRequest(doc *studioProductDoc, args studioGenerationArgs) (*studioChange, *studioGenerationRequest, error) {
	change := &studioChange{}
	photos, err := doc.photos()
	if err != nil {
		return nil, nil, err
	}
	truth := false
	for _, photo := range photos {
		truth = truth || studioPhotoTruth(photo)
	}
	if !truth {
		return nil, nil, BadAuthRequest("这个商品还没有外观依据照片，出图没有商品外观可依；请用户先在生图台上传照片并点亮星标")
	}
	plans, err := doc.plans()
	if err != nil {
		return nil, nil, err
	}
	var shots []map[string]any
	for _, raw := range plans {
		if studioPlanKind(raw) == args.Kind {
			_, shots, err = decodeStudioPlan(raw)
			if err != nil {
				return nil, nil, err
			}
		}
	}
	if shots == nil {
		return nil, nil, cloudAgentFieldError("kind", "not_found", "这套方案还没排，请先用 studio_plan_shots 排方案")
	}
	byID := map[string]map[string]any{}
	for _, shot := range shots {
		byID[stringValue(shot["id"])] = shot
	}
	ids, err := studioIDList("shotIds", args.ShotIDs, 16, func(id string) bool { return byID[id] != nil })
	if err != nil {
		return nil, nil, err
	}
	for _, id := range ids {
		if status, _, _, _ := studioShotStatus(byID[id]); studioAttemptActive(status) {
			return nil, nil, cloudAgentFieldError("shotIds", "invalid_value", "「"+stringValue(byID[id]["title"])+"」正在生成，不要重复请求")
		}
		change.detail("%s", stringValue(byID[id]["title"]))
	}
	note, err := studioText("note", args.Note, 200, false)
	if err != nil {
		return nil, nil, err
	}
	request := &studioGenerationRequest{ID: studioNewID(), Kind: args.Kind, ShotIDs: ids, Note: note, Source: "agent", CreatedAt: studioNow()}
	if err := doc.set("pendingGeneration", request); err != nil {
		return nil, nil, err
	}
	change.field("出图请求")
	return change, request, nil
}
