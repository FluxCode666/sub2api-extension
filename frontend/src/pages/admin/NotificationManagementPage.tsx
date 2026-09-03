import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Bell, CalendarDays, ChevronDown, Plus, Save, Send, Trash2 } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { zhCN } from 'date-fns/locale'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from '@/components/ui/pagination'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'

type ChannelType = 'email' | 'resend' | 'webhook' | 'wecom' | 'feishu_bot' | 'dingtalk' | 'feishu'
type WebhookProvider = 'generic' | 'wecom' | 'feishu_bot' | 'dingtalk'
interface Channel { id: number; name: string; type: ChannelType; config: Record<string, unknown>; enabled: boolean }
interface EventConfig { event: string; channel_ids: number[]; channel_recipients: Record<string, string[]>; channels: Channel[] }
interface Delivery { id: number; channel_name: string; channel_type: string; status: string; event: string; recipient: string; subject: string; error_message?: string; created_at: string }
interface DeliveryPage { items: Delivery[]; total: number; page?: number; page_size?: number; total_pages?: number }
interface ChannelForm { name: string; type: ChannelType; enabled: boolean; config: Record<string, unknown> }

const labels: Record<ChannelType, string> = { email: '邮箱 SMTP', resend: 'Resend', webhook: 'Webhook', feishu: '飞书应用', feishu_bot: '飞书机器人', wecom: '企业微信机器人', dingtalk: '钉钉机器人' }
const webhookProviders: Record<WebhookProvider, string> = { generic: 'Webhook', wecom: '企业微信机器人', feishu_bot: '飞书机器人', dingtalk: '钉钉机器人' }

function isWebhookChannelType(type: ChannelType): boolean {
  return type === 'webhook' || type === 'wecom' || type === 'feishu_bot' || type === 'dingtalk'
}

function webhookProviderForType(type: ChannelType): WebhookProvider {
  if (type === 'wecom') return 'wecom'
  if (type === 'feishu_bot') return 'feishu_bot'
  if (type === 'dingtalk') return 'dingtalk'
  return 'generic'
}

function defaultConfig(type: ChannelType): Record<string, unknown> {
  switch (type) {
    case 'email': return { host: '', port: 587, from: '', username: '', password: '', starttls: true }
    case 'resend': return { api_key: '', from: '' }
    case 'webhook':
    case 'wecom':
    case 'feishu_bot':
    case 'dingtalk': return { provider: webhookProviderForType(type), url: '', authorization: '', secret: '' }
    case 'feishu': return { app_id: '', app_secret: '', receive_id: '', receive_id_type: 'email' }
  }
}
function newForm(): ChannelForm { return { name: '', type: 'email', enabled: true, config: defaultConfig('email') } }
function textValue(config: Record<string, unknown>, key: string): string { const value = config[key]; return value == null ? '' : String(value) }

function webhookProviderValue(config: Record<string, unknown>): WebhookProvider {
  const value = textValue(config, 'provider')
  return value in webhookProviders ? value as WebhookProvider : 'generic'
}

function channelLabel(channel: Channel): string {
  if (isWebhookChannelType(channel.type)) return webhookProviders[channel.type === 'webhook' ? webhookProviderValue(channel.config) : webhookProviderForType(channel.type)]
  return labels[channel.type] ?? channel.type
}

function ChannelConfigFields({ form, onChange }: { form: ChannelForm; onChange: (next: ChannelForm) => void }) {
  const setValue = (key: string, value: unknown) => onChange({ ...form, config: { ...form.config, [key]: value } })
  const field = (key: string, label: string, placeholder: string, type = 'text') => <div><Label htmlFor={`notification-${key}`}>{label}</Label><Input id={`notification-${key}`} type={type} value={textValue(form.config, key)} onChange={event => setValue(key, event.target.value)} placeholder={placeholder} autoComplete={type === 'password' ? 'new-password' : 'off'} /></div>
  if (form.type === 'email') return <div className="grid gap-4 sm:grid-cols-2">
    {field('host', 'SMTP 主机', 'smtp.example.com')}
    <div><Label htmlFor="notification-port">SMTP 端口</Label><Input id="notification-port" type="number" min={1} max={65535} value={textValue(form.config, 'port')} onChange={event => setValue('port', Number(event.target.value) || 0)} /></div>
    {field('from', '发件人邮箱', 'noreply@example.com', 'email')}
    {field('username', 'SMTP 用户名（QQ 邮箱请填完整邮箱地址，留空时使用发件邮箱）', '通常与发件人相同')}
    {field('password', 'SMTP 授权码 / 密码（需要认证时必填）', 'QQ 邮箱请填写 SMTP 授权码', 'password')}
    <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={Boolean(form.config.starttls)} onChange={event => setValue('starttls', event.target.checked)} />启用 STARTTLS（587 端口；465 端口自动使用 SSL/TLS）</label>
  </div>
  if (form.type === 'resend') return <div className="space-y-4">{field('api_key', 'Resend API Key', 're_...', 'password')}{field('from', '发件人邮箱', 'noreply@example.com', 'email')}</div>
  if (isWebhookChannelType(form.type)) {
    const provider = form.type === 'webhook' ? 'generic' : webhookProviderForType(form.type)
    const providerHelp: Record<WebhookProvider, string> = {
      generic: '发送系统统一 JSON 数据，可通过 Authorization 或 X-Webhook-Secret 做接收端鉴权。',
      wecom: '企业微信机器人地址通常包含 key 参数，系统会发送 text 消息。',
      feishu_bot: '飞书机器人地址通常以 /bot/v2/hook/ 开头；填写安全设置中的签名密钥后自动签名。',
      dingtalk: '钉钉机器人地址通常包含 access_token；填写加签密钥后自动生成 timestamp 和 sign。',
    }
    return <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{providerHelp[provider]}</p>
      {field('url', 'Webhook URL', provider === 'wecom' ? 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...' : provider === 'feishu_bot' ? 'https://open.feishu.cn/open-apis/bot/v2/hook/...' : provider === 'dingtalk' ? 'https://oapi.dingtalk.com/robot/send?access_token=...' : 'https://example.com/hooks/notify', 'url')}
      {provider === 'generic' && field('authorization', 'Authorization（可选）', 'Bearer ...', 'password')}
      {provider === 'generic' ? field('secret', '请求头密钥（可选）', '用于 X-Webhook-Secret', 'password') : provider === 'wecom' ? null : field('secret', '机器人签名密钥（可选）', '按平台安全设置中的密钥填写', 'password')}
    </div>
  }
  return <div className="space-y-4">{field('app_id', '飞书 App ID', 'cli_...')}{field('app_secret', '飞书 App Secret', '••••••••', 'password')}{field('receive_id', '接收人 ID / 邮箱', '接收消息的用户或群组')}
    <div><Label>接收人类型</Label><Select value={textValue(form.config, 'receive_id_type') || 'email'} onValueChange={value => setValue('receive_id_type', value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">邮箱</SelectItem><SelectItem value="open_id">用户 open_id</SelectItem><SelectItem value="chat_id">群聊 chat_id</SelectItem></SelectContent></Select></div>
  </div>
}

export default function NotificationManagementPage() {
  const [channels, setChannels] = useState<Channel[]>([])
  const [channelForm, setChannelForm] = useState<ChannelForm>(newForm())
  const [editingID, setEditingID] = useState<number | null>(null)
  const [channelDialogOpen, setChannelDialogOpen] = useState(false)
  const [selectedIDs, setSelectedIDs] = useState<number[]>([])
  const [recipients, setRecipients] = useState<Record<string, string>>({})
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveryTotal, setDeliveryTotal] = useState(0)
  const [deliveryPage, setDeliveryPage] = useState(1)
  const [deliveryTotalPages, setDeliveryTotalPages] = useState(0)
  const [deliveryDateRange, setDeliveryDateRange] = useState({ startAt: '', endAt: '' })
  const [deliveryFilters, setDeliveryFilters] = useState({ startAt: '', endAt: '' })
  const [saving, setSaving] = useState(false)
  const [togglingID, setTogglingID] = useState<number | null>(null)
  const [testingID, setTestingID] = useState<number | null>(null)

  const load = useCallback(async (nextDeliveryPage = 1) => {
    try {
      const [channelResponse, eventResponse, deliveryResponse] = await Promise.all([
        apiClient.get<AuxEnvelope<{ items: Channel[] }>>('/admin/notifications/channels'),
        apiClient.get<AuxEnvelope<EventConfig>>('/admin/notifications/events/invoice.application.created'),
        apiClient.get<AuxEnvelope<DeliveryPage>>(`/admin/notifications/logs?page_size=10&page=${nextDeliveryPage}${deliveryFilters.startAt ? `&start_at=${encodeURIComponent(deliveryFilters.startAt)}` : ''}${deliveryFilters.endAt ? `&end_at=${encodeURIComponent(deliveryFilters.endAt)}` : ''}`),
      ])
      setChannels(channelResponse.data?.items ?? [])
      setSelectedIDs(eventResponse.data?.channel_ids ?? [])
      const configuredRecipients = eventResponse.data?.channel_recipients ?? {}
      setRecipients(Object.fromEntries(Object.entries(configuredRecipients).map(([id, values]) => [id, values.join(', ')])))
      setDeliveries(deliveryResponse.data?.items ?? [])
      setDeliveryTotal(deliveryResponse.data?.total ?? 0)
      setDeliveryPage(deliveryResponse.data?.page ?? nextDeliveryPage)
      setDeliveryTotalPages(deliveryResponse.data?.total_pages ?? 0)
    } catch (error) { console.error('[NotificationManagementPage] load failed', error); const message = error instanceof Error ? error.message : '未知错误'; toast.error(`通知配置加载失败：${message}`) }
  }, [deliveryFilters])
  useEffect(() => { void load(1) }, [load])

  const openNewChannel = () => { setEditingID(null); setChannelForm(newForm()); setChannelDialogOpen(true) }
  const editChannel = (channel: Channel) => { const formType = channel.type === 'webhook' ? (() => { const provider = webhookProviderValue(channel.config); return provider === 'wecom' ? 'wecom' : provider === 'feishu_bot' ? 'feishu_bot' : provider === 'dingtalk' ? 'dingtalk' : 'webhook' })() : channel.type; setEditingID(channel.id); setChannelForm({ name: channel.name, type: formType, enabled: channel.enabled, config: { ...defaultConfig(formType), ...channel.config } }); setChannelDialogOpen(true) }
  const saveChannel = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      const body = { name: channelForm.name, type: channelForm.type, enabled: channelForm.enabled, config: channelForm.config }
      if (editingID) await apiClient.put(`/admin/notifications/channels/${editingID}`, body)
      else await apiClient.post('/admin/notifications/channels', body)
      toast.success(editingID ? '通知渠道已更新' : '通知渠道已创建'); setChannelDialogOpen(false); setEditingID(null); setChannelForm(newForm()); await load()
    } catch (error) { console.error('[NotificationManagementPage] save failed', error); const message = error instanceof Error ? error.message : '未知错误'; toast.error(`通知渠道保存失败：${message}`) } finally { setSaving(false) }
  }
  const toggleChannel = async (channel: Channel, enabled: boolean) => {
    setTogglingID(channel.id)
    setChannels(current => current.map(item => item.id === channel.id ? { ...item, enabled } : item))
    try {
      await apiClient.put(`/admin/notifications/channels/${channel.id}`, { name: channel.name, type: channel.type, enabled, config: channel.config })
      toast.success(enabled ? `已启用「${channel.name}」` : `已停用「${channel.name}」`)
    } catch (error) {
      console.error('[NotificationManagementPage] toggle failed', error)
      setChannels(current => current.map(item => item.id === channel.id ? { ...item, enabled: channel.enabled } : item))
      toast.error('渠道状态保存失败，已恢复原状态')
    } finally { setTogglingID(null) }
  }
  const deleteChannel = async (id: number) => { if (!window.confirm('确定删除该通知渠道？')) return; try { await apiClient.del(`/admin/notifications/channels/${id}`); toast.success('通知渠道已删除'); await load() } catch { toast.error('通知渠道删除失败') } }
  const testChannel = async (channel: Channel) => {
    setTestingID(channel.id)
    try {
      await apiClient.post(`/admin/notifications/channels/${channel.id}/test`, {})
      toast.success(`已通过「${channel.name}」发送测试消息`)
    } catch (error) {
      console.error('[NotificationManagementPage] channel test failed', error)
      toast.error('测试消息发送失败，请查看系统消息通知日志')
    } finally {
      setTestingID(null)
      await load()
    }
  }
  const saveEvent = async () => { try { const channelRecipients = Object.fromEntries(selectedIDs.map(id => [String(id), (recipients[String(id)] ?? '').split(/[\s,;，；]+/).map(item => item.trim()).filter(Boolean)])); await apiClient.put('/admin/notifications/events/invoice.application.created', { channel_ids: selectedIDs, channel_recipients: channelRecipients }); toast.success('发票申请通知渠道已保存'); await load() } catch { toast.error('发票通知配置保存失败') } }
  const submitDeliveryQuery = (event: FormEvent) => {
    event.preventDefault()
    if (deliveryDateRange.startAt && deliveryDateRange.endAt && deliveryDateRange.startAt >= deliveryDateRange.endAt) {
      toast.error('开始时间必须早于结束时间')
      return
    }
    setDeliveryFilters(deliveryDateRange)
  }

  const deliveryPages = buildDeliveryPageItems(deliveryPage, deliveryTotalPages)

  return <div className="aux-admin-page space-y-6">
    <div><h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100"><Bell className="h-6 w-6" />消息通知管理</h1><p className="mt-1 text-sm text-muted-foreground">配置可复用的通知渠道，并为发票申请选择一个或多个渠道。</p></div>
    <section className="rounded-lg border bg-card p-5 shadow-sm"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-semibold">已配置渠道</h2><p className="text-xs text-muted-foreground">密钥仅在保存时提交，读取时会自动脱敏。</p></div><Button onClick={openNewChannel}><Plus className="mr-1 h-4 w-4" />新增渠道</Button></div><div className="space-y-2">{channels.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">暂未配置通知渠道</p> : channels.map(channel => <div key={channel.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"><div><p className="font-medium">{channel.name}</p><p className="text-xs text-muted-foreground">{channelLabel(channel)} · {channel.enabled ? '启用' : '停用'}</p></div><div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={channel.enabled} onCheckedChange={checked => void toggleChannel(channel, checked)} disabled={togglingID === channel.id} aria-label={`${channel.name}是否启用`} />启用</label><Button variant="outline" size="sm" onClick={() => void testChannel(channel)} disabled={testingID === channel.id} title={channel.type === 'email' || channel.type === 'resend' ? '将发送到发票申请通知中已配置的收件人' : '使用当前渠道配置发送测试消息'}><Send className="mr-1 h-3.5 w-3.5" />{testingID === channel.id ? '发送中…' : '测试渠道'}</Button><Button variant="outline" size="sm" onClick={() => editChannel(channel)}>编辑</Button><Button variant="ghost" size="icon" onClick={() => void deleteChannel(channel.id)} aria-label={`删除${channel.name}`}><Trash2 className="h-4 w-4 text-destructive" /></Button></div></div>)}</div></section>
    <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editingID ? '编辑通知渠道' : '新增通知渠道'}</DialogTitle><DialogDescription>按渠道类型填写发送端信息。邮箱和 Resend 的收件人请在业务通知中配置。</DialogDescription></DialogHeader><form onSubmit={event => void saveChannel(event)} className="space-y-5"><div><Label htmlFor="notification-name">渠道名称</Label><Input id="notification-name" value={channelForm.name} onChange={event => setChannelForm({ ...channelForm, name: event.target.value })} placeholder="财务通知邮箱" required /></div><div><Label>渠道类型</Label><Select value={channelForm.type} onValueChange={(value: ChannelType) => setChannelForm({ ...channelForm, type: value, config: defaultConfig(value) })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(labels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div><ChannelConfigFields form={channelForm} onChange={setChannelForm} /><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={channelForm.enabled} onChange={event => setChannelForm({ ...channelForm, enabled: event.target.checked })} />启用渠道</label><DialogFooter><Button type="button" variant="outline" onClick={() => setChannelDialogOpen(false)}>取消</Button><Button type="submit" disabled={saving}><Save className="mr-2 h-4 w-4" />{saving ? '保存中…' : '保存渠道'}</Button></DialogFooter></form></DialogContent></Dialog>
    <section className="rounded-lg border bg-card p-5 shadow-sm"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-lg font-semibold">发票申请通知</h2><p className="text-xs text-muted-foreground">用户提交发票申请后，将按勾选渠道发送；支持多选。邮箱和 Resend 的收件人填写在这里。</p></div><Button onClick={() => void saveEvent()}><Save className="mr-2 h-4 w-4" />保存事件配置</Button></div>{channels.length === 0 ? <p className="rounded-md bg-muted p-4 text-sm text-muted-foreground">尚未配置渠道。用户申请仍会生成发送失败记录，并注明未配置原因。</p> : <div className="grid gap-3 sm:grid-cols-2">{channels.map(channel => <div key={channel.id} className={`rounded-md border p-3 text-sm ${selectedIDs.includes(channel.id) ? 'border-primary bg-primary/5' : ''}`}><label className="flex cursor-pointer items-center gap-2"><input type="checkbox" checked={selectedIDs.includes(channel.id)} onChange={event => setSelectedIDs(event.target.checked ? [...selectedIDs, channel.id] : selectedIDs.filter(id => id !== channel.id))} /><span>{channel.name}</span><span className="ml-auto text-xs text-muted-foreground">{channelLabel(channel)}{!channel.enabled && ' · 已停用'}</span></label>{selectedIDs.includes(channel.id) && (channel.type === 'email' || channel.type === 'resend') && <Input className="mt-2" value={recipients[String(channel.id)] ?? ''} onChange={event => setRecipients({ ...recipients, [String(channel.id)]: event.target.value })} placeholder="收件人邮箱，多个用逗号、分号或空格分隔" aria-label={`${channel.name}收件人邮箱`} />}</div>)}</div>}</section>
    <section className="rounded-lg border bg-card p-5 shadow-sm"><div className="mb-3 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">系统消息通知日志</h2><p className="text-xs text-muted-foreground">系统消息通知发送记录，共 {deliveryTotal} 条日志</p></div><form className="flex flex-wrap items-end gap-2" onSubmit={submitDeliveryQuery}><NotificationDateTimeRangePicker value={deliveryDateRange} onChange={setDeliveryDateRange} /><Button type="submit" variant="outline" size="sm">查询</Button><Button type="button" variant="ghost" size="sm" onClick={() => { setDeliveryDateRange({ startAt: '', endAt: '' }); setDeliveryFilters({ startAt: '', endAt: '' }) }}>清除</Button></form></div><div className="overflow-auto"><table className="w-full min-w-[1080px] table-fixed text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="w-[150px] p-2">时间</th><th className="w-[220px] p-2">事件</th><th className="w-[140px] p-2">渠道</th><th className="w-[100px] p-2">状态</th><th className="w-[220px] p-2">收件人</th><th className="w-[320px] p-2">错误信息</th></tr></thead><tbody>{deliveries.map(item => <tr key={item.id} className="border-b last:border-0"><td className="whitespace-nowrap p-2">{new Date(item.created_at).toLocaleString()}</td><td className="truncate p-2 font-mono text-xs" title={item.event || undefined}>{item.event || '-'}</td><td className="truncate p-2" title={item.channel_name || undefined}>{item.channel_name || '未配置渠道'}</td><td className={`p-2 font-medium ${item.status === 'SENT' ? 'text-emerald-600' : 'text-destructive'}`}>{item.status === 'SENT' ? '发送成功' : '发送失败'}</td><td className="w-[220px] max-w-[220px] p-2"><div className="truncate" title={item.recipient || undefined}>{item.recipient || '-'}</div></td><td className="w-[320px] max-w-[320px] p-2 text-xs text-muted-foreground"><div className="truncate" title={item.error_message || undefined}>{item.error_message || '-'}</div></td></tr>)}</tbody></table>{deliveries.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无系统消息通知日志</p>}</div><div className="mt-4 flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-muted-foreground">第 {deliveryPage} / {deliveryTotalPages || 1} 页 · 共 {deliveryTotal} 条</span>{deliveryTotalPages > 0 && <Pagination className="mx-0 w-auto justify-end"><PaginationContent><PaginationItem><PaginationPrevious href="#" aria-disabled={deliveryPage <= 1} className={deliveryPage <= 1 ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (deliveryPage > 1) void load(deliveryPage - 1) }} /></PaginationItem>{deliveryPages.map((item, index) => item === 'ellipsis' ? <PaginationItem key={`ellipsis-${index}`}><PaginationEllipsis /></PaginationItem> : <PaginationItem key={item}><PaginationLink href="#" isActive={item === deliveryPage} onClick={event => { event.preventDefault(); if (item !== deliveryPage) void load(item) }}>{item}</PaginationLink></PaginationItem>)}<PaginationItem><PaginationNext href="#" aria-disabled={deliveryPage >= deliveryTotalPages} className={deliveryPage >= deliveryTotalPages ? 'pointer-events-none opacity-50' : undefined} onClick={event => { event.preventDefault(); if (deliveryPage < deliveryTotalPages) void load(deliveryPage + 1) }} /></PaginationItem></PaginationContent></Pagination>}</div></section>
  </div>
}

type NotificationDateTimeRangeValue = { startAt: string; endAt: string }

function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return undefined
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : undefined
}

function localDateString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function datePart(value: string): string { return value.slice(0, 10) }
function timePart(value: string, fallback: string): string { return /^\d{2}:\d{2}/.test(value.slice(11, 16)) ? value.slice(11, 16) : fallback }

const notificationTimeOptions = Array.from({ length: 24 * 12 }, (_, index) => {
  const hour = String(Math.floor(index / 12)).padStart(2, '0')
  const minute = String((index % 12) * 5).padStart(2, '0')
  return `${hour}:${minute}`
})

function notificationTimeOptionsFor(value: string): string[] {
  return notificationTimeOptions.includes(value) ? notificationTimeOptions : [value, ...notificationTimeOptions]
}

function compactDateTime(value: string, fallbackTime: string): string {
  const date = datePart(value)
  if (!date) return '未选择'
  return `${date.slice(5).replace('-', '/')} ${timePart(value, fallbackTime)}`
}

function NotificationDateTimeRangePicker({ value, onChange }: { value: NotificationDateTimeRangeValue; onChange: (value: NotificationDateTimeRangeValue) => void }) {
  const [open, setOpen] = useState(false)
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(() => ({ from: parseLocalDate(datePart(value.startAt)), to: parseLocalDate(datePart(value.endAt)) }))

  useEffect(() => {
    if (!open) setCalendarRange({ from: parseLocalDate(datePart(value.startAt)), to: parseLocalDate(datePart(value.endAt)) })
  }, [open, value.startAt, value.endAt])

  const startDate = datePart(value.startAt)
  const endDate = datePart(value.endAt)
  const startTime = timePart(value.startAt, '00:00')
  const endTime = timePart(value.endAt, '23:59')
  const summary = startDate && endDate ? `${compactDateTime(value.startAt, '00:00')} → ${compactDateTime(value.endAt, '23:59')}` : startDate ? `${compactDateTime(value.startAt, '00:00')} 起` : endDate ? `截至 ${compactDateTime(value.endAt, '23:59')}` : '选择日期时间范围'

  const handleCalendarSelect = (next: DateRange | undefined) => {
    setCalendarRange(next)
    if (!next?.from) {
      onChange({ startAt: '', endAt: '' })
      return
    }
    const from = next.from
    const to = next.to
    onChange({
      startAt: `${localDateString(from)}T${startTime}`,
      endAt: to ? `${localDateString(to)}T${endTime}` : '',
    })
  }

  const handleTimeChange = (key: 'startAt' | 'endAt', next: string) => {
    if (key === 'startAt' && startDate) onChange({ ...value, startAt: `${startDate}T${next}` })
    if (key === 'endAt' && endDate) onChange({ ...value, endAt: `${endDate}T${next}` })
  }

  return <div className="grid min-w-0 gap-1"><Label className="text-xs">日期时间范围</Label><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" aria-expanded={open} className="h-9 w-[190px] max-w-full justify-start gap-1.5 px-2.5 font-normal text-xs sm:w-[220px]"><CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-left">{summary}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></Button></PopoverTrigger><PopoverContent align="start" sideOffset={8} collisionPadding={8} className="max-h-[var(--radix-popover-content-available-height)] w-auto max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain p-0"><Calendar mode="range" selected={calendarRange} onSelect={handleCalendarSelect} numberOfMonths={1} locale={zhCN} autoFocus /><div className="grid grid-cols-2 gap-2 border-t px-3 py-2"><div><Label htmlFor="notification-start-time" className="text-[11px]">开始时间</Label><Select value={startTime} onValueChange={next => handleTimeChange('startAt', next)} disabled={!startDate}><SelectTrigger id="notification-start-time" className="mt-1 h-8 text-xs"><SelectValue placeholder="00:00" /></SelectTrigger><SelectContent>{notificationTimeOptionsFor(startTime).map(time => <SelectItem key={`start-${time}`} value={time}>{time}</SelectItem>)}</SelectContent></Select></div><div><Label htmlFor="notification-end-time" className="text-[11px]">结束时间</Label><Select value={endTime} onValueChange={next => handleTimeChange('endAt', next)} disabled={!endDate}><SelectTrigger id="notification-end-time" className="mt-1 h-8 text-xs"><SelectValue placeholder="23:59" /></SelectTrigger><SelectContent>{notificationTimeOptionsFor(endTime).map(time => <SelectItem key={`end-${time}`} value={time}>{time}</SelectItem>)}</SelectContent></Select></div></div></PopoverContent></Popover></div>
}

type DeliveryPageItem = number | 'ellipsis'

function buildDeliveryPageItems(current: number, total: number): DeliveryPageItem[] {
  if (total <= 0) return []
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1)
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis', total]
  if (current >= total - 3) return [1, 'ellipsis', total - 4, total - 3, total - 2, total - 1, total]
  return [1, 'ellipsis', current - 1, current, current + 1, 'ellipsis', total]
}
