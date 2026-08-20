/**
 * 动态页面注册表合并 —— KTD7 命名空间隔离的核心。
 *
 * 静态核心页(dashboard/assets)保留在 page-registry.ts 的
 * PAGE_REGISTRY 数组里(代码登记, 不可变)。公开动态页来自 /api/aux/pages；
 * admin 动态页仅在管理会话建立后从 /api/aux/admin/pages 获取。
 *
 * 合并规则:
 *   - 静态页 id 保持原样(dashboard/...)
 *   - 动态页 id = "page:<slug>"(命名空间隔离, 避免与静态 id 冲突, 防止埋点 page_id 碰撞)
 *   - 动态页 path = "/p/<slug>"(public) 或 "/admin/p/<slug>"(admin)
 *
 * bootstrap 时调用 fetchDynamicPages() 获取公开动态页清单, 与 STATIC_PAGE_REGISTRY 合并。
 * AdminLayout 在会话建立后调用 fetchDynamicPages({ includeAdmin: true })，再用受守卫的
 * /api/aux/admin/pages 补充 admin 动态页；公开端点不暴露 admin 页元数据。
 *
 * 内容渲染不依赖此注册表 —— DynamicPage 组件按 slug on-demand fetch 内容
 * (GET /api/aux/pages/:slug 或 admin 等价接口), 硬刷新也能工作。
 */
import { apiClient, type AuxEnvelope } from './api-client'
import {
  STATIC_PAGE_REGISTRY,
  type PageEntry,
  type PageVisibility,
} from './page-registry'

/** 后端 PageListItem(镜像 service.PageListItem)。 */
export interface DynamicPageItem {
  id: number
  slug: string
  title: string
  visibility: PageVisibility
  content_type: 'html' | 'react'
  enabled: boolean
  route: string
  page_id: string
  /** 管理员菜单图标名，来自 metadata.menu_icon。 */
  menu_icon?: string
  updated_at: string
}

/** 后端 /api/aux/pages 响应。 */
interface PageListResponse {
  items: DynamicPageItem[]
}

/** 动态页获取状态。 */
export type DynamicPagesStatus = 'idle' | 'loading' | 'loaded' | 'error'

let dynamicPagesCache: DynamicPageItem[] = []
let dynamicPagesStatus: DynamicPagesStatus = 'idle'
let dynamicPagesRequest: Promise<DynamicPageItem[]> | null = null
let dynamicPagesIncludeAdmin = false
const dynamicPagesListeners = new Set<() => void>()

function notifyDynamicPagesListeners(): void {
  for (const listener of dynamicPagesListeners) listener()
}

export interface FetchDynamicPagesOptions {
  /** 是否从受 AdminGuard 保护的管理端点读取 admin 动态页。 */
  includeAdmin?: boolean
}

/**
 * 从后端获取动态页清单(不含内容)。失败时返回空数组,不阻塞前端(静态页仍可用)。
 * 结果缓存到模块级变量, 供 getMergedRegistry 同步使用。
 */
export function fetchDynamicPages(options: FetchDynamicPagesOptions = {}): Promise<DynamicPageItem[]> {
  const includeAdmin = options.includeAdmin === true

  if (dynamicPagesRequest) {
    return dynamicPagesRequest.then(() => {
      if (includeAdmin && !dynamicPagesIncludeAdmin) {
        return fetchDynamicPages({ includeAdmin: true })
      }
      return dynamicPagesCache
    })
  }

  if (dynamicPagesStatus === 'loaded' && (!includeAdmin || dynamicPagesIncludeAdmin)) {
    return Promise.resolve(dynamicPagesCache)
  }

  dynamicPagesStatus = 'loading'
  dynamicPagesRequest = apiClient
    .get<AuxEnvelope<PageListResponse>>(includeAdmin ? '/admin/pages' : '/pages')
    .then((res) => {
      dynamicPagesCache = res.data?.items ?? []
      dynamicPagesIncludeAdmin = includeAdmin
      dynamicPagesStatus = 'loaded'
      notifyDynamicPagesListeners()
      return dynamicPagesCache
    })
    .catch(() => {
      // 后端不可达时降级: 仅静态页可用, 不阻塞前端
      dynamicPagesCache = []
      dynamicPagesStatus = 'error'
      notifyDynamicPagesListeners()
      return []
    })
    .finally(() => {
      dynamicPagesRequest = null
    })

  return dynamicPagesRequest
}

/** 订阅动态页面清单变化，供侧边栏等长驻布局在 CRUD 后刷新。 */
export function subscribeDynamicPages(listener: () => void): () => void {
  dynamicPagesListeners.add(listener)
  return () => dynamicPagesListeners.delete(listener)
}

/** 强制重新读取动态页面清单（页面管理 CRUD 完成后使用）。 */
export function refreshDynamicPages(options: FetchDynamicPagesOptions = {}): Promise<DynamicPageItem[]> {
  dynamicPagesStatus = 'idle'
  dynamicPagesIncludeAdmin = false
  return fetchDynamicPages(options)
}

/** 获取缓存的动态页清单(同步, 需先调用 fetchDynamicPages)。 */
export function getCachedDynamicPages(): DynamicPageItem[] {
  return dynamicPagesCache
}

/** 获取动态页获取状态。 */
export function getDynamicPagesStatus(): DynamicPagesStatus {
  return dynamicPagesStatus
}

/**
 * 将动态页项转为 PageEntry(与静态注册表条目同构)。
 * 动态页 id = "page:<slug>", path = item.route。
 */
function dynamicItemToEntry(item: DynamicPageItem): PageEntry {
  return {
    id: item.page_id, // "page:<slug>"
    title: item.title,
    path: item.route, // "/p/<slug>" 或 "/admin/p/<slug>"
    visibility: item.visibility,
    icon: item.menu_icon,
  }
}

/**
 * 合并静态核心页 + 动态页为统一只读注册表。
 * 这是 R5 与 KTD7 的核心数据结构: 侧边栏菜单、仪表盘页面清单、埋点 page_id 共享此命名空间。
 */
export function getMergedRegistry(): readonly PageEntry[] {
  // Admin 列表端点也会返回已停用页面供页面管理使用；停用页不应继续出现在
  // 侧边栏、仪表盘或埋点当前页面清单中（访问本身也会被后端拒绝）。
  const dynamicEntries = dynamicPagesCache
    .filter((item) => item.enabled)
    .map(dynamicItemToEntry)
  return [...STATIC_PAGE_REGISTRY, ...dynamicEntries]
}

/**
 * 按 path 在合并注册表中查找页面(含动态页)。
 * 用于埋点 SDK 解析当前路由 → page_id。
 */
export function getMergedPageByPath(path: string): PageEntry | undefined {
  return getMergedRegistry().find((p) => p.path === path)
}

/**
 * 按 id 在合并注册表中查找页面(含动态页)。
 */
export function getMergedPageById(id: string): PageEntry | undefined {
  return getMergedRegistry().find((p) => p.id === id)
}

/** 重置缓存(测试用)。 */
export function resetDynamicPagesCacheForTest(): void {
  dynamicPagesCache = []
  dynamicPagesStatus = 'idle'
  dynamicPagesRequest = null
  dynamicPagesIncludeAdmin = false
  dynamicPagesListeners.clear()
}
