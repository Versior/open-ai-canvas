package packaging

import (
	"errors"
	"math"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"
)

type Parameters struct {
	Length       float64 `json:"length"`
	Width        float64 `json:"width"`
	Height       float64 `json:"height"`
	Thickness    float64 `json:"thickness"`
	Bleed        float64 `json:"bleed"`
	Glue         float64 `json:"glue"`
	Tab          float64 `json:"tab"`
	Gap          float64 `json:"gap"`
	FrontHeight  float64 `json:"frontHeight"`
	WindowWidth  float64 `json:"windowWidth"`
	WindowHeight float64 `json:"windowHeight"`
	Inflation    float64 `json:"inflation"`
	SpoutRadius  float64 `json:"spoutRadius"`
}

type Template struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Category    string     `json:"category"`
	Structure   string     `json:"structure"`
	Description string     `json:"description"`
	Enabled     bool       `json:"enabled"`
	Defaults    Parameters `json:"defaults"`
}

type Material struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Color       string  `json:"color"`
	InsideColor string  `json:"insideColor"`
	Thickness   float64 `json:"thickness"`
	Roughness   float64 `json:"roughness"`
	Metalness   float64 `json:"metalness"`
	Enabled     bool    `json:"enabled"`
}

type Catalog struct {
	Revision      int64      `json:"revision"`
	Enabled       bool       `json:"enabled"`
	MockupEnabled bool       `json:"mockupEnabled"`
	MaxProjects   int        `json:"maxProjects"`
	Templates     []Template `json:"templates"`
	Materials     []Material `json:"materials"`
}

type Artwork struct {
	ID         string        `json:"id"`
	ResourceID string        `json:"resourceId"`
	Name       string        `json:"name"`
	PanelID    string        `json:"panelId"`
	Role       string        `json:"role"`
	X          float64       `json:"x"`
	Y          float64       `json:"y"`
	Width      float64       `json:"width"`
	Height     float64       `json:"height"`
	Rotation   float64       `json:"rotation"`
	Opacity    float64       `json:"opacity"`
	Content    *LayerContent `json:"content,omitempty"`
	Visible    *bool         `json:"visible,omitempty"`
	Locked     bool          `json:"locked,omitempty"`
}

type LayerContent struct {
	Kind          string   `json:"kind"`
	Value         string   `json:"value"`
	Font          string   `json:"font,omitempty"`
	Weight        int      `json:"weight,omitempty"`
	Align         string   `json:"align,omitempty"`
	Shape         string   `json:"shape,omitempty"`
	Color         string   `json:"color"`
	FontSize      *float64 `json:"fontSize,omitempty"`
	LineHeight    *float64 `json:"lineHeight,omitempty"`
	LetterSpacing *float64 `json:"letterSpacing,omitempty"`
	Wrap          *bool    `json:"wrap,omitempty"`
}

type Surface struct {
	Paper       string  `json:"paper"`
	Film        string  `json:"film"`
	Studio      string  `json:"studio"`
	Inspection  string  `json:"inspection"`
	Quality     int     `json:"quality"`
	Depth       float64 `json:"depth"`
	FoilColor   string  `json:"foilColor"`
	SilverColor string  `json:"silverColor"`
}

type View struct {
	Fold       float64 `json:"fold"`
	Open       float64 `json:"open"`
	Layout     string  `json:"layout"`
	Background string  `json:"background"`
	Projection string  `json:"projection"`
	Finish     string  `json:"finish"`
	Light      float64 `json:"light"`
	Shadows    bool    `json:"shadows"`
	Dimensions bool    `json:"dimensions"`
}

type Document struct {
	Version    int        `json:"version"`
	Template   Template   `json:"template"`
	Parameters Parameters `json:"parameters"`
	Material   Material   `json:"material"`
	Artworks   []Artwork  `json:"artworks"`
	View       View       `json:"view"`
	Surface    *Surface   `json:"surface,omitempty"`
	Notes      string     `json:"notes"`
}

var Structures = []string{"tuck", "reverse-tuck", "mailer", "tray", "display", "lid-base", "drawer", "book", "double-door", "pillow", "pouch", "spout-pouch"}
var Roles = []string{"artwork", "foil", "silver", "uv", "gloss", "emboss", "deboss", "holo"}
var identifier = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)
var color = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validNumber(value, min, max float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= min && value <= max
}

func ValidateParameters(p Parameters) error {
	for _, value := range []float64{p.Length, p.Width, p.Height} {
		if !validNumber(value, 10, 1000) {
			return errors.New("长、宽、高必须为 10–1000 毫米")
		}
	}
	if !validNumber(p.Thickness, 0.05, math.Min(10, math.Min(p.Length, math.Min(p.Width, p.Height))/5)) || !validNumber(p.Bleed, 0, 20) || !validNumber(p.Glue, 2, math.Min(80, math.Min(p.Length, p.Width))) || !validNumber(p.Tab, 2, math.Min(100, math.Min(p.Length, p.Width))) || !validNumber(p.Gap, 0.1, 10) || !validNumber(p.FrontHeight, 5, p.Height) || !validNumber(p.Inflation, 0, 1) || !validNumber(p.SpoutRadius, 0, math.Min(p.Length, p.Width)/4) {
		return errors.New("纸厚、粘口、插舌、间隙、展示高度或袋体参数超出有效范围")
	}
	if !validNumber(p.WindowWidth, 0, p.Length-4) || !validNumber(p.WindowHeight, 0, p.Height-4) || (p.WindowWidth == 0) != (p.WindowHeight == 0) {
		return errors.New("开窗宽高应同时填写，且距面板边缘至少 2 毫米")
	}
	if 2*(p.Length+p.Width)+p.Glue+2*p.Bleed > 4000 || p.Height+2*(p.Width+p.Tab)+2*p.Bleed > 4000 {
		return errors.New("刀版展开尺寸不能超过 4 米")
	}
	return nil
}

func ValidateTemplate(t Template) error {
	if !identifier.MatchString(t.ID) || !slices.Contains(Structures, t.Structure) || strings.TrimSpace(t.Name) == "" || utf8.RuneCountInString(t.Name) > 80 || utf8.RuneCountInString(t.Description) > 800 || !slices.Contains([]string{"折叠纸盒", "礼盒", "托盘展示", "软包装"}, t.Category) {
		return errors.New("盒型名称、分类或结构标识无效")
	}
	return ValidateParameters(t.Defaults)
}

func ValidateMaterial(m Material) error {
	if !identifier.MatchString(m.ID) || strings.TrimSpace(m.Name) == "" || utf8.RuneCountInString(m.Name) > 80 || !color.MatchString(m.Color) || !color.MatchString(m.InsideColor) || !validNumber(m.Thickness, 0.05, 10) || !validNumber(m.Roughness, 0, 1) || !validNumber(m.Metalness, 0, 1) {
		return errors.New("材料名称、颜色、厚度或表面参数无效")
	}
	return nil
}

func ValidateCatalog(c Catalog) error {
	if c.MaxProjects < 1 || c.MaxProjects > 500 || len(c.Templates) < 1 || len(c.Templates) > 100 || len(c.Materials) < 1 || len(c.Materials) > 50 {
		return errors.New("项目配额、盒型或材料数量超出范围")
	}
	ids := map[string]bool{}
	for _, t := range c.Templates {
		if err := ValidateTemplate(t); err != nil {
			return err
		}
		if ids[t.ID] {
			return errors.New("盒型标识不能重复")
		}
		ids[t.ID] = true
	}
	ids = map[string]bool{}
	for _, m := range c.Materials {
		if err := ValidateMaterial(m); err != nil {
			return err
		}
		if ids[m.ID] {
			return errors.New("材料标识不能重复")
		}
		ids[m.ID] = true
	}
	return nil
}

func ValidateDocument(d Document) error {
	if d.Version != 1 || len(d.Artworks) > 40 || utf8.RuneCountInString(d.Notes) > 4000 {
		return errors.New("包装方案版本、图稿数量或备注无效")
	}
	if err := ValidateTemplate(d.Template); err != nil {
		return err
	}
	if err := ValidateParameters(d.Parameters); err != nil {
		return err
	}
	if err := ValidateMaterial(d.Material); err != nil {
		return err
	}
	if d.Parameters.WindowWidth > 0 {
		p := d.Parameters
		if slices.Contains([]string{"pouch", "spout-pouch", "pillow"}, d.Template.Structure) {
			return errors.New("软包装曲面暂不支持实体开窗")
		}
		height := p.Height - p.Thickness
		if d.Template.Structure == "display" {
			height = p.FrontHeight - p.Thickness/2
		}
		if p.WindowWidth >= p.Length-p.Thickness-4 || p.WindowHeight >= height-4 {
			return errors.New("当前正面容不下开窗，请缩小开窗")
		}
	}
	if !validNumber(d.View.Fold, 0, 1) || !validNumber(d.View.Open, 0, 1) || !validNumber(d.View.Light, 0.2, 5) || !slices.Contains([]string{"split", "dieline", "model"}, d.View.Layout) || !slices.Contains([]string{"transparent", "light", "dark"}, d.View.Background) || !slices.Contains([]string{"perspective", "orthographic"}, d.View.Projection) || !slices.Contains([]string{"paper", "matte", "gloss", "foil", "emboss"}, d.View.Finish) {
		return errors.New("预览设置无效")
	}
	ids := map[string]bool{}
	if s := d.Surface; s != nil {
		if !slices.Contains([]string{"smooth", "kraft", "linen"}, s.Paper) || !slices.Contains([]string{"none", "matte", "gloss", "soft"}, s.Film) || !slices.Contains([]string{"neutral", "commerce", "warm", "dramatic"}, s.Studio) || (!slices.Contains(Roles, s.Inspection) && s.Inspection != "checker") || !slices.Contains([]int{1024, 2048, 4096}, s.Quality) || !validNumber(s.Depth, 0.05, 1) || !color.MatchString(s.FoilColor) || !color.MatchString(s.SilverColor) {
			return errors.New("包装材质或检查模式无效")
		}
	}
	for _, a := range d.Artworks {
		if !identifier.MatchString(a.ID) || ids[a.ID] || (a.PanelID != "" && !slices.Contains(PanelIDs(d.Template.Structure), a.PanelID)) || utf8.RuneCountInString(a.Name) > 200 || !slices.Contains(Roles, a.Role) || !validNumber(a.Width, 0.1, 8000) || !validNumber(a.Height, 0.1, 8000) || !validNumber(a.X, -8000, 8000) || !validNumber(a.Y, -8000, 8000) || !validNumber(a.Rotation, -360, 360) || !validNumber(a.Opacity, 0, 1) {
			return errors.New("图稿引用、位置或工艺层参数无效")
		}
		if a.Content == nil {
			if !identifier.MatchString(a.ResourceID) {
				return errors.New("图片资源标识无效")
			}
		}
		if c := a.Content; c != nil {
			if a.ResourceID != "" || !color.MatchString(c.Color) || (c.Kind != "text" && c.Kind != "shape") {
				return errors.New("原生图层类型或资源引用无效")
			}
			if c.Kind == "text" && (utf8.RuneCountInString(c.Value) > 2000 || !slices.Contains([]string{"sans", "serif", "mono"}, c.Font) || !slices.Contains([]int{400, 700}, c.Weight) || !slices.Contains([]string{"left", "center", "right"}, c.Align)) {
				return errors.New("文字图层排版无效")
			}
			if c.Kind == "text" && ((c.FontSize != nil && !validNumber(*c.FontSize, 0.1, 2000)) || (c.LineHeight != nil && !validNumber(*c.LineHeight, 1, 3)) || (c.LetterSpacing != nil && !validNumber(*c.LetterSpacing, 0, 20))) {
				return errors.New("文字字号、行距或字距无效")
			}
			if c.Kind == "shape" && !slices.Contains([]string{"rectangle", "ellipse"}, c.Shape) {
				return errors.New("图形图层形状无效")
			}
		}
		ids[a.ID] = true
	}
	return nil
}

func PanelIDs(structure string) []string {
	tube := []string{"front", "right", "back", "left", "glue"}
	tub := []string{"bottom", "back", "right", "front", "left", "ear-left", "ear-right", "front-ear-left", "front-ear-right"}
	result := []string{}
	add := func(part string, names []string) {
		for _, name := range names {
			result = append(result, part+"-"+name)
		}
	}
	switch structure {
	case "tuck", "reverse-tuck":
		add("box", append(tube, "top", "top-tab", "top-right-wing", "top-left-wing", "bottom", "bottom-tab", "bottom-right-wing", "bottom-left-wing"))
	case "tray", "display", "mailer":
		add("tray", tub)
		if structure == "mailer" {
			add("tray", []string{"lid", "lid-tab"})
		}
	case "lid-base", "drawer", "book", "double-door":
		add("base", tub)
		if structure == "lid-base" {
			add("lid", tub)
		}
		if structure == "drawer" {
			add("sleeve", tube)
		}
		if structure == "book" {
			add("cover", []string{"bottom", "spine", "lid"})
		}
		if structure == "double-door" {
			add("cover", []string{"bottom", "left-spine", "left-lid", "right-spine", "right-lid"})
		}
	case "pillow":
		add("pillow", []string{"front", "back"})
	case "pouch", "spout-pouch":
		add("bag", []string{"front", "back"})
	}
	return result
}

func DefaultCatalog() Catalog {
	p := Parameters{Length: 120, Width: 60, Height: 180, Thickness: 0.45, Bleed: 3, Glue: 12, Tab: 15, Gap: 1, FrontHeight: 40, Inflation: 0.6, SpoutRadius: 8}
	names := []string{"双插盒", "反插盒", "飞机盒", "开放托盘", "斜边展示盒", "天地盖", "抽屉礼盒", "书型翻盖盒", "对开精品盒", "枕形盒", "三边封袋", "吸嘴袋"}
	descriptions := []string{"同向上下插盖，带粘口与防尘翼", "上下插盖反向，适合零售纸盒", "带一体翻盖与内折角片的邮寄盒", "开放四壁与角部粘接耳", "低前沿、高后背的展示托盘", "独立盖底、套合间隙与开盖预览", "外套筒与独立内抽屉", "书脊连接的外封套与内盒", "左右翻门与独立内托", "弧形封口和鼓起的枕形盒体", "双面软膜、三边封口与可调鼓胀", "软袋加吸嘴，袋体和吸嘴分别建模"}
	result := Catalog{Revision: 0, Enabled: true, MockupEnabled: true, MaxProjects: 200, Templates: []Template{}, Materials: []Material{
		{ID: "white-card", Name: "白卡纸", Color: "#f0ece3", InsideColor: "#e5ddcc", Thickness: 0.45, Roughness: 0.65, Enabled: true},
		{ID: "kraft", Name: "牛皮纸", Color: "#af8956", InsideColor: "#a7804d", Thickness: 0.6, Roughness: 0.9, Enabled: true},
		{ID: "corrugated", Name: "瓦楞纸", Color: "#b59163", InsideColor: "#aa8253", Thickness: 2, Roughness: 0.85, Enabled: true},
		{ID: "greyboard", Name: "灰板裱纸", Color: "#e9e4d9", InsideColor: "#bbb4a6", Thickness: 2, Roughness: 0.7, Enabled: true},
		{ID: "film", Name: "复合软膜", Color: "#e7e8eb", InsideColor: "#bfc1c5", Thickness: 0.1, Roughness: 0.28, Metalness: 0.15, Enabled: true},
	}}
	for i, structure := range Structures {
		defaults := p
		category := "折叠纸盒"
		if slices.Contains([]string{"tray", "display", "mailer"}, structure) {
			defaults.Height = 80
			defaults.Width = 100
			category = "托盘展示"
		}
		if slices.Contains([]string{"lid-base", "drawer", "book", "double-door"}, structure) {
			defaults.Height = 60
			defaults.Width = 100
			defaults.Thickness = 2
			category = "礼盒"
		}
		if slices.Contains([]string{"pillow", "pouch", "spout-pouch"}, structure) {
			defaults.Width = 40
			defaults.Thickness = 0.1
			category = "软包装"
		}
		result.Templates = append(result.Templates, Template{ID: structure, Structure: structure, Name: names[i], Category: category, Description: descriptions[i], Enabled: true, Defaults: defaults})
	}
	return result
}
