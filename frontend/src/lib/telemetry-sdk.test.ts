import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initTelemetry,
  trackPageView,
  trackFeatureClick,
  trackCurrentPageView,
  resetTelemetry,
} from './telemetry-sdk'
import { resetVisitorId } from './visitor-id'
import { getAdminSession } from './admin-auth'

// mock fetch 全局, 拦截上报请求
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// mock admin-auth: 每个测试显式控制管理员会话。
vi.mock('./admin-auth', () => ({
  getAdminSession: vi.fn(),
}))

describe('telemetry-sdk', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }))
    resetVisitorId()
    localStorage.clear()
    resetTelemetry()
    vi.mocked(getAdminSession).mockReturnValue(null)
  })

  afterEach(() => {
    resetTelemetry()
  })

  describe('trackPageView', () => {
    it('sends a POST to /api/aux/telemetry/page-view with page_id and visitor_id', async () => {
      trackPageView('home')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/page-view')
      expect(init.method).toBe('POST')

      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('home')
      expect(body.visitor_id).toBeTruthy()
      expect(body.is_admin).toBe(false)
    })

    it('does not send when pageId is empty', () => {
      trackPageView('')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('trackFeatureClick', () => {
    it('sends a POST to /api/aux/telemetry/feature-click with page_id, feature_id, visitor_id', () => {
      trackFeatureClick('dashboard', 'refresh-btn')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/feature-click')

      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('dashboard')
      expect(body.feature_id).toBe('refresh-btn')
      expect(body.visitor_id).toBeTruthy()
      expect(body.is_admin).toBe(false)
    })

    it('does not send when pageId is empty', () => {
      trackFeatureClick('', 'refresh-btn')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not send when featureId is empty', () => {
      trackFeatureClick('dashboard', '')
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('error handling (fire-and-forget)', () => {
    it('does not throw when fetch rejects (network error)', () => {
      fetchMock.mockRejectedValueOnce(new Error('network error'))

      // 不应抛错
      expect(() => trackPageView('home')).not.toThrow()
    })

    it('does not throw when fetch throws synchronously', () => {
      fetchMock.mockImplementationOnce(() => {
        throw new Error('fetch unavailable')
      })

      expect(() => trackPageView('home')).not.toThrow()
    })

    it('recovers for subsequent calls after a failure', () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'))
      // 第一次失败
      trackPageView('home')
      // 第二次应正常调用 fetch(不因前次失败而停止)
      trackPageView('home')

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })
  })

  describe('initTelemetry route tracking', () => {
    beforeEach(() => {
      vi.mocked(getAdminSession).mockReturnValue({
        token: 'valid-session',
        user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
      })
    })

    it('does not report a guarded route before authentication', () => {
      vi.mocked(getAdminSession).mockReturnValue(null)
      window.history.replaceState({}, '', '/admin/dashboard')

      initTelemetry()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('reports the current guarded route once authentication succeeds', () => {
      vi.mocked(getAdminSession).mockReturnValue(null)
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()
      expect(fetchMock).not.toHaveBeenCalled()

      vi.mocked(getAdminSession).mockReturnValue({
        token: 'valid-session',
        user: { id: 1, email: 'a@e.com', username: 'admin', role: 'admin' },
      })
      trackCurrentPageView()
      trackCurrentPageView()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body).toMatchObject({ page_id: 'dashboard', is_admin: true })
    })

    it('reports page_view for the initial registered route on init', () => {
      window.history.replaceState({}, '', '/admin/dashboard')

      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/page-view')
      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('dashboard')
    })

    it('reports page_view on history.pushState (SPA route change)', () => {
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      window.history.pushState({}, '', '/admin/examples/content')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [, init] = fetchMock.mock.calls[1]
      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('example-content')
    })

    it('does NOT report when path is not in page-registry (e.g. /unknown)', () => {
      window.history.replaceState({}, '', '/unknown')
      initTelemetry()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does NOT report for an unregistered path after a valid route', () => {
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      window.history.pushState({}, '', '/some-random-path')

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('deduplicates consecutive events for the same path', () => {
      window.history.replaceState({}, '', '/unknown')
      initTelemetry()

      window.history.replaceState({}, '', '/admin/dashboard')
      window.history.replaceState({}, '', '/admin/dashboard')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.page_id).toBe('dashboard')
    })

    it('produces multiple records after navigating away and returning', () => {
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      window.history.pushState({}, '', '/admin/examples/content')
      window.history.pushState({}, '', '/admin/examples/interaction')
      window.history.pushState({}, '', '/admin/dashboard')

      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('reports on popstate (browser back/forward)', () => {
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      window.history.pushState({}, '', '/admin/examples/content')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // jsdom 的 history.back() 是异步的, 直接设置目标 URL 后触发 popstate。
      window.history.replaceState({}, '', '/admin/dashboard')
      window.dispatchEvent(new PopStateEvent('popstate'))

      const calls = fetchMock.mock.calls
      const lastCall = calls[calls.length - 1]
      const body = JSON.parse(lastCall[1].body as string)
      expect(body.page_id).toBe('dashboard')
    })

    it('is idempotent: calling initTelemetry twice does not double-report', () => {
      window.history.replaceState({}, '', '/admin/dashboard')
      initTelemetry()
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('is_admin flag', () => {
    it('reports is_admin=false for anonymous visitor', () => {
      trackPageView('home')

      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
      expect(body.is_admin).toBe(false)
    })
  })
})
