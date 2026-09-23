package handler

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"

	"infinite-canvas/backend/internal/buildinfo"
	"infinite-canvas/backend/internal/domainmcp"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const (
	domainMCPTokenEnvironment = "CANVAS_DOMAIN_MCP_TOKEN"
	domainMCPAdminBodyLimit   = 64 << 10
)

func RegisterDomainMCPRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/domain-mcp/catalog", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminDomainMCPCatalog(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/domain-mcp/installations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminDomainMCPInstallations(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/admin/domain-mcp/installations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.InstallDomainMCPRequest
		if !decodeDomainMCPRequest(c, &request) {
			return
		}
		result, err := svc.InstallDomainMCPPack(user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.PATCH("/admin/domain-mcp/installations/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.UpdateDomainMCPRequest
		if !decodeDomainMCPRequest(c, &request) {
			return
		}
		result, err := svc.UpdateDomainMCPInstallation(user, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.DELETE("/admin/domain-mcp/installations/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteDomainMCPInstallation(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.POST("/admin/domain-mcp/installations/:id/test", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.TestDomainMCPConnection(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

func RegisterDomainMCPProtocolRoute(r gin.IRoutes, svc *service.Service) {
	protocol := domainmcp.NewStreamableHTTPHandler(svc.DomainMCPHubSnapshot, buildinfo.Current().Version)
	r.Any("/mcp/domain", func(c *gin.Context) {
		token := strings.TrimSpace(os.Getenv(domainMCPTokenEnvironment))
		if token == "" {
			http.NotFound(c.Writer, c.Request)
			return
		}
		provided, valid := domainMCPBearerToken(c.GetHeader("Authorization"))
		if !valid || !constantTimeTokenEqual(provided, token) {
			c.Header("WWW-Authenticate", `Bearer realm="domain-mcp"`)
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		protocol.ServeHTTP(c.Writer, c.Request)
	})
}

func decodeDomainMCPRequest(c *gin.Context, target any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, domainMCPAdminBodyLimit)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			fail(c, http.StatusRequestEntityTooLarge, errors.New("请求体不能超过 64 KiB"))
			return false
		}
		failService(c, service.BadAuthRequest("领域 MCP 请求无效"))
		return false
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		failService(c, service.BadAuthRequest("领域 MCP 请求只能包含一个 JSON 对象"))
		return false
	}
	return true
}

func domainMCPBearerToken(value string) (string, bool) {
	const prefix = "Bearer "
	if len(value) <= len(prefix) || !strings.EqualFold(value[:len(prefix)], prefix) {
		return "", false
	}
	token := strings.TrimSpace(value[len(prefix):])
	return token, token != "" && len(token) <= 4096
}

func constantTimeTokenEqual(left, right string) bool {
	if len(left) != len(right) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}
