/**
 * 页面管理页占位(Phase 5 替换为完整 CRUD UI)。
 *
 * 当前 Phase 4: 仅提供路由入口, 让侧边栏"页面管理"链接可访问。
 * Phase 5 将替换为: 列表 + 创建/编辑/删除/启停 + Monaco 编辑器。
 */
export default function PageManagementPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          页面管理
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          创建、编辑、删除动态页面,配置路由与权限。
        </p>
      </div>
      <div className="rounded-xl border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          页面管理 UI 将在 Phase 5 实现(列表 + Monaco 编辑器 + CRUD)
        </p>
      </div>
    </div>
  )
}
