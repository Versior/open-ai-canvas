package app

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"sort"
	"strings"
	"sync"
	"yingce/backend/internal/model"
)

// EcomGen f8e6e7b52c1ff74a614052728ccb24c2b4c5e7b6; MIT, see ecommerce-catalog/LICENSE.txt.
//
//go:embed ecommerce-catalog/suites.json.gz
var ecommerceCatalogArchive []byte

type ecommerceCatalogDocument struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    struct {
		L1       string   `json:"l1"`
		L2       string   `json:"l2"`
		Leaf     string   `json:"leaf"`
		Keywords []string `json:"leafKeywords"`
	} `json:"category"`
	Style struct {
		Text string `json:"lockText"`
	} `json:"styleLock"`
	Shots []struct {
		Title      string `json:"displayName"`
		Intent     string `json:"intent"`
		Prompt     string `json:"promptTemplate"`
		Camera     string `json:"camera"`
		Lighting   string `json:"lighting"`
		Background string `json:"background"`
		Ratio      string `json:"aspectRatio"`
		Props      string `json:"props"`
		Occupancy  string `json:"productOccupancy"`
		Whitespace string `json:"whitespace"`
		TextZone   string `json:"textZone"`
	} `json:"shots"`
}
type EcommerceCatalogEntry struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Count       int    `json:"count"`
}

// EcommerceCatalogCategory 是一级类目和它在当前搜索词下的模板数。
type EcommerceCatalogCategory struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type EcommerceCatalogPage struct {
	Items []EcommerceCatalogEntry `json:"items"`
	Total int                     `json:"total"`
	// Categories 按搜索词统计，不受 category 筛选影响，供选择器的类目栏显示每类还剩几套。
	Categories []EcommerceCatalogCategory `json:"categories"`
	Page       int                        `json:"page"`
	PageSize   int                        `json:"pageSize"`
}

var ecommerceCatalogOnce sync.Once
var ecommerceCatalogDocs []ecommerceCatalogDocument
var ecommerceCatalogErr error

func loadEcommerceCatalog() ([]ecommerceCatalogDocument, error) {
	ecommerceCatalogOnce.Do(func() {
		reader, err := gzip.NewReader(bytes.NewReader(ecommerceCatalogArchive))
		if err != nil {
			ecommerceCatalogErr = err
			return
		}
		defer reader.Close()
		ecommerceCatalogErr = json.NewDecoder(reader).Decode(&ecommerceCatalogDocs)
	})
	return ecommerceCatalogDocs, ecommerceCatalogErr
}

// allowEcommerceCatalog：套图库与后台模板供生图台「模板套图」使用，按「电商生图台」开关放行；
// 旧画布的总开关和用途开关已没有后台入口，不再参与判断。管理员维护模板时不受开关限制。
func (s *Service) allowEcommerceCatalog(actor *model.User) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	if actor.Role == model.UserRoleAdmin {
		return nil
	}
	return s.RequireFeature(FeatureEcommerceStudio)
}

// EcommerceStudioPrompts 返回后台改过的出图提示词，生图台出图时替换内置写法；没改过时为空表。
func (s *Service) EcommerceStudioPrompts(actor *model.User) (map[string]string, error) {
	if err := s.allowEcommerceCatalog(actor); err != nil {
		return nil, err
	}
	_, setting, err := s.readEcommerceSetting()
	if err != nil {
		return nil, err
	}
	if setting.StudioPrompts == nil {
		return map[string]string{}, nil
	}
	return setting.StudioPrompts, nil
}

// EcommerceStudioTemplates 返回后台已启用的套图模板，供生图台选择；停用的草稿不对用户可见。
func (s *Service) EcommerceStudioTemplates(actor *model.User) ([]EcommerceSuiteTemplate, error) {
	if err := s.allowEcommerceCatalog(actor); err != nil {
		return nil, err
	}
	_, setting, err := s.readEcommerceSetting()
	if err != nil {
		return nil, err
	}
	templates := []EcommerceSuiteTemplate{}
	for _, item := range setting.Templates {
		if item.Enabled {
			templates = append(templates, item)
		}
	}
	return templates, nil
}

// EcommerceCatalog 搜索内置套图库。category 为空时不按类目筛选，否则只取这个一级类目；
// 类目计数只看搜索词，切换类目时类目栏的数字不变。
func (s *Service) EcommerceCatalog(actor *model.User, query, category string, page, pageSize int) (*EcommerceCatalogPage, error) {
	if err := s.allowEcommerceCatalog(actor); err != nil {
		return nil, err
	}
	if page < 1 || pageSize < 1 || pageSize > 50 || len([]rune(query)) > 100 || len([]rune(category)) > 50 {
		return nil, BadAuthRequest("模板查询参数无效")
	}
	docs, err := loadEcommerceCatalog()
	if err != nil {
		return nil, err
	}
	result := &EcommerceCatalogPage{Items: []EcommerceCatalogEntry{}, Categories: []EcommerceCatalogCategory{}, Page: page, PageSize: pageSize}
	terms := strings.Fields(strings.ToLower(query))
	counts := map[string]int{}
	for _, doc := range docs {
		path := strings.Join([]string{doc.Category.L1, doc.Category.L2, doc.Category.Leaf}, " / ")
		text := strings.ToLower(doc.Name + " " + path + " " + doc.Description + " " + strings.Join(doc.Category.Keywords, " "))
		match := true
		for _, term := range terms {
			if !strings.Contains(text, term) {
				match = false
				break
			}
		}
		if !match {
			continue
		}
		if counts[doc.Category.L1] == 0 {
			result.Categories = append(result.Categories, EcommerceCatalogCategory{Name: doc.Category.L1})
		}
		counts[doc.Category.L1]++
		if category != "" && doc.Category.L1 != category {
			continue
		}
		index := result.Total
		result.Total++
		if index/pageSize == page-1 {
			result.Items = append(result.Items, EcommerceCatalogEntry{doc.ID, doc.Name, path, doc.Description, len(doc.Shots)})
		}
	}
	for index := range result.Categories {
		result.Categories[index].Count = counts[result.Categories[index].Name]
	}
	// 多的排前面；同样多时保持库里的先后，翻页和刷新时顺序稳定。
	sort.SliceStable(result.Categories, func(i, j int) bool { return result.Categories[i].Count > result.Categories[j].Count })
	return result, nil
}
func (s *Service) EcommerceCatalogTemplate(actor *model.User, id string) (*EcommerceSuiteTemplate, error) {
	if err := s.allowEcommerceCatalog(actor); err != nil {
		return nil, err
	}
	docs, err := loadEcommerceCatalog()
	if err != nil {
		return nil, err
	}
	for _, doc := range docs {
		if doc.ID == id {
			value := &EcommerceSuiteTemplate{ID: doc.ID, Name: doc.Name, Flow: "detail", Category: strings.Join([]string{doc.Category.L1, doc.Category.L2, doc.Category.Leaf}, " / "), Enabled: true, Style: doc.Style.Text, Source: "EcomGen 内置套图库 · f8e6e7b · MIT", Shots: []EcommerceTemplateShot{}}
			for _, shot := range doc.Shots {
				value.Shots = append(value.Shots, EcommerceTemplateShot{Title: shot.Title, Duty: strings.Join([]string{shot.Intent, "镜头：" + shot.Camera, "布光：" + shot.Lighting, "背景：" + shot.Background, "道具：" + shot.Props, "主体占比：" + shot.Occupancy, "留白：" + shot.Whitespace, "文字位置：" + shot.TextZone, "画幅：" + shot.Ratio, "画面参考（须按当前商品事实改写，不可照搬属性）：" + shot.Prompt}, "\n")})
			}
			return value, nil
		}
	}
	return nil, NotFound("内置模板不存在")
}
