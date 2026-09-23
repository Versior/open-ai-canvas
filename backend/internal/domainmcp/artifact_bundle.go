package domainmcp

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

const (
	maxBundleArtifacts = 50
	maxRecipeNodes     = 20
	maxCanvasContent   = 16000
	maxBundleTTL       = 24 * time.Hour
)

type ArtifactBundle struct {
	ID        string     `json:"id"`
	UserID    string     `json:"userId"`
	CanvasID  string     `json:"canvasId"`
	RunID     string     `json:"runId"`
	ToolName  string     `json:"toolName"`
	Artifacts []Artifact `json:"artifacts"`
	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
}

type CanvasRecipe struct {
	Layout string             `json:"layout"`
	Nodes  []CanvasRecipeNode `json:"nodes"`
}

type CanvasRecipeNode struct {
	Key     string `json:"key"`
	Type    string `json:"type"`
	Title   string `json:"title"`
	Content any    `json:"content"`
	Column  int    `json:"column"`
	Row     int    `json:"row"`
}

type CanvasRecipeOp struct {
	ID       string  `json:"id"`
	NodeType string  `json:"nodeType"`
	Title    string  `json:"title"`
	Content  string  `json:"content"`
	X        float64 `json:"x"`
	Y        float64 `json:"y"`
}

func NewArtifactBundle(id, userID, canvasID, runID, toolName string, result Result, now time.Time, ttl time.Duration) (ArtifactBundle, error) {
	for label, value := range map[string]string{"bundle ID": id, "user ID": userID, "canvas ID": canvasID, "run ID": runID, "tool name": toolName} {
		if err := validateBundleIdentity(value, 128); err != nil {
			return ArtifactBundle{}, outputInvalid(fmt.Errorf("%s 无效: %w", label, err))
		}
	}
	if now.IsZero() || ttl <= 0 || ttl > maxBundleTTL {
		return ArtifactBundle{}, outputInvalid(errors.New("Artifact Bundle 有效期需要大于 0 且不超过 24 小时"))
	}
	if len(result.Artifacts) == 0 || len(result.Artifacts) > maxBundleArtifacts {
		return ArtifactBundle{}, outputInvalid(errors.New("Artifact Bundle 需要 1–50 个产物"))
	}
	if err := ValidateResult(result); err != nil {
		return ArtifactBundle{}, err
	}
	artifacts, err := cloneArtifacts(result.Artifacts)
	if err != nil {
		return ArtifactBundle{}, outputInvalid(err)
	}
	return ArtifactBundle{
		ID: id, UserID: userID, CanvasID: canvasID, RunID: runID, ToolName: toolName,
		Artifacts: artifacts, CreatedAt: now.UTC(), ExpiresAt: now.Add(ttl).UTC(),
	}, nil
}

func (b ArtifactBundle) ValidateScope(userID, canvasID, runID string) error {
	if b.UserID != userID || b.CanvasID != canvasID || b.RunID != runID {
		return NewError(ErrorPolicyBlocked, "Artifact Bundle 不属于当前用户、画布或 Agent Run", nil)
	}
	return nil
}

func (b ArtifactBundle) Authorize(userID, canvasID, runID string, now time.Time) error {
	if err := b.ValidateScope(userID, canvasID, runID); err != nil {
		return err
	}
	if now.IsZero() || b.ExpiresAt.IsZero() || !now.Before(b.ExpiresAt) {
		return NewError(ErrorPolicyBlocked, "Artifact Bundle 已过期", nil)
	}
	return nil
}

func CompileCanvasRecipe(bundle ArtifactBundle) ([]CanvasRecipeOp, error) {
	if err := validateBundleIdentity(bundle.ID, 128); err != nil {
		return nil, outputInvalid(fmt.Errorf("Artifact Bundle ID 无效: %w", err))
	}
	result := make([]CanvasRecipeOp, 0)
	seenKeys := make(map[string]struct{})
	for _, artifact := range bundle.Artifacts {
		if artifact.Type != ArtifactRecipe {
			continue
		}
		var recipe CanvasRecipe
		encoded, err := json.Marshal(artifact.Content)
		if err != nil || len(encoded) > maxResultBytes {
			return nil, outputInvalid(errors.New("画布 Recipe 无法编码或过大"))
		}
		decoder := json.NewDecoder(strings.NewReader(string(encoded)))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&recipe); err != nil {
			return nil, outputInvalid(fmt.Errorf("画布 Recipe 合同无效: %w", err))
		}
		if strings.TrimSpace(recipe.Layout) == "" || len(recipe.Nodes) == 0 {
			return nil, outputInvalid(errors.New("画布 Recipe 缺少 layout 或 nodes"))
		}
		if len(result)+len(recipe.Nodes) > maxRecipeNodes {
			return nil, outputInvalid(fmt.Errorf("画布 Recipe 节点不能超过 %d 个", maxRecipeNodes))
		}
		for _, node := range recipe.Nodes {
			if err := validateBundleIdentity(node.Key, 80); err != nil {
				return nil, outputInvalid(fmt.Errorf("画布 Recipe 节点 key 无效: %w", err))
			}
			if _, duplicate := seenKeys[node.Key]; duplicate {
				return nil, outputInvalid(fmt.Errorf("画布 Recipe 节点 key 重复: %s", node.Key))
			}
			seenKeys[node.Key] = struct{}{}
			nodeType, err := recipeCanvasNodeType(node.Type)
			if err != nil {
				return nil, err
			}
			if err := validateRecipeTitle(node.Title); err != nil {
				return nil, err
			}
			if node.Column < 0 || node.Column > 20 || node.Row < 0 || node.Row > 20 {
				return nil, outputInvalid(errors.New("画布 Recipe 行列坐标超出范围"))
			}
			content, err := recipeContent(node.Content)
			if err != nil {
				return nil, err
			}
			result = append(result, CanvasRecipeOp{
				ID: stableRecipeNodeID(bundle.ID, node.Key), NodeType: nodeType, Title: node.Title, Content: content,
				X: float64(node.Column * 460), Y: float64(node.Row * 360),
			})
		}
	}
	if len(result) == 0 {
		return nil, outputInvalid(errors.New("Artifact Bundle 没有可应用的画布 Recipe"))
	}
	return result, nil
}

func recipeCanvasNodeType(artifactType string) (string, error) {
	switch artifactType {
	case ArtifactText:
		return "text", nil
	case ArtifactTable, ArtifactCommerceProductReport, ArtifactCommerceHeroPlan, ArtifactCommerceDetailPlan, ArtifactBrandAudit, ArtifactSocialContentPlan, ArtifactFilmReferenceBoard, ArtifactStoryScript:
		return "markdown", nil
	case ArtifactStoryboard:
		return "script", nil
	default:
		return "", outputInvalid(fmt.Errorf("画布 Recipe 节点类型不受支持: %s", artifactType))
	}
}

func recipeContent(value any) (string, error) {
	if text, ok := value.(string); ok {
		text = strings.TrimSpace(text)
		if text == "" || utf8.RuneCountInString(text) > maxCanvasContent {
			return "", outputInvalid(errors.New("画布 Recipe 文本内容为空或过长"))
		}
		return text, nil
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", outputInvalid(fmt.Errorf("画布 Recipe 内容无法编码: %w", err))
	}
	text := string(encoded)
	if text == "null" || utf8.RuneCountInString(text) > maxCanvasContent {
		return "", outputInvalid(errors.New("画布 Recipe 结构化内容为空或过长"))
	}
	return "```json\n" + text + "\n```", nil
}

func validateRecipeTitle(value string) error {
	if strings.TrimSpace(value) != value || value == "" || utf8.RuneCountInString(value) > 240 {
		return outputInvalid(errors.New("画布 Recipe 节点标题无效"))
	}
	return nil
}

func validateBundleIdentity(value string, maxRunes int) error {
	if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) || utf8.RuneCountInString(value) > maxRunes {
		return errors.New("值为空、过长或包含首尾空白")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("值包含控制字符")
		}
	}
	return nil
}

func stableRecipeNodeID(bundleID, key string) string {
	sum := sha256.Sum256([]byte(bundleID + "\x00" + key))
	return "artifact-" + hex.EncodeToString(sum[:12])
}

func cloneArtifacts(input []Artifact) ([]Artifact, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, fmt.Errorf("Artifact 无法编码: %w", err)
	}
	var result []Artifact
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, fmt.Errorf("Artifact 无法复制: %w", err)
	}
	return result, nil
}
