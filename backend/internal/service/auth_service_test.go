package service

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"sub2api-extension/internal/integration"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeSub2APIClient 是可记录调用次数的 mock,用于验证缓存 TTL 行为。
type fakeSub2APIClient struct {
	verifyCount int32
	isAdmin     bool
	user        *integration.Sub2APIUserInfo
	err         error

	// Login 返回控制(供 LoginAdmin 测试)
	loginResp *integration.Sub2APILoginResponse
	loginErr  error
}

func (f *fakeSub2APIClient) callCount() int32 {
	return atomic.LoadInt32(&f.verifyCount)
}

func (f *fakeSub2APIClient) VerifyAdminJWT(ctx context.Context, token string) (bool, *integration.Sub2APIUserInfo, error) {
	atomic.AddInt32(&f.verifyCount, 1)
	return f.isAdmin, f.user, f.err
}

func (f *fakeSub2APIClient) Login(ctx context.Context, req integration.Sub2APILoginRequest) (*integration.Sub2APILoginResponse, error) {
	return f.loginResp, f.loginErr
}

func TestVerifyAdminToken_AdminThroughCache(t *testing.T) {
	fake := &fakeSub2APIClient{
		isAdmin: true,
		user: &integration.Sub2APIUserInfo{
			ID: 1, Email: "admin@example.com", Username: "admin", Role: "admin",
		},
	}
	svc := &AuthService{
		client:    fake, // fakeSub2APIClient 实现 adminVerifier 接口
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}

	user, err := svc.VerifyAdminToken(context.Background(), "admin-token-1")
	require.NoError(t, err)
	assert.Equal(t, "admin", user.Role)
	assert.Equal(t, int32(1), fake.callCount(), "首次应回查 sub2api")

	// 同一 token 再验证: 应命中缓存,不回查
	user2, err := svc.VerifyAdminToken(context.Background(), "admin-token-1")
	require.NoError(t, err)
	assert.Equal(t, "admin", user2.Role)
	assert.Equal(t, int32(1), fake.callCount(), "缓存命中,不应再次回查 sub2api")
}

func TestVerifyAdminToken_NotAdmin(t *testing.T) {
	fake := &fakeSub2APIClient{
		isAdmin: false,
		user:    &integration.Sub2APIUserInfo{ID: 2, Role: "user"},
	}
	svc := &AuthService{
		client:    fake,
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}

	_, err := svc.VerifyAdminToken(context.Background(), "user-token")
	assert.True(t, errors.Is(err, ErrNotAdmin))
}

func TestVerifyAdminToken_InvalidToken(t *testing.T) {
	fake := &fakeSub2APIClient{
		err: integration.ErrInvalidToken,
	}
	svc := &AuthService{
		client:    fake,
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}

	_, err := svc.VerifyAdminToken(context.Background(), "bad-token")
	assert.True(t, errors.Is(err, ErrInvalidSub2APIToken))
}

func TestVerifyAdminToken_Unreachable(t *testing.T) {
	fake := &fakeSub2APIClient{
		err: errors.New("connection refused"),
	}
	svc := &AuthService{
		client:    fake,
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}

	_, err := svc.VerifyAdminToken(context.Background(), "some-token")
	assert.True(t, errors.Is(err, integration.ErrSub2APIUnreachable), "不可达应包装 integration.ErrSub2APIUnreachable")
}

func TestIssueAndValidateSession(t *testing.T) {
	svc := &AuthService{
		client:    &fakeSub2APIClient{},
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}

	user := &integration.Sub2APIUserInfo{
		ID: 42, Email: "admin@example.com", Username: "admin", Role: "admin",
	}

	token, err := svc.IssueSession(user)
	require.NoError(t, err)
	assert.NotEmpty(t, token)

	// 校验有效会话
	claims, err := svc.ValidateSession(token)
	require.NoError(t, err)
	assert.Equal(t, int64(42), claims.UserID)
	assert.Equal(t, "admin@example.com", claims.Email)
	assert.Equal(t, "admin", claims.Role)
	assert.Equal(t, "sub2api-extension", claims.Issuer)
}

func TestValidateSession_Invalid(t *testing.T) {
	svc := &AuthService{
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cache:     make(map[string]cachedVerification),
	}

	_, err := svc.ValidateSession("not-a-valid-jwt")
	assert.Error(t, err)
}

func TestValidateSession_WrongSecret(t *testing.T) {
	signSvc := &AuthService{
		secret:    []byte("secret-a"),
		expireDur: time.Hour,
		cache:     make(map[string]cachedVerification),
	}
	verifySvc := &AuthService{
		secret:    []byte("secret-b"),
		expireDur: time.Hour,
		cache:     make(map[string]cachedVerification),
	}

	user := &integration.Sub2APIUserInfo{ID: 1, Role: "admin"}
	token, err := signSvc.IssueSession(user)
	require.NoError(t, err)

	_, err = verifySvc.ValidateSession(token)
	assert.Error(t, err, "不同密钥签发的 token 应校验失败")
}

func TestValidateSession_Expired(t *testing.T) {
	svc := NewAuthServiceForSigning("test-secret", 1)

	user := &integration.Sub2APIUserInfo{ID: 1, Role: "admin"}
	token, err := svc.IssueExpiredSession(user)
	require.NoError(t, err)

	_, err = svc.ValidateSession(token)
	assert.Error(t, err, "过期会话应校验失败")
}

func TestVerifyAdminToken_CacheExpiry(t *testing.T) {
	fake := &fakeSub2APIClient{
		isAdmin: true,
		user:    &integration.Sub2APIUserInfo{ID: 1, Role: "admin"},
	}
	svc := &AuthService{
		client:    fake,
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  50 * time.Millisecond, // 极短 TTL
		cache:     make(map[string]cachedVerification),
	}

	// 首次验证
	_, err := svc.VerifyAdminToken(context.Background(), "token-x")
	require.NoError(t, err)
	assert.Equal(t, int32(1), fake.callCount())

	// 等 TTL 过期
	time.Sleep(80 * time.Millisecond)

	// 再次验证: 缓存已过期,应回查
	_, err = svc.VerifyAdminToken(context.Background(), "token-x")
	require.NoError(t, err)
	assert.Equal(t, int32(2), fake.callCount(), "TTL 过期后应重新回查")
}

// ============ LoginAdmin 测试 ============

func newLoginService(fake *fakeSub2APIClient) *AuthService {
	return &AuthService{
		client:    fake,
		secret:    []byte("test-secret"),
		expireDur: time.Hour,
		cacheTTL:  5 * time.Minute,
		cache:     make(map[string]cachedVerification),
	}
}

func TestLoginAdmin_AdminSuccess(t *testing.T) {
	fake := &fakeSub2APIClient{
		loginResp: &integration.Sub2APILoginResponse{
			AccessToken: "sub2api-jwt",
			User: integration.Sub2APIUserInfo{
				ID: 1, Email: "admin@example.com", Username: "admin", Role: "admin",
			},
		},
	}
	svc := newLoginService(fake)

	user, err := svc.LoginAdmin(context.Background(), "admin@example.com", "pass")
	require.NoError(t, err)
	require.NotNil(t, user)
	assert.Equal(t, "admin", user.Role)
	assert.Equal(t, int64(1), user.ID)
}

func TestLoginAdmin_NotAdmin(t *testing.T) {
	fake := &fakeSub2APIClient{
		loginResp: &integration.Sub2APILoginResponse{
			User: integration.Sub2APIUserInfo{
				ID: 2, Email: "user@example.com", Role: "user",
			},
		},
	}
	svc := newLoginService(fake)

	_, err := svc.LoginAdmin(context.Background(), "user@example.com", "pass")
	assert.ErrorIs(t, err, ErrNotAdmin)
}

func TestLoginAdmin_TwoFactorRequired(t *testing.T) {
	fake := &fakeSub2APIClient{
		loginResp: &integration.Sub2APILoginResponse{
			Requires2FA: true,
			TempToken:   "tt-2fa",
		},
	}
	svc := newLoginService(fake)

	_, err := svc.LoginAdmin(context.Background(), "2fa@example.com", "pass")
	assert.ErrorIs(t, err, ErrTwoFactorRequired)
}

func TestLoginAdmin_InvalidCredentials(t *testing.T) {
	fake := &fakeSub2APIClient{
		loginErr: integration.ErrInvalidCredentials,
	}
	svc := newLoginService(fake)

	_, err := svc.LoginAdmin(context.Background(), "x@example.com", "wrong")
	assert.ErrorIs(t, err, integration.ErrInvalidCredentials)
}

func TestLoginAdmin_Unreachable(t *testing.T) {
	fake := &fakeSub2APIClient{
		loginErr: errors.New("connection refused"),
	}
	svc := newLoginService(fake)

	_, err := svc.LoginAdmin(context.Background(), "x@example.com", "pass")
	// 非 ErrInvalidCredentials 的错误应被包装为 ErrSub2APIUnreachable
	assert.ErrorIs(t, err, integration.ErrSub2APIUnreachable)
}
