/**
 * SandboxRenderer —— 在隔离的 iframe 沙箱中渲染用户提供的 HTML 内容。
 *
 * 安全模型(Pitfall 1/2):
 *   - sandbox="allow-scripts" 且不含 allow-same-origin → iframe 获得唯一 opaque origin,
 *     无法访问父应用 localStorage/JWT/Cookie/DOM。用户脚本被隔离。
 *   - srcdoc 注入内容(不经过主 DOM), 严格 CSP 限制: default-src 'none',
 *     script-src 'unsafe-inline', style-src 'unsafe-inline' —— 无外部加载。
 *   - 父↔iframe 通信仅经 postMessage(feature-click 埋点上报钩子)。
 *
 * 埋点:
 *   iframe 内脚本通过 window.parent.postMessage({type:'feature-click', featureId}, '*')
 *   上报功能点击。父窗口监听并调用 telemetry-sdk 的 trackFeatureClick。
 *   页面访问埋点(page-view)由父窗口在 DynamicPage 组件中直接上报(iframe 无法触达)。
 */
import { useEffect, useRef } from 'react'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

interface SandboxRendererProps {
  /** 用户提供的 HTML 内容。 */
  content: string
  /** 页面 id(page:<slug>), 用于埋点 feature-click 上报。 */
  pageId: string
  /** 可选标题, 注入到 iframe document.title。 */
  title?: string
}

/** iframe 内注入的引导脚本: 监听 click 事件, 上报 feature-click。 */
const SANDBOX_BOOTSTRAP = `
<script>
(function(){
  // 拦截带 data-feature-id 的元素点击, 上报 feature-click
  document.addEventListener('click', function(e){
    var el = e.target;
    while(el && el !== document.body){
      var fid = el.getAttribute('data-feature-id');
      if(fid){
        try { window.parent.postMessage({ type: 'aux-feature-click', featureId: fid }, '*'); } catch(_){}
      }
      el = el.parentElement;
    }
  }, true);
})();
</script>`

/** CSP 策略: 禁止外部加载, 仅允许内联脚本与样式。 */
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

export default function SandboxRenderer({ content, pageId, title }: SandboxRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pageIdRef = useRef(pageId)
  pageIdRef.current = pageId

  // 监听 iframe postMessage(feature-click 上报)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (data && typeof data === 'object' && data.type === 'aux-feature-click' && typeof data.featureId === 'string') {
        trackFeatureClick(pageIdRef.current, data.featureId)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  // 构建 srcdoc: 标题 + 内容 + 引导脚本
  const srcdoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
${title ? `<title>${escapeHtml(title)}</title>` : ''}
<style>
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 24px; color: #1a1a1a; background: #fff; line-height: 1.6; }
  @media (prefers-color-scheme: dark) { body { color: #e5e5e5; background: #0a0a0a; } }
</style>
</head>
<body>
${content}
${SANDBOX_BOOTSTRAP}
</body>
</html>`

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        title={title ?? '动态页面内容'}
        className="h-[70dvh] w-full border-0 bg-white dark:bg-gray-950"
        loading="lazy"
      />
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
