/**
 * 动态页面 host 组件(admin)。
 *
 * 路由 /admin/p/:slug 渲染此组件(经 AdminGuard)。按 slug on-demand fetch
 * 管理端页面内容(GET /api/aux/admin/pages/slug/:slug), 硬刷新也能工作。
 *
 * v1: HTML 内容经 SandboxRenderer(iframe 沙箱)渲染 —— Phase 6 实现。
 * 当前 Phase 3: 先实现 fetch + loading/error 态, 内容渲染用占位。
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import ErrorState from '@/components/ErrorState'

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

export default function AdminDynamicPage() {
  const { slug = '' } = useParams<{ slug: string }>()
  const [state, setState] = useState<LoadState>('loading')
  const [page, setPage] = useState<DynamicPageData | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    apiClient
      .get<AuxEnvelope<DynamicPageData>>(`/admin/pages/slug/${encodeURIComponent(slug)}`)
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
      <div className="flex min-h-[40dvh] items-center justify-center">
        <div className="text-sm text-gray-500 dark:text-gray-400">加载页面中…</div>
      </div>
    )
  }

  if (state === 'error' || !page) {
    return <ErrorState title="无法加载页面" description={errorMsg} />
  }

  // Phase 6 将替换此处为 SandboxRenderer
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
        {page.title}
      </h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
        slug: {page.slug} · 内容类型: {page.content_type}
      </p>
      <div
        className="mt-6 rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-400 dark:border-gray-700 dark:text-gray-500"
        aria-placeholder="dynamic-content"
      >
        动态页面内容渲染将在 Phase 6(沙箱渲染器)实现
      </div>
    </div>
  )
}
