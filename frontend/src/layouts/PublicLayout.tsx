import { Outlet } from 'react-router-dom'

/**
 * 公开页外壳布局。
 * 承载由开发者硬编码的扩展动态页面 (U4 实现)。
 */
export default function PublicLayout() {
  return (
    <div className="min-h-screen bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
      <main className="mx-auto max-w-5xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
