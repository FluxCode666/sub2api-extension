import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Download, FilePlus2, FileUp, Loader2, Search, Settings2, X } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { zhCN } from 'date-fns/locale'
import { apiClient, AuxApiError, type AuxEnvelope } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Calendar } from '@/components/ui/calendar'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { downloadInvoiceFile, formatDate, formatMoney, invoiceStatusClass, invoiceStatusLabel, type InvoiceRequest, type InvoiceStatus } from '@/lib/invoices'

interface FeatureResponse { enabled: boolean; publish_available: boolean }
interface ItemsResponse { items: InvoiceRequest[]; total: number; page: number; page_size: number; total_pages: number }
interface InvoiceUser { id: number; email: string; username?: string }
interface UserItemsResponse { items: InvoiceUser[] }
interface InvoiceFilters { keyword: string; startDate: string; endDate: string; status: '' | InvoiceStatus; userId: number | null }
type InvoiceFilterOverrides = Partial<Pick<InvoiceFilters, 'startDate' | 'endDate' | 'status' | 'userId'>>
const statuses: Array<{ value: '' | InvoiceStatus; label: string }> = [{ value: '', label: '全部状态' }, { value: 'PENDING', label: '待处理' }, { value: 'PROCESSING', label: '开票中' }, { value: 'ISSUED', label: '已开具' }, { value: 'REJECTED', label: '已驳回' }]
const PAGE_SIZE = 20

export default function InvoiceManagementPage() {
  const [enabled, setEnabled] = useState(false)
  const [publishAvailable, setPublishAvailable] = useState(false)
  const [items, setItems] = useState<InvoiceRequest[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [keyword, setKeyword] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [status, setStatus] = useState<'' | InvoiceStatus>('')
  const [userSearch, setUserSearch] = useState('')
  const [userOptions, setUserOptions] = useState<InvoiceUser[]>([])
  const [selectedUser, setSelectedUser] = useState<InvoiceUser | null>(null)
  const [filters, setFilters] = useState<InvoiceFilters>({ keyword: '', startDate: '', endDate: '', status: '', userId: null })
  const [loading, setLoading] = useState(true)
  const [savingFeature, setSavingFeature] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<InvoiceRequest | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const requestSequence = useRef(0)

  const load = useCallback(async (nextPage: number, isRefresh = false) => {
    const sequence = ++requestSequence.current
    if (!isRefresh) setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(nextPage), page_size: String(PAGE_SIZE) })
      if (filters.keyword) params.set('keyword', filters.keyword)
      if (filters.startDate) params.set('start_date', filters.startDate)
      if (filters.endDate) params.set('end_date', filters.endDate)
      if (filters.status) params.set('status', filters.status)
      if (filters.userId) params.set('user_id', String(filters.userId))
      const [config, requests] = await Promise.all([
        apiClient.get<AuxEnvelope<FeatureResponse>>('/admin/invoices/config'),
        apiClient.get<AuxEnvelope<ItemsResponse>>(`/admin/invoices?${params.toString()}`),
      ])
      if (sequence !== requestSequence.current) return
      setEnabled(config.data?.enabled === true)
      setPublishAvailable(config.data?.publish_available === true)
      setItems(requests.data?.items ?? [])
      setTotal(requests.data?.total ?? requests.data?.items?.length ?? 0)
      setPage(requests.data?.page || nextPage)
      setTotalPages(requests.data?.total_pages ?? 0)
    } catch (caught) {
      if (sequence !== requestSequence.current) return
      setError(invoiceLoadErrorMessage(caught))
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false)
      }
    }
  }, [filters])
  useEffect(() => { void load(1) }, [load])

  useEffect(() => {
    const email = userSearch.trim()
    if (email.length < 2 || selectedUser?.email === email) {
      setUserOptions([])
      return
    }
    const timer = window.setTimeout(() => {
      void apiClient.get<AuxEnvelope<UserItemsResponse>>(`/admin/invoices/users?email=${encodeURIComponent(email)}&page_size=20`)
        .then((response) => setUserOptions(response.data?.items ?? []))
        .catch((caught) => { console.error('[InvoiceManagementPage] failed to search users', caught); setUserOptions([]) })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [selectedUser?.email, userSearch])

  const applyDraftFilters = (overrides: InvoiceFilterOverrides = {}) => {
    const nextFilters: InvoiceFilters = { keyword: keyword.trim(), startDate, endDate, status, userId: selectedUser?.id ?? null, ...overrides }
    if (nextFilters.startDate && nextFilters.endDate && nextFilters.startDate > nextFilters.endDate) {
      setError('开始日期不能晚于结束日期。')
      return
    }
    setFilters(nextFilters)
  }

  const submitFilters = (event: FormEvent) => {
    event.preventDefault()
    applyDraftFilters()
  }

  const toggleFeature = async (next: boolean) => {
    setSavingFeature(true)
    try {
      const response = await apiClient.put<AuxEnvelope<{ enabled: boolean; published: boolean }>>('/admin/invoices/config', { enabled: next })
      setEnabled(response.data?.enabled === true)
      if (response.reason) toast.warning(response.reason)
      else if (next && response.data?.published === false) toast.warning('设置已保存，但未能同步到 Sub2API 菜单，请检查公开地址和数据库配置')
      else toast.success(next ? '发票入口已开启并同步到 Sub2API 菜单' : '发票入口已关闭并从 Sub2API 菜单移除')
    } catch (error) { console.error('[InvoiceManagementPage] failed to toggle feature', error); toast.error('发票入口设置保存失败')
    } finally { setSavingFeature(false) }
  }

  return <div className="aux-admin-page space-y-6">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">发票管理</h1><p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">审核企业客户的充值开票申请，手动开票后上传 PDF 或图片，用户即可在 Sub2API 内下载。</p></div><Button onClick={() => setManualOpen(true)}><FilePlus2 className="mr-2 h-4 w-4" />手动录入</Button></div>
    <section className="flex flex-col gap-4 rounded-xl border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><div className="rounded-lg bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><Settings2 className="h-5 w-5" /></div><div><h2 className="font-semibold text-gray-900 dark:text-gray-100">Sub2API 用户端入口</h2><p className="mt-1 max-w-2xl text-sm text-gray-500 dark:text-gray-400">开启后会在 Sub2API 自定义菜单中上架“发票管理” iframe 页面；关闭后用户端接口也会停止受理新申请。</p>{!publishAvailable && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">未配置 Sub2API 数据库或扩展公网地址，设置可以保存，但无法自动同步菜单。</p>}</div></div><div className="flex items-center gap-3"><span className="text-sm font-medium">{enabled ? '已上架' : '未上架'}</span><Switch checked={enabled} disabled={savingFeature} onCheckedChange={(value) => void toggleFeature(value)} aria-label="切换发票用户端入口" /></div></section>
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
    <InvoiceFiltersForm keyword={keyword} startDate={startDate} endDate={endDate} status={status} userSearch={userSearch} userOptions={userOptions} selectedUser={selectedUser} onKeywordChange={setKeyword} onStartDateChange={setStartDate} onEndDateChange={setEndDate} onStatusChange={(value) => { setStatus(value); applyDraftFilters({ status: value }) }} onUserSearchChange={(value) => { setUserSearch(value); setSelectedUser(null) }} onUserSelect={(user) => { setSelectedUser(user); setUserSearch(user.email); setUserOptions([]); applyDraftFilters({ userId: user.id }) }} onClearUser={() => { setSelectedUser(null); setUserSearch(''); setUserOptions([]); applyDraftFilters({ userId: null }) }} onApplyFilters={applyDraftFilters} onSubmit={submitFilters} />
    <section className="overflow-hidden rounded-xl border bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950"><div className="border-b p-5 dark:border-gray-800"><h2 className="font-semibold">开票申请</h2><p className="mt-1 text-sm text-gray-500">共 {total} 条当前筛选结果</p></div>{loading ? <div className="flex min-h-64 items-center justify-center text-sm text-gray-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" />正在加载申请…</div> : items.length === 0 ? <div className="min-h-64 p-10 text-center text-sm text-gray-500">暂时没有符合条件的开票申请。</div> : <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/60 dark:text-gray-400"><tr><th className="px-5 py-3">申请 / 用户</th><th className="px-4 py-3">开票资料</th><th className="px-4 py-3">订单 / 金额</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">申请时间</th><th className="px-5 py-3 text-right">操作</th></tr></thead><tbody className="divide-y dark:divide-gray-800">{items.map((request) => <tr key={request.id} className="align-top hover:bg-gray-50/80 dark:hover:bg-gray-900/45"><td className="px-5 py-4"><p className="font-medium">#{request.id} {request.user_name || '—'}</p><p className="mt-1 text-xs text-gray-500">{request.user_email}</p></td><td className="px-4 py-4"><p className="font-medium">{request.invoice_title}</p><p className="mt-1 font-mono text-xs text-gray-500">{request.taxpayer_id}</p></td><td className="px-4 py-4"><p className="font-medium">{formatMoney(request.amount)}</p><p className="mt-1 text-xs text-gray-500">{request.orders.length ? `${request.orders.length} 笔充值订单` : '线下转账，无订单'}</p></td><td className="px-4 py-4"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${invoiceStatusClass(request.status)}`}>{invoiceStatusLabel(request.status)}</span>{request.document_available && <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">已上传：{request.document_name}</p>}</td><td className="px-4 py-4 text-xs text-gray-500">{formatDate(request.created_at)}</td><td className="px-5 py-4 text-right"><Button size="sm" variant="outline" onClick={() => setSelected(request)}>处理</Button></td></tr>)}</tbody></table></div>}</section>
    <div className="flex items-center justify-between rounded-xl border bg-white px-5 py-3 text-xs text-gray-500 shadow-sm dark:border-gray-800 dark:bg-gray-950"><span>共 {total} 条 · 第 {page} / {Math.max(1, totalPages)} 页</span><div className="flex items-center gap-2"><Button type="button" size="sm" variant="outline" aria-label="上一页" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button type="button" size="sm" variant="outline" aria-label="下一页" disabled={totalPages === 0 || page >= totalPages || loading} onClick={() => void load(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
    {selected && <InvoiceDetail request={selected} onClose={() => setSelected(null)} onChanged={(updated) => { setSelected(updated); setItems((current) => current.map((item) => item.id === updated.id ? updated : item)) }} />}
    <ManualInvoiceDialog open={manualOpen} onOpenChange={setManualOpen} onCreated={() => { setManualOpen(false); toast.success('线下开票记录已创建'); void load(page, true) }} />
  </div>
}

interface InvoiceFiltersFormProps {
  keyword: string
  startDate: string
  endDate: string
  status: '' | InvoiceStatus
  userSearch: string
  userOptions: InvoiceUser[]
  selectedUser: InvoiceUser | null
  onKeywordChange: (value: string) => void
  onStartDateChange: (value: string) => void
  onEndDateChange: (value: string) => void
  onStatusChange: (value: '' | InvoiceStatus) => void
  onUserSearchChange: (value: string) => void
  onUserSelect: (user: InvoiceUser) => void
  onClearUser: () => void
  onApplyFilters: (overrides?: InvoiceFilterOverrides) => void
  onSubmit: (event: FormEvent) => void
}

function InvoiceFiltersForm(props: InvoiceFiltersFormProps) {
  return <form onSubmit={props.onSubmit} className="grid gap-3 rounded-xl border bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950 md:grid-cols-2 xl:grid-cols-6">
    <div className="relative xl:col-span-3"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><Input aria-label="按企业名称或税号搜索" value={props.keyword} onChange={(event) => props.onKeywordChange(event.target.value)} placeholder="企业名称或税号模糊搜索" className="pl-9" /></div>
    <DateRangeFilter startDate={props.startDate} endDate={props.endDate} onStartDateChange={props.onStartDateChange} onEndDateChange={props.onEndDateChange} onApply={props.onApplyFilters} />
    <Select value={props.status || '__ALL__'} onValueChange={(value) => props.onStatusChange(value === '__ALL__' ? '' : value as InvoiceStatus)}>
      <SelectTrigger aria-label="按状态筛选"><SelectValue placeholder="全部状态" /></SelectTrigger>
      <SelectContent>{statuses.map((option) => <SelectItem key={option.value || '__ALL__'} value={option.value || '__ALL__'}>{option.label}</SelectItem>)}</SelectContent>
    </Select>
    <div className="md:col-span-2 xl:col-span-3">
      <InvoiceUserCombobox selectedUser={props.selectedUser} searchValue={props.userSearch} userOptions={props.userOptions} onSearchChange={props.onUserSearchChange} onSelect={props.onUserSelect} onClear={props.onClearUser} placeholder="按 Sub2API 用户邮箱搜索" />
    </div>
    <div className="flex items-center gap-2 md:col-span-2 xl:col-span-3"><Button type="submit"><Search className="mr-2 h-4 w-4" />筛选</Button>{props.selectedUser && <span className="truncate text-xs text-gray-500">已选择：{props.selectedUser.email}</span>}</div>
  </form>
}

function DateRangeFilter({ startDate, endDate, onStartDateChange, onEndDateChange, onApply }: { startDate: string; endDate: string; onStartDateChange: (value: string) => void; onEndDateChange: (value: string) => void; onApply: (overrides?: InvoiceFilterOverrides) => void }) {
  const [open, setOpen] = useState(false)
  const selected: DateRange | undefined = startDate || endDate ? { from: parseLocalDate(startDate), to: parseLocalDate(endDate) } : undefined
  const summary = startDate && endDate ? `${startDate} 至 ${endDate}` : startDate ? `${startDate} 起` : endDate ? `截至 ${endDate}` : '选择申请日期范围'
  return <div className="xl:col-span-2">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-start font-normal"><CalendarDays className="mr-2 h-4 w-4 text-muted-foreground" /><span className="truncate">{summary}</span></Button></PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} collisionPadding={12} className="invoice-date-range-popover">
        <Calendar className="invoice-date-range-calendar" mode="range" selected={selected} onSelect={(next) => { const nextStart = next?.from ? localDateString(next.from) : ''; const nextEnd = next?.to ? localDateString(next.to) : ''; onStartDateChange(nextStart); onEndDateChange(nextEnd); if (nextStart && nextEnd) { setOpen(false); onApply({ startDate: nextStart, endDate: nextEnd }) } }} numberOfMonths={1} locale={zhCN} autoFocus />
        <div className="invoice-date-range-footer"><span className="text-xs text-muted-foreground"><Check className="mr-1 inline h-3.5 w-3.5" />{summary}</span><Button type="button" size="sm" variant="ghost" onClick={() => { onStartDateChange(''); onEndDateChange(''); setOpen(false); onApply({ startDate: '', endDate: '' }) }}>清除</Button></div>
      </PopoverContent>
    </Popover>
  </div>
}

function InvoiceUserCombobox({ selectedUser, searchValue, userOptions, onSearchChange, onSelect, onClear, placeholder }: { selectedUser: InvoiceUser | null; searchValue: string; userOptions: InvoiceUser[]; onSearchChange: (value: string) => void; onSelect: (user: InvoiceUser) => void; onClear: () => void; placeholder: string }) {
  const [open, setOpen] = useState(false)
  return <Command shouldFilter={false} loop className="contents">
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative w-full">
          <CommandInput
            value={searchValue}
            onValueChange={(value) => { onSearchChange(value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-expanded={open}
            role="combobox"
            wrapperClassName="relative h-auto w-full border-0 p-0"
            iconClassName="pointer-events-none absolute left-3 top-1/2 mr-0 -translate-y-1/2"
            className="h-10 rounded-md border border-input bg-background px-3 py-2 pl-9 pr-9 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchValue && <button type="button" aria-label="清空用户搜索" className="absolute right-2 top-1/2 z-10 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" onMouseDown={(event) => event.preventDefault()} onClick={() => { onClear(); setOpen(false) }}><X className="h-4 w-4" /></button>}
        </div>
      </PopoverAnchor>
      <PopoverContent align="start" sideOffset={4} onOpenAutoFocus={(event) => event.preventDefault()} className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
        <CommandList>
          <CommandEmpty>{selectedUser?.email === searchValue.trim() ? '已选择该用户' : searchValue.trim().length < 2 ? '输入至少 2 个字符搜索用户' : '没有找到匹配用户'}</CommandEmpty>
          {userOptions.length > 0 && <CommandGroup>{userOptions.map((user) => <CommandItem key={user.id} value={user.email} onMouseDown={(event) => event.preventDefault()} onSelect={() => { onSelect(user); setOpen(false) }}><span className="flex min-w-0 flex-1 flex-col"><span className="truncate">{user.email}</span><span className="truncate text-xs text-muted-foreground">{user.username || `#${user.id}`}</span></span><Check className={`ml-3 h-4 w-4 shrink-0 ${selectedUser?.id === user.id ? 'opacity-100' : 'opacity-0'}`} /></CommandItem>)}</CommandGroup>}
        </CommandList>
      </PopoverContent>
    </Popover>
  </Command>
}

function parseLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function localDateString(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

interface ManualInvoiceForm {
  invoiceTitle: string
  taxpayerId: string
  contactEmail: string
  contactPhone: string
  registeredAddress: string
  bankName: string
  bankAccount: string
  remark: string
  amount: string
  status: InvoiceStatus
  adminNote: string
}

function ManualInvoiceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (request: InvoiceRequest) => void }) {
  const [userSearch, setUserSearch] = useState('')
  const [userOptions, setUserOptions] = useState<InvoiceUser[]>([])
  const [selectedUser, setSelectedUser] = useState<InvoiceUser | null>(null)
  const [form, setForm] = useState<ManualInvoiceForm>({ invoiceTitle: '', taxpayerId: '', contactEmail: '', contactPhone: '', registeredAddress: '', bankName: '', bankAccount: '', remark: '', amount: '', status: 'PENDING', adminNote: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setError(''); setSelectedUser(null); setUserSearch(''); setUserOptions([])
    setForm({ invoiceTitle: '', taxpayerId: '', contactEmail: '', contactPhone: '', registeredAddress: '', bankName: '', bankAccount: '', remark: '', amount: '', status: 'PENDING', adminNote: '' })
  }, [open])
  useEffect(() => {
    const value = userSearch.trim()
    if (!open || value.length < 2 || selectedUser?.email === value) { setUserOptions([]); return }
    const timer = window.setTimeout(() => { void apiClient.get<AuxEnvelope<UserItemsResponse>>(`/admin/invoices/users?email=${encodeURIComponent(value)}&page_size=20`).then((response) => setUserOptions(response.data?.items ?? [])).catch(() => setUserOptions([])) }, 250)
    return () => window.clearTimeout(timer)
  }, [open, selectedUser?.email, userSearch])
  const update = (key: keyof ManualInvoiceForm, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('')
    if (!selectedUser) { setError('请选择一个 Sub2API 用户。'); return }
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) { setError('请输入大于 0 的有效金额。'); return }
    setSaving(true)
    try {
      const result = await apiClient.post<AuxEnvelope<InvoiceRequest>>('/admin/invoices/manual', { user_id: selectedUser.id, invoice_title: form.invoiceTitle, taxpayer_id: form.taxpayerId, contact_email: form.contactEmail, contact_phone: form.contactPhone, registered_address: form.registeredAddress, bank_name: form.bankName, bank_account: form.bankAccount, remark: form.remark, amount, status: form.status, admin_note: form.adminNote })
      if (!result.data) throw new Error('empty response')
      onCreated(result.data)
    } catch (caught) {
      console.error('[ManualInvoiceDialog] failed to create invoice', caught)
      setError(caught instanceof AuxApiError ? (caught.status === 503 ? 'Sub2API 用户数据暂不可用，请检查连接。' : caught.message) : '手动录入失败，请检查表单和服务状态。')
    } finally { setSaving(false) }
  }
  const field = (key: keyof ManualInvoiceForm, label: string, placeholder: string, required = false, type = 'text') => <div><Label htmlFor={`manual-${key}`} className="mb-1.5 block">{label}{required && <span className="text-destructive"> *</span>}</Label><Input id={`manual-${key}`} type={type} value={form[key]} required={required} onChange={(event) => update(key, event.target.value)} placeholder={placeholder} step={type === 'number' ? '0.01' : undefined} min={type === 'number' ? '0.01' : undefined} /></div>
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>手动录入开票记录</DialogTitle><DialogDescription>用于线下对公转账等没有站内订单的场景。记录会保存为该用户的开票申请，可继续上传发票文件。</DialogDescription></DialogHeader><form onSubmit={submit} className="space-y-5"><div><Label className="mb-1.5 block">Sub2API 用户<span className="text-destructive"> *</span></Label><InvoiceUserCombobox selectedUser={selectedUser} searchValue={userSearch} userOptions={userOptions} onSearchChange={(value) => { setUserSearch(value); setSelectedUser(null) }} onSelect={(user) => { setSelectedUser(user); setUserSearch(user.email); if (!form.contactEmail) update('contactEmail', user.email) }} onClear={() => { setSelectedUser(null); setUserSearch(''); setUserOptions([]) }} placeholder="搜索并选择用户邮箱" /></div><div className="grid gap-4 sm:grid-cols-2">{field('invoiceTitle', '发票抬头', '企业名称', true)}{field('taxpayerId', '纳税人识别号', '统一社会信用代码', true)}{field('contactEmail', '收票邮箱', 'finance@example.com', true)}{field('amount', '线下转账金额', '0.00', true, 'number')}{field('contactPhone', '联系电话', '可选')}{field('bankName', '开户行', '可选')}{field('bankAccount', '银行账号', '可选')}<div><Label htmlFor="manual-status" className="mb-1.5 block">初始状态</Label><Select value={form.status} onValueChange={(value) => update('status', value)}><SelectTrigger id="manual-status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PENDING">待处理</SelectItem><SelectItem value="PROCESSING">开票中</SelectItem><SelectItem value="REJECTED">已驳回</SelectItem></SelectContent></Select></div></div>{field('registeredAddress', '注册地址', '可选')}<div><Label htmlFor="manual-remark" className="mb-1.5 block">线下转账备注</Label><Textarea id="manual-remark" value={form.remark} onChange={(event) => update('remark', event.target.value)} rows={3} maxLength={2000} placeholder="例如：转账日期、银行流水号或凭证说明" /></div><div><Label htmlFor="manual-adminNote" className="mb-1.5 block">管理员备注</Label><Textarea id="manual-adminNote" value={form.adminNote} onChange={(event) => update('adminNote', event.target.value)} rows={2} maxLength={2000} placeholder="仅供管理员处理时参考" /></div>{error && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />}{saving ? '保存中…' : '创建开票记录'}</Button></DialogFooter></form></DialogContent></Dialog>
}

function invoiceLoadErrorMessage(error: unknown): string {
  if (error instanceof AuxApiError) {
    if (error.status === 401) {
      return '管理员会话已失效，请重新从 Sub2API 管理菜单打开，或重新登录。'
    }
    if (error.status === 503) {
      return '发票服务暂不可用，请检查数据库连接和 Sub2API 数据库配置。'
    }
    if (error.status >= 500) {
      return '发票数据表尚未完成迁移，请先运行 make -C backend migrate 后重启服务。'
    }
  }
  return '发票数据加载失败，请检查管理员会话、数据库连接和迁移状态。'
}

function InvoiceDetail({ request, onClose, onChanged }: { request: InvoiceRequest; onClose: () => void; onChanged: (request: InvoiceRequest) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<InvoiceStatus>(request.status)
  const [note, setNote] = useState(request.admin_note ?? '')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const updateStatus = async () => { setSaving(true); setError(''); try { const result = await apiClient.put<AuxEnvelope<InvoiceRequest>>(`/admin/invoices/${request.id}/status`, { status, admin_note: note }); if (result.data) { onChanged(result.data); toast.success('处理状态已保存') } } catch (error) { console.error('[InvoiceDetail] failed to update status', error); setError('状态保存失败。已开具状态需通过上传发票文件完成。') } finally { setSaving(false) } }
  const upload = async (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 20 * 1024 * 1024) { setError('文件不能超过 20MB。'); return }; setUploading(true); setError(''); try { const form = new FormData(); form.append('file', file); const result = await apiClient.upload<AuxEnvelope<InvoiceRequest>>(`/admin/invoices/${request.id}/document`, form, { timeout: 60_000 }); if (result.data) { onChanged(result.data); setStatus('ISSUED'); toast.success('发票已上传，用户现在可以下载') } } catch (error) { console.error('[InvoiceDetail] failed to upload document', error); setError('上传失败，只支持 PDF、PNG 或 JPEG，且文件不能超过 20MB。') } finally { setUploading(false); if (inputRef.current) inputRef.current.value = '' } }
  const download = async () => { setError(''); try { await downloadInvoiceFile(`/api/aux/admin/invoices/${request.id}/document`) } catch (caught) { console.error('[InvoiceDetail] failed to download document', caught); setError(caught instanceof Error ? caught.message : '下载失败') } }
  return <div className="fixed inset-0 z-50 overflow-y-auto bg-black/45 p-4"><div className="mx-auto my-8 max-w-3xl rounded-2xl bg-white shadow-2xl dark:bg-gray-950"><div className="flex items-start justify-between border-b p-6 dark:border-gray-800"><div><p className="text-sm text-gray-500">开票申请 #{request.id}</p><h2 className="mt-1 text-xl font-semibold">{request.invoice_title}</h2></div><Button variant="ghost" size="sm" onClick={onClose}>关闭</Button></div><div className="space-y-6 p-6">{error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>}<div className="grid gap-4 rounded-xl bg-gray-50 p-4 text-sm dark:bg-gray-900/70 sm:grid-cols-2"><Info label="客户" value={`${request.user_name || '—'} · ${request.user_email || '—'}`} /><Info label="申请金额" value={formatMoney(request.amount)} /><Info label="纳税人识别号" value={request.taxpayer_id} /><Info label="收票邮箱" value={request.contact_email} /><Info label="电话" value={request.contact_phone || '—'} /><Info label="注册地址" value={request.registered_address || '—'} /><Info label="开户行" value={request.bank_name || '—'} /><Info label="银行账号" value={request.bank_account || '—'} /></div>{request.remark && <div className="rounded-xl border p-4 text-sm dark:border-gray-800"><p className="text-xs text-gray-500">用户备注</p><p className="mt-1 whitespace-pre-wrap">{request.remark}</p></div>}<div><h3 className="mb-3 font-medium">关联充值订单</h3><div className="overflow-x-auto rounded-xl border dark:border-gray-800"><table className="w-full min-w-[580px] text-sm"><thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900"><tr><th className="px-4 py-3 text-left">订单号</th><th className="px-4 py-3 text-left">支付时间</th><th className="px-4 py-3 text-right">金额</th></tr></thead><tbody className="divide-y dark:divide-gray-800">{request.orders.length > 0 ? request.orders.map((order) => <tr key={order.payment_order_id}><td className="px-4 py-3 font-mono text-xs">{order.out_trade_no || `#${order.payment_order_id}`}</td><td className="px-4 py-3 text-gray-500">{formatDate(order.paid_at)}</td><td className="px-4 py-3 text-right font-medium">{formatMoney(order.amount)}</td></tr>) : <tr><td colSpan={3} className="px-4 py-4 text-center text-sm text-gray-500">线下转账，无关联充值订单</td></tr>}</tbody></table></div></div><div className="grid gap-5 rounded-xl border p-5 dark:border-gray-800 md:grid-cols-[1fr_auto]"><div><Label className="mb-2 block">处理状态</Label><Select value={status} onValueChange={(value) => setStatus(value as InvoiceStatus)} disabled={status === 'ISSUED'}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="PENDING">待处理</SelectItem><SelectItem value="PROCESSING">开票中</SelectItem><SelectItem value="REJECTED">已驳回</SelectItem>{status === 'ISSUED' && <SelectItem value="ISSUED">已开具</SelectItem>}</SelectContent></Select><Label className="mb-2 mt-4 block">管理员备注</Label><Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={2000} placeholder="例如：资料有误时说明驳回原因" /></div><div className="flex flex-col justify-end gap-2"><Button onClick={() => void updateStatus()} disabled={saving || status === 'ISSUED'}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}保存处理状态</Button><input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg" className="sr-only" onChange={(event) => void upload(event)} /><Button variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading || status === 'REJECTED'}>{uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileUp className="mr-2 h-4 w-4" />}{uploading ? '上传中' : '上传已开具发票'}</Button>{request.document_available && <Button type="button" variant="outline" onClick={() => void download()}><Download className="mr-2 h-4 w-4" />下载当前文件</Button>}</div></div></div></div></div>
}
function Info({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-gray-500">{label}</p><p className="mt-1 break-all">{value}</p></div> }
