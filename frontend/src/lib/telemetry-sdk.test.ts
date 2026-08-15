import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  initTelemetry,
  trackPageView,
  trackFeatureClick,
  resetTelemetry,
} from './telemetry-sdk'
import { resetVisitorId } from './visitor-id'

// mock fetch 全局, 拦截上报请求
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

// mock admin-auth: 默认无管理员会话
vi.mock('./admin-auth', () => ({
  getAdminSession: vi.fn(() => null),
}))

describe('telemetry-sdk', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response('{}', { status: 201 }))
    resetVisitorId()
    localStorage.clear()
    resetTelemetry()
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
      trackFeatureClick('sample-dynamic', 'refresh-btn')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/feature-click')

      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('sample-dynamic')
      expect(body.feature_id).toBe('refresh-btn')
      expect(body.visitor_id).toBeTruthy()
      expect(body.is_admin).toBe(false)
    })

    it('does not send when pageId is empty', () => {
      trackFeatureClick('', 'refresh-btn')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does not send when featureId is empty', () => {
      trackFeatureClick('sample-dynamic', '')
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
    it('reports page_view for the initial route on init', () => {
      // 设置初始路径为 home (在 page-registry 中)
      window.history.replaceState({}, '', '/')

      initTelemetry()

      // 初始化时应上报当前页面的首次访问
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('/api/aux/telemetry/page-view')
      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('home')
    })

    it('reports page_view on history.pushState (SPA route change)', () => {
      window.history.replaceState({}, '', '/')
      initTelemetry()

      // 初始上报
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // 模拟 SPA 导航到 /admin/sample-dynamic
      window.history.pushState({}, '', '/admin/sample-dynamic')

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [, init] = fetchMock.mock.calls[1]
      const body = JSON.parse(init.body as string)
      expect(body.page_id).toBe('sample-dynamic')
    })

    it('does NOT report when path is not in page-registry (e.g. /unknown)', () => {
      window.history.replaceState({}, '', '/unknown')
      initTelemetry()

      // /unknown 不在 page-registry → 不上报
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('does NOT report for 404 path on route change', () => {
      window.history.replaceState({}, '', '/')
      initTelemetry()

      // 初始上报(home)
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // 导航到不在 registry 的路径
      window.history.pushState({}, '', '/some-random-path')

      // 不应新增上报
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('produces multiple records for repeated route switches (per-visit counting)', () => {
      window.history.replaceState({}, '', '/')
      initTelemetry()

      // 初始上报
      expect(fetchMock).toHaveBeenCalledTimes(1)

      // 来回切换多次
      window.history.pushState({}, '', '/admin/sample-dynamic')
      window.history.pushState({}, '', '/')
      window.history.pushState({}, '', '/admin/sample-dynamic')

      // 每次有效路由切换都上报一条(按访问计,非去重)
      expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('reports on popstate (browser back/forward)', () => {
      window.history.replaceState({}, '', '/')
      initTelemetry()

      expect(fetchMock).toHaveBeenCalledTimes(1)

      // pushState 到另一个页面
      window.history.pushState({}, '', '/admin/sample-dynamic')
      expect(fetchMock).toHaveBeenCalledTimes(2)

      // 模拟浏览器后退: 先改变 URL 再触发 popstate 事件
      // jsdom 的 history.back() 是异步的, 这里直接模拟 popstate 的效果
      window.history.replaceState({}, '', '/')
      window.dispatchEvent(new PopStateEvent('popstate'))

      // 验证后退到 home 时上报了 home
      const calls = fetchMock.mock.calls
      const lastCall = calls[calls.length - 1]
      const body = JSON.parse(lastCall[1].body as string)
      expect(body.page_id).toBe('home')
    })

    it('is idempotent: calling initTelemetry twice does not double-report', () => {
      window.history.replaceState({}, '', '/')
      initTelemetry()
      initTelemetry() // 重复调用

      // 只应上报一次(幂等)
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
