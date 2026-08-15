/**
 * api-client 单元测试 (#2)。
 *
 * 覆盖契约点:
 *   - buildHeaders: 存在会话 token 时附加 X-Aux-Session;
 *     存在嵌入 token 时附加 X-Aux-Token; 两者可并存; 无则都不附加。
 *   - apiRequest: POST 含 Content-Type 与序列化 body; 非 ok 抛含状态码 Error。
 *   - apiClient.get/post 正确委托。
 *
 * 这些是前端↔后端认证头契约(X-Aux-Session)的关键测试: 若头名漂移,
 * 所有受守卫 admin 请求静默 401。历史 bug 接缝, 必须有回归保护。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { AUX_API_BASE_URL } from './api-base'

// mock fetch
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// mock admin-auth: 控制 getAdminSessionToken 返回值与 ADMIN_SESSION_HEADER 常量
vi.mock('./admin-auth', () => ({
  getAdminSessionToken: vi.fn(() => null),
  ADMIN_SESSION_HEADER: 'X-Aux-Session',
}))
// mock embedded: 控制 getEmbeddedContext 返回值
vi.mock('./embedded', () => ({
  getEmbeddedContext: vi.fn(() => null),
}))

import { apiClient, apiRequest, type AuxEnvelope } from './api-client'
import { getAdminSessionToken } from './admin-auth'
import { getEmbeddedContext } from './embedded'

const mockedGetToken = vi.mocked(getAdminSessionToken)
const mockedGetCtx = vi.mocked(getEmbeddedContext)

function mockResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    json: async () => body,
  }
}

describe('api-client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    mockedGetToken.mockReturnValue(null)
    mockedGetCtx.mockReturnValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('points baseURL at the aux backend', () => {
    expect(AUX_API_BASE_URL).toBe('/api/aux')
  })

  describe('buildHeaders via apiRequest', () => {
    it('attaches X-Aux-Session when admin session token exists', async () => {
      mockedGetToken.mockReturnValue('session-jwt-123')
      fetchMock.mockResolvedValueOnce(mockResponse(200, { code: 0, message: 'ok' }))

      await apiRequest('/admin/analytics/overview')

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-Aux-Session']).toBe('session-jwt-123')
    })

    it('attaches X-Aux-Token when embedded context token exists', async () => {
      mockedGetCtx.mockReturnValue({ token: 'embedded-tok' } as any)
      fetchMock.mockResolvedValueOnce(mockResponse(200, { code: 0, message: 'ok' }))

      await apiRequest('/admin/session')

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-Aux-Token']).toBe('embedded-tok')
    })

    it('attaches both headers when both tokens present', async () => {
      mockedGetToken.mockReturnValue('session-jwt')
      mockedGetCtx.mockReturnValue({ token: 'embedded-tok' } as any)
      fetchMock.mockResolvedValueOnce(mockResponse(200, { code: 0, message: 'ok' }))

      await apiRequest('/admin/analytics/overview')

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-Aux-Session']).toBe('session-jwt')
      expect(init.headers['X-Aux-Token']).toBe('embedded-tok')
    })

    it('attaches neither header when no tokens present', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { code: 0, message: 'ok' }))

      await apiRequest('/telemetry/page-view')

      const [, init] = fetchMock.mock.calls[0]
      expect(init.headers['X-Aux-Session']).toBeUndefined()
      expect(init.headers['X-Aux-Token']).toBeUndefined()
    })
  })

  describe('apiRequest behavior', () => {
    it('POST includes Content-Type and serialized body', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(201, { code: 0, message: 'ok' }))

      await apiRequest('/telemetry/page-view', {
        method: 'POST',
        body: { page_id: 'home', visitor_id: 'v1' },
      })

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/page-view')
      expect(init.method).toBe('POST')
      expect(init.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(init.body)).toEqual({ page_id: 'home', visitor_id: 'v1' })
    })

    it('returns parsed JSON on success', async () => {
      const payload: AuxEnvelope<{ count: number }> = {
        code: 0,
        message: 'success',
        data: { count: 42 },
      }
      fetchMock.mockResolvedValueOnce(mockResponse(200, payload))

      const result = await apiRequest<AuxEnvelope<{ count: number }>>('/x')
      expect(result).toEqual(payload)
    })

    it('throws Error containing status code on non-ok response', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(503, {}))

      await expect(apiRequest('/x')).rejects.toThrow(/503/)
    })

    it('throws on 401 unauthorized', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(401, {}))

      await expect(apiRequest('/x')).rejects.toThrow(/401/)
    })
  })

  describe('apiClient delegation', () => {
    it('get delegates with GET method', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(200, { code: 0, message: 'ok' }))

      await apiClient.get('/admin/analytics/overview')

      const [, init] = fetchMock.mock.calls[0]
      expect(init.method).toBe('GET')
    })

    it('post delegates with POST method and body', async () => {
      fetchMock.mockResolvedValueOnce(mockResponse(201, { code: 0, message: 'ok' }))

      await apiClient.post('/telemetry/page-view', { page_id: 'home' })

      const [, init] = fetchMock.mock.calls[0]
      expect(init.method).toBe('POST')
      expect(JSON.parse(init.body)).toEqual({ page_id: 'home' })
    })
  })

  describe('timeout (#4)', () => {
    it('aborts request after default timeout when response never arrives', async () => {
      // fetch 永不 resolve, 但超时 abort 会使其 reject
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            // 监听 abort: signal abort 时 reject
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted', 'AbortError'))
            })
          }),
      )

      await expect(
        apiRequest('/slow', { timeout: 50 }),
      ).rejects.toThrow()
    })

    it('respects caller-provided signal without applying default timeout', async () => {
      const controller = new AbortController()
      fetchMock.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
      )

      // 调用方自带 signal: 50ms 后手动 abort(而非默认超时)
      const p = apiRequest('/x', { signal: controller.signal })
      setTimeout(() => controller.abort(), 50)
      await expect(p).rejects.toThrow()
    })
  })
})
