/**
 * 页面管理页 —— 管理员动态页面 CRUD。
 *
 * /admin/pages: 列出所有动态页面(标题/slug/路由/可见性/状态/操作)。
 * 创建/编辑: Dialog 表单(Monaco 编辑器编辑 HTML, slug 实时校验, 可见性/内容类型选择)。
 * 删除: 确认对话框(提示埋点历史保留)。
 * 启停: Switch 切换 enabled。
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
import { Plus, Pencil, Trash2, Loader2, RefreshCw } from 'lucide-react'
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
}

/** 后端 Page(含内容, 编辑时获取)。 */
interface PageDetail extends PageListItem {
  content_html?: string
  content_react?: string
  metadata?: Record<string, string>
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
}

const MAX_CONTENT_BYTES = 256 * 1024

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

  const createMetadataEntries = (metadata: Record<string, string>): MetadataEntry[] => (
    Object.entries(metadata).map(([key, value]) => ({
      id: `metadata-${metadataEntryId.current++}`,
      key,
      value,
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
      setPages(res.data?.items ?? [])
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
        setForm({
          slug: detail.slug,
          title: detail.title,
          visibility: detail.visibility,
          content_type: detail.content_type,
          content_html: detail.content_type === 'react'
            ? (detail.content_react ?? '')
            : (detail.content_html ?? ''),
          metadata,
          menu_icon: metadata.menu_icon ?? detail.menu_icon ?? 'menu',
          enabled: detail.enabled,
        })
        setMetadataEntries(createMetadataEntries(metadata))
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
              <TableHead>标题</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>路由</TableHead>
              <TableHead>可见性</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-gray-400">
                  加载中…
                </TableCell>
              </TableRow>
            ) : pages.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-sm text-gray-400">
                  暂无动态页面,点击"新建页面"创建。
                </TableCell>
              </TableRow>
            ) : (
              pages.map((page) => (
                <TableRow key={page.id}>
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
