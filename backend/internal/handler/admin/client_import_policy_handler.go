package admin

import (
	"context"
	"errors"
	"log"

	"aux-system/internal/integration"
	"aux-system/internal/pkg/response"
	"aux-system/internal/service"

	"github.com/gin-gonic/gin"
)

type clientImportPolicyProvider interface {
	Get(ctx context.Context) (service.ClientImportPolicy, error)
	Save(ctx context.Context, policy service.ClientImportPolicy) (service.ClientImportPolicy, error)
}

type clientImportGroupLister interface {
	ListGroups(ctx context.Context) ([]integration.Sub2APIGroup, error)
}

// ClientImportPolicyHandler 管理客户端导入限制，并提供只读的 Sub2API 分组列表供选择。
type ClientImportPolicyHandler struct {
	provider clientImportPolicyProvider
	groups   clientImportGroupLister
}

func NewClientImportPolicyHandler(provider *service.ClientImportPolicyService, groups *integration.Sub2APIGroupStore) *ClientImportPolicyHandler {
	return &ClientImportPolicyHandler{provider: provider, groups: groups}
}

// GetPolicy handles GET /api/aux/admin/client-import/policy.
func (h *ClientImportPolicyHandler) GetPolicy(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.ServiceUnavailable(c, "client import policy is unavailable")
		return
	}
	policy, err := h.provider.Get(c.Request.Context())
	if err != nil {
		log.Printf("[ClientImportPolicyHandler.GetPolicy] failed: %v", err)
		response.InternalError(c, "failed to load client import policy")
		return
	}
	response.Success(c, policy)
}

// UpdatePolicy handles PUT /api/aux/admin/client-import/policy.
func (h *ClientImportPolicyHandler) UpdatePolicy(c *gin.Context) {
	if h == nil || h.provider == nil {
		response.ServiceUnavailable(c, "client import policy is unavailable")
		return
	}
	var request service.ClientImportPolicy
	if err := c.ShouldBindJSON(&request); err != nil {
		response.BadRequest(c, "invalid client import policy")
		return
	}
	saved, err := h.provider.Save(c.Request.Context(), request)
	if err != nil {
		if errors.Is(err, service.ErrInvalidClientImportPolicy) {
			response.BadRequest(c, err.Error())
			return
		}
		log.Printf("[ClientImportPolicyHandler.UpdatePolicy] failed: %v", err)
		response.InternalError(c, "failed to save client import policy")
		return
	}
	response.Success(c, saved)
}

// ListGroups handles GET /api/aux/admin/client-import/groups.
func (h *ClientImportPolicyHandler) ListGroups(c *gin.Context) {
	if h == nil || h.groups == nil {
		response.ServiceUnavailable(c, "sub2api database is unavailable")
		return
	}
	groups, err := h.groups.ListGroups(c.Request.Context())
	if err != nil {
		if errors.Is(err, service.ErrSub2APIDatabaseUnavailable) {
			response.ServiceUnavailable(c, "sub2api database is unavailable")
			return
		}
		log.Printf("[ClientImportPolicyHandler.ListGroups] failed: %v", err)
		response.InternalError(c, "failed to list sub2api groups")
		return
	}
	response.Success(c, gin.H{"items": groups})
}
