package agentpet

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"sync"
	"unicode/utf8"
)

// 内置形象随程序发布，运行时不访问任何外部站点。NOTICE.md 是素材的授权记录，只随程序分发，不在界面展示。
//
//go:embed builtin/catalog.json builtin/*.webp builtin/NOTICE.md
var builtinFS embed.FS

// Builtin 是内置形象的默认配置；管理员保存配置后以数据库记录为准。
type Builtin struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Description   string `json:"description"`
	SpriteVersion int    `json:"spriteVersion"`
	File          string `json:"file"`
	Pixelated     bool   `json:"pixelated"`
	SortOrder     int    `json:"sortOrder"`
	// Tone 决定头顶气泡的说话风格，Lines 是这个形象专属的台词。
	Tone  string   `json:"tone"`
	Lines []string `json:"lines"`
	// Revision 是图集内容摘要，用作浏览器缓存版本。
	Revision string `json:"-"`
}

// UploadIDPrefix 是上传形象的 ID 前缀，内置 ID 不得使用。
const UploadIDPrefix = "custom-"

var builtinCatalog = sync.OnceValues(loadBuiltins)

// Builtins 返回内置形象，顺序与 catalog.json 一致。
func Builtins() ([]Builtin, error) {
	return builtinCatalog()
}

// LookupBuiltin 按 ID 查找内置形象。
func LookupBuiltin(id string) (Builtin, bool) {
	byID, err := builtinCatalogIndex()
	if err != nil {
		return Builtin{}, false
	}
	item, ok := byID[id]
	return item, ok
}

// BuiltinSheet 读取内置形象图集。
func BuiltinSheet(id string) ([]byte, Sheet, error) {
	item, ok := LookupBuiltin(id)
	if !ok {
		return nil, Sheet{}, fmt.Errorf("内置形象 %q 不存在", id)
	}
	data, err := builtinFS.ReadFile("builtin/" + item.File)
	if err != nil {
		return nil, Sheet{}, err
	}
	sheet, err := InspectSheet(data)
	return data, sheet, err
}

var builtinCatalogIndex = sync.OnceValues(func() (map[string]Builtin, error) {
	list, err := Builtins()
	if err != nil {
		return nil, err
	}
	byID := make(map[string]Builtin, len(list))
	for _, item := range list {
		byID[item.ID] = item
	}
	return byID, nil
})

func loadBuiltins() ([]Builtin, error) {
	raw, err := builtinFS.ReadFile("builtin/catalog.json")
	if err != nil {
		return nil, err
	}
	var list []Builtin
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil, fmt.Errorf("内置形象目录无效：%w", err)
	}
	seen := make(map[string]struct{}, len(list))
	for index := range list {
		item := &list[index]
		if _, duplicate := seen[item.ID]; duplicate || !ValidBuiltinID(item.ID) {
			return nil, fmt.Errorf("内置形象 ID %q 无效或重复", item.ID)
		}
		seen[item.ID] = struct{}{}
		data, err := builtinFS.ReadFile("builtin/" + item.File)
		if err != nil {
			return nil, err
		}
		sheet, err := InspectSheet(data)
		if err != nil {
			return nil, fmt.Errorf("内置形象 %s：%w", item.ID, err)
		}
		if sheet.Version != item.SpriteVersion {
			return nil, fmt.Errorf("内置形象 %s 声明 v%d，图集是 v%d", item.ID, item.SpriteVersion, sheet.Version)
		}
		if !slices.Contains(Tones, item.Tone) || len(item.Lines) == 0 || len(item.Lines) > maxLines {
			return nil, fmt.Errorf("内置形象 %s 的说话风格或台词无效", item.ID)
		}
		for _, line := range item.Lines {
			if line == "" || utf8.RuneCountInString(line) > maxLineRunes {
				return nil, fmt.Errorf("内置形象 %s 的台词为空或过长", item.ID)
			}
		}
		sum := sha256.Sum256(data)
		item.Revision = hex.EncodeToString(sum[:8])
	}
	return list, nil
}

// ValidBuiltinID 限定内置 ID 为短横线小写串，且不占用上传形象的 ID 前缀。
func ValidBuiltinID(id string) bool {
	if id == "" || len(id) > 40 || strings.HasPrefix(id, UploadIDPrefix) {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-') {
			return false
		}
	}
	return true
}
