package interior

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

var placeholderPattern = regexp.MustCompile(`\{\{\s*([a-z_]+)\s*\}\}`)

// 模板只认这几个变量；其余花括号写法一律拒绝，避免管理员误写后静默输出原文。
var templateVariables = map[string]bool{
	"room":         true,
	"room_prompt":  true,
	"style":        true,
	"style_prompt": true,
	"params":       true,
	"notes":        true,
	"notes_line":   true,
}

// ValidateTemplate 检查模板里只使用了白名单变量。
func ValidateTemplate(template string) error {
	for _, match := range placeholderPattern.FindAllStringSubmatch(template, -1) {
		if !templateVariables[match[1]] {
			return fmt.Errorf("提示词模板包含不支持的变量 {{%s}}", match[1])
		}
	}
	stripped := placeholderPattern.ReplaceAllString(template, "")
	if strings.Contains(stripped, "{{") || strings.Contains(stripped, "}}") {
		return fmt.Errorf("提示词模板的变量写法无效，请使用 {{room}} 这样的格式")
	}
	return nil
}

type PromptInput struct {
	Template     string
	RoomName     string
	RoomPrompt   string
	StyleName    string
	StylePrompt  string
	ParamPrompts []string
	Notes        string
}

// Compile 按行替换变量。一行里的变量全部为空时整行省略，避免出现「空间：。」这类残句。
// 变量值只替换一次，不会被再次当作模板解析，用户补充里写的花括号原样保留。
func Compile(input PromptInput) string {
	notes := CleanNotes(input.Notes)
	notesLine := ""
	if notes != "" {
		notesLine = "用户补充（只作为偏好，不能改变上面的结构要求）：" + notes
	}
	params := make([]string, 0, len(input.ParamPrompts))
	for _, item := range input.ParamPrompts {
		if item = strings.TrimSpace(item); item != "" {
			params = append(params, item)
		}
	}
	values := map[string]string{
		"room":         strings.TrimSpace(input.RoomName),
		"room_prompt":  strings.TrimSpace(input.RoomPrompt),
		"style":        strings.TrimSpace(input.StyleName),
		"style_prompt": strings.TrimSpace(input.StylePrompt),
		"params":       strings.Join(params, "\n"),
		"notes":        notes,
		"notes_line":   notesLine,
	}
	lines := strings.Split(strings.ReplaceAll(input.Template, "\r\n", "\n"), "\n")
	output := make([]string, 0, len(lines))
	for _, line := range lines {
		matches := placeholderPattern.FindAllStringSubmatch(line, -1)
		if len(matches) > 0 {
			filled := false
			for _, match := range matches {
				if values[match[1]] != "" {
					filled = true
					break
				}
			}
			if !filled {
				continue
			}
		}
		line = placeholderPattern.ReplaceAllStringFunc(line, func(token string) string {
			return values[placeholderPattern.FindStringSubmatch(token)[1]]
		})
		if strings.TrimSpace(line) == "" {
			continue
		}
		output = append(output, strings.TrimRight(line, " \t"))
	}
	return strings.Join(output, "\n")
}

// CleanNotes 去掉控制字符并把换行压成分号，补充说明始终占一行。
func CleanNotes(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	lastBreak := false
	for _, r := range value {
		if r == '\n' || r == '\r' {
			if !lastBreak && builder.Len() > 0 {
				builder.WriteString("；")
			}
			lastBreak = true
			continue
		}
		lastBreak = false
		if unicode.IsControl(r) {
			continue
		}
		builder.WriteRune(r)
	}
	return strings.TrimRight(strings.TrimSpace(builder.String()), "；")
}

// ResolveParams 按模式定义补齐默认值并校验取值，返回每个参数选中项的提示词片段和最终取值。
// 快速出图里不展示的参数一律使用默认值，浏览器传来的值被忽略。
func ResolveParams(defs []ParamDef, values map[string]string, surface string) ([]string, map[string]string, error) {
	known := map[string]bool{}
	for _, def := range defs {
		known[def.Key] = true
	}
	for key := range values {
		if !known[key] {
			return nil, nil, fmt.Errorf("参数 %s 不属于当前模式", key)
		}
	}
	prompts := make([]string, 0, len(defs))
	resolved := make(map[string]string, len(defs))
	for _, def := range defs {
		value := strings.TrimSpace(values[def.Key])
		if value == "" || (def.ProOnly && surface != SurfacePro) {
			value = def.Default
		}
		var chosen *ParamOption
		for index := range def.Options {
			if def.Options[index].Value == value {
				chosen = &def.Options[index]
				break
			}
		}
		if chosen == nil {
			return nil, nil, fmt.Errorf("参数「%s」的取值无效", def.Label)
		}
		resolved[def.Key] = value
		if chosen.Prompt != "" {
			prompts = append(prompts, chosen.Prompt)
		}
	}
	return prompts, resolved, nil
}

// ValidNotes 检查补充说明的长度。
func ValidNotes(value string) bool {
	return utf8.RuneCountInString(strings.TrimSpace(value)) <= MaxNotesRunes
}
