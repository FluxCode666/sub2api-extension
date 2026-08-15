import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  exchangeSession,
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
})
