// Package service 提供附属内容系统的业务逻辑层。
//
// auth_service 负责管理员会话的签发与校验,以及转发验证结果的 TTL 缓存。
//
// 设计要点:
//   - 两套 JWT 严格区分: sub2api JWT(用户持有,转发给 sub2api 验证) vs 附属系统 JWT(本服务签发,存前端)。
//   - 缓存: 用 sub2api token 的 SHA-256 哈希作键,缓存验证结果(TTL 默认 5 分钟),避免每次请求回查 sub2api。
//   - 失败关闭: sub2api 不可达时不签发会话(由 handler 层返回 503)。
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"sync"
	"time"

	"aux-system/internal/integration"

	"github.com/golang-jwt/jwt/v5"
)

// 附属系统管理员会话 JWT 的 claims。
type auxAdminClaims struct {
	UserID   int64  `json:"user_id"`
	Email    string `json:"email"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// cachedVerification 缓存的转发验证结果。
type cachedVerification struct {
	isAdmin bool
	user    *integration.Sub2APIUserInfo
	at      time.Time
}

// ErrNotAdmin 非 admin 角色被拒绝。
var ErrNotAdmin = errors.New("sub2api user is not an admin")

// ErrInvalidSub2APIToken sub2api 判定 token 无效或过期。
var ErrInvalidSub2APIToken = errors.New("invalid or expired sub2api token")

// 不可达错误复用 integration.ErrSub2APIUnreachable(同一哨兵), 避免跨包定义两个
// 同名同消息的错误导致 errors.Is 失配的混淆风险。service 层用 %w 包装该哨兵,
// 使 errors.Is(err, integration.ErrSub2APIUnreachable) 对 service 层错误同样成立。

// AuthService 管理管理员会话签发/校验与转发验证缓存。
type AuthService struct {
	// adminVerifier 是 sub2api 转发验证的抽象接口,
	// 使测试可注入 mock(不依赖真实 HTTP)。*integration.Sub2APIClient 实现该接口。
	client    adminVerifier
	secret    []byte
	expireDur time.Duration
	cacheTTL  time.Duration

	mu    sync.Mutex
	cache map[string]cachedVerification
}

// adminVerifier 抽象 sub2api 转发验证能力。
type adminVerifier interface {
	VerifyAdminJWT(ctx context.Context, token string) (bool, *integration.Sub2APIUserInfo, error)
}

// NewAuthService 创建 auth service。
//   - secret: 附属系统 JWT 签名密钥
//   - expireHour: 附属会话有效期(小时)
//   - cacheTTL: 转发验证结果缓存 TTL(0 表示使用默认 5 分钟)
func NewAuthService(client *integration.Sub2APIClient, secret string, expireHour int, cacheTTL time.Duration) *AuthService {
	if expireHour <= 0 {
		expireHour = 24
	}
	if cacheTTL <= 0 {
		cacheTTL = 5 * time.Minute
	}
	return &AuthService{
		client:    client,
		secret:    []byte(secret),
		expireDur: time.Duration(expireHour) * time.Hour,
		cacheTTL:  cacheTTL,
		cache:     make(map[string]cachedVerification),
	}
}

// NewAuthServiceForSigning 创建仅用于签发/校验会话的 service(不含 sub2api client)。
// 供中间件测试与不涉及转发验证的场景使用。expireHour<=0 时用默认 24 小时。
func NewAuthServiceForSigning(secret string, expireHour int) *AuthService {
	dur := time.Duration(24) * time.Hour
	if expireHour > 0 {
		dur = time.Duration(expireHour) * time.Hour
	}
	return &AuthService{
		secret:    []byte(secret),
		expireDur: dur,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}
}

// VerifyAdminToken 转发 sub2api token 验证,带 TTL 缓存。
//
// 返回:
//   - user: 用户信息(admin 时)
//   - err: ErrNotAdmin / ErrInvalidSub2APIToken / 包装了 integration.ErrSub2APIUnreachable 的错误
func (s *AuthService) VerifyAdminToken(ctx context.Context, sub2apiToken string) (*integration.Sub2APIUserInfo, error) {
	key := tokenHash(sub2apiToken)

	// 查缓存(未过期则直接用)
	s.mu.Lock()
	if entry, ok := s.cache[key]; ok {
		fresh := time.Since(entry.at) < s.cacheTTL
		s.mu.Unlock()
		if fresh {
			if !entry.isAdmin {
				return nil, ErrNotAdmin
			}
			return entry.user, nil
		}
		// 过期: 删除并回查
		s.mu.Lock()
		delete(s.cache, key)
		s.mu.Unlock()
	} else {
		s.mu.Unlock()
	}

	// 回查 sub2api
	isAdmin, user, err := s.client.VerifyAdminJWT(ctx, sub2apiToken)
	if err != nil {
		if errors.Is(err, integration.ErrInvalidToken) {
			return nil, ErrInvalidSub2APIToken
		}
		// 网络/不可达/5xx → 失败关闭。用 %w 包装 integration 哨兵,
		// 使调用方可用 errors.Is(err, integration.ErrSub2APIUnreachable) 判定 503。
		return nil, fmt.Errorf("%w: %v", integration.ErrSub2APIUnreachable, err)
	}

	// 写缓存
	s.mu.Lock()
	s.cache[key] = cachedVerification{
		isAdmin: isAdmin,
		user:    user,
		at:      time.Now(),
	}
	s.mu.Unlock()

	if !isAdmin {
		return nil, ErrNotAdmin
	}
	return user, nil
}

// IssueSession 签发附属系统管理员会话 JWT。
func (s *AuthService) IssueSession(user *integration.Sub2APIUserInfo) (string, error) {
	return s.issueSessionWithExpiry(user, s.expireDur)
}

// issueSessionWithExpiry 用指定有效期签发会话(测试辅助)。
func (s *AuthService) issueSessionWithExpiry(user *integration.Sub2APIUserInfo, dur time.Duration) (string, error) {
	now := time.Now()
	claims := auxAdminClaims{
		UserID:   user.ID,
		Email:    user.Email,
		Username: user.Username,
		Role:     user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(dur)),
			Issuer:    "aux-system",
			Subject:   fmt.Sprintf("%d", user.ID),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.secret)
}

// IssueExpiredSession 签发一个已过期的会话(测试辅助)。
func (s *AuthService) IssueExpiredSession(user *integration.Sub2APIUserInfo) (string, error) {
	return s.issueSessionWithExpiry(user, -1*time.Hour)
}

// ValidateSession 校验附属系统会话 JWT,返回 claims 或错误。
func (s *AuthService) ValidateSession(tokenStr string) (*auxAdminClaims, error) {
	claims := &auxAdminClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return s.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("invalid aux session: %w", err)
	}
	if !token.Valid {
		return nil, errors.New("invalid aux session token")
	}
	return claims, nil
}

// tokenHash 返回 token 的 SHA-256 哈希十六进制串,用作缓存键。
func tokenHash(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}
