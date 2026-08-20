/**
 * 埋点 SDK —— 前端数据采集与上报。
 *
 * 职责:
 *   - initTelemetry(): 监听 SPA 路由切换, 自动上报 page_view(用合并注册表解析 page id)。
 *   - trackFeatureClick(pageId, featureId): 手动上报功能点击。
 *   - 上报失败静默丢弃(fire-and-forget), 绝不抛错到页面(KTD4)。
 *
 * 设计要点:
 *   1. page id 来自合并注册表(KTD7): 路由切换时优先用 getMergedPageByPath(pathname)
 *      解析动态页，静态核心页用 page-registry 作为 fallback；路径不在 registry → 不上报。
 *   2. 埋点端点匿名可写(R8/R11): 上报走 /api/aux/telemetry/*, 不需要会话 token。
 *   3. 上报失败不阻塞页面(KTD4): 用 fetch + catch, 所有错误静默丢弃。
 *   4. 访客 id 区分匿名/管理员: getVisitorId() 取持久 id, isCurrentUserAdmin() 判断管理员。
 *   5. 访问量按访问计: 每次路由切换都上报一条(非去重)。
 *
 * Covers KTD4, KTD7, R8(页面访问埋点), R9(功能使用埋点), R11(自有采集)。
 */
import { getMergedPageByPath } from './dynamic-pages'
import { getPageByPath } from './page-registry'
import { getVisitorId, isCurrentUserAdmin } from './visitor-id'

const TELEMETRY_BASE_URL = '/api/aux/telemetry'

/** 是否已初始化(防止重复监听)。 */
let initialized = false

/** 当前监听路由变化的 unsubscribe 函数(用于测试重置)。 */
let unsubscribeHistory: (() => void) | null = null

/** 最近处理的路由身份, 用于合并 StrictMode 等造成的连续相同导航事件。 */
let lastRouteKey: string | null = null

/**
 * 发送埋点请求(fire-and-forget, 静默丢弃错误)。
 *
 * 用 fetch + catch: 任何网络错误/非 2xx 响应都被 catch, 不抛错。
 * 这保证上报失败绝不阻塞页面(KTD4)。
 */
function sendTelemetry(endpoint: string, payload: Record<string, unknown>): void {
  const url = `${TELEMETRY_BASE_URL}${endpoint}`
  const body = JSON.stringify(payload)

  try {
    // fire-and-forget: 不 await, catch 所有错误
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      // keepalive: 页面卸载时也能发出去(类似 sendBeacon 的效果)
      keepalive: true,
    }).catch(() => {
      // 静默丢弃: 上报失败不影响页面
    })
  } catch {
    // 同步异常也静默(如 fetch 不可用)
  }
}

/**
 * 上报一次页面访问。
 *
 * @param pageId 来自 page-registry 的页面 id
 * @internal 供 initTelemetry 路由监听调用, 也可手动调用
 */
export function trackPageView(pageId: string): void {
  if (!pageId) return
  sendTelemetry('/page-view', {
    page_id: pageId,
    visitor_id: getVisitorId(),
    is_admin: isCurrentUserAdmin(),
  })
}

/**
 * 手动上报功能点击(R9)。
 *
 * @param pageId 功能所在页面的 id(来自 page-registry)
 * @param featureId 被点击的功能标识(前端约定, 如 "refresh-btn")
 */
export function trackFeatureClick(pageId: string, featureId: string): void {
  if (!pageId || !featureId) return
  sendTelemetry('/feature-click', {
    page_id: pageId,
    feature_id: featureId,
    visitor_id: getVisitorId(),
    is_admin: isCurrentUserAdmin(),
  })
}

/**
 * 处理路由变化: 用当前路径从合并注册表解析 page id, 上报 page_view。
 *
 * 路径不在 registry(如 404) → 不上报(避免噪声)。
 */
function handleRouteChange(pathname: string): void {
  // 动态页清单异步加载，缓存命中后优先使用动态注册表；在 bootstrap 尚未完成时
  // 仍通过静态注册表识别核心页面，避免动态列表请求影响既有页面埋点。
  const page = getMergedPageByPath(pathname) ?? getPageByPath(pathname)
  const isAdmin = isCurrentUserAdmin()
  const routeKey = page
    ? `${pathname}:${isAdmin ? 'admin' : 'anonymous'}`
    : `unregistered:${pathname}`
  if (routeKey === lastRouteKey) return
  lastRouteKey = routeKey

  if (!page) {
    // 路径不在 page-registry → 不上报(KTD7, 避免 404 等噪声)
    return
  }
  if (page.visibility === 'admin' && !isAdmin) {
    // 管理路由仅在 AdminGuard 确认会话后统计, 避免把登录跳转算作访问。
    return
  }
  trackPageView(page.id)
}

/** AdminGuard 认证成功后统计当前管理页面。 */
export function trackCurrentPageView(): void {
  if (typeof window !== 'undefined') {
    handleRouteChange(window.location.pathname)
  }
}

/**
 * 初始化埋点 SDK: 监听 SPA 路由切换, 自动上报 page_view。
 *
 * 监听方式:
 *   - 拦截 history.pushState/replaceState + popstate 事件(兼容 react-router v6)。
 *   - 初始化时上报当前页面的首次访问。
 *
 * 幂等: 重复调用不会重复监听(防止 SPA 严格模式下重复初始化)。
 */
export function initTelemetry(): void {
  if (initialized) return
  initialized = true

  // 上报当前页面(首次访问)
  if (typeof window !== 'undefined') {
    handleRouteChange(window.location.pathname)
  }

  // 拦截 history.pushState / replaceState
  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)

  history.pushState = function (...args: Parameters<History['pushState']>) {
    originalPushState(...args)
    handleRouteChange(window.location.pathname)
  }

  history.replaceState = function (...args: Parameters<History['replaceState']>) {
    originalReplaceState(...args)
    handleRouteChange(window.location.pathname)
  }

  // 监听 popstate(浏览器前进/后退)
  const onPopState = () => {
    handleRouteChange(window.location.pathname)
  }
  window.addEventListener('popstate', onPopState)

  unsubscribeHistory = () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    window.removeEventListener('popstate', onPopState)
  }
}

/**
 * 重置埋点 SDK 状态(测试用)。
 * 清除监听并重置初始化标志, 使下次 initTelemetry() 可重新监听。
 */
export function resetTelemetry(): void {
  if (unsubscribeHistory) {
    unsubscribeHistory()
    unsubscribeHistory = null
  }
  initialized = false
  lastRouteKey = null
}
