/**
 * 动态页面注册表合并 —— KTD7 命名空间隔离的核心。
 *
 * 静态核心页(home/dashboard/homepage-config/examples)保留在 page-registry.ts 的
 * PAGE_REGISTRY 数组里(代码登记, 不可变)。动态页来自后端 /api/aux/pages(管理员创建)。
 *
 * 合并规则:
 *   - 静态页 id 保持原样(home/dashboard/...)
 *   - 动态页 id = "page:<slug>"(命名空间隔离, 避免与静态 id 冲突, 防止埋点 page_id 碰撞)
 *   - 动态页 path = "/p/<slug>"(public) 或 "/admin/p/<slug>"(admin)
 *
 * bootstrap 时调用 fetchDynamicPages() 获取动态页清单, 与 STATIC_PAGE_REGISTRY 合并,
 * 供侧边栏菜单、仪表盘页面清单、埋点 page_id 解析使用。
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

/**
 * 从后端获取动态页清单(不含内容)。失败时返回空数组,不阻塞前端(静态页仍可用)。
 * 结果缓存到模块级变量, 供 getMergedRegistry 同步使用。
 */
export async function fetchDynamicPages(): Promise<DynamicPageItem[]> {
  dynamicPagesStatus = 'loading'
  try {
    const res = await apiClient.get<AuxEnvelope<PageListResponse>>('/pages')
    dynamicPagesCache = res.data?.items ?? []
    dynamicPagesStatus = 'loaded'
    return dynamicPagesCache
  } catch {
    // 后端不可达时降级: 仅静态页可用, 不阻塞前端
    dynamicPagesCache = []
    dynamicPagesStatus = 'error'
    return []
  }
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
  }
}

/**
 * 合并静态核心页 + 动态页为统一只读注册表。
 * 这是 R5 与 KTD7 的核心数据结构: 侧边栏菜单、仪表盘页面清单、埋点 page_id 共享此命名空间。
 */
export function getMergedRegistry(): readonly PageEntry[] {
  const dynamicEntries = dynamicPagesCache.map(dynamicItemToEntry)
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
}
