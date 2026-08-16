const statusItems = [
  { label: '管理端路由', value: '正常', tone: 'text-emerald-700 dark:text-emerald-300' },
  { label: '管理员权限', value: '已验证', tone: 'text-emerald-700 dark:text-emerald-300' },
  { label: '内容版本', value: 'v1', tone: 'text-gray-700 dark:text-gray-300' },
]

export default function ContentExamplePage() {
  return (
    <div className="max-w-4xl space-y-8">
      <header className="border-b border-gray-200 pb-6 dark:border-gray-700">
        <p className="text-sm font-medium text-blue-700 dark:text-blue-300">
          内容中心
        </p>
        <h1 className="mt-2 text-3xl font-bold text-gray-900 dark:text-gray-100">
          静态内容示例
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-400">
          本周发布窗口为周三 14:00 至 16:00。变更负责人需在发布前完成检查，
          并在窗口结束后记录验证结果。
        </p>
      </header>

      <section aria-labelledby="status-heading">
        <h2
          id="status-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          系统状态
        </h2>
        <ul className="mt-3 divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-700 dark:border-gray-700">
          {statusItems.map((item) => (
            <li
              key={item.label}
              className="flex items-center justify-between gap-4 py-3 text-sm"
            >
              <span className="text-gray-600 dark:text-gray-400">{item.label}</span>
              <span className={`font-medium ${item.tone}`}>{item.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="metadata-heading">
        <h2
          id="metadata-heading"
          className="text-lg font-semibold text-gray-900 dark:text-gray-100"
        >
          内容元数据
        </h2>
        <dl className="mt-3 grid gap-x-8 gap-y-4 border-t border-gray-200 pt-4 text-sm sm:grid-cols-2 dark:border-gray-700">
          <div>
            <dt className="text-gray-500 dark:text-gray-400">页面 ID</dt>
            <dd className="mt-1 font-mono text-gray-900 dark:text-gray-100">
              example-content
            </dd>
          </div>
          <div>
            <dt className="text-gray-500 dark:text-gray-400">数据来源</dt>
            <dd className="mt-1 text-gray-900 dark:text-gray-100">
              本地静态内容
            </dd>
          </div>
        </dl>
      </section>
    </div>
  )
}
