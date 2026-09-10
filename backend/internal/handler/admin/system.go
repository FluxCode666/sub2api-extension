package admin

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

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
	if h.releases == nil || h.updater == nil {
		response.ServiceUnavailable(c, "更新服务未配置")
		return
	}
	release, err := h.releases.Latest(c.Request.Context(), false)
	if err != nil {
		response.ServiceUnavailable(c, err.Error())
		return
	}
	if release == nil {
		response.ServiceUnavailable(c, "最新发布信息为空")
		return
	}
	status := h.updater.Status(c.Request.Context())
	available := update.Newer(release.Version, h.build.Version)
	reason := status.Reason
	if !release.HasCompatibleAsset() {
		reason = "此版本没有适用于当前平台的更新包，请按发布说明手动更新"
	}
	response.Success(c, gin.H{
		"release": release, "updateAvailable": available,
		"canUpdate": available && status.Enabled && release.HasCompatibleAsset() && !status.Job.Active(),
		"reason":    reason,
	})
}

func (h *SystemHandler) Status(c *gin.Context) {
	if h.updater == nil {
		response.ServiceUnavailable(c, "更新服务未配置")
		return
	}
	response.Success(c, h.updater.Status(c.Request.Context()))
}

func (h *SystemHandler) Start(c *gin.Context) {
	if h.updater == nil {
		response.ServiceUnavailable(c, "更新服务未配置")
		return
	}
	if c.Request.Body != nil {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
	}
	var request update.UpdateRequest
	bindErr := c.ShouldBindJSON(&request)
	if bindErr != nil && !errors.Is(bindErr, io.EOF) {
		response.BadRequest(c, "更新请求无效")
		return
	}
	if request.Version != "" && !update.ValidVersion(request.Version) {
		response.BadRequest(c, "请选择有效的发布版本")
		return
	}
	// Binary downloads can take several minutes and should continue if a browser
	// or reverse proxy closes the request. The process remains on the old binary
	// until the operator restarts the service after the atomic swap completes.
	base := context.Background()
	if c.Request.Context() != nil {
		base = context.WithoutCancel(c.Request.Context())
	}
	ctx, cancel := context.WithTimeout(base, 15*time.Minute)
	defer cancel()
	job, err := h.updater.Start(ctx, request.Version)
	if err != nil {
		response.Error(c, http.StatusConflict, err.Error())
		return
	}
	if job == nil {
		response.InternalError(c, "更新服务返回了空任务")
		return
	}
	// The update is complete when this handler returns. The old process keeps
	// serving requests until the operator restarts it, just like Sub2API's
	// in-process updater. Keep the job fields in the payload for old clients.
	response.SuccessWithReason(c, gin.H{
		"id":           job.ID,
		"version":      job.Version,
		"phase":        job.Phase,
		"message":      job.Message,
		"startedAt":    job.StartedAt,
		"updatedAt":    job.UpdatedAt,
		"need_restart": true,
	}, "更新完成，请重启应用", "二进制已原子替换，重启后加载新版本")
}
