/**
 * 动态页面 host 组件(public)。
 *
 * 路由 /p/:slug 渲染此组件。按 slug on-demand fetch 页面内容
 * (GET /api/aux/pages/:slug), 硬刷新也能工作。
 *
 * 支持两种内容类型：
 * - html: 通过 SandboxRenderer 在隔离 iframe 中渲染
 * - react: 支持两种模式
 *   1. 文件组件模式：content_react 为组件名（如 "TestDynamicPage"），从预注册的文件中加载
 *   2. 代码模式：content_react 包含完整的 TSX 代码，运行时动态编译
 */
import { useEffect, useState, type ComponentType } from 'react'
import { useParams } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import ErrorState from '@/components/ErrorState'
import SandboxRenderer from '@/components/SandboxRenderer'
import { trackPageView } from '@/lib/telemetry-sdk'
import { compileAndCreateComponent } from '@/lib/dynamic-react-compiler'

// 使用 Vite 的 import.meta.glob 预先注册所有页面组件（文件组件模式）
export type DynamicComponentProps = { metadata?: Record<string, unknown>; pageId?: string }
type DynamicComponent = ComponentType<DynamicComponentProps>
const pageModules = import.meta.glob<{ default: DynamicComponent }>('./*Page.tsx')

/** 后端 Page(镜像 service.Page)。 */
interface DynamicPageData {
  id: number
  slug: string
  title: string
  visibility: 'public' | 'admin'
  content_type: 'html' | 'react'
  content_html?: string
  content_react?: string
  metadata?: Record<string, unknown>
  enabled: boolean
  page_id: string
}

type LoadState = 'loading' | 'loaded' | 'error'

export default function DynamicPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [state, setState] = useState<LoadState>('loading')
  const [page, setPage] = useState<DynamicPageData | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // React 组件动态加载 state（必须在组件顶层声明）
  const [ReactComponent, setReactComponent] = useState<DynamicComponent | null>(null)
  const [componentError, setComponentError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    apiClient
      .get<AuxEnvelope<DynamicPageData>>(`/pages/${encodeURIComponent(slug)}`)
      .then((res) => {
        if (cancelled) return
        if (res.data) {
          setPage(res.data)
          setState('loaded')
          // 上报页面访问埋点(page_id = page:<slug>)
          trackPageView(res.data.page_id)
        } else {
          setErrorMsg('页面内容为空')
          setState('error')
        }
      })
      .catch(() => {
        if (cancelled) return
        setErrorMsg('页面不存在或暂时不可用')
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  useEffect(() => {
    let cancelled = false
    setReactComponent(null)
    setComponentError('')

    if (page?.content_type === 'react' && page.content_react) {
      const reactContent = page.content_react.trim()

      // 判断是文件组件模式还是代码模式
      // 如果包含 export、function、const 等关键字，判定为代码模式
      const isCodeMode = /\b(export|function|const|class|import)\b/.test(reactContent)

      if (isCodeMode) {
        // 代码模式：运行时编译完整的 TSX 代码
        compileAndCreateComponent(reactContent)
          .then((Component) => {
            if (!cancelled) setReactComponent(() => Component as DynamicComponent)
          })
          .catch((err) => {
            if (!cancelled) setComponentError(`组件编译失败: ${getErrorMessage(err)}`)
          })
      } else {
        // 文件组件模式：从预注册的模块中加载
        const componentPath = `./${reactContent}.tsx`
        const loader = pageModules[componentPath]

        if (loader) {
          loader()
            .then((module) => {
              if (!cancelled) setReactComponent(() => module.default)
            })
            .catch((err) => {
              if (!cancelled) setComponentError(`组件加载失败: ${getErrorMessage(err)}`)
            })
        } else {
          setComponentError(`未找到组件: ${reactContent}`)
        }
      }
    }

    return () => { cancelled = true }
  }, [page?.content_type, page?.content_react])

  if (state === 'loading') {
    return (
      <main className="aux-public-page flex min-h-[60dvh] items-center justify-center">
        <div className="aux-surface-loading">加载页面中…</div>
      </main>
    )
  }

  if (state === 'error' || !page) {
    return <ErrorState title="无法加载页面" description={errorMsg} />
  }

  // 根据 content_type 渲染不同类型的内容
  if (page.content_type === 'react' && page.content_react) {
    if (componentError) {
      return <ErrorState title="组件加载失败" description={componentError} />
    }
    if (!ReactComponent) {
      return (
        <main className="aux-public-page flex min-h-[60dvh] items-center justify-center">
          <div className="aux-surface-loading">加载组件中…</div>
        </main>
      )
    }
    return <ReactComponent metadata={page.metadata ?? {}} pageId={page.page_id} />
  }

  // HTML 类型通过隔离 iframe 渲染，避免动态内容接触宿主应用会话。
  const htmlContent = page.content_html ?? ''
  const fullBleed = page.metadata?.full_bleed === 'true'
  const scrollWithinFrame = fullBleed && page.metadata?.scroll_mode === 'frame'
  return (
    <main className={fullBleed ? 'aux-public-page aux-public-page--full-bleed' : 'aux-public-page'}>
      <div className={fullBleed ? 'aux-page-frame aux-page-frame--full-bleed' : 'aux-page-frame'}>
        {!fullBleed && (
          <header className="aux-page-header">
            <span className="aux-page-kicker">公开内容</span>
            <h1>{page.title}</h1>
          </header>
        )}
        <SandboxRenderer
          content={htmlContent}
          pageId={page.page_id}
          title={page.title}
          metadata={page.metadata}
          fullBleed={fullBleed}
          scrollWithinFrame={scrollWithinFrame}
        />
      </div>
    </main>
  )
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
