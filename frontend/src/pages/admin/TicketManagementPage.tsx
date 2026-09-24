import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { MessageSquareText, RefreshCw, Send, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { formatTicketDate, ticketStatusLabel, type Ticket, type TicketPage, type TicketStatus } from '@/lib/tickets'
import TicketMarkdown from '../TicketMarkdown'

export default function TicketManagementPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const selectedIDRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [draftStatus, setDraftStatus] = useState('ALL')
  const [draftKeyword, setDraftKeyword] = useState('')
  const [filters, setFilters] = useState({ status: 'ALL', keyword: '' })
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const pageRef = useRef(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [savingStatus, setSavingStatus] = useState(false)
  const [menuPublished, setMenuPublished] = useState(false)
  const [publishAvailable, setPublishAvailable] = useState(false)
  const [menuSaving, setMenuSaving] = useState(false)

  const loadPublicationSetting = useCallback(async () => {
    try {
      const response = await apiClient.get<AuxEnvelope<{ enabled: boolean; publish_available: boolean }>>('/admin/tickets/config')
      setMenuPublished(response.data?.enabled === true)
      setPublishAvailable(response.data?.publish_available === true)
    } catch (caught) {
      console.error('[TicketManagementPage] failed to load publication setting', caught)
      setPublishAvailable(false)
    }
  }, [])

  const loadTicket = useCallback(async (id: number) => {
    const response = await apiClient.get<AuxEnvelope<Ticket>>(`/admin/tickets/${id}`)
    setSelected(response.data ?? null)
  }, [])

  const loadTickets = useCallback(async (preferredID?: number, requestedPage = pageRef.current) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(requestedPage), page_size: '20' })
      if (filters.status !== 'ALL') params.set('status', filters.status)
      if (filters.keyword.trim()) params.set('keyword', filters.keyword.trim())
      const response = await apiClient.get<AuxEnvelope<TicketPage>>(`/admin/tickets?${params}`)
      const items = response.data?.items ?? []
      setTickets(items)
      pageRef.current = response.data?.page ?? requestedPage
      setPage(pageRef.current)
      setTotalPages(response.data?.total_pages || 1)
      const currentID = selectedIDRef.current
      const nextID = preferredID ?? (items.some(item => item.id === currentID) ? currentID : items[0]?.id ?? null)
      selectedIDRef.current = nextID
      setSelectedID(nextID)
      if (nextID === null) setSelected(null)
      else await loadTicket(nextID)
    } catch (caught) {
      console.error('[TicketManagementPage] failed to load tickets', caught)
      setError(caught instanceof Error ? caught.message : '工单加载失败')
    } finally {
      setLoading(false)
    }
  }, [filters, loadTicket])

  useEffect(() => { void loadTickets() }, [loadTickets])
  useEffect(() => { void loadPublicationSetting() }, [loadPublicationSetting])

  const submitFilter = (event: FormEvent) => {
    event.preventDefault()
    pageRef.current = 1
    setFilters({ status: draftStatus, keyword: draftKeyword })
  }

  const sendReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setSending(true)
    try {
      await apiClient.post(`/admin/tickets/${selected.id}/messages`, { body: reply })
      setReply('')
      toast.success('工单回复已发送')
      await loadTickets(selected.id)
    } catch (caught) {
      console.error('[TicketManagementPage] failed to send reply', caught)
      toast.error('工单回复失败', { description: '请稍后重试。' })
    } finally {
      setSending(false)
    }
  }

  const updateStatus = async (nextStatus: TicketStatus) => {
    if (!selected || nextStatus === selected.status) return
    setSavingStatus(true)
    try {
      const response = await apiClient.put<AuxEnvelope<Ticket>>(`/admin/tickets/${selected.id}/status`, { status: nextStatus })
      setSelected(response.data ?? selected)
      toast.success('工单状态已更新')
      await loadTickets(selected.id)
    } catch (caught) {
      console.error('[TicketManagementPage] failed to update status', caught)
      toast.error('工单状态更新失败')
    } finally {
      setSavingStatus(false)
    }
  }

  const toggleMenu = async (enabled: boolean) => {
    setMenuSaving(true)
    try {
      const response = await apiClient.put<AuxEnvelope<{ enabled: boolean; published: boolean }>>('/admin/tickets/config', { enabled })
      setMenuPublished(response.data?.enabled === true)
      if (response.reason) {
        toast.warning(response.reason)
      } else if (enabled && response.data?.published === false) {
        toast.warning('设置已保存，但未能同步到 Sub2API 菜单，请检查公开地址和数据库配置')
      } else {
        toast.success(enabled ? '工单用户端已上架' : '工单用户端已下架')
      }
    } catch (caught) {
      console.error('[TicketManagementPage] failed to update publication setting', caught)
      toast.error('工单用户端上架设置保存失败')
    } finally {
      setMenuSaving(false)
    }
  }

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="flex items-center gap-2 text-2xl font-semibold text-gray-900 dark:text-gray-100"><MessageSquareText className="h-6 w-6" />工单管理</h1><p className="mt-1 text-sm text-muted-foreground">查看用户问题、回复消息并更新处理状态。</p></div><section className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"><div className="flex items-start gap-2"><Settings2 className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><Label htmlFor="ticket-user-menu" className="font-medium">上架到用户端</Label><p className="mt-1 text-xs text-muted-foreground">在 Sub2API 自定义菜单显示工单中心</p>{!publishAvailable && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">未配置 Sub2API 数据库或扩展公网地址</p>}</div></div><div className="flex items-center gap-2"><span className="text-sm font-medium">{menuPublished ? '已上架' : '未上架'}</span><Switch id="ticket-user-menu" checked={menuPublished} disabled={menuSaving || !publishAvailable} onCheckedChange={value => void toggleMenu(value)} aria-label="上架工单用户端" /></div></section></header>
      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      <div className="grid min-h-[600px] gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-lg border bg-card">
          <form onSubmit={submitFilter} className="space-y-3 border-b p-4"><div className="space-y-2"><Label htmlFor="ticket-keyword">搜索工单</Label><Input id="ticket-keyword" value={draftKeyword} onChange={event => setDraftKeyword(event.target.value)} placeholder="主题、用户或邮箱" /></div><div className="flex gap-2"><Select value={draftStatus} onValueChange={setDraftStatus}><SelectTrigger aria-label="工单状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">全部状态</SelectItem><SelectItem value="OPEN">待处理</SelectItem><SelectItem value="IN_PROGRESS">处理中</SelectItem><SelectItem value="CLOSED">已关闭</SelectItem></SelectContent></Select><Button type="submit" variant="outline" disabled={loading}>筛选</Button><Button type="button" variant="ghost" size="icon" aria-label="刷新工单" onClick={() => void loadTickets()} disabled={loading}><RefreshCw className="h-4 w-4" /></Button></div></form>
          {loading && tickets.length === 0 ? <p role="status" className="p-6 text-sm text-muted-foreground">正在加载工单…</p> : tickets.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">当前筛选下没有工单</p> : <div className="max-h-[680px] divide-y overflow-y-auto">{tickets.map(ticket => <Button key={ticket.id} variant="ghost" onClick={() => { selectedIDRef.current = ticket.id; setSelectedID(ticket.id); void loadTicket(ticket.id).catch(() => setError('工单详情加载失败，请重试。')) }} className={`h-auto w-full justify-start rounded-none px-4 py-3 text-left ${selectedID === ticket.id ? 'bg-muted' : ''}`}><span className="min-w-0"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{ticket.subject}</span><span className="shrink-0 text-[11px] text-muted-foreground">{ticketStatusLabel(ticket.status)}</span></span><span className="mt-1 block truncate text-xs text-muted-foreground">#{ticket.id} · {ticket.user_name || ticket.user_email || `用户 ${ticket.user_id}`}</span><span className="mt-1 block text-[11px] text-muted-foreground">{formatTicketDate(ticket.updated_at)}</span></span></Button>)}</div>}
          {totalPages > 1 && <Pagination className="border-t px-3 py-2"><PaginationContent><PaginationItem><PaginationPrevious href="#" aria-disabled={page <= 1} className={page <= 1 ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (page > 1) void loadTickets(undefined, page - 1) }} /></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground">{page} / {totalPages}</span></PaginationItem><PaginationItem><PaginationNext href="#" aria-disabled={page >= totalPages} className={page >= totalPages ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (page < totalPages) void loadTickets(undefined, page + 1) }} /></PaginationItem></PaginationContent></Pagination>}
        </section>

        <section className="flex min-h-[600px] flex-col rounded-lg border bg-card">
          {!selected ? <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{loading ? '正在加载工单…' : '选择一条工单查看详情'}</div> : <>
            <div className="flex flex-wrap items-start justify-between gap-4 border-b p-5"><div><p className="text-xs text-muted-foreground">工单 #{selected.id} · {selected.user_name || '用户'} · {selected.user_email}</p><h2 className="mt-1 text-xl font-semibold">{selected.subject}</h2><p className="mt-1 text-xs text-muted-foreground">创建于 {formatTicketDate(selected.created_at)}</p></div><div className="w-40"><Label htmlFor="ticket-status" className="sr-only">工单状态</Label><Select value={selected.status} onValueChange={value => void updateStatus(value as TicketStatus)} disabled={savingStatus}><SelectTrigger id="ticket-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="OPEN">待处理</SelectItem><SelectItem value="IN_PROGRESS">处理中</SelectItem><SelectItem value="CLOSED">已关闭</SelectItem></SelectContent></Select></div></div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">{(selected.messages ?? []).map(message => <article key={message.id} className={`max-w-[88%] min-w-0 rounded-lg border p-4 ${message.sender_type === 'admin' ? 'ml-auto bg-primary/5' : 'bg-muted/50'}`}><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{message.sender_type === 'admin' ? '管理员' : `${selected.user_name || '用户'}（${selected.user_email || ''}）`}</span><time>{formatTicketDate(message.created_at)}</time></div><TicketMarkdown body={message.body} /></article>)}</div>
            <form onSubmit={event => void sendReply(event)} className="space-y-3 border-t p-4"><Label htmlFor="admin-ticket-reply">回复用户</Label><Textarea id="admin-ticket-reply" value={reply} onChange={event => setReply(event.target.value)} rows={3} maxLength={10000} placeholder="输入回复内容…" aria-describedby="admin-ticket-reply-hint" required /><p id="admin-ticket-reply-hint" className="text-xs text-muted-foreground">支持 Markdown 格式。</p><div className="flex justify-end"><Button type="submit" disabled={sending || !reply.trim()}><Send className="mr-2 h-4 w-4" />{sending ? '发送中…' : '发送回复'}</Button></div></form>
          </>}
        </section>
      </div>
    </div>
  )
}
