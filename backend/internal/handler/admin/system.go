package admin

import (
	"net/http"

	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/update"

	"github.com/gin-gonic/gin"
)

type SystemHandler struct {
	build    update.Build
	releases update.ReleaseSource
	updater  update.Controller
}

func NewSystemHandler(build update.Build, releases update.ReleaseSource, updater update.Controller) *SystemHandler {
	return &SystemHandler{build: build, releases: releases, updater: updater}
}

func (h *SystemHandler) Version(c *gin.Context) { response.Success(c, h.build) }

func (h *SystemHandler) Latest(c *gin.Context) {
	release, err := h.releases.Latest(c.Request.Context(), false)
	if err != nil {
		response.ServiceUnavailable(c, err.Error())
		return
	}
	status := h.updater.Status(c.Request.Context())
	available := update.Newer(release.Version, h.build.Version)
	reason := status.Reason
	if release.Manifest == nil {
		reason = "此 Release 未附带自动更新清单，请按发布说明手动更新"
	}
	response.Success(c, gin.H{
		"release": release, "updateAvailable": available,
		"canUpdate": available && status.Enabled && release.Manifest != nil && !status.Job.Active(),
		"reason":    reason,
	})
}

func (h *SystemHandler) Status(c *gin.Context) {
	response.Success(c, h.updater.Status(c.Request.Context()))
}

func (h *SystemHandler) Start(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	var request update.UpdateRequest
	if c.ShouldBindJSON(&request) != nil || !update.ValidVersion(request.Version) {
		response.BadRequest(c, "请选择有效的发布版本")
		return
	}
	job, err := h.updater.Start(c.Request.Context(), request.Version)
	if err != nil {
		response.Error(c, http.StatusConflict, err.Error())
		return
	}
	c.JSON(http.StatusAccepted, response.Response{Code: 0, Message: "更新任务已创建", Data: job})
}
