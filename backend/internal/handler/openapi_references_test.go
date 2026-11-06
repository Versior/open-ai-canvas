package handler

import (
	"strings"
	"testing"

	"github.com/goccy/go-yaml"
)

func TestOpenAPILocalReferencesResolve(t *testing.T) {
	var spec map[string]any
	if err := yaml.Unmarshal(openAPISpec, &spec); err != nil {
		t.Fatal(err)
	}
	var walk func(any)
	walk = func(value any) {
		switch value := value.(type) {
		case map[string]any:
			if ref, ok := value["$ref"].(string); ok && strings.HasPrefix(ref, "#/") {
				var target any = spec
				for _, part := range strings.Split(strings.TrimPrefix(ref, "#/"), "/") {
					object, _ := target.(map[string]any)
					target = object[strings.ReplaceAll(strings.ReplaceAll(part, "~1", "/"), "~0", "~")]
				}
				if target == nil {
					t.Errorf("OpenAPI reference does not resolve: %s", ref)
				}
			}
			for _, child := range value {
				walk(child)
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	walk(spec)
}
