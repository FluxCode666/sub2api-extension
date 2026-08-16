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

function makeSessionToken(expiresInSeconds = 3600): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
  })}.test-signature`
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
      const sessionToken = makeSessionToken()
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: sessionToken,
            user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
          },
        }),
      )

      const result = await exchangeSession()

      expect(result.ok).toBe(true)
      expect(result.session?.token).toBe(sessionToken)
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

    it('rejects an expired session returned by a successful exchange', async () => {
      initEmbeddedContext('?token=sub2api-jwt')
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: makeSessionToken(-60),
            user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
          },
        }),
      )

      expect(await exchangeSession()).toEqual({ ok: false, error: 'unknown' })
      expect(getAdminSession()).toBeNull()
    })
  })

  describe('session storage', () => {
    it('persists and retrieves admin session', async () => {
      initEmbeddedContext('?token=sub2api-jwt')
      const sessionToken = makeSessionToken()
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: sessionToken,
            user: { id: 7, email: 'x@y.com', username: 'x', role: 'admin' },
          },
        }),
      )

      await exchangeSession()

      // 从内存取
      const session = getAdminSession()
      expect(session?.token).toBe(sessionToken)
      expect(session?.user.id).toBe(7)

      // token 便捷取
      expect(getAdminSessionToken()).toBe(sessionToken)

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
            session_token: makeSessionToken(),
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

    it('clears an expired persisted session', () => {
      store.aux_admin_session = JSON.stringify({
        token: makeSessionToken(-60),
        user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
      })

      expect(getAdminSession()).toBeNull()
      expect(store.aux_admin_session).toBeUndefined()
    })

    it('clears a malformed persisted session', () => {
      store.aux_admin_session = JSON.stringify({
        token: makeSessionToken(),
        user: { id: 'not-a-number', role: 'admin' },
      })

      expect(getAdminSession()).toBeNull()
      expect(store.aux_admin_session).toBeUndefined()
    })

    it('clears a persisted token with an invalid JWT header', () => {
      const payload = Buffer.from(
        JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }),
      ).toString('base64url')
      store.aux_admin_session = JSON.stringify({
        token: `not-json.${payload}.test-signature`,
        user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
      })

      expect(getAdminSession()).toBeNull()
      expect(store.aux_admin_session).toBeUndefined()
    })

    it('clears a persisted token with an invalid signature segment', () => {
      const token = makeSessionToken().split('.')
      token[2] = 'invalid+signature'
      store.aux_admin_session = JSON.stringify({
        token: token.join('.'),
        user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
      })

      expect(getAdminSession()).toBeNull()
      expect(store.aux_admin_session).toBeUndefined()
    })
  })

  describe('loginWithCredentials', () => {
    it('logs in with email+password and saves session on success', async () => {
      const sessionToken = makeSessionToken()
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: sessionToken,
            user: { id: 1, email: 'admin@sub2api.local', username: '', role: 'admin' },
          },
        }),
      )

      const result = await loginWithCredentials('admin@sub2api.local', '123456')

      expect(result.ok).toBe(true)
      expect(result.session?.token).toBe(sessionToken)
      expect(result.session?.user.role).toBe('admin')
      // 会话已保存
      expect(getAdminSessionToken()).toBe(sessionToken)

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

    it('rejects a non-admin session returned by a successful login', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(200, {
          code: 0,
          message: 'success',
          data: {
            session_token: makeSessionToken(),
            user: { id: 2, email: 'user@e.com', username: 'user', role: 'user' },
          },
        }),
      )

      expect(await loginWithCredentials('user@e.com', 'pass')).toEqual({
        ok: false,
        error: 'unknown',
      })
      expect(getAdminSession()).toBeNull()
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
