import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { MessageSquareText, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Textarea } from '@/components/ui/textarea'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { formatTicketDate, ticketStatusLabel, type Ticket, type TicketPage } from '@/lib/tickets'
import TicketMarkdown from './TicketMarkdown'

export default function TicketsPortalPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const selectedIDRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const pageRef = useRef(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [subject, setSubject] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [reply, setReply] = useState('')
  const [creating, setCreating] = useState(false)
  const [sending, setSending] = useState(false)

  const loadTicket = useCallback(async (id: number) => {
    const response = await apiClient.get<AuxEnvelope<Ticket>>(`/tickets/${id}`)
    setSelected(response.data ?? null)
  }, [])

  const loadTickets = useCallback(async (preferredID?: number, nextPage = pageRef.current) => {
    setLoading(true)
    setError('')
    try {
      const response = await apiClient.get<AuxEnvelope<TicketPage>>(`/tickets?page=${nextPage}&page_size=20`)
      const items = response.data?.items ?? []
      setTickets(items)
      pageRef.current = response.data?.page ?? nextPage
      setPage(pageRef.current)
      setTotalPages(response.data?.total_pages || 1)
      const currentID = selectedIDRef.current
      const nextID = preferredID ?? (items.some(item => item.id === currentID) ? currentID : items[0]?.id ?? null)
      selectedIDRef.current = nextID
      setSelectedID(nextID)
      if (nextID === null) setSelected(null)
      else await loadTicket(nextID)
    } catch (caught) {
      console.error('[TicketsPortalPage] failed to load tickets', caught)
      setError(caught instanceof Error ? caught.message : '工单加载失败，请从用户菜单重新打开。')
    } finally {
      setLoading(false)
    }
  }, [loadTicket])

  useEffect(() => { void loadTickets(undefined, 1) }, [loadTickets])

  const messages = useMemo(() => selected?.messages ?? [], [selected])

  const createTicket = async (event: FormEvent) => {
    event.preventDefault()
    setCreating(true)
    try {
      const response = await apiClient.post<AuxEnvelope<Ticket>>('/tickets', { subject, body: newMessage })
      const created = response.data
      toast.success('工单已提交', { description: '客服团队会通过工单中心回复。' })
      setDialogOpen(false)
      setSubject('')
      setNewMessage('')
      if (created) {
        await loadTickets(created.id, 1)
        if (page !== 1) setPage(1)
      }
    } catch (caught) {
      console.error('[TicketsPortalPage] failed to create ticket', caught)
      toast.error('工单提交失败', { description: '请检查内容后重试。' })
    } finally {
      setCreating(false)
    }
  }

  const sendReply = async (event: FormEvent) => {
    event.preventDefault()
    if (!selected) return
    setSending(true)
    try {
      const response = await apiClient.post<AuxEnvelope<Ticket>>(`/tickets/${selected.id}/messages`, { body: reply })
      setSelected(response.data ?? selected)
      setReply('')
      toast.success('回复已发送')
      await loadTickets(selected.id)
    } catch (caught) {
      console.error('[TicketsPortalPage] failed to reply', caught)
      toast.error('回复发送失败', { description: '请稍后重试。' })
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="min-h-screen bg-[var(--aux-page-bg)] px-4 py-8 text-[var(--aux-page-text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--aux-page-muted)]">客户支持</p>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold"><MessageSquareText className="h-6 w-6" />工单中心</h1>
            <p className="mt-2 text-sm text-[var(--aux-page-muted)]">提交问题并在这里跟进客服回复。</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />新建工单</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>提交新工单</DialogTitle><DialogDescription>请描述遇到的问题和复现步骤，客服会在工单中回复。</DialogDescription></DialogHeader>
              <form onSubmit={event => void createTicket(event)} className="space-y-4">
                <div className="space-y-2"><Label htmlFor="ticket-subject">问题主题</Label><Input id="ticket-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} required /></div>
                <div className="space-y-2"><Label htmlFor="ticket-message">问题描述</Label><Textarea id="ticket-message" value={newMessage} onChange={event => setNewMessage(event.target.value)} rows={6} maxLength={10000} aria-describedby="ticket-message-hint" required /><p id="ticket-message-hint" className="text-xs text-muted-foreground">支持 Markdown：标题、列表、代码块及链接。</p></div>
                <DialogFooter><Button type="submit" disabled={creating || !subject.trim() || !newMessage.trim()}>{creating ? '提交中…' : '提交工单'}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </header>

        {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>}
      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="rounded-lg border bg-card">
            <div className="flex items-center justify-between border-b px-4 py-3"><h2 className="font-medium">我的工单</h2><Button variant="ghost" size="sm" onClick={() => void loadTickets(undefined, page)} disabled={loading}>刷新</Button></div>
            {loading && tickets.length === 0 ? <p role="status" className="p-6 text-sm text-muted-foreground">正在加载工单…</p> : tickets.length === 0 ? <div className="p-6 text-center text-sm text-muted-foreground"><p>还没有工单</p><p className="mt-1">提交问题后可在这里持续跟进。</p></div> : <div className="max-h-[620px] divide-y overflow-y-auto">{tickets.map(ticket => <Button key={ticket.id} variant="ghost" onClick={() => { selectedIDRef.current = ticket.id; setSelectedID(ticket.id); void loadTicket(ticket.id).catch(() => setError('工单详情加载失败，请重试。')) }} className={`h-auto w-full justify-start rounded-none px-4 py-3 text-left ${selectedID === ticket.id ? 'bg-muted' : ''}`}><span className="min-w-0"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{ticket.subject}</span><span className="shrink-0 text-[11px] text-muted-foreground">{ticketStatusLabel(ticket.status)}</span></span><span className="mt-1 block text-xs text-muted-foreground">#{ticket.id} · {formatTicketDate(ticket.updated_at)}</span></span></Button>)}</div>}
            {totalPages > 1 && <Pagination className="border-t px-3 py-2"><PaginationContent><PaginationItem><PaginationPrevious href="#" aria-disabled={page <= 1} className={page <= 1 ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (page > 1) void loadTickets(undefined, page - 1) }} /></PaginationItem><PaginationItem><span className="px-2 text-xs text-muted-foreground">{page} / {totalPages}</span></PaginationItem><PaginationItem><PaginationNext href="#" aria-disabled={page >= totalPages} className={page >= totalPages ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (page < totalPages) void loadTickets(undefined, page + 1) }} /></PaginationItem></PaginationContent></Pagination>}
          </section>

          <section className="flex min-h-[520px] flex-col rounded-lg border bg-card">
            {!selected ? <div className="grid flex-1 place-items-center p-8 text-center text-sm text-muted-foreground">{loading ? '正在加载工单…' : '选择一条工单查看对话'}</div> : <>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4"><div><p className="text-xs text-muted-foreground">工单 #{selected.id}</p><h2 className="mt-1 text-lg font-semibold">{selected.subject}</h2></div><span className="rounded-full border px-3 py-1 text-xs">{ticketStatusLabel(selected.status)}</span></div>
              <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">{messages.map(message => <article key={message.id} className={`max-w-[85%] min-w-0 rounded-lg border p-4 ${message.sender_type === 'user' ? 'ml-auto bg-primary/5' : 'bg-muted/50'}`}><div className="flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span>{message.sender_type === 'user' ? '我' : '客服团队'}</span><time>{formatTicketDate(message.created_at)}</time></div><TicketMarkdown body={message.body} /></article>)}</div>
              {selected.status === 'CLOSED' ? <p className="border-t p-4 text-sm text-muted-foreground">此工单已关闭。如需继续协助，请新建工单。</p> : <form onSubmit={event => void sendReply(event)} className="space-y-3 border-t p-4"><Label htmlFor="ticket-reply">追加回复</Label><Textarea id="ticket-reply" value={reply} onChange={event => setReply(event.target.value)} rows={3} maxLength={10000} placeholder="补充信息或回复客服…" aria-describedby="ticket-reply-hint" required /><p id="ticket-reply-hint" className="text-xs text-muted-foreground">支持 Markdown 格式。</p><div className="flex justify-end"><Button type="submit" disabled={sending || !reply.trim()}><Send className="mr-2 h-4 w-4" />{sending ? '发送中…' : '发送回复'}</Button></div></form>}
            </>}
          </section>
        </div>
      </div>
    </main>
  )
}
