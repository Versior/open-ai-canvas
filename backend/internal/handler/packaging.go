package handler

import (
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"io"
	"net/http"
	"strconv"
	"time"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func RegisterPackagingRoutes(r *gin.RouterGroup, svc *service.Service) {
	actor := func(c *gin.Context) (*model.User, bool) {
		u, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return nil, false
		}
		return u, true
	}
	write := func(c *gin.Context, u *model.User) bool {
		policy, available := loadRuntimePolicy(c, svc)
		return available && enforceRateLimit(c, "packaging-write:"+u.ID, policy.Request.CanvasWritePerMinute, time.Minute)
	}
	for _, admin := range []bool{false, true} {
		prefix := "/packaging"
		if admin {
			prefix = "/admin/packaging"
		}
		r.GET(prefix+"/catalog", func(c *gin.Context) {
			u, allowed := actor(c)
			if !allowed {
				return
			}
			value, err := svc.PackagingCatalog(u, admin)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, value)
		})
		r.GET(prefix+"/projects", func(c *gin.Context) {
			u, allowed := actor(c)
			if !allowed {
				return
			}
			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "30"))
			value, err := svc.PackagingProjects(u, admin, c.Query("userId"), c.Query("templateId"), page, size)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, value)
		})
		r.GET(prefix+"/projects/:projectId", func(c *gin.Context) {
			u, allowed := actor(c)
			if !allowed {
				return
			}
			value, err := svc.PackagingProject(u, c.Param("projectId"), admin)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, value)
		})
		r.GET(prefix+"/projects/:projectId/mockups", func(c *gin.Context) {
			u, allowed := actor(c)
			if !allowed {
				return
			}
			page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
			size, _ := strconv.Atoi(c.DefaultQuery("pageSize", "12"))
			value, err := svc.PackagingMockups(u, c.Param("projectId"), admin, page, size)
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Cache-Control", "no-store")
			ok(c, value)
		})
	}
	r.PUT("/admin/packaging/catalog", func(c *gin.Context) {
		u, allowed := actor(c)
		if !allowed || !write(c, u) {
			return
		}
		var input service.PackagingCatalogInput
		if err := decodePackagingJSON(c, &input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SavePackagingCatalog(u, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.GET("/admin/packaging/overview", func(c *gin.Context) {
		u, allowed := actor(c)
		if !allowed {
			return
		}
		value, err := svc.AdminPackagingOverview(u)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	save := func(c *gin.Context) {
		u, allowed := actor(c)
		if !allowed || !write(c, u) {
			return
		}
		var input service.PackagingProjectInput
		if err := decodePackagingJSON(c, &input); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SavePackagingProject(u, c.Param("projectId"), input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	}
	r.POST("/packaging/projects", save)
	r.PUT("/packaging/projects/:projectId", save)
	for _, admin := range []bool{false, true} {
		prefix := "/packaging"
		if admin {
			prefix = "/admin/packaging"
		}
		r.DELETE(prefix+"/projects/:projectId", func(c *gin.Context) {
			u, allowed := actor(c)
			if !allowed || !write(c, u) {
				return
			}
			expected, err := strconv.ParseInt(c.Query("expectedRevision"), 10, 64)
			if err != nil {
				fail(c, http.StatusBadRequest, errors.New("expectedRevision 无效"))
				return
			}
			remove := svc.DeletePackagingProject
			if admin {
				remove = svc.AdminDeletePackagingProject
			}
			if err := remove(u, c.Param("projectId"), expected); err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"deleted": true})
		})
	}
}

func decodePackagingJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return errors.New("包装请求格式无效或超过 256 KiB")
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return errors.New("请求只能包含一份 JSON")
	}
	return nil
}
