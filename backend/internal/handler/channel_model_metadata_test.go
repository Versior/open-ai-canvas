package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func TestModelMetadataRouteRequiresLogin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), &service.Service{})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/admin/channels/channel/model-metadata", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("metadata route status = %d", w.Code)
	}
}
