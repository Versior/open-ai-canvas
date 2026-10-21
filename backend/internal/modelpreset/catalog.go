// Package modelpreset matches public model metadata without consulting channel credentials.
package modelpreset

import (
	_ "embed"
	"encoding/json"
	"regexp"
	"strings"
)

//go:embed catalog.json
var catalogJSON []byte

type Preset struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Context   int    `json:"context"`
	Output    int    `json:"output"`
	Vision    bool   `json:"vision"`
	MaxImages int    `json:"maxImages"`
}

var separator = regexp.MustCompile(`[^a-z0-9]+`)
var effort = regexp.MustCompile(`-(high|medium|low|xhigh|thinking|nothinking|latest)$`)
var date = regexp.MustCompile(`-(20[0-9]{2}-?[0-9]{2}-?[0-9]{2}|[0-9]{4})$`)
var digits = regexp.MustCompile(`[0-9]+`)
var hyphens = regexp.MustCompile(`-+`)

func normalized(id string) string {
	parts := strings.Split(strings.TrimSpace(id), "/")
	return strings.Trim(separator.ReplaceAllString(strings.ToLower(parts[len(parts)-1]), "-"), "-")
}
func base(id string) string {
	return date.ReplaceAllString(effort.ReplaceAllString(normalized(id), ""), "")
}

func MatchScore(id, candidate string, allowFamily bool) int {
	if strings.TrimSpace(id) == "" || strings.TrimSpace(candidate) == "" {
		return 0
	}
	if strings.EqualFold(strings.TrimSpace(id), strings.TrimSpace(candidate)) {
		return 4
	}
	if normalized(id) == normalized(candidate) {
		return 3
	}
	a, b := base(id), base(candidate)
	if a == b {
		return 2
	}
	family := func(s string) string {
		return strings.Trim(hyphens.ReplaceAllString(digits.ReplaceAllString(s, ""), "-"), "-")
	}
	if allowFamily && digits.MatchString(a) && digits.MatchString(b) && len(family(a)) >= 3 && family(a) == family(b) {
		return 1
	}
	return 0
}

var models = func() []Preset {
	var catalog struct {
		Models []Preset `json:"models"`
	}
	if err := json.Unmarshal(catalogJSON, &catalog); err != nil {
		panic(err)
	}
	return catalog.Models
}()

func Find(id string) (Preset, bool) {
	best := 0
	var candidates []Preset
	for _, candidate := range models {
		score := max(MatchScore(id, candidate.ID, false), MatchScore(id, candidate.Name, false))
		if score == 0 || score < best {
			continue
		}
		if score > best {
			best, candidates = score, nil
		}
		candidates = append(candidates, candidate)
	}
	hasBareID := false
	for _, candidate := range candidates {
		if !strings.Contains(candidate.ID, "/") {
			hasBareID = true
		}
	}
	var result Preset
	ambiguous := false
	for _, candidate := range candidates {
		if hasBareID && strings.Contains(candidate.ID, "/") {
			continue
		}
		if result.ID == "" {
			result = candidate
			continue
		}
		if base(result.ID) != base(candidate.ID) {
			ambiguous = true
		}
		if candidate.ID < result.ID {
			result.ID, result.Name = candidate.ID, candidate.Name
		}
		result.Context = min(result.Context, candidate.Context)
		result.Output = min(result.Output, candidate.Output)
		result.Vision = result.Vision && candidate.Vision
		if candidate.MaxImages > 0 && (result.MaxImages == 0 || candidate.MaxImages < result.MaxImages) {
			result.MaxImages = candidate.MaxImages
		}
	}
	return result, best > 0 && !ambiguous && result.Context >= 4096 && result.Context <= 10000000 && result.Output >= 256 && result.Output <= 1000000 && result.Output < result.Context
}

func Icon(id string) string {
	_, icon := Identity(id)
	return icon
}

var identityFamilies = func() []struct {
	pattern        *regexp.Regexp
	category, icon string
} {
	var result []struct {
		pattern        *regexp.Regexp
		category, icon string
	}
	for _, family := range [][3]string{
		{`^claude(-|$)`, "Claude", "Claude"}, {`^gemini(-|$)`, "Gemini", "Gemini"}, {`^gemma(-|$)`, "Gemma", "Gemma"},
		{`^(gpt|chatgpt)(-|$)|^o[134](-|$)`, "GPT", "OpenAI"}, {`^deepseek(-|$)`, "DeepSeek", "DeepSeek"},
		{`^qwen([0-9]|-|$)`, "Qwen", "Qwen"}, {`^kimi(-|$)`, "Kimi", "Moonshot"}, {`^glm(-|$)`, "GLM", "ZAI"},
		{`^minimax(-|$)`, "MiniMax", "Minimax"}, {`^grok(-|$)`, "Grok", "Grok"},
		{`^(mistral|magistral|pixtral|devstral|ministral)(-|$)`, "Mistral", "Mistral"},
		{`^llama([0-9]|-|$)`, "Llama", "Meta"}, {`^mimo(-|$)`, "MiMo", "XiaomiMiMo"}, {`^step([0-9]|-|$)`, "Step", "Stepfun"},
		{`^flux([0-9]|-|$)`, "FLUX", "Flux"}, {`^(midjourney|mj)(-|$)`, "Midjourney", "Midjourney"},
		{`^ideogram(-|$)`, "Ideogram", "Ideogram"}, {`^recraft(-|$)`, "Recraft", "Recraft"},
		{`^(stable-diffusion|sdxl)(-|$)`, "Stable Diffusion", "Stability"},
		{`^sora(-|$)`, "Sora", "Sora"}, {`^veo(-|$)`, "Veo", "Gemini"},
		{`^kling(-|$)`, "Kling", "Kling"}, {`^vidu(-|$)`, "Vidu", "Vidu"}, {`^hailuo(-|$)`, "Hailuo", "Hailuo"},
		{`^seedance(-|$)`, "Seedance", "Doubao"}, {`^seedream(-|$)`, "Seedream", "Doubao"},
		{`^doubao(-|$)`, "Doubao", "Doubao"}, {`^jimeng(-|$)`, "Jimeng", "Jimeng"},
		{`^hunyuan(-|$)`, "Hunyuan", "Hunyuan"}, {`^suno(-|$)`, "Suno", "Suno"},
	} {
		result = append(result, struct {
			pattern        *regexp.Regexp
			category, icon string
		}{regexp.MustCompile(family[0]), family[1], family[2]})
	}
	return result
}()

// Identity does not depend on catalog limits, capability, or channel vendor.
func Identity(id string) (category, icon string) {
	name := normalized(id)
	for _, family := range identityFamilies {
		if family.pattern.MatchString(name) {
			return family.category, family.icon
		}
	}
	return "", ""
}
