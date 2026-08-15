/**
 * HomePage —— 替换 sub2api 官网首页的公开页。
 *
 * 纯公开内容 (KTD6): 不依赖 token, 不读 sub2api 受保护数据。
 * 对应 sub2api home_content 路径: HomeView 把 home_content 当裸 iframe 渲染,
 * 不走 buildEmbeddedUrl, 不传 token —— 因此此页面必须能在无认证时渲染。
 *
 * Covers AE1: 公开访客经 home_content iframe 加载此页, 无需登录可浏览。
 */
export default function HomePage() {
  return (
    <div className="space-y-8">
      <section className="text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          Sub2API
        </h1>
        <p className="mt-4 text-lg text-gray-600 dark:text-gray-400">
          统一的 API 调度与管理平台
        </p>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <FeatureCard
          title="多渠道管理"
          description="集中管理多个 API 渠道,智能调度与负载均衡,确保服务高可用。"
        />
        <FeatureCard
          title="实时监控"
          description="请求量、Token 消耗、成本统计一目了然,助你掌控全局。"
        />
        <FeatureCard
          title="灵活分组"
          description="按需配置 API Key 分组与权限策略,适配多场景需求。"
        />
      </section>

      <section className="rounded-lg bg-gray-50 p-6 dark:bg-gray-800">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          开始使用
        </h2>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          请登录管理后台以访问完整功能。如有疑问,请联系管理员获取 API Key。
        </p>
      </section>
    </div>
  )
}

function FeatureCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-6 dark:border-gray-700">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {title}
      </h3>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        {description}
      </p>
    </div>
  )
}
