package handler

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"yingce/backend/internal/service"
)

func RegisterLUTLibraryRoutes(r *gin.RouterGroup, svc *service.Service) {
	for _, admin := range []bool{false, true} {
		base := "/lut-library/items"
		if admin {
			base = "/admin" + base
		}
		r.GET(base, func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			items, err := svc.LUTLibraryItems(actor, admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"items": items})
		})
		r.GET(base+"/:id", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			item, err := svc.LUTLibraryDetail(actor, c.Param("id"), admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, item)
		})
	}
	for _, method := range []string{"POST", "PUT"} {
		path := "/admin/lut-library/items"
		if method == "PUT" {
			path += "/:id"
		}
		r.Handle(method, path, func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if err := svc.RequireAdmin(actor); err != nil {
				failService(c, err)
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
			var req service.LUTLibraryWriteRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			if method == "POST" {
				item, err := svc.CreateLUTLibraryItem(actor, req)
				if err != nil {
					failService(c, err)
					return
				}
				ok(c, gin.H{"item": item})
			} else {
				item, err := svc.UpdateLUTLibraryItem(actor, c.Param("id"), req)
				if err != nil {
					failService(c, err)
					return
				}
				ok(c, gin.H{"item": item})
			}
		})
	}
	r.DELETE("/admin/lut-library/items/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		version, _ := strconv.ParseInt(c.Query("version"), 10, 64)
		if err := svc.DeleteLUTLibraryItem(actor, c.Param("id"), version); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}
