/**
 * 测试动态导入功能的示例页面
 */
export default function TestDynamicPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-slate-100">
      <div className="container mx-auto px-4 py-16">
        <div className="max-w-3xl mx-auto space-y-8">
          <header className="text-center space-y-4">
            <h1 className="text-5xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              动态导入测试成功！
            </h1>
            <p className="text-xl text-slate-300">
              这个页面通过 Vite 动态 import 加载，无需硬编码注册
            </p>
          </header>

          <div className="bg-slate-800/50 backdrop-blur border border-slate-700 rounded-2xl p-8 space-y-6">
            <h2 className="text-2xl font-semibold text-cyan-400">功能说明</h2>
            <ul className="space-y-3 text-slate-300">
              <li className="flex items-start gap-3">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>组件文件位于 <code className="px-2 py-1 bg-slate-900 rounded text-sm">frontend/src/pages/TestDynamicPage.tsx</code></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>在页面管理中，内容类型选择 React(v2)，内容填写 <code className="px-2 py-1 bg-slate-900 rounded text-sm">TestDynamicPage</code></span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>系统自动通过 <code className="px-2 py-1 bg-slate-900 rounded text-sm">import()</code> 动态加载组件</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-cyan-400 mt-1">✓</span>
                <span>无需在 DynamicPage.tsx 或 AdminDynamicPage.tsx 中手动注册</span>
              </li>
            </ul>
          </div>

          <div className="bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/20 rounded-2xl p-8">
            <h3 className="text-xl font-semibold text-cyan-400 mb-4">创建新页面流程</h3>
            <ol className="space-y-3 text-slate-300 list-decimal list-inside">
              <li>创建组件文件 <code className="px-2 py-1 bg-slate-900 rounded text-sm">frontend/src/pages/YourPage.tsx</code></li>
              <li>在页面管理 UI 中新建页面</li>
              <li>内容类型选择 <strong className="text-cyan-400">React(v2)</strong></li>
              <li>内容填写组件名（如 <code className="px-2 py-1 bg-slate-900 rounded text-sm">YourPage</code>）</li>
              <li>保存并访问路由即可</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
