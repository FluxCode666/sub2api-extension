package handler

import (
	"errors"
	"log"
	"net/http"
	"strconv"

	"sub2api-extension/internal/integration"
	"sub2api-extension/internal/pkg/response"
	"sub2api-extension/internal/server/middleware"
	"sub2api-extension/internal/service"

	"github.com/gin-gonic/gin"
)

// PromotionUserHandler exposes the authenticated user's current and ended
// promotions, orders and claim history. The user ID always comes from UserGuard.
type PromotionUserHandler struct {
	service  *service.PromotionService
	verifier *integration.Sub2APIClient
}

func NewPromotionUserHandler(svc *service.PromotionService, verifier *integration.Sub2APIClient) *PromotionUserHandler {
	return &PromotionUserHandler{service: svc, verifier: verifier}
}
func (h *PromotionUserHandler) Guard() gin.HandlerFunc {
	if h == nil {
		return middleware.UserGuard(nil)
	}
	return middleware.UserGuard(h.verifier)
}

func (h *PromotionUserHandler) List(c *gin.Context) {
	items, err := h.service.List(c.Request.Context(), true)
	if err != nil {
		log.Printf("[PromotionUserHandler.List] failed: %v", err)
		response.InternalError(c, "failed to list promotions")
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *PromotionUserHandler) Orders(c *gin.Context) {
	user, ok := promotionAuthenticatedUser(c)
	if !ok {
		return
	}
	id, valid := promotionIDParam(c)
	if !valid {
		return
	}
	items, err := h.service.ListPublicOrders(c.Request.Context(), user.ID, id)
	if err != nil {
		handlePromotionUserError(c, err)
		return
	}
	response.Success(c, gin.H{"items": items})
}

func (h *PromotionUserHandler) Claim(c *gin.Context) {
	user, ok := promotionAuthenticatedUser(c)
	if !ok {
		return
	}
	id, valid := promotionIDParam(c)
	if !valid {
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32*1024)
	var input service.PromotionClaimInput
	if err := c.ShouldBindJSON(&input); err != nil {
		response.BadRequest(c, "invalid promotion claim request")
		return
	}
	claims, err := h.service.Claim(c.Request.Context(), user.ID, id, input)
	if err != nil {
		handlePromotionUserError(c, err)
		return
	}
	response.Created(c, gin.H{"items": claims})
}

func (h *PromotionUserHandler) Claims(c *gin.Context) {
	user, ok := promotionAuthenticatedUser(c)
	if !ok {
		return
	}
	items, err := h.service.ListClaims(c.Request.Context(), user.ID)
	if err != nil {
		log.Printf("[PromotionUserHandler.Claims] failed user_id=%d: %v", user.ID, err)
		response.InternalError(c, "failed to list promotion claims")
		return
	}
	response.Success(c, gin.H{"items": items})
}

func promotionAuthenticatedUser(c *gin.Context) (*integration.Sub2APIUserInfo, bool) {
	value, ok := c.Get(string(middleware.ContextKeySub2APIUser))
	user, valid := value.(*integration.Sub2APIUserInfo)
	if !ok || !valid || user == nil {
		response.Unauthorized(c, "valid sub2api login is required")
		return nil, false
	}
	return user, true
}
func promotionIDParam(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		response.BadRequest(c, "invalid promotion ID")
		return 0, false
	}
	return id, true
}

func handlePromotionUserError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, service.ErrPromotionNotFound):
		response.Error(c, http.StatusNotFound, "promotion not found")
	case errors.Is(err, service.ErrPromotionInactive):
		response.Forbidden(c, "promotion is not active")
	case errors.Is(err, service.ErrPromotionOrderClaimed):
		response.Error(c, http.StatusConflict, "one or more selected orders have already been claimed")
	case errors.Is(err, service.ErrPromotionOrderInvalid):
		response.BadRequest(c, "one or more selected orders are unavailable")
	case errors.Is(err, service.ErrPromotionBalanceUnavailable):
		response.ServiceUnavailable(c, "promotion balance credit is temporarily unavailable")
	case errors.Is(err, service.ErrSub2APIDatabaseUnavailable):
		response.ServiceUnavailable(c, "sub2api order data is unavailable")
	default:
		log.Printf("[PromotionUserHandler] failed: %v", err)
		response.InternalError(c, "failed to process promotion")
	}
}
