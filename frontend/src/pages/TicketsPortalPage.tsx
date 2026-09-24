import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Inbox, Loader2, MessageSquareText, Plus, RefreshCw, Send } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Toaster } from '@/components/ui/sonner'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TicketListItem } from '@/components/TicketListItem'
import { TicketMessageBubble } from '@/components/TicketMessageBubble'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { formatTicketDate, type Ticket, type TicketPage } from '@/lib/tickets'

export default function TicketsPortalPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const selectedIDRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
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

  // 切换工单或收到新回复后停在最新一条，避免用户每次手动滚动到底部。
  useEffect(() => {
    const container = conversationRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

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

  const selectTicket = (id: number) => {
    selectedIDRef.current = id
    setSelectedID(id)
    void loadTicket(id).catch(() => setError('工单详情加载失败，请重试。'))
  }

  const listLoading = loading && tickets.length === 0

  return (
    <TooltipProvider>
      <main className="flex min-h-screen flex-col bg-[var(--aux-page-bg)] px-4 py-8 text-[var(--aux-page-ink)] sm:px-6 lg:h-screen lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 lg:min-h-0">
          <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-[var(--aux-page-line)] pb-5">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--aux-page-accent)]">客户支持</p>
              <h1 className="mt-2 flex items-center gap-2 text-3xl font-semibold tracking-tight">
                <MessageSquareText className="h-7 w-7 text-[var(--aux-page-accent)]" aria-hidden="true" />
                工单中心
              </h1>
              <p className="mt-2 text-sm text-[var(--aux-page-muted)]">提交问题并在这里跟进客服回复，支持 Markdown 排版。</p>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="lg"><Plus className="mr-2 h-4 w-4" aria-hidden="true" />新建工单</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>提交新工单</DialogTitle>
                  <DialogDescription>请描述遇到的问题和复现步骤，客服会在工单中回复。</DialogDescription>
                </DialogHeader>
                <form onSubmit={event => void createTicket(event)} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="ticket-subject">问题主题</Label>
                    <Input id="ticket-subject" value={subject} onChange={event => setSubject(event.target.value)} maxLength={200} placeholder="一句话概括问题" required />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="ticket-message">问题描述</Label>
                      <span id="ticket-message-hint" className="text-xs text-muted-foreground">支持 Markdown：标题、列表、代码块及链接</span>
                    </div>
                    <Textarea
                      id="ticket-message"
                      value={newMessage}
                      onChange={event => setNewMessage(event.target.value)}
                      rows={6}
                      maxLength={10000}
                      placeholder="描述问题现象、复现步骤和已尝试的操作…"
                      aria-describedby="ticket-message-hint"
                      required
                      className="resize-y"
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={creating || !subject.trim() || !newMessage.trim()}>
                      {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      {creating ? '提交中…' : '提交工单'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </header>

          {error && (
            <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="grid min-h-[520px] gap-4 lg:min-h-[420px] lg:flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
            <Card className="flex min-w-0 flex-col overflow-hidden lg:min-h-0">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-muted/20 px-4 py-2.5">
                <h2 className="text-sm font-medium">我的工单</h2>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="刷新工单" onClick={() => void loadTickets(undefined, page)} disabled={loading} className="h-8 w-8">
                      <RefreshCw className={loading ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>刷新工单列表</TooltipContent>
                </Tooltip>
              </div>

              {listLoading ? (
                <div role="status" aria-label="正在加载工单" className="space-y-3 p-4">
                  {[0, 1, 2].map(index => (
                    <div key={index} className="space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  ))}
                </div>
              ) : tickets.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                  <Inbox className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                  <p className="text-sm font-medium">还没有工单</p>
                  <p className="text-xs text-muted-foreground">提交问题后可在这里持续跟进。</p>
                </div>
              ) : (
                <div className="max-h-[420px] flex-1 divide-y overflow-y-auto lg:max-h-none">
                  {tickets.map(ticket => (
                    <TicketListItem
                      key={ticket.id}
                      subject={ticket.subject}
                      status={ticket.status}
                      reference={`#${ticket.id}`}
                      updatedAt={ticket.updated_at}
                      selected={selectedID === ticket.id}
                      onSelect={() => selectTicket(ticket.id)}
                    />
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <Pagination className="shrink-0 border-t bg-muted/20 px-3 py-2">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        aria-disabled={page <= 1}
                        className={page <= 1 ? 'pointer-events-none opacity-50' : undefined}
                        onClick={event => { event.preventDefault(); if (page > 1) void loadTickets(undefined, page - 1) }}
                      />
                    </PaginationItem>
                    <PaginationItem>
                      <span className="px-2 text-xs tabular-nums text-muted-foreground">{page} / {totalPages}</span>
                    </PaginationItem>
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        aria-disabled={page >= totalPages}
                        className={page >= totalPages ? 'pointer-events-none opacity-50' : undefined}
                        onClick={event => { event.preventDefault(); if (page < totalPages) void loadTickets(undefined, page + 1) }}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </Card>

            <Card className="flex min-h-[520px] min-w-0 flex-col overflow-hidden lg:min-h-0">
              {!selected ? (
                <div className="grid flex-1 place-items-center p-8 text-center">
                  <div className="space-y-2">
                    {loading ? (
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
                    ) : (
                      <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                    )}
                    <p role="status" className="text-sm text-muted-foreground">{loading ? '正在加载工单…' : '选择一条工单查看对话'}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b bg-muted/20 px-5 py-4">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-muted-foreground">#{selected.id}</p>
                      <h2 className="mt-1 text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">{selected.subject}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">创建于 {formatTicketDate(selected.created_at)}</p>
                    </div>
                    <TicketStatusBadge status={selected.status} />
                  </div>

                  <div ref={conversationRef} className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-5" aria-live="polite">
                    {messages.map(message => (
                      <TicketMessageBubble
                        key={message.id}
                        self={message.sender_type === 'user'}
                        senderLabel={message.sender_type === 'user' ? '我' : '客服团队'}
                        createdAt={message.created_at}
                        body={message.body}
                      />
                    ))}
                  </div>

                  {selected.status === 'CLOSED' ? (
                    <p className="shrink-0 border-t bg-muted/30 p-4 text-sm text-muted-foreground">此工单已关闭。如需继续协助，请新建工单。</p>
                  ) : (
                    <form onSubmit={event => void sendReply(event)} className="shrink-0 space-y-2 border-t p-4">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="ticket-reply" className="text-sm font-medium">追加回复</Label>
                        <span id="ticket-reply-hint" className="text-xs text-muted-foreground">支持 Markdown 格式</span>
                      </div>
                      <Textarea
                        id="ticket-reply"
                        value={reply}
                        onChange={event => setReply(event.target.value)}
                        rows={3}
                        maxLength={10000}
                        placeholder="补充信息或回复客服…"
                        aria-describedby="ticket-reply-hint"
                        required
                        className="resize-y"
                      />
                      <div className="flex justify-end">
                        <Button type="submit" disabled={sending || !reply.trim()}>
                          {sending
                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                            : <Send className="mr-2 h-4 w-4" aria-hidden="true" />}
                          {sending ? '发送中…' : '发送回复'}
                        </Button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </Card>
          </div>
        </div>
        {/* 用户端工单页是独立路由，没有 AdminLayout 的 Toaster，需自行挂载右上角通知。 */}
        <Toaster position="top-right" />
      </main>
    </TooltipProvider>
  )
}
