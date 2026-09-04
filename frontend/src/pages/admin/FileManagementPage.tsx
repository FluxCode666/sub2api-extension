import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Check, Copy, File, FileDown, Loader2, Pencil, RefreshCw, Save, Upload } from 'lucide-react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { downloadInvoiceFile } from '@/lib/invoices'

interface FileAsset {
  source: 'image' | 'invoice'
  source_id: number
  /** Compatibility alias returned by older extension backends. */
  name?: string
  original_name?: string
  note?: string
  mime_type: string
  size: number
  created_at: string
}

interface FileAssetListResponse {
  items: FileAsset[]
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export default function FileManagementPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<FileAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [noteTarget, setNoteTarget] = useState<FileAsset | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [savingNote, setSavingNote] = useState(false)

  const loadFiles = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    setError('')
    try {
      const response = await apiClient.get<AuxEnvelope<FileAssetListResponse>>('/admin/files')
      setItems(response.data?.items ?? [])
      return true
    } catch (error) {
      console.error('[FileManagementPage] failed to load files', error)
      setError('文件列表加载失败，请检查管理会话或后端服务。')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const handleRefresh = async () => {
    if (refreshing || loading || uploading) return
    setRefreshing(true)
    const success = await loadFiles()
    if (success) {
      toast.success('文件列表刷新成功')
    } else {
      toast.error('文件列表刷新失败')
    }
    setRefreshing(false)
  }

  const uploadFile = async (file: File) => {
    setError('')
    if (!file.type.startsWith('image/')) {
      const message = '只能上传 PNG、JPEG、GIF 或 WebP 图片。'
      setError(message)
      toast.error(message)
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      const message = '单张图片不能超过 10MB。'
      setError(message)
      toast.error(message)
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await apiClient.upload<AuxEnvelope<FileAsset>>('/admin/assets', formData, { timeout: 60_000 })
      toast.success('图片上传成功')
      await loadFiles()
    } catch (error) {
      console.error('[FileManagementPage] failed to upload asset', error)
      const message = '上传失败。请确认文件格式正确、大小不超过 10MB，并已执行数据库迁移。'
      setError(message)
      toast.error(message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void uploadFile(file)
  }

  const copyURL = async (asset: FileAsset) => {
    const url = new URL(`/api/aux/assets/${asset.source_id}`, window.location.origin).href
    try {
      await writeClipboardText(url)
      setCopiedId(fileKey(asset))
      toast.success('文件 URL 已复制')
      window.setTimeout(() => setCopiedId((current) => current === fileKey(asset) ? null : current), 1600)
    } catch (error) {
      console.error('[FileManagementPage] failed to copy asset URL', error)
      const message = '复制失败，请手动选择 URL 复制。'
      setError(message)
      toast.error(message)
    }
  }

  const downloadInvoice = async (asset: FileAsset) => {
    const key = fileKey(asset)
    setDownloadingId(key)
    try {
      await downloadInvoiceFile(`/api/aux/admin/invoices/${asset.source_id}/document`)
    } catch (error) {
      console.error('[FileManagementPage] failed to download invoice file', error)
      toast.error('文件下载失败')
    } finally {
      setDownloadingId(null)
    }
  }

  const openNoteEditor = (asset: FileAsset) => {
    setNoteTarget(asset)
    setNoteDraft(asset.note ?? '')
  }

  const closeNoteEditor = () => {
    if (!savingNote) setNoteTarget(null)
  }

  const saveNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!noteTarget || savingNote) return
    const key = fileKey(noteTarget)
    setSavingNote(true)
    try {
      const response = await apiClient.patch<AuxEnvelope<FileAsset>>(
        `/admin/files/${noteTarget.source}/${noteTarget.source_id}`,
        { note: noteDraft },
      )
      const updated = response.data
      if (!updated) throw new Error('missing updated file asset')
      setItems((current) => current.map((asset) => fileKey(asset) === key ? { ...asset, ...updated } : asset))
      setNoteTarget(null)
      toast.success('备注已保存')
    } catch (error) {
      console.error('[FileManagementPage] failed to update file note', error)
      toast.error('备注保存失败，请稍后重试')
    } finally {
      setSavingNote(false)
    }
  }

  return (
    <div className="aux-admin-page space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">文件管理</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            统一查看系统上传的图片和发票文件。图片可复制公开 URL，发票文件可直接下载。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => void handleRefresh()} disabled={loading || refreshing || uploading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? '刷新中' : '刷新'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="sr-only"
            onChange={handleFileChange}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            {uploading ? '正在上传' : '上传图片'}
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 px-5 py-4 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-400">
        当前支持上传 PNG、JPEG、GIF、WebP 图片，单张不超过 10MB；发票文件会自动出现在此列表中。
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-gray-400" />
          <span className="text-sm text-gray-500">正在加载文件列表…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-6 text-center dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900">
            <File className="h-5 w-5 text-gray-500" />
          </div>
          <p className="font-medium text-gray-900 dark:text-gray-100">还没有上传文件</p>
          <p className="mt-1 text-sm text-gray-500">上传图片或开具发票后，文件会展示在这里。</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="border-b bg-gray-50 text-left text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
              <tr>
                <th className="px-4 py-3 font-medium">原始文件名</th>
                <th className="px-4 py-3 font-medium">备注</th>
                <th className="px-4 py-3 font-medium">类型</th>
                <th className="px-4 py-3 font-medium">来源</th>
                <th className="px-4 py-3 font-medium">大小</th>
                <th className="px-4 py-3 font-medium">上传时间</th>
                <th className="px-4 py-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-800">
              {items.map((asset) => {
                const key = fileKey(asset)
                const imageURL = new URL(`/api/aux/assets/${asset.source_id}`, window.location.origin).href
                const originalName = asset.original_name || asset.name || '未命名文件'
                const note = asset.note || ''
                return (
                  <tr key={key}>
                    <td className="max-w-[260px] truncate px-4 py-3 font-medium text-gray-900 dark:text-gray-100" title={originalName}>{originalName}</td>
                    <td className="max-w-[240px] truncate px-4 py-3 text-gray-500" title={note}>{note || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{asset.mime_type || '未知'}</td>
                    <td className="px-4 py-3 text-gray-500">{asset.source === 'image' ? '图片上传' : '发票上传'}</td>
                    <td className="px-4 py-3 text-gray-500">{formatBytes(asset.size)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-500">{formatDate(asset.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => openNoteEditor(asset)}>
                          <Pencil className="mr-1 h-4 w-4" />编辑备注
                        </Button>
                        {asset.source === 'image' ? (
                          <>
                            <input readOnly value={imageURL} aria-label={`${originalName} 的 HTTP URL`} onFocus={(event) => event.currentTarget.select()} className="sr-only" />
                            <Button type="button" variant="outline" size="sm" onClick={() => void copyURL(asset)}>
                              {copiedId === key ? <Check className="mr-1 h-4 w-4 text-emerald-500" /> : <Copy className="mr-1 h-4 w-4" />}复制 URL
                            </Button>
                          </>
                        ) : (
                          <Button type="button" variant="outline" size="sm" onClick={() => void downloadInvoice(asset)} disabled={downloadingId === key}>
                            {downloadingId === key ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />}下载
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={noteTarget !== null} onOpenChange={(open) => !open && closeNoteEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑文件备注</DialogTitle>
            <DialogDescription className="truncate" title={noteTarget ? fileDisplayName(noteTarget) : undefined}>
              {noteTarget ? fileDisplayName(noteTarget) : ''}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => void saveNote(event)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="file-note">备注</Label>
              <Textarea
                id="file-note"
                value={noteDraft}
                onChange={(event) => setNoteDraft(event.target.value)}
                maxLength={2000}
                rows={5}
                placeholder="填写文件用途、来源或其他管理说明"
                autoFocus
              />
              <p className="text-right text-xs text-gray-500">{noteDraft.length}/2000</p>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeNoteEditor} disabled={savingNote}>取消</Button>
              <Button type="submit" disabled={savingNote}>
                {savingNote && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {savingNote ? '保存中…' : <><Save className="mr-2 h-4 w-4" />保存备注</>}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch (error) {
      // 非安全上下文或浏览器策略禁用 Clipboard API 时，继续使用兼容回退，
      // 同时保留诊断日志。
      console.error('[FileManagementPage] Clipboard API unavailable; using fallback', error)
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard is unavailable')
}

function fileKey(asset: FileAsset): string {
  return `${asset.source}:${asset.source_id}`
}

function fileDisplayName(asset: FileAsset): string {
  return asset.original_name || asset.name || '未命名文件'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
