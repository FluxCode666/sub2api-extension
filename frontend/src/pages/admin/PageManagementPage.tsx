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
import { useCallback, useEffect, useState, lazy, Suspense } from 'react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
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
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react'

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
  updated_at: string
}

/** 后端 Page(含内容, 编辑时获取)。 */
interface PageDetail extends PageListItem {
  content_html?: string
  content_react?: string
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
  enabled: boolean
}

const EMPTY_FORM: PageForm = {
  slug: '',
  title: '',
  visibility: 'public',
  content_type: 'html',
  content_html: '',
  enabled: true,
}

const MAX_CONTENT_BYTES = 256 * 1024

export default function PageManagementPage() {
  const [pages, setPages] = useState<PageListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [form, setForm] = useState<PageForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [slugHint, setSlugHint] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<PageListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // 列表加载
  const loadPages = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiClient.get<AuxEnvelope<PageListResponse>>('/admin/pages')
      setPages(res.data?.items ?? [])
    } catch {
      setError('加载页面列表失败,请检查会话或网络')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPages()
  }, [loadPages])

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
    if (['home', 'dashboard', 'homepage-config'].includes(slug)) {
      setSlugHint('该 slug 与静态核心页 id 冲突')
      return
    }
    setSlugHint(form.visibility === 'admin' ? `路由: /admin/p/${slug}` : `路由: /p/${slug}`)
  }, [form.slug, form.visibility, pages, editingId])

  const openCreate = () => {
    setEditingId(null)
    setForm(EMPTY_FORM)
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
        setForm({
          slug: detail.slug,
          title: detail.title,
          visibility: detail.visibility,
          content_type: detail.content_type,
          content_html: detail.content_html ?? '',
          enabled: detail.enabled,
        })
      }
    } catch {
      setFormError('加载页面详情失败')
    }
  }

  const handleSave = async () => {
    setFormError('')
    // 客户端校验
    if (!form.slug.trim()) {
      setFormError('slug 不能为空')
      return
    }
    if (!form.title.trim()) {
      setFormError('标题不能为空')
      return
    }
    if (slugHint.startsWith('slug') || slugHint.startsWith('该 slug')) {
      setFormError(slugHint)
      return
    }
    if (form.content_html.length > MAX_CONTENT_BYTES) {
      setFormError(`内容超过 ${MAX_CONTENT_BYTES} 字节上限`)
      return
    }
    setSaving(true)
    try {
      const body = {
        slug: form.slug,
        title: form.title,
        visibility: form.visibility,
        content_type: form.content_type,
        content_html: form.content_type === 'html' ? form.content_html : '',
        content_react: form.content_type === 'react' ? form.content_html : '',
        enabled: form.enabled,
      }
      if (editingId !== null) {
        await apiClient.put(`/admin/pages/${editingId}`, body)
      } else {
        await apiClient.post('/admin/pages', body)
      }
      setDialogOpen(false)
      await loadPages()
    } catch (e) {
      setFormError('保存失败,可能 slug 冲突或会话过期')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleEnabled = async (page: PageListItem) => {
    try {
      await apiClient.put(`/admin/pages/${page.id}`, { enabled: !page.enabled })
      await loadPages()
    } catch {
      setError('切换状态失败')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await apiClient.del(`/admin/pages/${deleteTarget.id}`)
      setDeleteTarget(null)
      await loadPages()
    } catch {
      setError('删除失败')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            页面管理
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            创建、编辑、删除动态页面,配置路由与权限。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          新建页面
        </Button>
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
                    {page.route}
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
                    <Switch
                      checked={page.enabled}
                      onCheckedChange={() => handleToggleEnabled(page)}
                    />
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
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? '编辑页面' : '新建页面'}</DialogTitle>
            <DialogDescription>
              填写页面信息与内容。slug 决定路由,可见性决定访问权限。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
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
            <div className="space-y-2">
              <Label>内容(HTML)</Label>
              <div className="h-64 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800">
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />加载编辑器…</div>}>
                  <MonacoEditor
                    height="100%"
                    language={form.content_type === 'react' ? 'typescript' : 'html'}
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
          <DialogFooter>
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
