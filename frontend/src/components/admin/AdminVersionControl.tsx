import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react'
import { ArrowUpRight, CheckCircle2, ChevronDown, Download, Loader2, RefreshCw } from 'lucide-react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface Build { version: string; commit: string; buildTime: string }
interface Job { id: string; version: string; phase: string; message: string; startedAt: string }
interface UpdateStatus { enabled: boolean; reason?: string; job?: Job }
interface ReleaseInfo {
  release: { version: string; name: string; notes: string; url: string; publishedAt: string }
  updateAvailable: boolean
  canUpdate: boolean
  reason?: string
}

interface UpdateResponse extends Job {
  need_restart?: boolean
}

const finished = new Set(['succeeded', 'failed', 'rolled_back', 'rollback_failed'])
const VersionContext = createContext<{ version?: string; open: () => void }>({ open: () => {} })
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重试'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

function renderReleaseNotes(notes: string): string {
  const renderer = new marked.Renderer()
  // Keep raw HTML visible as text before URI and attribute sanitization.
  renderer.html = ({ text }) => escapeHtml(text)
  const html = marked.parse(notes, {
    gfm: true,
    breaks: true,
    silent: true,
    async: false,
    renderer,
  })
  return DOMPurify.sanitize(typeof html === 'string' ? html : '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'svg', 'math'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/|#)/i,
  })
}

export function AdminVersionButton({ compact = false }: { compact?: boolean }) {
  const { version, open } = useContext(VersionContext)
  return (
    <button type="button" onClick={open} className={compact ? 'aux-admin-version-compact' : 'aux-admin-version-button'} aria-label={`查看版本与更新${version ? `，当前 ${version}` : ''}`}>
      {compact ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <>{version || '版本信息'}<ChevronDown className="h-3 w-3" aria-hidden="true" /></>}
    </button>
  )
}

export default function AdminVersionControl({ children }: PropsWithChildren) {
  const [build, setBuild] = useState<Build>()
  const [open, setOpen] = useState(false)
  const [release, setRelease] = useState<ReleaseInfo>()
  const [status, setStatus] = useState<UpdateStatus>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [reconnecting, setReconnecting] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [needRestart, setNeedRestart] = useState(false)
  const mounted = useRef(true)
  const generation = useRef(0)
  const job = status?.job
  const active = !!job && !finished.has(job.phase)

  const loadBuild = useCallback(async () => {
    const response = await apiClient.get<AuxEnvelope<Build>>('/admin/system/version')
    if (mounted.current && response.data) setBuild(response.data)
  }, [])

  useEffect(() => {
    mounted.current = true
    void loadBuild().catch(() => {})
    return () => { mounted.current = false; generation.current++ }
  }, [loadBuild])

  const check = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    setConfirm(false)
    const results = await Promise.allSettled([
      apiClient.get<AuxEnvelope<ReleaseInfo>>('/admin/system/release', { timeout: 35000 }),
      apiClient.get<AuxEnvelope<UpdateStatus>>('/admin/system/update'),
      loadBuild(),
    ])
    if (!mounted.current || request !== generation.current) return
    const [latest, updateStatus, version] = results
    if (latest.status === 'fulfilled' && latest.value.data) setRelease(latest.value.data)
    else setError(latest.status === 'rejected' ? message(latest.reason) : '未能读取发布信息')
    if (updateStatus.status === 'fulfilled' && updateStatus.value.data) {
      setStatus(updateStatus.value.data)
      setReconnecting(false)
    } else {
      setReconnecting(true)
    }
    if (version.status === 'rejected' && latest.status === 'fulfilled') setError('当前版本暂不可用，请稍后重新检查')
    setLoading(false)
  }, [loadBuild])

  useEffect(() => {
    if (!open) return
    void check()
  }, [open, check])

  useEffect(() => {
    if (!open || (!active && !reconnecting && !submitting)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await apiClient.get<AuxEnvelope<UpdateStatus>>('/admin/system/update', { timeout: 10000 })
        if (cancelled) return
        if (!result.data) throw new Error('更新状态暂不可用')
        setStatus(result.data)
        setReconnecting(false)
        if (result.data.job) {
          setError('')
          // 检查任务是否刚完成且匹配当前 release 版本
          if (finished.has(result.data.job.phase) && result.data.job.phase === 'succeeded' && release?.release.version === result.data.job.version) {
            setNeedRestart(true)
          }
        }
        if (result.data.job && finished.has(result.data.job.phase)) {
          void loadBuild().catch(() => {})
          return
        }
      } catch {
        if (!cancelled) setReconnecting(true)
      }
      if (!cancelled) timer = setTimeout(poll, 3000)
    }
    timer = setTimeout(poll, 3000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, active, reconnecting, submitting, loadBuild, release])

  const startUpdate = async () => {
    if (!release || submitting) return
    setSubmitting(true)
    setConfirm(false)
    setError('')
    try {
      // Binary packages may be large and the server bounds this operation at
      // 15 minutes, matching Sub2API's in-process updater.
      // The server resolves the latest formal release itself, matching
      // Sub2API's synchronous PerformUpdate contract.
      const response = await apiClient.post<AuxEnvelope<UpdateResponse>>('/admin/system/update', undefined, { timeout: 15 * 60 * 1000 })
      if (!response.data) throw new Error('更新任务响应为空，请检查任务状态')
      if (mounted.current) {
        setStatus({ enabled: true, job: response.data })
        if (response.data.need_restart) setNeedRestart(true)
      }
    } catch (failure) {
      if (mounted.current) {
        setError(message(failure))
        // POST 响应可能在应用重启时中断；先读取任务状态，不能自动重复发起更新。
        setReconnecting(true)
      }
    } finally {
      if (mounted.current) setSubmitting(false)
    }
  }

  const justUpdated = job?.phase === 'succeeded' && job.version === release?.release.version
  const canUpdate = release?.canUpdate && status?.enabled && !active && !submitting && !loading && !error && !reconnecting && job?.phase !== 'rollback_failed' && !justUpdated

  const handleRestartConfirmed = () => {
    setNeedRestart(false)
    void check()
  }

  return (
    <VersionContext.Provider value={{ version: build?.version, open: () => setOpen(true) }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85svh] w-[calc(100%-2rem)] max-w-2xl gap-5 overflow-y-auto rounded-xl p-5 sm:p-6">
          <DialogHeader>
            <DialogTitle>版本与更新</DialogTitle>
            <DialogDescription>查看正式发布说明，由管理员选择何时更新。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 rounded-lg border bg-muted/30 p-4">
            <div><p className="text-xs text-muted-foreground">当前版本</p><p className="mt-1 break-all font-mono text-lg font-semibold">{build?.version || '暂不可用'}</p></div>
            <div><p className="text-xs text-muted-foreground">最新正式版</p><p className="mt-1 break-all font-mono text-lg font-semibold">{release?.release.version || (loading ? '检查中…' : '—')}</p></div>
          </div>
          {loading && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />正在检查发布信息…</p>}
          {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          {needRestart && justUpdated && (
            <div role="alert" className="space-y-3 rounded-lg border-2 border-amber-500/30 bg-amber-50 p-4 dark:bg-amber-950/20">
              <p className="font-medium text-amber-900 dark:text-amber-100">🎉 更新已完成</p>
              <p className="text-sm leading-relaxed text-amber-800 dark:text-amber-200">
                新版本二进制已原子替换到磁盘，但当前进程仍在运行旧版本。请重启服务以加载新版本：
              </p>
              <pre className="overflow-x-auto rounded bg-amber-100 p-2 text-xs dark:bg-amber-900/30">docker restart aux-system</pre>
              <p className="text-xs text-amber-700 dark:text-amber-300">或使用 Docker Compose 重启（不要用 up -d，会重建容器）：</p>
              <pre className="overflow-x-auto rounded bg-amber-100 p-2 text-xs dark:bg-amber-900/30">docker compose -f deploy/docker-compose.yml restart aux-system</pre>
            </div>
          )}
          {release && (
            <section aria-label="发布说明" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">{release.release.name || release.release.version}</h3>
                <a href={release.release.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4">GitHub Release<ArrowUpRight className="h-3 w-3" /></a>
              </div>
              {release.release.publishedAt && <p className="text-xs text-muted-foreground">发布于 {new Date(release.release.publishedAt).toLocaleDateString('zh-CN')}</p>}
              <div className="aux-release-markdown max-h-64 overflow-y-auto break-words rounded-lg border p-4 text-sm leading-7" dangerouslySetInnerHTML={{ __html: renderReleaseNotes(release.release.notes || '此版本暂无发布说明。') }} />
              {!release.updateAvailable && !active && !loading && <p className="flex items-center gap-2 text-sm"><CheckCircle2 className="h-4 w-4" />当前已是最新版本或更新的版本</p>}
              {(release.reason || status?.reason) && <p className="text-sm text-muted-foreground">{status?.reason || release.reason}</p>}
            </section>
          )}
          {(job || reconnecting) && (
            <div role="status" aria-live="polite" className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm">
              {job && <><p className="font-medium">{active ? '正在更新到' : '更新任务'} {job.version}</p><p>{job.message}</p></>}
              {reconnecting && <p className="flex items-start gap-2 text-muted-foreground"><Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" />连接暂时中断，正在重新获取更新状态。任务在后台继续；请勿重复更新。</p>}
            </div>
          )}
          {confirm && <p className="rounded-lg border p-4 text-sm leading-6">确认更新到 <strong>{release?.release.version}</strong>？更新会下载并原子替换应用二进制，完成后需要重启服务。数据库迁移不会自动撤销，请先备份数据。</p>}
          <DialogFooter className="flex-wrap gap-2">
            {!needRestart && <Button variant="outline" disabled={loading || submitting || active} onClick={() => void check()}><RefreshCw className="mr-2 h-4 w-4" />重新检查</Button>}
            {needRestart && justUpdated ? <Button onClick={handleRestartConfirmed}>我已重启，重新检查</Button> : confirm ? <>
              <Button variant="ghost" onClick={() => setConfirm(false)}>取消</Button>
              <Button disabled={!canUpdate} onClick={() => void startUpdate()}>确认更新</Button>
            </> : <Button disabled={!canUpdate} onClick={() => setConfirm(true)}>{submitting || active ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download className="mr-2 h-4 w-4" />}{submitting ? '正在创建任务…' : active ? '更新进行中' : '更新到最新版本'}</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </VersionContext.Provider>
  )
}
