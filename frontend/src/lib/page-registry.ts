/**
 * 页面清单注册表 —— 页面身份的单一真相源 (KTD7)。
 *
 * 静态核心页(dashboard/files/ops-ttft)在此声明(代码登记, 不可变)。
 * 动态页(管理员创建)来自后端 /api/aux/pages, 在 lib/dynamic-pages.ts 与静态注册表合并。
 *
 * - App.tsx 路由与 registry 共享同一 id 命名空间
 * - U5 埋点 SDK 按页面 id 上报与聚合
 * - U6 仪表盘从 registry 派生页面清单 (R5: 非独立注册表)
 * - 动态页 id = "page:<slug>"(命名空间隔离, 见 dynamic-pages.ts)
 *
 * 页面存在于代码但零访问 → 仪表盘显示 0 (U6 处理)。公开官网已迁移到数据库
 * 动态页 `home`，根路径重定向不再作为内容页面登记。
 * 页面 identity 来自代码, 不在线编辑/上下架。
 *
 * 添加新静态页面步骤:
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
  /** 动态管理员菜单图标名，来自 metadata.menu_icon。静态页通常不设置。 */
  icon?: string
}

/**
 * 静态核心页面清单(代码登记, 不可变)。示例页已经迁移到 pages 表，
 * 由 AdminLayout 的“动态页面”分组展示；运维看板页面保留在代码中，
 * 由 AdminLayout 的“运维看板”分组展示。
 * 动态页由 lib/dynamic-pages.ts 在 bootstrap 时合并(getMergedRegistry)。
 *
 * 与 App.tsx 中的静态核心管理路由一一对应；旧示例路由仅作为兼容入口保留，
 * 不再参与静态注册或当前页面统计。测试 (page-registry.test.ts) 验证此一致性。
 */
export const STATIC_PAGE_REGISTRY: readonly PageEntry[] = [
  {
    id: 'dashboard',
    title: '分析仪表盘',
    path: '/admin/dashboard',
    visibility: 'admin',
  },
  {
    id: 'file-management',
    title: '文件管理',
    path: '/admin/files',
    visibility: 'admin',
  },
  {
    id: 'ops-ttft',
    title: '首字延迟',
    path: '/admin/ops/ttft',
    visibility: 'admin',
  },
] as const

/**
 * PAGE_REGISTRY 是 STATIC_PAGE_REGISTRY 的别名(向后兼容)。
 * 仅包含静态核心页; 动态页通过 getMergedRegistry()(dynamic-pages.ts)获取。
 */
export const PAGE_REGISTRY: readonly PageEntry[] = STATIC_PAGE_REGISTRY

/**
 * 获取所有静态页面清单(只读)。仅静态核心页; 动态页见 dynamic-pages.ts。
 */
export function getPages(): readonly PageEntry[] {
  return STATIC_PAGE_REGISTRY
}

/**
 * 按 id 查找静态页面。不存在时返回 undefined。
 * 动态页查找见 dynamic-pages.ts 的 getMergedPageById。
 */
export function getPageById(id: string): PageEntry | undefined {
  return STATIC_PAGE_REGISTRY.find((p) => p.id === id)
}

/**
 * 按路径查找静态页面。不存在时返回 undefined。
 * 动态页查找见 dynamic-pages.ts 的 getMergedPageByPath。
 */
export function getPageByPath(path: string): PageEntry | undefined {
  return STATIC_PAGE_REGISTRY.find((p) => p.path === path)
}

/**
 * 获取公开页面清单(仅静态核心)。
 */
export function getPublicPages(): readonly PageEntry[] {
  return STATIC_PAGE_REGISTRY.filter((p) => p.visibility === 'public')
}

/**
 * 获取管理员页面清单(仅静态核心)。
 */
export function getAdminPages(): readonly PageEntry[] {
  return STATIC_PAGE_REGISTRY.filter((p) => p.visibility === 'admin')
}
