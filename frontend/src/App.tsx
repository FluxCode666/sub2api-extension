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
import HomePage from '@/pages/HomePage'
import DashboardPage from '@/pages/admin/DashboardPage'
import HomepageConfigPage from '@/pages/admin/HomepageConfigPage'
import ContentExamplePage from '@/pages/examples/ContentExamplePage'
import InteractionExamplePage from '@/pages/examples/InteractionExamplePage'
import APIExamplePage from '@/pages/examples/APIExamplePage'

function NotFound() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-gray-50 px-5 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">404</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">页面不存在</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400">当前地址没有对应内容，可以返回 TERALEMO 官网继续浏览。</p>
        <Link to="/" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-gray-50 dark:bg-gray-100 dark:text-gray-900">返回官网首页</Link>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      {/* 独立登录入口: AdminGuard 的 no-embedded-token 分支重定向到此。
          功能路由, 不登记到 page-registry (非内容页, 不污染埋点仪表盘)。 */}
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
      </Route>
      {/* 管理端: 需管理员会话 (对应 sub2api custom_menu_items, 传 token) */}
      <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
        {/* U6: 仪表盘为管理端首页 (R10) */}
        <Route index element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="homepage" element={<HomepageConfigPage />} />
        <Route path="examples/content" element={<ContentExamplePage />} />
        <Route path="examples/interaction" element={<InteractionExamplePage />} />
        <Route path="examples/api" element={<APIExamplePage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
