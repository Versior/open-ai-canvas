package app

import (
	"net/http"
	"strings"
)

const (
	studioDetailContractKey      = "studioDetailContract"
	studioDetailContract         = 3
	studioDetailContractOutdated = "studio_detail_contract_outdated"
)

func validateStudioDetailSubmission(taskType, fallbackPrompt string, input map[string]any, metadata map[string]any) error {
	if metadata["source"] != ecommerceStudioSource {
		return nil
	}
	version, marked := metadata[studioDetailContractKey]
	if version == float64(studioDetailContract) {
		return nil
	}
	ordinary := taskType == "canvas_text" && ecommerceStudioFinalPlan(metadata) && metadata["studioPlanScope"] == "detail"
	if taskType == "canvas_image" {
		prompt, _ := input["prompt"].(string)
		ordinary = marked || legacyStudioDetailPageIdentity(firstNonEmpty(prompt, fallbackPrompt))
	}
	if !ordinary {
		return nil
	}
	return &AppError{
		Status: http.StatusUnprocessableEntity, Code: http.StatusUnprocessableEntity,
		Reason: studioDetailContractOutdated, Message: "详情页生成规则已更新。请刷新页面，重新策划后再出图。",
	}
}

func legacyStudioDetailPageIdentity(prompt string) bool {
	pageIdentity := false
	for raw := range strings.SplitSeq(prompt, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "【") && strings.HasSuffix(line, "】") {
			pageIdentity = line == "【页面身份】"
			continue
		}
		if pageIdentity && line == "商品详情区单屏，不是搜索主图。" {
			return true
		}
	}
	return false
}
