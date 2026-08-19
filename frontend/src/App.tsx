/**
 * 路由根。
 *
 * 嵌入参数在 main.tsx 启动时已解析并应用 (主题/语言)。
 * 管理端路由用 AdminGuard 包裹: 用 sub2api iframe token 换取附属会话(U3)。
 * 页面路由 id 与 page-registry 共享同一命名空间 (KTD7)。
 *
 * 路由 meta 思路对齐 sub2api frontend/src/router/index.ts:
 *   requiresAuth / requiresAdmin 通过 guard 组件实现 (U3)。
 */
import { Link, Navigate, Routes, Route } from 'react-router-dom'
import PublicLayout from '@/layouts/PublicLayout'
import AdminLayout from '@/layouts/AdminLayout'
import AdminGuard from '@/components/AdminGuard'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/admin/DashboardPage'
import PageManagementPage from '@/pages/admin/PageManagementPage'
import ImageAssetsPage from '@/pages/admin/ImageAssetsPage'
import AdminDynamicPage from '@/pages/admin/AdminDynamicPage'
import DynamicPage from '@/pages/DynamicPage'
import ContentExamplePage from '@/pages/examples/ContentExamplePage'
import InteractionExamplePage from '@/pages/examples/InteractionExamplePage'
import APIExamplePage from '@/pages/examples/APIExamplePage'
import { fetchDynamicPages } from '@/lib/dynamic-pages'

// bootstrap: 获取动态页清单, 与静态注册表合并(KTD7)。
// 失败时降级为仅静态页, 不阻塞前端。
fetchDynamicPages().catch(() => {
  /* 降级: 仅静态页可用 */
})

function NotFound() {
  return (
    <main className="aux-not-found">
      <div className="max-w-md text-center">
        <p className="aux-not-found-code">404</p>
        <h1>页面不存在</h1>
        <p>当前地址没有对应内容，可以返回 TERALEMO 官网继续浏览。</p>
        <Link to="/p/home" className="aux-surface-button">返回官网首页</Link>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      {/* 根路径是控制台入口；官网首页由数据库动态页面 /p/home 提供。 */}
      <Route path="/" element={<Navigate to="/admin/dashboard" replace />} />
      {/* 独立登录入口: AdminGuard 的 no-embedded-token 分支重定向到此。
          功能路由, 不登记到 page-registry (非内容页, 不污染埋点仪表盘)。 */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      {/* 动态页面(public): /p/:slug, on-demand fetch 内容, 硬刷新可工作 */}
      <Route path="/p/:slug" element={<DynamicPage />} />
      {/* 管理端: 需管理员会话 (对应 sub2api custom_menu_items, 传 token) */}
      <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
        {/* U6: 仪表盘为管理端首页 (R10) */}
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="pages" element={<PageManagementPage />} />
        <Route path="assets" element={<ImageAssetsPage />} />
        {/* 动态页面(admin): /admin/p/:slug, 经 AdminGuard, on-demand fetch */}
        <Route path="p/:slug" element={<AdminDynamicPage />} />
        <Route path="examples/content" element={<ContentExamplePage />} />
        <Route path="examples/interaction" element={<InteractionExamplePage />} />
        <Route path="examples/api" element={<APIExamplePage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
