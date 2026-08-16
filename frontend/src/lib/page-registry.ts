/**
 * 页面清单注册表 —— 页面身份的单一真相源 (KTD7)。
 *
 * 每个扩展页面在此声明其 id/title/path/visibility。
 * - App.tsx 路由与 registry 共享同一 id 命名空间
 * - U5 埋点 SDK 按页面 id 上报与聚合
 * - U6 仪表盘从 registry 派生页面清单 (R5: 非独立注册表)
 *
 * 页面存在于代码但零访问 → 仪表盘显示 0 (U6 处理)。
 * 页面 identity 来自代码, 不在线编辑/上下架。
 *
 * 添加新页面步骤:
 *   1. 在此 registry 数组中新增条目 (id/title/path/visibility)
 *   2. 在 App.tsx 中注册对应路由, 路由 id 必须与 registry 一致
 *   3. 实现页面组件
 */

/** 页面可见性。public = 无需认证; admin = 需管理员会话。 */
export type PageVisibility = 'public' | 'admin'

/** 页面注册条目。 */
export interface PageEntry {
  /** 页面唯一标识。埋点、仪表盘、路由共享此 id。 */
  id: string
  /** 页面标题(展示用)。 */
  title: string
  /** 路由路径(与 App.tsx 路由 path 一致)。 */
  path: string
  /** 可见性: public 无需认证; admin 需管理员会话。 */
  visibility: PageVisibility
}

/**
 * 页面清单。这是 R5 与 KTD7 的核心数据结构。
 *
 * 与 App.tsx 已注册路由一一对应。
 * 测试 (page-registry.test.ts) 验证此一致性。
 */
export const PAGE_REGISTRY: readonly PageEntry[] = [
  {
    id: 'dashboard',
    title: '分析仪表盘',
    path: '/admin/dashboard',
    visibility: 'admin',
  },
  {
    id: 'example-content',
    title: '静态内容示例',
    path: '/admin/examples/content',
    visibility: 'admin',
  },
  {
    id: 'example-interaction',
    title: '交互与埋点示例',
    path: '/admin/examples/interaction',
    visibility: 'admin',
  },
  {
    id: 'example-api',
    title: 'API 请求示例',
    path: '/admin/examples/api',
    visibility: 'admin',
  },
] as const

/**
 * 获取所有页面清单(只读)。
 */
export function getPages(): readonly PageEntry[] {
  return PAGE_REGISTRY
}

/**
 * 按 id 查找页面。不存在时返回 undefined。
 */
export function getPageById(id: string): PageEntry | undefined {
  return PAGE_REGISTRY.find((p) => p.id === id)
}

/**
 * 按路径查找页面。不存在时返回 undefined。
 */
export function getPageByPath(path: string): PageEntry | undefined {
  return PAGE_REGISTRY.find((p) => p.path === path)
}

/**
 * 获取公开页面清单。
 */
export function getPublicPages(): readonly PageEntry[] {
  return PAGE_REGISTRY.filter((p) => p.visibility === 'public')
}

/**
 * 获取管理员页面清单。
 */
export function getAdminPages(): readonly PageEntry[] {
  return PAGE_REGISTRY.filter((p) => p.visibility === 'admin')
}
