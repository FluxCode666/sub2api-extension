import { Outlet } from 'react-router-dom'

/**
 * 公开页外壳布局。
 * 承载由开发者硬编码的扩展动态页面 (U4 实现)。
 */
export default function PublicLayout() {
  return (
    <div className="aux-public-shell">
      <main className="aux-public-main">
        <Outlet />
      </main>
    </div>
  )
}
