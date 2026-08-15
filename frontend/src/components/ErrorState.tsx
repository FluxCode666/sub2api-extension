/**
 * ErrorState —— 共享的错误降级展示。
 *
 * 各动态页加载失败(非管理员/无会话/服务不可达)时统一渲染, 不崩。
 * 提取自 SampleDynamicPage 与 DashboardPage 的重复错误块。
 */
interface ErrorStateProps {
  title: string
  description: string
  detail?: string
}

export default function ErrorState({ title, description, detail }: ErrorStateProps) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
        {title}
      </h1>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-700 dark:bg-amber-900/30">
        <h2 className="text-lg font-semibold text-amber-800 dark:text-amber-300">
          数据暂不可用
        </h2>
        <p className="mt-2 text-sm text-amber-700 dark:text-amber-400">
          {description}
        </p>
        {detail && (
          <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
            详情: {detail}
          </p>
        )}
      </div>
    </div>
  )
}
