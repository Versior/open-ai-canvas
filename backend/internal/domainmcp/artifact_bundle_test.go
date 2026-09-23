package domainmcp

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestArtifactBundleAuthorizesOnlyOwningScopeBeforeExpiry(t *testing.T) {
	now := time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)
	bundle, err := NewArtifactBundle("bundle-1", "user-1", "canvas-1", "run-1", "commerce.product_analyze", Result{
		Summary: "summary",
		Artifacts: []Artifact{{
			Type:  ArtifactRecipe,
			Title: "recipe",
			Content: CanvasRecipe{Layout: "grid", Nodes: []CanvasRecipeNode{{
				Key: "overview", Type: ArtifactText, Title: "概览", Content: "正文", Column: 0, Row: 0,
			}}},
		}},
	}, now, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.Authorize("user-1", "canvas-1", "run-1", now.Add(30*time.Minute)); err != nil {
		t.Fatalf("owner rejected: %v", err)
	}
	for _, scope := range [][3]string{{"user-2", "canvas-1", "run-1"}, {"user-1", "canvas-2", "run-1"}, {"user-1", "canvas-1", "run-2"}} {
		if err := bundle.Authorize(scope[0], scope[1], scope[2], now); !errors.Is(err, ErrPolicyBlocked) {
			t.Fatalf("scope %#v error = %v", scope, err)
		}
	}
	if err := bundle.Authorize("user-1", "canvas-1", "run-1", now.Add(time.Hour)); !errors.Is(err, ErrPolicyBlocked) {
		t.Fatalf("expired bundle error = %v", err)
	}
}

func TestCompileCanvasRecipeIsDeterministicAndBounded(t *testing.T) {
	now := time.Now().UTC()
	recipe := CanvasRecipe{Layout: "three-column-report", Nodes: []CanvasRecipeNode{
		{Key: "overview", Type: ArtifactText, Title: "商品概览", Content: "轻薄防晒衣", Column: 0, Row: 0},
		{Key: "signals", Type: ArtifactTable, Title: "市场信号", Content: []map[string]any{{"signal": "轻薄透气"}}, Column: 1, Row: 0},
	}}
	bundle, err := NewArtifactBundle("bundle-1", "user-1", "canvas-1", "run-1", "commerce.product_analyze", Result{
		Summary:   "summary",
		Artifacts: []Artifact{{Type: ArtifactRecipe, Title: "recipe", Content: recipe}},
	}, now, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	first, err := CompileCanvasRecipe(bundle)
	if err != nil {
		t.Fatal(err)
	}
	second, err := CompileCanvasRecipe(bundle)
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 2 || len(second) != 2 || first[0] != second[0] || first[1] != second[1] {
		t.Fatalf("non-deterministic recipe: first=%#v second=%#v", first, second)
	}
	if first[0].NodeType != "text" || first[0].X != 0 || first[0].Y != 0 || first[1].NodeType != "markdown" || first[1].X <= first[0].X {
		t.Fatalf("compiled ops = %#v", first)
	}
	if !strings.Contains(first[1].Content, "轻薄透气") {
		t.Fatalf("structured content missing: %s", first[1].Content)
	}
}

func TestCompileCanvasRecipeRejectsUnknownTypesAndTooManyNodes(t *testing.T) {
	now := time.Now().UTC()
	tests := []CanvasRecipe{
		{Layout: "grid", Nodes: []CanvasRecipeNode{{Key: "unsafe", Type: "canvas.executable", Title: "Unsafe", Content: "run"}}},
		{Layout: "grid", Nodes: recipeNodes(21)},
		{Layout: "grid", Nodes: []CanvasRecipeNode{{Key: "duplicate", Type: ArtifactText, Title: "One", Content: "one"}, {Key: "duplicate", Type: ArtifactText, Title: "Two", Content: "two"}}},
	}
	for _, recipe := range tests {
		bundle, err := NewArtifactBundle("bundle-1", "user-1", "canvas-1", "run-1", "commerce.product_analyze", Result{
			Summary:   "summary",
			Artifacts: []Artifact{{Type: ArtifactRecipe, Title: "recipe", Content: recipe}},
		}, now, time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := CompileCanvasRecipe(bundle); !errors.Is(err, ErrOutputInvalid) {
			t.Fatalf("recipe %#v error = %v", recipe, err)
		}
	}
}

func TestNewArtifactBundleRejectsInvalidIdentityAndTTL(t *testing.T) {
	now := time.Now().UTC()
	result := Result{Summary: "summary", Artifacts: []Artifact{{Type: ArtifactText, Title: "Text", Content: "body"}}}
	tests := []struct {
		id, userID, canvasID, runID, toolName string
		ttl                                   time.Duration
	}{
		{id: "", userID: "user", canvasID: "canvas", runID: "run", toolName: "tool.name", ttl: time.Hour},
		{id: "bundle", userID: "", canvasID: "canvas", runID: "run", toolName: "tool.name", ttl: time.Hour},
		{id: "bundle", userID: "user", canvasID: "canvas", runID: "run", toolName: "tool.name", ttl: 0},
		{id: "bundle", userID: "user", canvasID: "canvas", runID: "run", toolName: "tool.name", ttl: 25 * time.Hour},
	}
	for _, test := range tests {
		if _, err := NewArtifactBundle(test.id, test.userID, test.canvasID, test.runID, test.toolName, result, now, test.ttl); !errors.Is(err, ErrOutputInvalid) {
			t.Fatalf("input %#v error = %v", test, err)
		}
	}
}

func recipeNodes(count int) []CanvasRecipeNode {
	result := make([]CanvasRecipeNode, 0, count)
	for index := 0; index < count; index++ {
		result = append(result, CanvasRecipeNode{Key: "node-" + string(rune('a'+index)), Type: ArtifactText, Title: "Node", Content: "body", Column: index % 3, Row: index / 3})
	}
	return result
}
