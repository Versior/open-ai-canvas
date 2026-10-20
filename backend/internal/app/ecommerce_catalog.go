package app

import (
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
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
type EcommerceCatalogPage struct {
	Items    []EcommerceCatalogEntry `json:"items"`
	Total    int                     `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
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
func (s *Service) allowEcommerceCatalog(actor *model.User) error {
	if actor == nil {
		return Unauthorized("请先登录")
	}
	if actor.Role == model.UserRoleAdmin {
		return nil
	}
	_, setting, err := s.readEcommerceSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || !setting.Flows["detail"].Enabled {
		return Forbidden("管理员已停用电商套图")
	}
	return nil
}
func (s *Service) EcommerceCatalog(actor *model.User, query string, page, pageSize int) (*EcommerceCatalogPage, error) {
	if err := s.allowEcommerceCatalog(actor); err != nil {
		return nil, err
	}
	if page < 1 || pageSize < 1 || pageSize > 50 || len([]rune(query)) > 100 {
		return nil, BadAuthRequest("模板查询参数无效")
	}
	docs, err := loadEcommerceCatalog()
	if err != nil {
		return nil, err
	}
	result := &EcommerceCatalogPage{Items: []EcommerceCatalogEntry{}, Page: page, PageSize: pageSize}
	terms := strings.Fields(strings.ToLower(query))
	for _, doc := range docs {
		category := strings.Join([]string{doc.Category.L1, doc.Category.L2, doc.Category.Leaf}, " / ")
		text := strings.ToLower(doc.Name + " " + category + " " + doc.Description + " " + strings.Join(doc.Category.Keywords, " "))
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
		index := result.Total
		result.Total++
		if index/pageSize == page-1 {
			result.Items = append(result.Items, EcommerceCatalogEntry{doc.ID, doc.Name, category, doc.Description, len(doc.Shots)})
		}
	}
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
