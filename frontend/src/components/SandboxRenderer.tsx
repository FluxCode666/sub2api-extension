/**
 * SandboxRenderer —— 在隔离的 iframe 沙箱中渲染用户提供的 HTML 内容。
 *
 * 安全模型(Pitfall 1/2):
 *   - sandbox="allow-scripts" 且不含 allow-same-origin → iframe 获得唯一 opaque origin,
 *     无法访问父应用 localStorage/JWT/Cookie/DOM。用户脚本被隔离。
 *   - srcdoc 注入内容(不经过主 DOM), 严格 CSP 限制: default-src 'none',
 *     script/style 只允许内联，合作伙伴 icon 仅允许 https/data 图片。
 *   - 父↔iframe 通信仅经 postMessage(埋点上报与宿主顶层导航钩子)。
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

/** iframe 内注入的引导脚本: 监听 click 事件, 上报埋点并把页面跳转交给宿主。 */
const SANDBOX_BOOTSTRAP = `
<script>
(function(){
  // 所有离开当前文档的链接都交给宿主窗口做顶层导航。sandbox iframe
  // 没有 allow-same-origin，直接在 iframe 内加载宿主 SPA 会产生 opaque
  // origin(null)，开发环境的 Vite 模块请求因此触发 CORS 并显示空白页。
  // 纯页内 #锚点仍留在 iframe 内，官网的 frame 滚动和导航不受影响。
  function postNavigation(event, anchor) {
    var href = (anchor.getAttribute('href') || '').trim();
    var target = (anchor.getAttribute('target') || '').trim().toLowerCase();
    if (!href || href === '#') return;
    if (/^javascript:/i.test(href)) {
      event.preventDefault();
      return;
    }
    var isHash = href.charAt(0) === '#';
    var targetTop = target === '_top' || target === '_parent' || target === '_blank';
    if (isHash && !targetTop) return;
    event.preventDefault();
    try {
      window.parent.postMessage({
        type: 'aux-navigation',
        href: href,
        target: target || '_self'
      }, '*');
    } catch(_) {}
  }

  document.addEventListener('click', function(e){
    var el = e.target;
    var anchor = null;
    while(el && el !== document.body){
      var fid = el.getAttribute ? el.getAttribute('data-feature-id') : null;
      if(fid){
        try { window.parent.postMessage({ type: 'aux-feature-click', featureId: fid }, '*'); } catch(_){}
      }
      if (el.tagName && el.tagName.toLowerCase() === 'a') {
        anchor = anchor || el;
      }
      el = el.parentElement;
    }
    if (anchor) postNavigation(e, anchor);
  }, true);
})();
</script>`

/** iframe 内注入的元数据链接引导脚本: 支持任意动态 HTML 声明 data-metadata-href。 */
const METADATA_LINK_BOOTSTRAP = `
<script>
(function(){
  var metadata = window.__AUX_METADATA__ || {};
  function isSafeNavigation(value) {
    var href = String(value == null ? '' : value).trim();
    if (!href || /^javascript:/i.test(href)) return false;
    if (/^(https?:|mailto:|tel:|\\/|#)/i.test(href)) return true;
    return !/^[a-z][a-z0-9+.-]*:/i.test(href);
  }
  document.querySelectorAll('[data-metadata-href]').forEach(function(el){
    var key = el.getAttribute('data-metadata-href');
    if (!key || metadata[key] == null) return;
    var value = String(metadata[key]).trim();
    if (value && isSafeNavigation(value)) el.setAttribute('href', value);
  });
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

      // 兼容旧版引导脚本发送的控制台消息；新版统一发送 aux-navigation。
      if (
        (data.type === 'aux-navigation' || data.type === 'aux-console-navigation') &&
        event.source === iframeRef.current?.contentWindow &&
        typeof data.href === 'string'
      ) {
        const href = data.href.trim()
        if (!href) return
        try {
          const target = new URL(href, window.location.href)
          if (!isSafeNavigationProtocol(target.protocol)) return
          const targetName = typeof data.target === 'string' ? data.target.toLowerCase() : '_self'
          if (targetName === '_blank') {
            // postMessage 会跨一个任务边界，部分浏览器可能阻止弹窗；失败时
            // 降级为当前窗口导航，确保链接始终可用且不会回到 iframe。
            const opened = window.open(target.href, '_blank', 'noopener,noreferrer')
            if (!opened) window.location.assign(target.href)
          } else {
            window.location.assign(target.href)
          }
        } catch {
          // 忽略无效地址，保持当前页面可用。
        }
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
${METADATA_LINK_BOOTSTRAP}
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

function isSafeNavigationProtocol(protocol: string): boolean {
  return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:' || protocol === 'tel:'
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
