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
import { lazy, Suspense } from 'react'
import { Link, Navigate, Routes, Route, useLocation } from 'react-router-dom'
import PublicLayout from '@/layouts/PublicLayout'
import AdminGuard from '@/components/AdminGuard'
import PageLoadBoundary from '@/components/PageLoadBoundary'
import { fetchDynamicPages } from '@/lib/dynamic-pages'

// 页面按路由加载，公开官网不下载管理后台和文档代码。
const AdminLayout = lazy(() => import('@/layouts/AdminLayout'))
const LoginPage = lazy(() => import('@/pages/LoginPage'))
const DashboardPage = lazy(() => import('@/pages/admin/DashboardPage'))
const PageManagementPage = lazy(() => import('@/pages/admin/PageManagementPage'))
const ImageAssetsPage = lazy(() => import('@/pages/admin/ImageAssetsPage'))
const FileManagementPage = lazy(() => import('@/pages/admin/FileManagementPage'))
const TTFTFlamegraphPage = lazy(() => import('@/pages/admin/TTFTFlamegraphPage'))
const ConsumptionPage = lazy(() => import('@/pages/admin/ConsumptionPage'))
const CostConfigPage = lazy(() => import('@/pages/admin/CostConfigPage'))
const InvoiceManagementPage = lazy(() => import('@/pages/admin/InvoiceManagementPage'))
const NotificationManagementPage = lazy(() => import('@/pages/admin/NotificationManagementPage'))
const SystemLogsPage = lazy(() => import('@/pages/admin/SystemLogsPage'))
const OperationLogsPage = lazy(() => import('@/pages/admin/OperationLogsPage'))
const SystemConfigPage = lazy(() => import('@/pages/admin/SystemConfigPage'))
const InvoicePortalPage = lazy(() => import('@/pages/InvoicePortalPage'))
const PromotionPortalPage = lazy(() => import('@/pages/PromotionPortalPage'))
const PromotionManagementPage = lazy(() => import('@/pages/admin/PromotionManagementPage'))
const AdminDynamicPage = lazy(() => import('@/pages/admin/AdminDynamicPage'))
const DynamicPage = lazy(() => import('@/pages/DynamicPage'))
const ContentExamplePage = lazy(() => import('@/pages/examples/ContentExamplePage'))
const InteractionExamplePage = lazy(() => import('@/pages/examples/InteractionExamplePage'))
const APIExamplePage = lazy(() => import('@/pages/examples/APIExamplePage'))
const HomepagePage = lazy(() => import('@/pages/HomepagePage'))
const HomepageConfigPage = lazy(() => import('@/pages/admin/HomepageConfigPage'))
const TobHomepagePage = lazy(() => import('@/pages/TobHomepagePage'))
const TobHomepageConfigPage = lazy(() => import('@/pages/admin/TobHomepageConfigPage'))
const ApiDocsPage = lazy(() => import('@/pages/ApiDocsPage'))
const ClientDocsPage = lazy(() => import('@/pages/ClientDocsPage'))

// bootstrap: 获取动态页清单, 与静态注册表合并(KTD7)。
// 失败时降级为仅静态页, 不阻塞前端。
fetchDynamicPages().catch((error: unknown) => {
  console.error('[App] failed to bootstrap dynamic pages; using static registry', error)
})

function NotFound() {
  return (
    <main className="aux-not-found">
      <div className="max-w-md text-center">
        <p className="aux-not-found-code">404</p>
        <h1>页面不存在</h1>
        <p>当前地址没有对应内容，可以返回管理控制台继续操作。</p>
        <Link to="/admin/dashboard" className="aux-surface-button">返回管理控制台</Link>
      </div>
    </main>
  )
}

/**
 * 将入口路径规范化到控制台时保留 sub2api 注入的查询参数。
 *
 * custom_menu_items 以 iframe 打开扩展时会在 URL 上附加 `token`、`user_id`
 * 等嵌入上下文。若这里使用字符串 Navigate，React Router 会丢掉 search，
 * AdminGuard 随后无法完成 session exchange，表现为已登录用户再次看到登录页。
 */
function AdminEntryRedirect() {
  const location = useLocation()
  return (
    <Navigate
      to={{
        pathname: '/admin/dashboard',
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  )
}

export default function App() {
  const location = useLocation()
  const isHomepage = ['/sub2api-home', '/embed', '/tob-home', '/embed-tob'].includes(location.pathname)
  return (
    <PageLoadBoundary routeKey={location.pathname}>
      <Suspense fallback={isHomepage
        ? <main className="min-h-screen bg-[var(--aux-homepage-bg)]" role="status" aria-label="正在加载官网" />
        : <main className="min-h-screen bg-[var(--aux-page-bg)] p-8 text-sm text-[var(--aux-page-muted)]" role="status">正在加载页面…</main>}>
        <Routes>
          {/* 根路径与当前扩展控制台保持兼容；Sub2API 官网使用独立入口。 */}
          <Route path="/" element={<AdminEntryRedirect />} />
          <Route path="/sub2api-home" element={<HomepagePage />} />
          <Route path="/embed" element={<HomepagePage />} />
          <Route path="/tob-home" element={<TobHomepagePage />} />
          <Route path="/embed-tob" element={<TobHomepagePage />} />
          {/* 独立登录入口: AdminGuard 的 no-embedded-token 分支重定向到此。
              功能路由, 不登记到 page-registry (非内容页, 不污染埋点仪表盘)。 */}
          <Route element={<PublicLayout />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
          {/* 动态页面(public): /p/:slug, on-demand fetch 内容, 硬刷新可工作 */}
          <Route path="/p/:slug" element={<DynamicPage />} />
          {/* 用户端发票中心：由 Sub2API custom_menu_items 以 iframe 打开并注入 token。 */}
          <Route path="/invoice" element={<InvoicePortalPage />} />
          <Route path="/invoices" element={<InvoicePortalPage />} />
          <Route path="/promotions" element={<PromotionPortalPage />} />
          {/* Sub2API developer documentation: public by design so it can be mounted
              in a user-facing custom menu or embedded by another system. */}
          <Route path="/api-docs" element={<ApiDocsPage />} />
          <Route path="/docs" element={<ApiDocsPage />} />
          <Route path="/client-docs" element={<Suspense fallback={<main className="p-8" role="status">正在加载接入指南…</main>}><ClientDocsPage /></Suspense>} />
          {/* 管理端: 需管理员会话 (对应 sub2api custom_menu_items, 传 token) */}
          <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
            {/* U6: 仪表盘为管理端首页 (R10) */}
            <Route index element={<AdminEntryRedirect />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="homepage" element={<HomepageConfigPage />} />
            <Route path="tob-homepage" element={<TobHomepageConfigPage />} />
            <Route path="pages" element={<PageManagementPage />} />
            <Route path="files" element={<FileManagementPage />} />
            {/* Legacy bookmark: the former image resource route now points to the same file manager. */}
            <Route path="assets" element={<ImageAssetsPage />} />
            <Route path="ops/ttft" element={<TTFTFlamegraphPage />} />
            <Route path="ops/consumption" element={<ConsumptionPage />} />
            <Route path="ops/cost-config" element={<CostConfigPage />} />
            <Route path="invoices" element={<InvoiceManagementPage />} />
            <Route path="promotions" element={<PromotionManagementPage />} />
            <Route path="notifications" element={<NotificationManagementPage />} />
            <Route path="logs/system" element={<SystemLogsPage />} />
            <Route path="logs/operation" element={<OperationLogsPage />} />
            <Route path="logs/operations" element={<OperationLogsPage />} />
            <Route path="system-config" element={<SystemConfigPage />} />
            {/* 动态页面(admin): /admin/p/:slug, 经 AdminGuard, on-demand fetch */}
            <Route path="p/:slug" element={<AdminDynamicPage />} />
            <Route path="examples/content" element={<ContentExamplePage />} />
            <Route path="examples/interaction" element={<InteractionExamplePage />} />
            <Route path="examples/api" element={<APIExamplePage />} />
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </PageLoadBoundary>
  )
}
