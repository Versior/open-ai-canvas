// 后台「视频复刻」管理：使用统计、所有用户的拆解记录（查看、删除）和视频复刻设置。解析接口池的路由在 social_video_parse_routes.go。
package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterVideoReplicationAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/video-replication/overview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.AdminVideoReplicationOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.GET("/admin/video-replication/teardowns", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		records, err := svc.AdminVideoReplications(user, service.AdminVideoReplicationQuery{Status: c.Query("status"), Keyword: c.Query("keyword"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, records)
	})
	r.GET("/admin/video-replication/teardowns/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.AdminVideoReplication(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	r.DELETE("/admin/video-replication/teardowns/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.DeleteAdminVideoReplication(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/video-replication/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.AdminVideoReplicationSettings(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.PATCH("/admin/video-replication/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.VideoReplicationSettingsPatch
		if !bindLimitedJSON(c, 4<<10, &req) {
			return
		}
		if _, err := svc.UpdateVideoReplicationSettings(user, req); err != nil {
			failService(c, err)
			return
		}
		// 和 GET 返回同一份内容：保存后的设置，以及按新设置算出的口播识别状态。
		view, err := svc.AdminVideoReplicationSettings(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
}
