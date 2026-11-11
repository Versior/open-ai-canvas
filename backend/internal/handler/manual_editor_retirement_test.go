package handler

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTaskRoutesPreserveForkRemakeEditorAdmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterTaskRoutes(router.Group("/api"), nil)
	for _, expected := range []struct{ method, path string }{
		{http.MethodPost, "/api/tasks"},
		{http.MethodGet, "/api/tasks/:id"},
		{http.MethodPost, "/api/timeline/renders"},
		{http.MethodPost, "/api/timeline/transcriptions"},
		{http.MethodPost, "/api/timeline/jianying-draft"},
	} {
		found := false
		for _, route := range router.Routes() {
			if route.Method == expected.method && route.Path == expected.path {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("core task route missing: %s %s", expected.method, expected.path)
		}
	}
}
