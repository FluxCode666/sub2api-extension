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
import { Routes, Route } from 'react-router-dom'
import PublicLayout from '@/layouts/PublicLayout'
import AdminLayout from '@/layouts/AdminLayout'
import AdminGuard from '@/components/AdminGuard'
import HomePage from '@/pages/HomePage'
import SampleDynamicPage from '@/pages/SampleDynamicPage'
import DashboardPage from '@/pages/admin/DashboardPage'

function NotFound() {
  return <h1 className="text-2xl font-bold">404 Not Found</h1>
}

export default function App() {
  return (
    <Routes>
      {/* 公开页: 无需认证 (对应 sub2api home_content 裸 iframe, KTD6) */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
      </Route>
      {/* 管理端: 需管理员会话 (对应 sub2api custom_menu_items, 传 token) */}
      <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
        {/* U6: 仪表盘为管理端首页 (R10) */}
        <Route index element={<DashboardPage />} />
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="sample-dynamic" element={<SampleDynamicPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
