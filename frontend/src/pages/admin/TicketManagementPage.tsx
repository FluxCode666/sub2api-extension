import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Inbox, Loader2, MessageSquareText, RefreshCw, Search, Send, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Pagination, PaginationContent, PaginationItem, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TicketListItem } from '@/components/TicketListItem'
import { TicketMessageBubble } from '@/components/TicketMessageBubble'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { formatTicketDate, type Ticket, type TicketPage, type TicketStatus } from '@/lib/tickets'

export default function TicketManagementPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [selectedID, setSelectedID] = useState<number | null>(null)
  const selectedIDRef = useRef<number | null>(null)
  const [selected, setSelected] = useState<Ticket | null>(null)
  const conversationRef = useRef<HTMLDivElement>(null)
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
      setTotal(response.data?.total ?? items.length)
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

  // 切换工单或收到新消息后停在最新一条，避免管理员每次手动滚动到底部。
  useEffect(() => {
    const container = conversationRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [selected])

  const submitFilter = (event: FormEvent) => {
    event.preventDefault()
    pageRef.current = 1
    setFilters({ status: draftStatus, keyword: draftKeyword })
  }

  const selectTicket = (id: number) => {
    selectedIDRef.current = id
    setSelectedID(id)
    void loadTicket(id).catch(() => setError('工单详情加载失败，请重试。'))
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

  const listLoading = loading && tickets.length === 0

  return (
    <TooltipProvider>
      <div className="flex flex-col gap-6 p-4 sm:p-6 xl:h-[calc(100svh-3.5rem)]">
        <header className="flex shrink-0 flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <MessageSquareText className="h-6 w-6 text-primary" aria-hidden="true" />
              工单管理
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">查看用户问题、回复消息并更新处理状态。</p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card px-4 py-3 shadow-sm sm:w-auto">
            <Settings2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <Label htmlFor="ticket-user-menu" className="cursor-pointer text-sm font-medium">上架到用户端</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">在 Sub2API 自定义菜单显示工单中心</p>
            </div>
            <Badge variant={menuPublished ? 'default' : 'secondary'} className="shrink-0">{menuPublished ? '已上架' : '未上架'}</Badge>
            <Switch
              id="ticket-user-menu"
              checked={menuPublished}
              disabled={menuSaving || !publishAvailable}
              onCheckedChange={value => void toggleMenu(value)}
              aria-label="上架工单用户端"
            />
          </div>
        </header>

        {!publishAvailable && (
          <Alert className="border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertDescription>未配置 Sub2API 数据库或扩展公网地址，工单中心无法自动同步到 Sub2API 菜单。</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid min-h-[600px] gap-4 xl:min-h-[420px] xl:flex-1 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card className="flex min-w-0 flex-col overflow-hidden xl:min-h-0">
            <form onSubmit={submitFilter} className="shrink-0 space-y-3 border-b bg-muted/20 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="ticket-keyword" className="text-xs font-medium text-muted-foreground">搜索工单</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="ticket-keyword"
                    value={draftKeyword}
                    onChange={event => setDraftKeyword(event.target.value)}
                    placeholder="主题、用户或邮箱"
                    className="pl-9"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select value={draftStatus} onValueChange={setDraftStatus}>
                  <SelectTrigger aria-label="工单状态" className="min-w-0 flex-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ALL">全部状态</SelectItem>
                    <SelectItem value="OPEN">待处理</SelectItem>
                    <SelectItem value="IN_PROGRESS">处理中</SelectItem>
                    <SelectItem value="CLOSED">已关闭</SelectItem>
                  </SelectContent>
                </Select>
                <Button type="submit" variant="outline" disabled={loading} className="shrink-0">筛选</Button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="刷新工单" onClick={() => void loadTickets()} disabled={loading} className="shrink-0">
                      <RefreshCw className={loading ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>刷新工单列表</TooltipContent>
                </Tooltip>
              </div>
            </form>

            <div className="flex shrink-0 items-center justify-between border-b px-4 py-2 text-xs text-muted-foreground">
              <span>工单列表</span>
              <span className="tabular-nums">共 {total} 条</span>
            </div>

            {listLoading ? (
              <div role="status" aria-label="正在加载工单" className="space-y-3 p-4">
                {[0, 1, 2, 3].map(index => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : tickets.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
                <Inbox className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">当前筛选下没有工单</p>
              </div>
            ) : (
              <div className="max-h-[420px] flex-1 divide-y overflow-y-auto xl:max-h-none">
                {tickets.map(ticket => (
                  <TicketListItem
                    key={ticket.id}
                    subject={ticket.subject}
                    status={ticket.status}
                    reference={`#${ticket.id}`}
                    secondary={ticket.user_name || ticket.user_email || `用户 ${ticket.user_id}`}
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

          <Card className="flex min-h-[600px] min-w-0 flex-col overflow-hidden xl:min-h-0">
            {!selected ? (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div className="space-y-2">
                  {loading ? (
                    <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
                  ) : (
                    <MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
                  )}
                  <p role="status" className="text-sm text-muted-foreground">{loading ? '正在加载工单…' : '选择一条工单查看详情'}</p>
                </div>
              </div>
            ) : (
              <>
                <div className="flex shrink-0 flex-wrap items-start justify-between gap-4 border-b bg-muted/20 px-5 py-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">#{selected.id}</span>
                      <TicketStatusBadge status={selected.status} className="px-2 py-0 text-[11px]" />
                    </div>
                    <h2 className="mt-1.5 text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{selected.subject}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {selected.user_name || '用户'}
                      {selected.user_email ? ` · ${selected.user_email}` : ''} · 创建于 {formatTicketDate(selected.created_at)}
                    </p>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    {savingStatus && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />}
                    <div className="w-36">
                      <Label htmlFor="ticket-status" className="sr-only">工单状态</Label>
                      <Select value={selected.status} onValueChange={value => void updateStatus(value as TicketStatus)} disabled={savingStatus}>
                        <SelectTrigger id="ticket-status"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OPEN">待处理</SelectItem>
                          <SelectItem value="IN_PROGRESS">处理中</SelectItem>
                          <SelectItem value="CLOSED">已关闭</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div ref={conversationRef} className="flex-1 space-y-4 overflow-y-auto bg-muted/20 p-5" aria-live="polite">
                  {(selected.messages ?? []).map(message => (
                    <TicketMessageBubble
                      key={message.id}
                      self={message.sender_type === 'admin'}
                      senderLabel={message.sender_type === 'admin' ? '管理员' : selected.user_name || selected.user_email || '用户'}
                      createdAt={message.created_at}
                      body={message.body}
                    />
                  ))}
                </div>

                <form onSubmit={event => void sendReply(event)} className="shrink-0 space-y-2 border-t p-4">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="admin-ticket-reply" className="text-sm font-medium">回复用户</Label>
                    <span id="admin-ticket-reply-hint" className="text-xs text-muted-foreground">支持 Markdown 格式</span>
                  </div>
                  <Textarea
                    id="admin-ticket-reply"
                    value={reply}
                    onChange={event => setReply(event.target.value)}
                    rows={3}
                    maxLength={10000}
                    placeholder="输入回复内容…"
                    aria-describedby="admin-ticket-reply-hint"
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
              </>
            )}
          </Card>
        </div>
      </div>
    </TooltipProvider>
  )
}
