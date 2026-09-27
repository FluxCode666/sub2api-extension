// Package admin 提供兼容 homepage.config 的系统配置端点。
package admin

import (
	"context"
	"errors"
	"log"

	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type homepageConfigProvider interface {
	Get(ctx context.Context) (service.HomepageConfig, error)
	Save(ctx context.Context, config service.HomepageConfig) (service.HomepageConfig, error)
}

type homepageMenuPublisher interface {
	SetHomepageMenu(context.Context, bool, string) error
}

type clientImportMenuPublisher interface {
	SetClientImportMenu(context.Context, bool) error
}

type asyncTaskMenuPublisher interface {
	SetAsyncTaskMenu(context.Context, bool) error
}

// publicURLRebaser 在扩展公网地址变更后迁移已上架菜单的 URL 前缀。
type publicURLRebaser interface {
	RebasePublicURL(ctx context.Context, oldBase, newBase string) error
}

// menuPublicationView 告诉管理端当前 Sub2API 菜单实际使用的扩展地址及来源
// （config=系统配置，env=SUB2API_EXTENSION_PUBLIC_URL，空=未配置）。
type menuPublicationView struct {
	Available    bool   `json:"available"`
	EffectiveURL string `json:"effectiveUrl"`
	Source       string `json:"source"`
}

// homepageConfigAdminView 在原有扁平配置字段之外附带菜单上架状态，仅管理端返回。
type homepageConfigAdminView struct {
	service.HomepageConfig
	MenuPublication menuPublicationView `json:"menuPublication"`
}

// HomepageConfigHandler 同时提供公开读取和管理员写入。
type HomepageConfigHandler struct {
	provider  homepageConfigProvider
	publisher homepageMenuPublisher
	reconcile func(context.Context) error
}

func NewHomepageConfigHandler(svc *service.HomepageConfigService, publishers ...homepageMenuPublisher) *HomepageConfigHandler {
	var publisher homepageMenuPublisher
	if len(publishers) > 0 {
		publisher = publishers[0]
	}
	return &HomepageConfigHandler{provider: svc, publisher: publisher}
}

// SetMenuReconciler 注册扩展公网地址从未配置变为可用时的补偿同步，
// 用于补上此前因缺少地址而未能写入的发票、工单、促销等入口。
func (h *HomepageConfigHandler) SetMenuReconciler(reconcile func(context.Context) error) {
	if h != nil {
		h.reconcile = reconcile
	}
}

func (h *HomepageConfigHandler) GetPublicConfig(c *gin.Context) {
	h.get(c, true)
}

func (h *HomepageConfigHandler) GetConfig(c *gin.Context) {
	h.get(c, false)
}

func (h *HomepageConfigHandler) get(c *gin.Context, fallbackToDefaults bool) {
	if h == nil || h.provider == nil {
		response.Success(c, service.DefaultHomepageConfig())
		return
	}
	config, err := h.provider.Get(c.Request.Context())
	if err != nil {
		log.Printf("[HomepageConfigHandler] failed to read config fallback=%t: %v", fallbackToDefaults, err)
		// 公开首页在配置库暂时不可用时仍然可用默认文案；管理员读取则提示错误。
		if fallbackToDefaults {
			response.Success(c, service.DefaultHomepageConfig())
			return
		}
		response.InternalError(c, "failed to fetch homepage config")
		return
	}
	if fallbackToDefaults {
		config.Sub2APIPublished = false
		config.ClientImportPublished = false
		config.AsyncTasksPublished = false
		config.ExtensionPublicURL = ""
		response.Success(c, config)
		return
	}
	response.Success(c, h.adminView(c.Request.Context(), config))
}

func (h *HomepageConfigHandler) adminView(ctx context.Context, config service.HomepageConfig) homepageConfigAdminView {
	view := homepageConfigAdminView{HomepageConfig: config}
	if info, ok := h.publisher.(menuPublicationInfo); ok {
		view.MenuPublication.EffectiveURL, view.MenuPublication.Source = info.EffectivePublicURL(ctx)
		view.MenuPublication.Available = info.MenuPublishAvailable(ctx)
	}
	return view
}

func (h *HomepageConfigHandler) effectivePublicURL(ctx context.Context) string {
	if info, ok := h.publisher.(menuPublicationInfo); ok {
		base, _ := info.EffectivePublicURL(ctx)
		return base
	}
	return ""
}

func (h *HomepageConfigHandler) UpdateConfig(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.InternalError(c, "homepage config store is unavailable")
		return
	}
	var config service.HomepageConfig
	if err := c.ShouldBindJSON(&config); err != nil {
		log.Printf("[HomepageConfigHandler.UpdateConfig] invalid request body: %v", err)
		response.BadRequest(c, "invalid homepage config")
		return
	}
	ctx := c.Request.Context()
	previousBase := h.effectivePublicURL(ctx)
	saved, err := h.provider.Save(ctx, config)
	if err != nil {
		if errors.Is(err, service.ErrInvalidExtensionPublicURL) {
			response.BadRequest(c, "invalid extension public URL")
			return
		}
		log.Printf("[HomepageConfigHandler.UpdateConfig] save failed: %v", err)
		response.InternalError(c, "failed to save homepage config")
		return
	}
	syncFailed := false
	currentBase := h.effectivePublicURL(ctx)
	if previousBase != "" && currentBase != "" && previousBase != currentBase {
		if rebaser, ok := h.publisher.(publicURLRebaser); ok {
			// 先迁移已上架菜单的前缀，避免旧域名入口残留成死链。
			if err := rebaser.RebasePublicURL(ctx, previousBase, currentBase); err != nil {
				log.Printf("[HomepageConfigHandler.UpdateConfig] rebase menu public URL failed: %v", err)
				syncFailed = true
			}
		}
	}
	if h.publisher != nil {
		if err := h.publisher.SetHomepageMenu(ctx, saved.Sub2APIPublished, saved.SiteName); err != nil {
			log.Printf("[HomepageConfigHandler.UpdateConfig] homepage menu sync failed published=%t: %v", saved.Sub2APIPublished, err)
			syncFailed = true
		}
	}
	if publisher, ok := h.publisher.(clientImportMenuPublisher); ok {
		if err := publisher.SetClientImportMenu(ctx, saved.ClientImportPublished); err != nil {
			log.Printf("[HomepageConfigHandler.UpdateConfig] client import menu sync failed published=%t: %v", saved.ClientImportPublished, err)
			syncFailed = true
		}
	}
	if publisher, ok := h.publisher.(asyncTaskMenuPublisher); ok {
		if err := publisher.SetAsyncTaskMenu(ctx, saved.AsyncTasksPublished); err != nil {
			log.Printf("[HomepageConfigHandler.UpdateConfig] async task menu sync failed published=%t: %v", saved.AsyncTasksPublished, err)
			syncFailed = true
		}
	}
	if previousBase == "" && currentBase != "" && h.reconcile != nil {
		if err := h.reconcile(ctx); err != nil {
			log.Printf("[HomepageConfigHandler.UpdateConfig] feature menu reconcile failed: %v", err)
			syncFailed = true
		}
	}
	view := h.adminView(ctx, saved)
	if syncFailed {
		response.SuccessWithReason(c, view, "homepage config saved with warning", "系统配置已保存，但 Sub2API 菜单同步失败，请检查数据库连接和公开域名")
		return
	}
	response.Success(c, view)
}
