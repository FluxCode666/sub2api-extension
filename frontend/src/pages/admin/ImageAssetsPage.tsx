import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Check, Copy, ImageIcon, Loader2, Upload } from 'lucide-react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Button } from '@/components/ui/button'

interface ImageAsset {
  id: number
  original_name: string
  mime_type: string
  size: number
  created_at: string
  url: string
}

interface ImageAssetListResponse {
  items: ImageAsset[]
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export default function ImageAssetsPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [items, setItems] = useState<ImageAsset[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [copiedId, setCopiedId] = useState<number | null>(null)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await apiClient.get<AuxEnvelope<ImageAssetListResponse>>('/admin/assets')
      setItems((response.data?.items ?? []).map((item) => ({
        ...item,
        // 后端返回稳定的公开路径；由浏览器补成当前站点的 HTTP(S) URL，
        // 避免反向代理把内部容器域名写进页面元数据。
        url: new URL(item.url, window.location.origin).href,
      })))
    } catch {
      setError('图片资源加载失败，请检查管理会话或后端服务。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadAssets()
  }, [loadAssets])

  const uploadFile = async (file: File) => {
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('只能上传 PNG、JPEG、GIF 或 WebP 图片。')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('单张图片不能超过 10MB。')
      return
    }

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await apiClient.upload<AuxEnvelope<ImageAsset>>('/admin/assets', formData, { timeout: 60_000 })
      await loadAssets()
    } catch {
      setError('上传失败。请确认文件格式正确、大小不超过 10MB，并已执行数据库迁移。')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void uploadFile(file)
  }

  const copyURL = async (asset: ImageAsset) => {
    try {
      await writeClipboardText(asset.url)
      setCopiedId(asset.id)
      window.setTimeout(() => setCopiedId((current) => current === asset.id ? null : current), 1600)
    } catch {
      setError('复制失败，请手动选择 URL 复制。')
    }
  }

  return (
    <div className="aux-admin-page space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">图片资源</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            图片以文件形式持久化，数据库只记录文件路径。上传后复制 HTTP URL，并粘贴到动态页面元数据中。
          </p>
        </div>
        <div>
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
        支持 PNG、JPEG、GIF、WebP，单张不超过 10MB。上传文件会生成随机文件名，避免覆盖已有资源。
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-56 items-center justify-center rounded-xl border border-gray-200 dark:border-gray-800">
          <Loader2 className="mr-2 h-5 w-5 animate-spin text-gray-400" />
          <span className="text-sm text-gray-500">正在加载图片资源…</span>
        </div>
      ) : items.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-gray-200 bg-white px-6 text-center dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-900">
            <ImageIcon className="h-5 w-5 text-gray-500" />
          </div>
          <p className="font-medium text-gray-900 dark:text-gray-100">还没有上传图片</p>
          <p className="mt-1 text-sm text-gray-500">上传后，这里会展示可复制的公开 HTTP URL。</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((asset) => (
            <article key={asset.id} className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
              <div className="flex h-44 items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
                <img src={asset.url} alt={asset.original_name} className="h-full w-full object-contain" loading="lazy" />
              </div>
              <div className="space-y-3 p-4">
                <div>
                  <p className="truncate text-sm font-medium text-gray-900 dark:text-gray-100" title={asset.original_name}>{asset.original_name}</p>
                  <p className="mt-1 text-xs text-gray-500">{formatBytes(asset.size)} · {formatDate(asset.created_at)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={asset.url}
                    aria-label={`${asset.original_name} 的 HTTP URL`}
                    onFocus={(event) => event.currentTarget.select()}
                    className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-xs text-foreground shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => void copyURL(asset)} aria-label="复制 HTTP URL">
                    {copiedId === asset.id ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

async function writeClipboardText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // 非安全上下文或浏览器策略禁用 Clipboard API 时，继续使用兼容回退。
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
