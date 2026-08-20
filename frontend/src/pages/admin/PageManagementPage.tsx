/**
 * 页面管理页 —— 管理员动态页面 CRUD。
 *
 * /admin/pages: 列出所有动态页面(标题/slug/路由/可见性/状态/操作)。
 * 创建/编辑: Dialog 表单(Monaco 编辑器编辑 HTML, slug 实时校验, 可见性/内容类型选择)。
 * 删除: 确认对话框(提示埋点历史保留)。
 * 启停: Switch 切换 enabled；支持按选择导出和 JSON 导入。
 *
 * Monaco 编辑器懒加载(React.lazy), 避免拖慢主 bundle。
 */
import { useCallback, useEffect, useRef, useState, lazy, Suspense } from 'react'
import { Link } from 'react-router-dom'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { refreshDynamicPages } from '@/lib/dynamic-pages'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MenuIconPicker } from '@/components/MenuIconPicker'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Plus, Pencil, Trash2, Loader2, RefreshCw, Download, Upload } from 'lucide-react'
import { MENU_ICON_OPTIONS } from '@/lib/menu-icons'
import { toast } from 'sonner'

// Monaco 懒加载(避免拖慢主 bundle)
const MonacoEditor = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.default })))

/** 后端 PageListItem(镜像 service.PageListItem)。 */
interface PageListItem {
  id: number
  slug: string
  title: string
  visibility: 'public' | 'admin'
  content_type: 'html' | 'react'
  enabled: boolean
  route: string
  page_id: string
  menu_icon?: string
  updated_at: string
  sub2api_published: boolean
  sub2api_visibility?: 'user' | 'admin'
  sub2api_menu_name?: string
}

/** 后端 Page(含内容, 编辑时获取)。 */
interface PageDetail extends PageListItem {
  content_html?: string
  content_react?: string
  metadata?: Record<string, unknown>
}

/** 页面导入/导出文件格式。id 不写入文件，导入时按路由匹配已有页面。 */
interface PageTransferItem {
  slug: string
  title: string
  visibility: 'public' | 'admin'
  content_type: 'html' | 'react'
  content_html: string
  content_react: string
  metadata: Record<string, unknown>
  enabled: boolean
  route: string
  sub2api_published?: boolean
  sub2api_visibility?: 'user' | 'admin'
  sub2api_menu_name?: string
}

interface PageTransferDocument {
  format: 'sub2api-extension-pages'
  version: 1
  exported_at: string
  pages: PageTransferItem[]
}

interface PageListResponse {
  items: PageListItem[]
}

/** 表单状态。 */
interface PageForm {
  slug: string
  title: string
  visibility: 'public' | 'admin'
  content_type: 'html' | 'react'
  content_html: string
  metadata: Record<string, string>
  menu_icon: string
  enabled: boolean
  sub2api_published: boolean
  sub2api_visibility: 'user' | 'admin'
  sub2api_menu_name: string
}

/** 元数据编辑行的 UI 状态；id 不会随着用户修改键名而变化。 */
interface MetadataEntry {
  id: string
  key: string
  value: string
}

function metadataEntriesToRecord(entries: MetadataEntry[]): Record<string, string> {
  const metadata: Record<string, string> = {}
  for (const entry of entries) {
    // 空键只保留在编辑器行中，不能写入通用元数据对象。
    if (entry.key) metadata[entry.key] = entry.value
  }
  return metadata
}

const EMPTY_FORM: PageForm = {
  slug: '',
  title: '',
  visibility: 'public',
  content_type: 'html',
  content_html: '',
  metadata: {},
  menu_icon: 'menu',
  enabled: true,
  sub2api_published: false,
  sub2api_visibility: 'user',
  sub2api_menu_name: '',
}

const MAX_CONTENT_BYTES = 256 * 1024

function pageRouteFor(slug: string, visibility: 'public' | 'admin'): string {
  return visibility === 'admin' ? `/admin/p/${slug}` : `/p/${slug}`
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeTransferItem(value: unknown, index: number): PageTransferItem {
  const source = asRecord(value)
  const slug = typeof source.slug === 'string' ? source.slug.trim().toLowerCase() : ''
  const title = typeof source.title === 'string' ? source.title.trim() : ''
  const visibility = source.visibility === 'admin' ? 'admin' : 'public'
  const contentType = source.content_type === 'react' ? 'react' : 'html'
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error(`第 ${index + 1} 个页面的 slug 无效`)
  }
  if (!title) {
    throw new Error(`第 ${index + 1} 个页面缺少标题`)
  }
  const sub2apiVisibility = source.sub2api_visibility === 'admin' ? 'admin' : 'user'
  return {
    slug,
    title,
    visibility,
    content_type: contentType,
    content_html: typeof source.content_html === 'string' ? source.content_html : '',
    content_react: typeof source.content_react === 'string' ? source.content_react : '',
    metadata: asRecord(source.metadata),
    enabled: source.enabled !== false,
    route: pageRouteFor(slug, visibility),
    sub2api_published: source.sub2api_published === true,
    sub2api_visibility: sub2apiVisibility,
    sub2api_menu_name: typeof source.sub2api_menu_name === 'string' ? source.sub2api_menu_name : title,
  }
}

function parseTransferDocument(value: unknown): PageTransferItem[] {
  const source = asRecord(value)
  const rawPages = Array.isArray(value)
    ? value
    : source.format === 'sub2api-extension-pages' && Array.isArray(source.pages)
      ? source.pages
      : null
  if (!rawPages) {
    throw new Error('导入文件不是有效的页面导出文件')
  }
  if (rawPages.length === 0) {
    throw new Error('导入文件中没有页面')
  }
  return rawPages.map((item, index) => normalizeTransferItem(item, index))
}

function nextAvailableSlug(baseSlug: string, visibility: 'public' | 'admin', occupiedRoutes: Set<string>): string {
  let suffix = 2
  let candidate = `${baseSlug}-${suffix}`
  while (occupiedRoutes.has(pageRouteFor(candidate, visibility))) {
    suffix += 1
    candidate = `${baseSlug}-${suffix}`
  }
  return candidate
}

export default function PageManagementPage() {
  const [pages, setPages] = useState<PageListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<PageForm>(EMPTY_FORM)
  const [metadataEntries, setMetadataEntries] = useState<MetadataEntry[]>([])
  const metadataEntryId = useRef(0)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [slugHint, setSlugHint] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PageListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const createMetadataEntries = (metadata: Record<string, unknown>): MetadataEntry[] => (
    Object.entries(metadata)
      .filter(([key]) => !key.startsWith('sub2api_'))
      .map(([key, value]) => ({
      id: `metadata-${metadataEntryId.current++}`,
      key,
      value: typeof value === 'string' ? value : JSON.stringify(value),
    }))
  )

  const commitMetadataEntries = (entries: MetadataEntry[]) => {
    setMetadataEntries(entries)
    setForm((current) => ({
      ...current,
      metadata: metadataEntriesToRecord(entries),
    }))
  }

  // 列表加载
  const loadPages = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get<AuxEnvelope<PageListResponse>>('/admin/pages')
      const nextPages = res.data?.items ?? []
      setPages(nextPages)
      setSelectedIds((current) => new Set([...current].filter((id) => nextPages.some((page) => page.id === id))))
      return true
    } catch {
      setError('加载页面列表失败,请检查会话或网络')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPages()
  }, [loadPages])

  const handleRefresh = async () => {
    if (refreshing || loading) return
    setRefreshing(true)
    const success = await loadPages()
    if (success) {
      toast.success('页面列表刷新成功')
    } else {
      toast.error('页面列表刷新失败')
    }
    setRefreshing(false)
  }

  const handleSelectPage = (pageId: number, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (checked) next.add(pageId)
      else next.delete(pageId)
      return next
    })
  }

  const handleSelectAll = (checked: boolean) => {
    setSelectedIds(checked ? new Set(pages.map((page) => page.id)) : new Set())
  }

  const createTransferItem = (detail: PageDetail): PageTransferItem => ({
    slug: detail.slug,
    title: detail.title,
    visibility: detail.visibility,
    content_type: detail.content_type,
    content_html: detail.content_html ?? '',
    content_react: detail.content_react ?? '',
    metadata: detail.metadata ?? {},
    enabled: detail.enabled,
    route: pageRouteFor(detail.slug, detail.visibility),
    sub2api_published: detail.sub2api_published ?? false,
    sub2api_visibility: detail.sub2api_visibility ?? (detail.visibility === 'admin' ? 'admin' : 'user'),
    sub2api_menu_name: detail.sub2api_menu_name ?? detail.title,
  })

  const buildPageRequest = (item: PageTransferItem) => ({
    slug: item.slug,
    title: item.title,
    visibility: item.visibility,
    content_type: item.content_type,
    content_html: item.content_type === 'html' ? item.content_html : '',
    content_react: item.content_type === 'react' ? item.content_react : '',
    metadata: item.metadata,
    enabled: item.enabled,
    sub2api_published: item.sub2api_published ?? false,
    sub2api_visibility: item.sub2api_visibility ?? (item.visibility === 'admin' ? 'admin' : 'user'),
    sub2api_menu_name: item.sub2api_menu_name ?? item.title,
  })

  const handleExportSelected = async () => {
    const selectedPages = pages.filter((page) => selectedIds.has(page.id))
    if (selectedPages.length === 0 || exporting) return
    setExporting(true)
    try {
      const details = await Promise.all(selectedPages.map(async (page) => {
        const response = await apiClient.get<AuxEnvelope<PageDetail>>(`/admin/pages/${page.id}`)
        if (!response.data) throw new Error(`无法读取页面「${page.title}」`)
        return createTransferItem(response.data)
      }))
      const document: PageTransferDocument = {
        format: 'sub2api-extension-pages',
        version: 1,
        exported_at: new Date().toISOString(),
        pages: details,
      }
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json;charset=utf-8' })
      const href = URL.createObjectURL(blob)
      const anchor = window.document.createElement('a')
      anchor.href = href
      anchor.download = `sub2api-pages-${new Date().toISOString().slice(0, 10)}.json`
      window.document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(href)
      toast.success(`已导出 ${details.length} 个页面`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导出页面失败')
    } finally {
      setExporting(false)
    }
  }

  const handleImportFile = async (file: File) => {
    if (importing) return
    setImporting(true)
    try {
      const parsed = parseTransferDocument(JSON.parse(await file.text()))
      const routeToPageId = new Map(pages.map((page) => [page.route, page.id]))
      const occupiedRoutes = new Set(pages.map((page) => page.route))
      const duplicateRoutes = new Set(parsed
        .map((item) => item.route)
        .filter((route, index, routes) => routes.indexOf(route) !== index || occupiedRoutes.has(route)))
      const duplicateMode = duplicateRoutes.size > 0 && window.confirm(
        `发现 ${duplicateRoutes.size} 个重复页面路由。\n\n点击“确定”将继续导入并为重复路由追加 -2、-3 等数字尾缀；点击“取消”则按路由幂等更新已有页面。`,
      )

      let created = 0
      let updated = 0
      for (const sourceItem of parsed) {
        let item = sourceItem
        let route = item.route
        if (duplicateMode && occupiedRoutes.has(route)) {
          item = { ...item, slug: nextAvailableSlug(item.slug, item.visibility, occupiedRoutes) }
          item.route = pageRouteFor(item.slug, item.visibility)
          route = item.route
        }

        const existingId = routeToPageId.get(route)
        if (existingId !== undefined && !duplicateMode) {
          await apiClient.put(`/admin/pages/${existingId}`, buildPageRequest(item))
          updated += 1
          continue
        }

        const response = await apiClient.post<AuxEnvelope<PageDetail>>('/admin/pages', buildPageRequest(item))
        if (!response.data) throw new Error(`导入页面「${item.title}」失败`)
        created += 1
        routeToPageId.set(route, response.data.id)
        occupiedRoutes.add(route)
      }
      await loadPages()
      await refreshDynamicPages({ includeAdmin: true })
      toast.success(`导入完成：新增 ${created} 个，幂等更新 ${updated} 个`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '导入页面失败')
    } finally {
      setImporting(false)
    }
  }

  const handleImportInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await handleImportFile(file)
  }

  // slug 实时校验(格式 + 与现有页冲突)
  useEffect(() => {
    if (!form.slug) {
      setSlugHint('')
      return
    }
    const slug = form.slug.toLowerCase()
    const valid = /^[a-z0-9][a-z0-9-]*$/.test(slug)
    if (!valid) {
      setSlugHint('slug 只能含小写字母、数字、连字符,且以字母/数字开头')
      return
    }
    const conflict = pages.some((p) => p.slug === slug && p.id !== editingId)
    if (conflict) {
      setSlugHint('该 slug 已被其他页面占用')
      return
    }
    if (slug === 'dashboard') {
      setSlugHint('该 slug 与静态核心页 id 冲突')
      return
    }
    setSlugHint(form.visibility === 'admin' ? `路由: /admin/p/${slug}` : `路由: /p/${slug}`)
  }, [form.slug, form.visibility, pages, editingId])

  const openCreate = () => {
    setEditingId(null)
    // 为 React 类型预填充示例代码
    const exampleReactCode = `export default function HelloWorld() {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(to bottom right, #1e293b, #0f172a)', color: 'white' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem' }}>Hello World!</h1>
        <p style={{ fontSize: '1.25rem', color: '#94a3b8' }}>这是一个动态编译的 React 组件</p>
      </div>
    </div>
  )
    }`
    setForm({ ...EMPTY_FORM, content_type: 'react', content_html: exampleReactCode })
    setMetadataEntries([])
    setFormError('')
    setSlugHint('')
    setDialogOpen(true)
  }

  const openEdit = async (page: PageListItem) => {
    setEditingId(page.id)
    setFormError('')
    setSlugHint('')
    setDialogOpen(true)
    try {
      const res = await apiClient.get<AuxEnvelope<PageDetail>>(`/admin/pages/${page.id}`)
      const detail = res.data
      if (detail) {
        const metadata = detail.metadata ?? {}
        const editableMetadataEntries = createMetadataEntries(metadata)
        setForm({
          slug: detail.slug,
          title: detail.title,
          visibility: detail.visibility,
          content_type: detail.content_type,
          content_html: detail.content_type === 'react'
            ? (detail.content_react ?? '')
            : (detail.content_html ?? ''),
          metadata: metadataEntriesToRecord(editableMetadataEntries),
          menu_icon: typeof metadata.menu_icon === 'string' ? metadata.menu_icon : (detail.menu_icon ?? 'menu'),
          enabled: detail.enabled,
          sub2api_published: detail.sub2api_published ?? false,
          sub2api_visibility: detail.sub2api_visibility ?? (detail.visibility === 'admin' ? 'admin' : 'user'),
          sub2api_menu_name: detail.sub2api_menu_name ?? detail.title,
        })
        setMetadataEntries(editableMetadataEntries)
      }
    } catch {
      const message = '加载页面详情失败'
      setFormError(message)
      toast.error(message)
    }
  }

  const handleSave = async () => {
    setFormError('')
    // 客户端校验
    if (!form.slug.trim()) {
      const message = 'slug 不能为空'
      setFormError(message)
      toast.error(message)
      return
    }
    if (!form.title.trim()) {
      const message = '标题不能为空'
      setFormError(message)
      toast.error(message)
      return
    }
    if (slugHint.startsWith('slug') || slugHint.startsWith('该 slug')) {
      setFormError(slugHint)
      toast.error(slugHint)
      return
    }
    if (form.content_html.length > MAX_CONTENT_BYTES) {
      const message = `内容超过 ${MAX_CONTENT_BYTES} 字节上限`
      setFormError(message)
      toast.error(message)
      return
    }
    const logo = (form.metadata.logo ?? '').trim()
    if (logo && !/^https?:\/\//i.test(logo)) {
      const message = 'Logo 必须是图片资源页复制的 HTTP URL，或其他 HTTP/HTTPS 图片地址'
      setFormError(message)
      toast.error(message)
      return
    }
    setSaving(true)
    try {
      const metadata = { ...form.metadata }
      if (form.visibility === 'admin') {
        metadata.menu_icon = form.menu_icon
      } else {
        // 菜单图标只对管理员侧边栏有意义，避免公开页面元数据留下误导配置。
        delete metadata.menu_icon
      }
      const body = {
        slug: form.slug,
        title: form.title,
        visibility: form.visibility,
        content_type: form.content_type,
        content_html: form.content_type === 'html' ? form.content_html : '',
        content_react: form.content_type === 'react' ? form.content_html : '',
        metadata,
        enabled: form.enabled,
        sub2api_published: form.sub2api_published,
        sub2api_visibility: form.sub2api_visibility,
        sub2api_menu_name: form.sub2api_menu_name,
      }
      if (editingId !== null) {
        await apiClient.put(`/admin/pages/${editingId}`, body)
      } else {
        await apiClient.post('/admin/pages', body)
      }
      setDialogOpen(false)
      toast.success(editingId !== null ? '页面保存成功' : '页面创建成功')
      await loadPages()
      await refreshDynamicPages({ includeAdmin: true })
    } catch {
      const message = '保存失败,可能 slug 冲突或会话过期'
      setFormError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (page: PageListItem) => {
    if (togglingId !== null) return
    setTogglingId(page.id)
    try {
      // 后端需要完整的 PageInput，所以先获取页面详情
      const res = await apiClient.get<AuxEnvelope<PageDetail>>(`/admin/pages/${page.id}`)
      const detail = res.data
      if (!detail) {
        const message = '获取页面详情失败'
        setError(message)
        toast.error(message)
        return
      }
      // 发送完整数据，只更新 enabled 字段
      await apiClient.put(`/admin/pages/${page.id}`, {
        slug: detail.slug,
        title: detail.title,
        visibility: detail.visibility,
        content_type: detail.content_type,
        content_html: detail.content_html ?? '',
        content_react: detail.content_react ?? '',
        metadata: detail.metadata ?? {},
        enabled: !page.enabled,
        sub2api_published: detail.sub2api_published ?? false,
        sub2api_visibility: detail.sub2api_visibility ?? (detail.visibility === 'admin' ? 'admin' : 'user'),
        sub2api_menu_name: detail.sub2api_menu_name ?? detail.title,
      })
      toast.success(`${page.title}已${page.enabled ? '停用' : '启用'}`)
      await loadPages()
      await refreshDynamicPages({ includeAdmin: true })
    } catch {
      const message = '切换状态失败'
      setError(message)
      toast.error(message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleToggleSub2APIPublished = async (page: PageListItem) => {
    if (togglingId !== null) return
    setTogglingId(page.id)
    try {
      const res = await apiClient.get<AuxEnvelope<PageDetail>>(`/admin/pages/${page.id}`)
      const detail = res.data
      if (!detail) {
        throw new Error('获取页面详情失败')
      }
      await apiClient.put(`/admin/pages/${page.id}`, {
        slug: detail.slug,
        title: detail.title,
        visibility: detail.visibility,
        content_type: detail.content_type,
        content_html: detail.content_html ?? '',
        content_react: detail.content_react ?? '',
        metadata: detail.metadata ?? {},
        enabled: detail.enabled,
        sub2api_published: !page.sub2api_published,
        sub2api_visibility: detail.sub2api_visibility ?? (detail.visibility === 'admin' ? 'admin' : 'user'),
        sub2api_menu_name: detail.sub2api_menu_name ?? detail.title,
      })
      toast.success(`${page.title}已${page.sub2api_published ? '下架' : '上架'}到 sub2api`)
      await loadPages()
      await refreshDynamicPages({ includeAdmin: true })
    } catch {
      const message = '同步 sub2api 菜单失败，请检查 sub2api 数据库连接与公网地址配置'
      setError(message)
      toast.error(message)
    } finally {
      setTogglingId(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiClient.del(`/admin/pages/${deleteTarget.id}`)
      setDeleteTarget(null)
      toast.success('页面删除成功')
      await loadPages()
      await refreshDynamicPages({ includeAdmin: true })
    } catch {
      const message = '删除失败'
      setError(message)
      toast.error(message)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="aux-admin-page aux-pages-page space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            页面管理
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            创建、编辑、删除动态页面,配置路由与权限。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => { void handleImportInputChange(event) }}
          />
          <Button
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            <Upload className="mr-2 h-4 w-4" />
            {importing ? '导入中…' : '导入页面'}
          </Button>
          <Button
            variant="outline"
            onClick={() => { void handleExportSelected() }}
            disabled={selectedIds.size === 0 || exporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? '导出中…' : `导出所选${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}`}
          </Button>
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={loading || refreshing}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '刷新中' : '刷新'}
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建页面
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-gray-200 dark:border-gray-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">
                <input
                  type="checkbox"
                  aria-label="全选页面"
                  checked={pages.length > 0 && pages.every((page) => selectedIds.has(page.id))}
                  onChange={(event) => handleSelectAll(event.target.checked)}
                />
              </TableHead>
              <TableHead>标题</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>路由</TableHead>
              <TableHead>可见性</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>sub2api</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-gray-400">
                  加载中…
                </TableCell>
              </TableRow>
            ) : pages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-sm text-gray-400">
                  暂无动态页面,点击"新建页面"创建。
                </TableCell>
              </TableRow>
            ) : (
              pages.map((page) => (
                <TableRow key={page.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      aria-label={`选择${page.title}`}
                      checked={selectedIds.has(page.id)}
                      onChange={(event) => handleSelectPage(page.id, event.target.checked)}
                    />
                  </TableCell>
                  <TableCell className="font-medium text-gray-900 dark:text-gray-100">
                    {page.title}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    {page.slug}
                  </TableCell>
                  <TableCell className="text-sm text-gray-600 dark:text-gray-400">
                    <Link
                      to={page.route}
                      className="aux-page-route-link"
                      aria-label={`打开${page.title}页面`}
                    >
                      {page.route}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${
                      page.visibility === 'admin'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                    }`}>
                      {page.visibility === 'admin' ? '管理员' : '公开'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <div className="aux-page-status-control">
                      <Switch
                        className="aux-page-status-switch"
                        checked={page.enabled}
                        disabled={togglingId === page.id}
                        aria-label={`${page.enabled ? '停用' : '启用'}${page.title}`}
                        onCheckedChange={() => handleToggleEnabled(page)}
                      />
                      <span className={`aux-page-status-badge ${page.enabled ? 'is-enabled' : 'is-disabled'}`}>
                        {page.enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="aux-page-status-control">
                      <Switch
                        checked={page.sub2api_published}
                        disabled={togglingId === page.id}
                        aria-label={`${page.sub2api_published ? '下架' : '上架'}${page.title}`}
                        onCheckedChange={() => handleToggleSub2APIPublished(page)}
                      />
                      <span className={`aux-page-status-badge ${page.sub2api_published ? 'is-enabled' : 'is-disabled'}`}>
                        {page.sub2api_published ? '已上架' : '未上架'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(page)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(page)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 创建/编辑 Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="!flex max-h-[85dvh] max-w-3xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-6 py-5 pr-12">
            <DialogTitle>{editingId !== null ? '编辑页面' : '新建页面'}</DialogTitle>
            <DialogDescription>
              填写页面信息与内容。slug 决定路由,可见性决定访问权限。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
            <div className="grid gap-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">标题</Label>
                <Input
                  id="title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="页面标题"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input
                  id="slug"
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                  placeholder="my-page"
                />
                {slugHint && (
                  <p className={`text-xs ${
                    slugHint.startsWith('路由') ? 'text-gray-500 dark:text-gray-400' : 'text-red-500'
                  }`}>
                    {slugHint}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>可见性</Label>
                <Select
                  value={form.visibility}
                  onValueChange={(v: 'public' | 'admin') => setForm({ ...form, visibility: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">公开(/p/:slug)</SelectItem>
                    <SelectItem value="admin">管理员(/admin/p/:slug)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>内容类型</Label>
                <Select
                  value={form.content_type}
                  onValueChange={(v: 'html' | 'react') => setForm({ ...form, content_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="html">HTML(v1)</SelectItem>
                    <SelectItem value="react">React(v2)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.visibility === 'admin' && (
              <div className="space-y-2">
                <Label htmlFor="menu-icon">侧边菜单图标</Label>
                <MenuIconPicker
                  id="menu-icon"
                  value={form.menu_icon}
                  onValueChange={(value) => setForm({ ...form, menu_icon: value })}
                />
                <p className="text-xs text-gray-500">
                  仅管理员可见页面会出现在控制台侧边栏；当前提供 {MENU_ICON_OPTIONS.length} 个 Lucide 图标，可输入图标名称或值搜索，名称保存在通用元数据的 menu_icon 键中。
                </p>
              </div>
            )}
            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 dark:border-blue-900/60 dark:bg-blue-950/20">
              <div className="mb-3 flex items-center gap-2">
                <Switch
                  checked={form.sub2api_published}
                  onCheckedChange={(checked) => setForm({ ...form, sub2api_published: checked })}
                />
                <Label>上架到 sub2api 自定义菜单</Label>
              </div>
              <p className="mb-3 text-xs text-gray-500">
                保存后会直接同步 sub2api 数据库的 custom_menu_items；关闭开关会移除本页面对应的菜单项，不影响其他菜单。
              </p>
              {form.sub2api_published && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>sub2api 可见角色</Label>
                    <Select
                      value={form.sub2api_visibility}
                      onValueChange={(value: 'user' | 'admin') => setForm({ ...form, sub2api_visibility: value })}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">普通用户</SelectItem>
                        <SelectItem value="admin">管理员</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sub2api-menu-name">sub2api 菜单名称</Label>
                    <Input
                      id="sub2api-menu-name"
                      value={form.sub2api_menu_name}
                      onChange={(event) => setForm({ ...form, sub2api_menu_name: event.target.value })}
                      placeholder={form.title || '菜单名称'}
                      maxLength={50}
                    />
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>
                {form.content_type === 'react' ? 'React 组件代码 (TSX)' : '内容 (HTML)'}
              </Label>
              {form.content_type === 'react' && (
                <p className="text-xs text-gray-500">
                  编写完整的 React 组件，必须 export default 一个函数组件。例如：
                  <code className="ml-1 rounded bg-gray-800 px-1 py-0.5">
                    export default function MyPage() {'{ return <div>Hello</div> }'}
                  </code>
                </p>
              )}
              <div className="h-64 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载编辑器…</div>}>
                  <MonacoEditor
                    height="100%"
                    language={form.content_type === 'react' ? 'typescriptreact' : 'html'}
                    value={form.content_html}
                    onChange={(v) => setForm({ ...form, content_html: v ?? '' })}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                    }}
                  />
                </Suspense>
              </div>
              {form.content_html.length > MAX_CONTENT_BYTES && (
                <p className="text-xs text-red-500">
                  内容超过 {MAX_CONTENT_BYTES} 字节上限
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>页面元数据（键值对）</Label>
              <p className="text-xs text-gray-500">
                Logo 等配置统一保存在这里；图片请先在“图片资源”页上传，再将 HTTP URL 填入 logo 的值。
              </p>
              <p className="text-xs text-gray-500">
                官网 home 页可用 <code>console_href</code>、<code>api_docs_href</code>、<code>usage_guide_href</code>、<code>contact_sales_href</code>、<code>terms_href</code> 配置入口；值支持相对路径或完整 HTTP/HTTPS 地址。
              </p>
              <div className="space-y-2">
                {metadataEntries.map((entry, index) => (
                  <div key={entry.id} className="flex gap-2">
                    <Input
                      placeholder="键"
                      value={entry.key}
                      onChange={(e) => {
                        const newKey = e.target.value
                        commitMetadataEntries(metadataEntries.map((currentEntry, currentIndex) => (
                          currentIndex === index
                            ? { ...currentEntry, key: newKey }
                            : currentEntry
                        )))
                      }}
                      className="flex-1"
                    />
                    <Input
                      placeholder="值"
                      value={entry.value}
                      onChange={(e) => {
                        commitMetadataEntries(metadataEntries.map((currentEntry, currentIndex) => (
                          currentIndex === index
                            ? { ...currentEntry, value: e.target.value }
                            : currentEntry
                        )))
                      }}
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => {
                        commitMetadataEntries(metadataEntries.filter((currentEntry) => currentEntry.id !== entry.id))
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const existingKeys = new Set(metadataEntries.map((entry) => entry.key))
                    let suffix = metadataEntries.length + 1
                    let newKey = `key${suffix}`
                    while (existingKeys.has(newKey)) {
                      suffix += 1
                      newKey = `key${suffix}`
                    }
                    commitMetadataEntries([
                      ...metadataEntries,
                      {
                        id: `metadata-${metadataEntryId.current++}`,
                        key: newKey,
                        value: '',
                      },
                    ])
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  添加元数据
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.enabled}
                onCheckedChange={(c) => setForm({ ...form, enabled: c })}
              />
              <Label>启用(停用页返回 404,但数据保留)</Label>
            </div>
            {formError && (
              <p className="text-sm text-red-500">{formError}</p>
            )}
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId !== null ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 Dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除页面</DialogTitle>
            <DialogDescription>
              确定要删除「{deleteTarget?.title}」吗?此操作不可撤销。
              该页面的访问与功能点击埋点历史将保留(只追加表不动),但页面本身立即不可访问。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
