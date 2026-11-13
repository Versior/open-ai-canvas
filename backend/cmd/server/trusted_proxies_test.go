package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTrustedProxyBoundary(t *testing.T) {
	for _, tc := range []struct{ proxies, peer, forwarded, want string }{
		{"", "198.51.100.10:1234", "203.0.113.1", "198.51.100.10"},
		{"", "127.0.0.1:1234", "203.0.113.1", "203.0.113.1"},
		{"172.23.0.0/16", "172.23.0.2:1234", "203.0.113.1", "203.0.113.1"},
		{"172.23.0.0/16", "172.24.0.2:1234", "203.0.113.1", "172.24.0.2"},
		{"172.23.0.0/16", "172.23.0.2:1234", "192.0.2.99, 203.0.113.1", "203.0.113.1"},
	} {
		router := gin.New()
		if err := configureTrustedProxies(router, tc.proxies); err != nil {
			t.Fatal(err)
		}
		router.GET("/ip", func(c *gin.Context) { c.String(http.StatusOK, c.ClientIP()) })
		req := httptest.NewRequest(http.MethodGet, "/ip", nil)
		req.RemoteAddr = tc.peer
		req.Header.Set("X-Forwarded-For", tc.forwarded)
		req.Header.Set("X-Real-IP", "192.0.2.99")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, req)
		if response.Body.String() != tc.want {
			t.Fatalf("peer=%s: got %s want %s", tc.peer, response.Body.String(), tc.want)
		}
	}
	if err := configureTrustedProxies(gin.New(), "bad-cidr"); err == nil {
		t.Fatal("invalid proxy configuration accepted")
	}
}
