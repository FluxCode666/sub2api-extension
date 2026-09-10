//go:build embed

package web

import (
	"embed"
	"io/fs"
	"net/http"

	"github.com/gin-gonic/gin"
)

// The Docker build copies frontend/dist here before compiling with -tags embed.
// A source build without a generated dist directory uses embed_off.go instead.
//
//go:embed dist
var frontendFS embed.FS

func RegisterEmbeddedFrontend(r *gin.Engine) bool {
	dist, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		return false
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return false
	}
	// 只内嵌前端构建产物(/assets/*、favicon.svg)。
	// 客户端接入文档截图与客户端图标属于系统统一资源目录(assets.dir)，
	// 由 internal/server.registerClientAssetRoutes 从资源目录提供，不在此注册。
	serve := gin.WrapH(http.FileServer(http.FS(dist)))
	r.GET("/assets/*filepath", serve)
	r.GET("/favicon.svg", gin.WrapH(http.FileServer(http.FS(dist))))
	return true
}

func EmbeddedFrontendIndex(c *gin.Context) {
	dist, err := fs.Sub(frontendFS, "dist")
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	data, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", data)
}
