/**
 * 动态页面 host 组件(public)。
 *
 * 路由 /p/:slug 渲染此组件。按 slug on-demand fetch 页面内容
 * (GET /api/aux/pages/:slug), 硬刷新也能工作。
 *
 * v1: HTML 内容经 SandboxRenderer(iframe 沙箱)渲染 —— Phase 6 实现。
 * 当前 Phase 3: 先实现 fetch + loading/error 态, 内容渲染用占位
 * (Phase 6 替换为 SandboxRenderer)。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import ErrorState from '@/components/ErrorState'

/** 后端 Page(镜像 service.Page)。 */
interface DynamicPageData {
  id: number
  slug: string
  title: string
  visibility: 'public' | 'admin'
  content_type: 'html' | 'react'
  content_html?: string
  content_react?: string
  enabled: boolean
  page_id: string
}

type LoadState = 'loading' | 'loaded' | 'error'

export default function DynamicPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [state, setState] = useState<LoadState>('loading')
  const [page, setPage] = useState<DynamicPageData | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

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

  if (state === 'loading') {
    return (
      <main className="flex min-h-[60dvh] items-center justify-center bg-gray-50 px-5 dark:bg-gray-950">
        <div className="text-sm text-gray-500 dark:text-gray-400">加载页面中…</div>
      </main>
    )
  }

  if (state === 'error' || !page) {
    return <ErrorState title="无法加载页面" description={errorMsg} />
  }

  // Phase 6 将替换此处为 SandboxRenderer(iframe 沙箱渲染 HTML)
  return (
    <main className="min-h-[60dvh] bg-gray-50 px-5 py-8 dark:bg-gray-950">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
          {page.title}
        </h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
          slug: {page.slug} · 内容类型: {page.content_type}
        </p>
        {/* Phase 6: SandboxRenderer 将在此渲染 page.content_html */}
        <div
          className="mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500"
          aria-placeholder="dynamic-content"
        >
          动态页面内容渲染将在 Phase 6(沙箱渲染器)实现
        </div>
      </div>
    </main>
  )
}
