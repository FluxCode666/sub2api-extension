import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  exchangeSession,
  loginWithCredentials,
  getAdminSession,
  getAdminSessionToken,
  clearAdminSession,
} from './admin-auth'
import { initEmbeddedContext } from './embedded'

// mock fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// mock localStorage
const store: Record<string, string> = {}
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, val: string) => {
    store[key] = val
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key]
  }),
  clear: vi.fn(() => {
    for (const k of Object.keys(store)) delete store[k]
  }),
}
vi.stubGlobal('localStorage', localStorageMock)

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('admin-auth', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    localStorageMock.clear()
    // 重置内存会话
    clearAdminSession()
    // 默认无嵌入 token
    initEmbeddedContext('')
  })

  afterEach(() => {
    initEmbeddedContext('')
  })

  describe('exchangeSession', () => {
    it('returns no-embedded-token when no iframe token present', async () => {
      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('no-embedded-token')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('exchanges embedded token for admin session on success', async () => {
      initEmbeddedContext('?token=sub2api-jwt-123')
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: 'aux-session-jwt',
            user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
          },
        }),
      )

      const result = await exchangeSession()

      expect(result.ok).toBe(true)
      expect(result.session?.token).toBe('aux-session-jwt')
      expect(result.session?.user.role).toBe('admin')
      // 请求体应带 sub2api token
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/admin/session')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ token: 'sub2api-jwt-123' })
    })

    it('returns forbidden on 403 (non-admin)', async () => {
      initEmbeddedContext('?token=user-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(403, { code: 403, message: 'admin access required' }),
      )

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('forbidden')
    })

    it('returns unauthorized on 401 (invalid sub2api token)', async () => {
      initEmbeddedContext('?token=expired-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(401, { code: 401, message: 'invalid or expired sub2api token' }),
      )

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unauthorized')
    })

    it('returns unreachable on 503 (sub2api down)', async () => {
      initEmbeddedContext('?token=some-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(503, { code: 503, message: 'sub2api unreachable' }),
      )

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unreachable')
    })

    it('returns unreachable on network error (fetch throws)', async () => {
      initEmbeddedContext('?token=some-jwt')
      fetchMock.mockRejectedValueOnce(new Error('network error'))

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unreachable')
    })

    it('returns bad-request on 400', async () => {
      initEmbeddedContext('?token=some-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(400, { code: 400, message: 'token is required' }),
      )

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('bad-request')
    })

    it('returns unknown on unexpected success envelope', async () => {
      initEmbeddedContext('?token=some-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { code: 0, message: 'success' }), // 缺 data
      )

      const result = await exchangeSession()
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unknown')
    })
  })

  describe('session storage', () => {
    it('persists and retrieves admin session', async () => {
      initEmbeddedContext('?token=sub2api-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: 'persisted-jwt',
            user: { id: 7, email: 'x@y.com', username: 'x', role: 'admin' },
          },
        }),
      )

      await exchangeSession()

      // 从内存取
      const session = getAdminSession()
      expect(session?.token).toBe('persisted-jwt')
      expect(session?.user.id).toBe(7)

      // token 便捷取
      expect(getAdminSessionToken()).toBe('persisted-jwt')

      // 持久化到 localStorage
      expect(localStorageMock.setItem).toHaveBeenCalled()
    })

    it('clears admin session', async () => {
      initEmbeddedContext('?token=sub2api-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: 'to-clear',
            user: { id: 1, email: 'a@b.com', username: 'a', role: 'admin' },
          },
        }),
      )

      await exchangeSession()
      expect(getAdminSession()).not.toBeNull()

      clearAdminSession()
      expect(getAdminSession()).toBeNull()
      expect(getAdminSessionToken()).toBeNull()
    })

    it('returns null when no session exists', () => {
      expect(getAdminSession()).toBeNull()
      expect(getAdminSessionToken()).toBeNull()
    })
  })

  describe('loginWithCredentials', () => {
    it('logs in with email+password and saves session on success', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: 'aux-login-jwt',
            user: { id: 1, email: 'admin@sub2api.local', username: '', role: 'admin' },
          },
        }),
      )

      const result = await loginWithCredentials('admin@sub2api.local', '123456')

      expect(result.ok).toBe(true)
      expect(result.session?.token).toBe('aux-login-jwt')
      expect(result.session?.user.role).toBe('admin')
      // 会话已保存
      expect(getAdminSessionToken()).toBe('aux-login-jwt')

      // 请求体应带 email+password
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/admin/login')
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({
        email: 'admin@sub2api.local',
        password: '123456',
      })
    })

    it('returns invalid-credentials on 401', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(401, { code: 401, message: '邮箱或密码错误' }),
      )

      const result = await loginWithCredentials('a@b.com', 'wrong')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('invalid-credentials')
    })

    it('returns forbidden on 403 with NOT_ADMIN reason', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(403, {
          code: 403,
          message: '仅管理员可登录',
          reason: 'NOT_ADMIN',
        }),
      )

      const result = await loginWithCredentials('user@e.com', 'pass')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('forbidden')
    })

    it('returns two-factor on 403 with TWO_FACTOR_REQUIRED reason', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(403, {
          code: 403,
          message: '该账号已开启两步验证,暂不支持',
          reason: 'TWO_FACTOR_REQUIRED',
        }),
      )

      const result = await loginWithCredentials('2fa@e.com', 'pass')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('two-factor')
    })

    it('returns unreachable on 503', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(503, { code: 503, message: '无法连接 sub2api 服务' }),
      )

      const result = await loginWithCredentials('a@b.com', 'pass')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unreachable')
    })

    it('returns unreachable on network error (fetch throws)', async () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'))

      const result = await loginWithCredentials('a@b.com', 'pass')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unreachable')
    })

    it('returns bad-request on 400', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(400, { code: 400, message: 'email and password are required' }),
      )

      const result = await loginWithCredentials('', '')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('bad-request')
    })

    it('returns unknown on unexpected success envelope', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, { code: 0, message: 'success' }), // 缺 data
      )

      const result = await loginWithCredentials('a@b.com', 'pass')
      expect(result.ok).toBe(false)
      expect(result.error).toBe('unknown')
    })

    it('returns unknown when a successful response body is not JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token')
        },
      })

      const result = await loginWithCredentials('a@b.com', 'pass')
      expect(result).toEqual({ ok: false, error: 'unknown' })
    })
  })
})
