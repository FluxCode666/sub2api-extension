import { Outlet, NavLink } from 'react-router-dom'

/**
 * 管理端外壳布局。
 * 承载附属系统的管理页面, 守卫逻辑 U3 加入。
 * U6: 加导航链接到仪表盘。
 */
export default function AdminLayout() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-1.5 text-sm font-medium transition ${
      isActive
        ? 'bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
    }`

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <header className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
        <div className="mx-auto flex max-w-7xl items-center gap-4">
          <span className="text-sm font-semibold">Sub2API Aux Admin</span>
          <nav className="flex gap-2">
            <NavLink to="/admin/dashboard" className={linkClass} end>
              仪表盘
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
