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
	serve := gin.WrapH(http.FileServer(http.FS(dist)))
	r.GET("/assets/*filepath", serve)
	r.GET("/client-docs/*filepath", serve)
	r.GET("/client-icons/*filepath", serve)
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
