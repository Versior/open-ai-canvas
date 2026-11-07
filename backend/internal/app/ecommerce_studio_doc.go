package app

import (
	"bytes"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	"yingce/backend/internal/repository"
)

// 生图台商品文档。字段结构由前端 web/src/lib/ecommerce-studio/types.ts 定义；
// Agent 只改档案、卖点、文案、方案镜头和待确认的出图请求，其余字段（照片、出图记录、
// 采用结果等）按原始 JSON 保留，没被改动的方案逐字节不变。

var (
	studioEvidenceLevels = []string{"visible", "inferred", "pending", "confirmed"}
	studioFactGroups     = []string{"identity", "appearance", "material", "structure", "text", "spec", "usage", "package"}
	studioFamilies       = []string{"apparel", "bags-shoes", "jewelry", "beauty", "food", "electronics", "home", "baby-toys", "generic"}
	studioPlatforms      = []string{"taobao", "jd", "pdd", "douyin", "xiaohongshu", "amazon", "walmart", "etsy", "tiktokshop", "shopify"}
	studioStyles         = []string{"mist", "warm", "noir", "fresh", "vivid"}
	studioTweaks         = []string{"brighter", "warmer", "cooler", "bigger", "cleaner", "angle", "softer", "dramatic"}
	studioMainRoles      = []string{"main-white", "main-selling", "main-scene", "main-detail", "main-angle"}
	studioDetailRoles    = []string{"detail-hero", "detail-selling", "detail-model", "detail-scene", "detail-material", "detail-closeup", "detail-angles", "detail-spec", "detail-size", "detail-package", "detail-closing"}
	studioRoleTitles     = map[string]string{
		"main-white": "白底主图", "main-selling": "卖点主图", "main-scene": "场景主图", "main-detail": "细节特写", "main-angle": "多角度",
		"detail-hero": "头图海报", "detail-selling": "核心卖点", "detail-model": "上身效果", "detail-scene": "使用场景", "detail-material": "材质工艺",
		"detail-closeup": "细节特写", "detail-angles": "多角度展示", "detail-spec": "规格参数", "detail-size": "尺寸参考", "detail-package": "包装与配件", "detail-closing": "购买理由",
	}
	studioViewLabels = map[string]string{"front": "正面", "side": "侧面", "back": "背面", "detail": "细节", "tag": "吊牌", "package": "包装", "scene": "场景", "other": "其他"}
)

type studioFact struct {
	ID       string `json:"id"`
	Group    string `json:"group"`
	Label    string `json:"label"`
	Value    string `json:"value"`
	Evidence string `json:"evidence"`
	Source   string `json:"source,omitempty"`
}

type studioDossierDoc struct {
	Name           string       `json:"name"`
	Category       string       `json:"category"`
	Family         string       `json:"family"`
	Summary        string       `json:"summary"`
	Facts          []studioFact `json:"facts"`
	Invariants     []string     `json:"invariants"`
	Questions      []string     `json:"questions"`
	RecognizedAt   string       `json:"recognizedAt,omitempty"`
	RecognizedWith string       `json:"recognizedWith,omitempty"`
}

type studioSellingPoint struct {
	ID       string   `json:"id"`
	Title    string   `json:"title"`
	Detail   string   `json:"detail"`
	Evidence string   `json:"evidence"`
	FactIDs  []string `json:"factIds"`
	Enabled  bool     `json:"enabled"`
}

type studioCopyDoc struct {
	Headline     string   `json:"headline"`
	Subhead      string   `json:"subhead"`
	ListingTitle string   `json:"listingTitle"`
	Bullets      []string `json:"bullets"`
}

type studioPhotoDoc struct {
	ID         string `json:"id"`
	ResourceID string `json:"resourceId"`
	View       string `json:"view"`
	Truth      *bool  `json:"truth"`
	Name       string `json:"name"`
}

// studioGenerationRequest 是 Agent 交给页面的出图请求；只有用户在生图台确认后才会提交任务。
type studioGenerationRequest struct {
	ID        string   `json:"id"`
	Kind      string   `json:"kind"`
	ShotIDs   []string `json:"shotIds"`
	Note      string   `json:"note,omitempty"`
	Source    string   `json:"source"`
	CreatedAt string   `json:"createdAt"`
}

type studioProductDoc struct {
	fields map[string]json.RawMessage
}

func decodeStudioProductDoc(raw json.RawMessage) (*studioProductDoc, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return nil, BadAuthRequest("生图台商品数据无法识别")
	}
	return &studioProductDoc{fields: fields}, nil
}

func (d *studioProductDoc) get(key string, target any) error {
	raw, ok := d.fields[key]
	if !ok || bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		return nil
	}
	if err := json.Unmarshal(raw, target); err != nil {
		return BadAuthRequest("生图台商品字段 " + key + " 无法识别，请在页面上重新保存这个商品")
	}
	return nil
}

func (d *studioProductDoc) set(key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	d.fields[key] = raw
	return nil
}

func (d *studioProductDoc) str(key string) string {
	var value string
	if json.Unmarshal(d.fields[key], &value) != nil {
		return ""
	}
	return value
}

func (d *studioProductDoc) revision() int64 {
	var value int64
	if json.Unmarshal(d.fields["revision"], &value) != nil || value < 0 {
		return 0
	}
	return value
}

func (d *studioProductDoc) dossier() (*studioDossierDoc, error) {
	if _, ok := d.fields["dossier"]; !ok {
		return nil, nil
	}
	var dossier *studioDossierDoc
	if err := d.get("dossier", &dossier); err != nil {
		return nil, err
	}
	return dossier, nil
}

func (d *studioProductDoc) sellingPoints() ([]studioSellingPoint, error) {
	points := []studioSellingPoint{}
	if err := d.get("sellingPoints", &points); err != nil {
		return nil, err
	}
	return points, nil
}

func (d *studioProductDoc) copyDoc() (*studioCopyDoc, error) {
	var copyDoc *studioCopyDoc
	if err := d.get("copy", &copyDoc); err != nil {
		return nil, err
	}
	return copyDoc, nil
}

func (d *studioProductDoc) photos() ([]studioPhotoDoc, error) {
	photos := []studioPhotoDoc{}
	if err := d.get("photos", &photos); err != nil {
		return nil, err
	}
	return photos, nil
}

func (d *studioProductDoc) plans() ([]json.RawMessage, error) {
	plans := []json.RawMessage{}
	if err := d.get("plans", &plans); err != nil {
		return nil, err
	}
	return plans, nil
}

func (d *studioProductDoc) pendingGeneration() (*studioGenerationRequest, error) {
	var request *studioGenerationRequest
	if err := d.get("pendingGeneration", &request); err != nil {
		return nil, err
	}
	return request, nil
}

// studioPlanKind 只读出方案的种类，避免为了定位方案而改写其余方案的 JSON。
func studioPlanKind(raw json.RawMessage) string {
	var header struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &header) != nil {
		return ""
	}
	return header.Kind
}

func decodeStudioPlan(raw json.RawMessage) (map[string]any, []map[string]any, error) {
	var plan map[string]any
	if err := json.Unmarshal(raw, &plan); err != nil || plan == nil {
		return nil, nil, BadAuthRequest("生图台方案数据无法识别")
	}
	shots := []map[string]any{}
	if items, ok := plan["shots"].([]any); ok {
		for _, item := range items {
			if shot, ok := item.(map[string]any); ok {
				shots = append(shots, shot)
			}
		}
	}
	return plan, shots, nil
}

func loadStudioProductDoc(repo *repository.Repository, userID, productID string) (*studioProductDoc, error) {
	row, err := repo.EcommerceLibrary(userID)
	if err != nil {
		return nil, err
	}
	_, document, err := decodeEcommerceStudioPayload(row)
	if err != nil {
		return nil, err
	}
	index, _ := ecommerceStudioFindProduct(document.Products, productID)
	if index < 0 {
		return nil, NotFound("生图台商品不存在或已被删除")
	}
	return decodeStudioProductDoc(document.Products[index])
}

// mutateStudioProductDoc 改写一个商品并把它的 revision 加一。调用方必须已持有 storageMu
// （Agent 检查点事务外层已持有）；expected 是模型最近一次读到的 revision，不一致即拒绝。
func mutateStudioProductDoc(repo *repository.Repository, userID, productID string, expected int64, mutate func(*studioProductDoc) error) (*studioProductDoc, error) {
	var result *studioProductDoc
	_, err := applyEcommerceStudioMutation(repo, userID, func(products []json.RawMessage) ([]json.RawMessage, error) {
		index, stored := ecommerceStudioFindProduct(products, productID)
		if index < 0 {
			return nil, NotFound("生图台商品不存在或已被删除")
		}
		if stored != expected {
			return nil, studioStaleRevision(stored)
		}
		doc, err := decodeStudioProductDoc(products[index])
		if err != nil {
			return nil, err
		}
		if err := mutate(doc); err != nil {
			return nil, err
		}
		if err := doc.set("updatedAt", studioNow()); err != nil {
			return nil, err
		}
		encoded, err := encodeEcommerceStudioProduct(doc.fields, stored+1)
		if err != nil {
			return nil, err
		}
		if bytes.Contains(encoded, []byte(`"data:`)) {
			return nil, BadAuthRequest("商品数据不能内嵌图片")
		}
		products[index] = encoded
		result = doc
		return products, nil
	})
	if errors.Is(err, repository.ErrEcommerceLibraryConflict) {
		return nil, studioStaleRevision(-1)
	}
	return result, err
}

func studioStaleRevision(current int64) error {
	message := "商品已在页面上被修改，请先用 studio_get_state 重新读取，再用新的 revision 写入"
	if current >= 0 {
		message = fmt.Sprintf("商品已在页面上被修改（当前 revision %d），请先用 studio_get_state 重新读取，再用新的 revision 写入", current)
	}
	return cloudAgentFieldError("revision", "stale_snapshot", message)
}

// studioNow 与浏览器 toISOString 同格式，商品墙按 updatedAt 字符串排序。
func studioNow() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

const studioIDAlphabet = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"

func studioNewID() string {
	var builder strings.Builder
	limit := big.NewInt(int64(len(studioIDAlphabet)))
	for builder.Len() < 10 {
		index, err := rand.Int(rand.Reader, limit)
		if err != nil {
			return fmt.Sprintf("%010d", time.Now().UnixNano()%10000000000)
		}
		builder.WriteByte(studioIDAlphabet[index.Int64()])
	}
	return builder.String()
}

func studioUsableEvidence(evidence string) bool {
	return evidence == "visible" || evidence == "confirmed"
}

func studioContains(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

// studioShotStatus 汇总一张镜头卡的出图状态：最近一次尝试的状态、是否已有可用成品、候选数。
func studioShotStatus(shot map[string]any) (status string, ready bool, candidates int, taskID string) {
	status = "idle"
	if _, ok := shot["adopted"].(map[string]any); ok {
		ready = true
	}
	attempts, _ := shot["attempts"].([]any)
	for index, item := range attempts {
		attempt, _ := item.(map[string]any)
		if attempt == nil {
			continue
		}
		if outputs, ok := attempt["outputs"].([]any); ok && stringValue(attempt["status"]) == "succeeded" {
			candidates += len(outputs)
			if len(outputs) > 0 {
				ready = true
			}
		}
		if index == len(attempts)-1 {
			status = firstNonEmpty(stringValue(attempt["status"]), "idle")
			taskID = stringValue(attempt["taskId"])
		}
	}
	return status, ready, candidates, taskID
}

func studioAttemptActive(status string) bool {
	return status == "submitting" || status == "queued" || status == "running"
}

func studioStringList(value any) []string {
	items, _ := value.([]any)
	result := make([]string, 0, len(items))
	for _, item := range items {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

type studioFormPlanView struct {
	Summary          string `json:"summary"`
	RequestedScreens *int   `json:"requestedScreens,omitempty"`
	Screens          []struct {
		Title       string   `json:"title"`
		Role        string   `json:"role"`
		Visual      string   `json:"visual"`
		Composition string   `json:"composition,omitempty"`
		Headline    string   `json:"headline"`
		Subline     string   `json:"subline"`
		Lines       []string `json:"lines"`
	} `json:"screens"`
}

// 显式投影表单字段，不能把模特资源、参考图地址或历史任务正文带进模型上下文。
func studioFormView(doc *studioProductDoc) (map[string]any, error) {
	var brief struct {
		OutputType    string              `json:"outputType"`
		DetailScreens *int                `json:"detailScreens"`
		Count         *int                `json:"count"`
		Mix           []string            `json:"mix"`
		Language      string              `json:"language"`
		Market        string              `json:"market"`
		Extra         string              `json:"extra"`
		PlanNote      string              `json:"planNote"`
		DetailPlan    *studioFormPlanView `json:"detailPlan"`
		MainPlan      *studioFormPlanView `json:"mainPlan"`
		SinglePlan    *studioFormPlanView `json:"singlePlan"`
		TemplatePlan  *studioFormPlanView `json:"templatePlan"`
	}
	if err := doc.get("brief", &brief); err != nil {
		return nil, err
	}
	plan := brief.SinglePlan
	switch brief.OutputType {
	case "detail-set":
		plan = brief.DetailPlan
	case "main-set":
		plan = brief.MainPlan
	case "template-set":
		plan = brief.TemplatePlan
	}
	return map[string]any{"outputType": brief.OutputType, "detailScreens": brief.DetailScreens, "count": brief.Count, "mix": brief.Mix,
		"language": brief.Language, "market": brief.Market, "extra": truncateRunes(brief.Extra, 600), "planNote": truncateRunes(brief.PlanNote, 1000), "savedFormPlan": plan,
		"note": "当前出图类型与详情屏数以表单为准；activePlan 和 plans 是助手方案，不能替代当前表单选择。savedFormPlan 是已保存的表单策划，屏数或类型变化后须重新策划。"}, nil
}

// studioStateView 只返回商品事实、表单策划与助手镜头状态，不含资源地址或历史任务正文。
func studioStateView(productID string, doc *studioProductDoc) (map[string]any, error) {
	photos, err := doc.photos()
	if err != nil {
		return nil, err
	}
	dossier, err := doc.dossier()
	if err != nil {
		return nil, err
	}
	points, err := doc.sellingPoints()
	if err != nil {
		return nil, err
	}
	copyDoc, err := doc.copyDoc()
	if err != nil {
		return nil, err
	}
	plans, err := doc.plans()
	if err != nil {
		return nil, err
	}
	pending, err := doc.pendingGeneration()
	if err != nil {
		return nil, err
	}
	photoViews := make([]map[string]any, 0, len(photos))
	for _, photo := range photos {
		photoViews = append(photoViews, map[string]any{"photoId": photo.ID, "view": photo.View, "truth": studioPhotoTruth(photo), "name": truncateRunes(photo.Name, 60)})
	}
	view := map[string]any{
		"productId": productID, "revision": doc.revision(), "name": doc.str("name"), "platform": doc.str("platform"), "style": doc.str("style"),
		"step": doc.str("step"), "activePlan": doc.str("activePlan"), "sellerNotes": truncateRunes(doc.str("sellerNotes"), 600),
		"photos": photoViews, "dossier": nil, "sellingPoints": []map[string]any{}, "copy": copyDoc, "plans": []map[string]any{}, "pendingGeneration": pending,
	}
	if dossier != nil {
		facts := make([]map[string]any, 0, len(dossier.Facts))
		for _, fact := range dossier.Facts {
			facts = append(facts, map[string]any{"factId": fact.ID, "group": fact.Group, "label": fact.Label, "value": fact.Value, "evidence": fact.Evidence, "source": fact.Source})
		}
		view["dossier"] = map[string]any{"name": dossier.Name, "category": dossier.Category, "family": dossier.Family, "summary": dossier.Summary, "facts": facts, "invariants": dossier.Invariants, "questions": dossier.Questions}
	}
	pointViews := make([]map[string]any, 0, len(points))
	for _, point := range points {
		pointViews = append(pointViews, map[string]any{"pointId": point.ID, "title": point.Title, "detail": point.Detail, "evidence": point.Evidence, "enabled": point.Enabled, "factIds": point.FactIDs})
	}
	view["sellingPoints"] = pointViews
	planViews := make([]map[string]any, 0, len(plans))
	for _, raw := range plans {
		plan, shots, err := decodeStudioPlan(raw)
		if err != nil {
			return nil, err
		}
		shotViews := make([]map[string]any, 0, len(shots))
		for _, shot := range shots {
			status, ready, candidates, taskID := studioShotStatus(shot)
			_, adopted := shot["adopted"].(map[string]any)
			shotViews = append(shotViews, map[string]any{
				"shotId": stringValue(shot["id"]), "role": stringValue(shot["role"]), "title": stringValue(shot["title"]), "ratio": stringValue(shot["ratio"]),
				"headline": stringValue(shot["headline"]), "subline": stringValue(shot["subline"]), "lines": studioStringList(shot["lines"]),
				"sellingPointIds": studioStringList(shot["sellingPointIds"]), "tweaks": studioStringList(shot["tweaks"]),
				"status": status, "imageReady": ready, "adopted": adopted, "candidates": candidates, "taskId": taskID,
			})
		}
		planViews = append(planViews, map[string]any{"kind": stringValue(plan["kind"]), "textMode": stringValue(plan["textMode"]), "shots": shotViews})
	}
	view["plans"] = planViews
	form, err := studioFormView(doc)
	if err != nil {
		return nil, err
	}
	view["form"] = form
	return view, nil
}

func studioPhotoTruth(photo studioPhotoDoc) bool {
	return photo.View != "tag" && (photo.Truth == nil || *photo.Truth)
}

// studioContextSummary 是建 run 时注入的商品概况：足够定位与判断下一步，细节由 studio_get_state 读取。
func studioContextSummary(productID string, doc *studioProductDoc) (map[string]any, error) {
	photos, err := doc.photos()
	if err != nil {
		return nil, err
	}
	dossier, err := doc.dossier()
	if err != nil {
		return nil, err
	}
	points, err := doc.sellingPoints()
	if err != nil {
		return nil, err
	}
	copyDoc, err := doc.copyDoc()
	if err != nil {
		return nil, err
	}
	pending, err := doc.pendingGeneration()
	if err != nil {
		return nil, err
	}
	rawPlans, err := doc.plans()
	if err != nil {
		return nil, err
	}
	truth := 0
	for _, photo := range photos {
		if studioPhotoTruth(photo) {
			truth++
		}
	}
	summary := map[string]any{
		"source": "server_snapshot", "productId": productID, "revision": doc.revision(), "name": doc.str("name"), "platform": doc.str("platform"), "style": doc.str("style"),
		"photos": len(photos), "truthPhotos": truth, "dossier": nil, "sellingPoints": len(points), "hasCopy": copyDoc != nil, "pendingGeneration": pending != nil,
		"note": "需要商品事实时先用 studio_get_state 读取完整状态和 revision；写入工具必须传最新 revision。排镜头前先用 skill_read_file 读内置技能「电商出图方法库」（skillId ecommerce-studio-method）的 SKILL.md 与 cards/shot-roles.md；镜头角色只能用 studio_plan_shots 声明里的值，不要按其他技能自造角色名。",
	}
	if dossier != nil {
		unconfirmed := 0
		for _, fact := range dossier.Facts {
			if !studioUsableEvidence(fact.Evidence) {
				unconfirmed++
			}
		}
		summary["dossier"] = map[string]any{"category": dossier.Category, "family": dossier.Family, "facts": len(dossier.Facts), "unconfirmedFacts": unconfirmed}
	}
	plans := make([]map[string]any, 0, len(rawPlans))
	for _, raw := range rawPlans {
		plan, shots, err := decodeStudioPlan(raw)
		if err != nil {
			return nil, err
		}
		ready := 0
		for _, shot := range shots {
			if _, imageReady, _, _ := studioShotStatus(shot); imageReady {
				ready++
			}
		}
		plans = append(plans, map[string]any{"kind": stringValue(plan["kind"]), "shots": len(shots), "imageReady": ready})
	}
	summary["plans"] = plans
	form, err := studioFormView(doc)
	if err != nil {
		return nil, err
	}
	if plan, ok := form["savedFormPlan"].(*studioFormPlanView); ok && plan != nil {
		form["savedFormPlan"] = map[string]any{"summary": plan.Summary, "screens": len(plan.Screens), "requestedScreens": plan.RequestedScreens}
	}
	summary["form"] = form
	return summary, nil
}
