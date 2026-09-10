//go:build !embed

package web

import "github.com/gin-gonic/gin"

func RegisterEmbeddedFrontend(*gin.Engine) bool { return false }

func EmbeddedFrontendIndex(*gin.Context) {}
