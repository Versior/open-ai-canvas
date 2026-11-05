package interior

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	ProjectKindHome   = "home"
	ProjectKindClient = "client"

	MaxProjectsPerUser      = 200
	MaxProjectDocumentBytes = 1 << 20
	MaxProjectRounds        = 300
	maxProjectNameRunes     = 120
)

const emptyProjectDocument = `{"version":1,"rounds":[]}`

func NormalizeProjectName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > maxProjectNameRunes {
		return "", fmt.Errorf("项目名称须为 1–%d 字", maxProjectNameRunes)
	}
	return value, nil
}

func ValidProjectKind(value string) bool {
	return value == ProjectKindHome || value == ProjectKindClient
}

// NormalizeProjectDocument 校验浏览器提交的项目文档并压缩空白。结构由前端定义，
// 服务端只保证它是对象、大小受限、不内嵌图片，以及出图轮次数量不超限。
// 文档里的图片必须写成 resourceId 字段，资源清理才能识别为仍被引用。
func NormalizeProjectDocument(raw json.RawMessage) (string, error) {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return emptyProjectDocument, nil
	}
	if len(raw) > MaxProjectDocumentBytes {
		return "", fmt.Errorf("项目数据须在 1MB 以内，请删除不需要的历史轮次")
	}
	// 媒体必须先上传为资源再引用；内嵌 data URL 会撑大文档，也绕开资源配额与清理。
	if bytes.Contains(raw, []byte(`"data:`)) {
		return "", fmt.Errorf("项目数据不能内嵌图片，请先上传为素材")
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil || fields == nil {
		return "", fmt.Errorf("项目数据必须是 JSON 对象")
	}
	if roundsRaw, exists := fields["rounds"]; exists {
		var rounds []json.RawMessage
		if err := json.Unmarshal(roundsRaw, &rounds); err != nil {
			return "", fmt.Errorf("项目的出图记录格式无效")
		}
		if len(rounds) > MaxProjectRounds {
			return "", fmt.Errorf("一个项目最多保存 %d 轮出图，请删除旧的记录", MaxProjectRounds)
		}
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return "", fmt.Errorf("项目数据格式无效")
	}
	return compact.String(), nil
}
