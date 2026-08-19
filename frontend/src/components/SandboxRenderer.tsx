/**
 * SandboxRenderer —— 在隔离的 iframe 沙箱中渲染用户提供的 HTML 内容。
 *
 * 安全模型(Pitfall 1/2):
 *   - sandbox="allow-scripts" 且不含 allow-same-origin → iframe 获得唯一 opaque origin,
 *     无法访问父应用 localStorage/JWT/Cookie/DOM。用户脚本被隔离。
 *   - srcdoc 注入内容(不经过主 DOM), 严格 CSP 限制: default-src 'none',
 *     script/style 只允许内联，合作伙伴 icon 仅允许 https/data 图片。
 *   - 父↔iframe 通信仅经 postMessage(feature-click 埋点上报钩子)。
 *
 * 埋点:
 *   iframe 内脚本通过 window.parent.postMessage({type:'feature-click', featureId}, '*')
 *   上报功能点击。父窗口监听并调用 telemetry-sdk 的 trackFeatureClick。
 *   页面访问埋点(page-view)由父窗口在 DynamicPage 组件中直接上报(iframe 无法触达)。
 */
import { useEffect, useRef, useState } from 'react'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

interface SandboxRendererProps {
  /** 用户提供的 HTML 内容。 */
  content: string
  /** 页面 id(page:<slug>), 用于埋点 feature-click 上报。 */
  pageId: string
  /** 可选标题, 注入到 iframe document.title。 */
  title?: string
  /** 页面管理中的元数据，注入沙箱供数据库 HTML 页面读取。 */
  metadata?: Record<string, unknown>
  /** 全屏动态页：去掉宿主边框；默认按内容高度展开 iframe。 */
  fullBleed?: boolean
  /** 由 iframe 自身滚动，让沙箱内 fixed 元素使用浏览器原生固定定位。 */
  scrollWithinFrame?: boolean
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

/** 兼容旧全屏页：由宿主滚动时同步 iframe 高度与父页面滚动位置。 */
const FRAME_SIZE_BOOTSTRAP = `
<script>
(function(){
  var root = document.querySelector('.teralemo-page') || document.body;
  function reportHeight(){
    try {
      var rect = root.getBoundingClientRect();
      var height = Math.ceil(rect.top + rect.height);
      window.parent.postMessage({ type: 'aux-frame-height', height: height }, '*');
    } catch (_) {}
  }
  window.addEventListener('message', function(event){
    var data = event.data;
    if (!data || data.type !== 'aux-parent-scroll') return;
    var offset = Math.max(0, Number(data.offset) || 0);
    document.documentElement.style.setProperty('--aux-parent-scroll-y', offset + 'px');
    try {
      window.dispatchEvent(new CustomEvent('auxparentscroll', { detail: { offset: offset } }));
    } catch (_) {}
  });
  window.addEventListener('load', reportHeight);
  if (window.ResizeObserver) {
    new ResizeObserver(reportHeight).observe(root);
  }
  setTimeout(reportHeight, 0);
})();
</script>`

/** CSP 策略: 脚本和样式只允许内联；合作伙伴 icon 允许安全的 HTTPS/data 图片。 */
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src http: https: data:; base-uri 'none'; form-action 'none'"

export default function SandboxRenderer({
  content,
  pageId,
  title,
  metadata = {},
  fullBleed = false,
  scrollWithinFrame = false,
}: SandboxRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pageIdRef = useRef(pageId)
  const [contentHeight, setContentHeight] = useState<number | null>(null)
  const expandsToContent = fullBleed && !scrollWithinFrame
  pageIdRef.current = pageId

  // 监听 iframe postMessage(feature-click 上报)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== 'object') return

      if (data.type === 'aux-feature-click' && typeof data.featureId === 'string') {
        trackFeatureClick(pageIdRef.current, data.featureId)
        return
      }

      // sandbox iframe 使用 opaque origin，不能依赖 event.origin 校验；
      // 通过 source 严格限定为当前 iframe，避免接收其他窗口的高度消息。
      if (
        expandsToContent &&
        data.type === 'aux-frame-height' &&
        event.source === iframeRef.current?.contentWindow &&
        typeof data.height === 'number' &&
        Number.isFinite(data.height)
      ) {
        const nextHeight = Math.max(480, Math.min(Math.ceil(data.height), 100_000))
        setContentHeight(nextHeight)
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [expandsToContent])

  useEffect(() => {
    setContentHeight(null)
  }, [content, expandsToContent])

  // 兼容没有启用 frame 滚动模式的旧全屏页。启用 frame 模式后不注册此同步，
  // 沙箱内 fixed 元素与内容共用原生滚动上下文，不存在跨窗口位置延迟。
  useEffect(() => {
    if (!expandsToContent) return

    const syncParentScroll = () => {
      const iframe = iframeRef.current
      const frameWindow = iframe?.contentWindow
      if (!iframe || !frameWindow) return
      const rect = iframe.getBoundingClientRect()
      const maxOffset = Math.max(0, rect.height - window.innerHeight)
      const offset = Math.max(0, Math.min(-rect.top, maxOffset))
      frameWindow.postMessage({ type: 'aux-parent-scroll', offset }, '*')
    }

    window.addEventListener('scroll', syncParentScroll, { passive: true })
    window.addEventListener('resize', syncParentScroll)
    syncParentScroll()
    return () => {
      window.removeEventListener('scroll', syncParentScroll)
      window.removeEventListener('resize', syncParentScroll)
    }
  }, [content, contentHeight, expandsToContent])

  // 构建 srcdoc: 标题 + 内容 + 引导脚本
  const metadataJSON = JSON.stringify(metadata).replace(/</g, '\\u003c')
  const metadataBootstrap = `<script>window.__AUX_METADATA__=${metadataJSON};</script>`
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
${metadataBootstrap}
${content}
${SANDBOX_BOOTSTRAP}
${expandsToContent ? FRAME_SIZE_BOOTSTRAP : ''}
</body>
</html>`

  const frameClassName = fullBleed
    ? 'aux-sandbox-frame aux-sandbox-frame--full-bleed'
    : 'aux-sandbox-frame'
  const iframeClassName = fullBleed
    ? `aux-sandbox-iframe aux-sandbox-iframe--full-bleed${scrollWithinFrame ? ' aux-sandbox-iframe--scroll-frame' : ''} w-full border-0 bg-white dark:bg-gray-950`
    : 'aux-sandbox-iframe h-[70dvh] w-full border-0 bg-white dark:bg-gray-950'

  return (
    <div className={frameClassName}>
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        title={title ?? '动态页面内容'}
        className={iframeClassName}
        style={expandsToContent && contentHeight ? { height: `${contentHeight}px` } : undefined}
        scrolling={fullBleed ? (scrollWithinFrame ? 'auto' : 'no') : undefined}
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
