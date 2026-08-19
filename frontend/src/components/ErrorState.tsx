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
    <div className="aux-error-state">
      <span className="aux-page-kicker">暂时无法继续</span>
      <h1>{title}</h1>
      <div className="aux-error-card">
        <h2>数据暂不可用</h2>
        <p>
          {description}
        </p>
        {detail && (
          <p className="aux-error-detail">
            详情: {detail}
          </p>
        )}
      </div>
    </div>
  )
}
