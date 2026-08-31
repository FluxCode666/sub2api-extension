import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent, type ReactNode, type UIEvent } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import {
  ArrowDownRight,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileText,
  Landmark,
  Loader2,
  Mail,
  ReceiptText,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { downloadInvoiceFile, formatDate, formatMoney, invoiceStatusClass, invoiceStatusLabel, type InvoiceOrder, type InvoiceProfile, type InvoiceRequest } from '@/lib/invoices'

gsap.registerPlugin(useGSAP)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  gsap.registerPlugin(ScrollTrigger)
}

interface FeatureResponse { enabled: boolean }
interface ItemsResponse<T> { items: T[] }
interface PageResponse<T> { items: T[]; total: number; page: number; page_size: number; total_pages: number }
interface ProfileResponse { profile: InvoiceProfile | null }

const emptyForm = {
  invoice_title: '', taxpayer_id: '', contact_email: '', contact_phone: '',
  registered_address: '', bank_name: '', bank_account: '', remark: '',
}

export default function InvoicePortalPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [orders, setOrders] = useState<InvoiceOrder[]>([])
  const [requests, setRequests] = useState<InvoiceRequest[]>([])
  const [requestPage, setRequestPage] = useState(1)
  const [requestTotal, setRequestTotal] = useState(0)
  const [requestTotalPages, setRequestTotalPages] = useState(0)
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false)
  const [profile, setProfile] = useState<InvoiceProfile | null>(null)
  const [selected, setSelected] = useState<number[]>([])
  const [form, setForm] = useState(emptyForm)
  const [loading, setLoading] = useState(true)
  const [refreshingOrders, setRefreshingOrders] = useState(false)
  const [refreshingProfile, setRefreshingProfile] = useState(false)
  const [refreshingRequests, setRefreshingRequests] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitCompleted, setSubmitCompleted] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileFeedback, setProfileFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [downloading, setDownloading] = useState<number | null>(null)
  const portalRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const config = await apiClient.get<AuxEnvelope<FeatureResponse>>('/invoices/config')
      const active = config.data?.enabled === true
      setEnabled(active)
      if (!active) return
      const [orderResponse, requestResponse, profileResponse] = await Promise.all([
        apiClient.get<AuxEnvelope<ItemsResponse<InvoiceOrder>>>('/invoices/eligible-orders'),
        apiClient.get<AuxEnvelope<PageResponse<InvoiceRequest>>>('/invoices/requests?page=1&page_size=5'),
        apiClient.get<AuxEnvelope<ProfileResponse>>('/invoices/profile'),
      ])
      setOrders(orderResponse.data?.items ?? [])
      setRequests(requestResponse.data?.items ?? [])
      setRequestPage(requestResponse.data?.page || 1)
      setRequestTotal(requestResponse.data?.total ?? requestResponse.data?.items?.length ?? 0)
      setRequestTotalPages(requestResponse.data?.total_pages ?? 0)
      const savedProfile = profileResponse.data?.profile ?? null
      setProfile(savedProfile)
      setProfileSaved(false)
      setProfileFeedback(null)
      setForm((current) => hasFormValues(current) ? current : profileToForm(savedProfile))
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to load invoice data', caught)
      setError(caught instanceof Error ? caught.message : '无法加载发票数据，请从 Sub2API 控制台重新打开此页面。')
    } finally { setLoading(false) }
  }, [])

  const refreshOrders = useCallback(async () => {
    setRefreshingOrders(true)
    try {
      const response = await apiClient.get<AuxEnvelope<ItemsResponse<InvoiceOrder>>>('/invoices/eligible-orders')
      const refreshed = response.data?.items ?? []
      setOrders(refreshed)
      setSelected((current) => current.filter((id) => refreshed.some((order) => order.payment_order_id === id)))
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to refresh eligible orders', caught)
      setError(caught instanceof Error ? caught.message : '订单刷新失败，请稍后重试。')
    } finally { setRefreshingOrders(false) }
  }, [])

  const refreshProfile = useCallback(async () => {
    setRefreshingProfile(true)
    try {
      const response = await apiClient.get<AuxEnvelope<ProfileResponse>>('/invoices/profile')
      const savedProfile = response.data?.profile ?? null
      setProfile(savedProfile)
      setForm(profileToForm(savedProfile))
      setProfileSaved(false)
      setProfileFeedback({ tone: 'success', message: savedProfile ? '已重新载入默认资料。' : '当前账号还没有保存默认资料。' })
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to refresh invoice profile', caught)
      const message = caught instanceof Error ? caught.message : '资料刷新失败，请稍后重试。'
      setProfileFeedback({ tone: 'error', message })
      setError(message)
    } finally { setRefreshingProfile(false) }
  }, [])

  const refreshRequests = useCallback(async () => {
    setRefreshingRequests(true)
    try {
      const response = await apiClient.get<AuxEnvelope<PageResponse<InvoiceRequest>>>('/invoices/requests?page=1&page_size=5')
      setRequests(response.data?.items ?? [])
      setRequestPage(response.data?.page || 1)
      setRequestTotal(response.data?.total ?? response.data?.items?.length ?? 0)
      setRequestTotalPages(response.data?.total_pages ?? 0)
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to refresh invoice requests', caught)
      setError(caught instanceof Error ? caught.message : '申请记录刷新失败，请稍后重试。')
    } finally { setRefreshingRequests(false) }
  }, [])

  const loadMoreRequests = useCallback(async () => {
    if (loadingMoreRequests || refreshingRequests || requestTotalPages <= requestPage) return
    setLoadingMoreRequests(true)
    try {
      const nextPage = requestPage + 1
      const response = await apiClient.get<AuxEnvelope<PageResponse<InvoiceRequest>>>(`/invoices/requests?page=${nextPage}&page_size=5`)
      const nextItems = response.data?.items ?? []
      setRequests((current) => [...current, ...nextItems])
      setRequestPage(response.data?.page || nextPage)
      setRequestTotal(response.data?.total ?? requestTotal)
      setRequestTotalPages(response.data?.total_pages ?? requestTotalPages)
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to load more invoice requests', caught)
      setError(caught instanceof Error ? caught.message : '申请记录加载失败，请稍后重试。')
    } finally { setLoadingMoreRequests(false) }
  }, [loadingMoreRequests, refreshingRequests, requestPage, requestTotal, requestTotalPages])

  useEffect(() => { void load() }, [load])

  const selectedOrders = useMemo(() => orders.filter((order) => selected.includes(order.payment_order_id)), [orders, selected])
  const total = useMemo(() => selectedOrders.reduce((sum, order) => sum + order.amount, 0), [selectedOrders])

  const { contextSafe } = useGSAP(() => {
    if (loading || enabled !== true || typeof window === 'undefined' || /jsdom/i.test(window.navigator.userAgent)) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    if (reduceMotion) return

    gsap.from('.invoice-hero-copy > *', { y: 28, autoAlpha: 0, stagger: 0.08, duration: 0.72, ease: 'power3.out' })
    gsap.from('.invoice-hero-orb', { scale: 0.72, rotation: -12, autoAlpha: 0, duration: 1.15, ease: 'power3.out' })
    gsap.from('.invoice-order-card', { y: 22, autoAlpha: 0, stagger: 0.06, duration: 0.62, ease: 'power3.out', scrollTrigger: { trigger: '.invoice-orders-section', start: 'top 82%', once: true } })
    gsap.from('.invoice-form-section .invoice-panel', { y: 42, autoAlpha: 0, stagger: 0.08, duration: 0.8, ease: 'power3.out', scrollTrigger: { trigger: '.invoice-form-section', start: 'top 86%', once: true } })
    gsap.from('.invoice-history-section .invoice-request-card', { y: 32, autoAlpha: 0, stagger: 0.08, duration: 0.72, ease: 'power3.out', scrollTrigger: { trigger: '.invoice-history-section', start: 'top 88%', once: true } })
    gsap.fromTo('.invoice-reveal-word', { autoAlpha: 0.18, y: 8 }, { autoAlpha: 1, y: 0, stagger: 0.08, ease: 'none', scrollTrigger: { trigger: '.invoice-flow-copy', start: 'top 88%', end: 'bottom 55%', scrub: 1 } })
  }, { scope: portalRef, dependencies: [loading, enabled, orders.length, requests.length], revertOnUpdate: true })

  const hoverIn = contextSafe((event: PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return
    gsap.to(event.currentTarget, { y: -5, scale: 1.01, duration: 0.24, ease: 'power2.out', overwrite: 'auto' })
  })
  const hoverOut = contextSafe((event: PointerEvent<HTMLElement>) => {
    if (prefersReducedMotion()) return
    gsap.to(event.currentTarget, { y: 0, scale: 1, duration: 0.32, ease: 'power2.out', overwrite: 'auto' })
  })

  const toggleOrder = (id: number) => { setSubmitCompleted(false); setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]) }
  const change = (key: keyof typeof emptyForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
    setSubmitCompleted(false)
    if (key !== 'remark') {
      setProfileSaved(false)
      setProfileFeedback(null)
    }
  }

  const saveProfile = async () => {
    const validationError = validateProfileForm(form)
    if (validationError) {
      setError(validationError)
      setProfileFeedback({ tone: 'error', message: validationError })
      return
    }
    setSavingProfile(true); setError(''); setNotice('')
    try {
      const response = await apiClient.put<AuxEnvelope<ProfileResponse>>('/invoices/profile', profileInput(form))
      const saved = response.data?.profile ?? null
      setProfile(saved)
      if (saved) setForm((current) => ({ ...current, ...profileToForm(saved) }))
      setProfileSaved(true)
      setProfileFeedback({ tone: 'success', message: profile ? '默认资料已更新。下次进入发票中心会自动填充。' : '默认资料已保存。下次进入发票中心会自动填充。' })
      setNotice('')
    } catch (caught) {
      console.error('[InvoicePortalPage] failed to save invoice profile', caught)
      const message = caught instanceof Error ? caught.message : '保存开票资料失败，请稍后重试。'
      setError(message)
      setProfileFeedback({ tone: 'error', message })
    } finally { setSavingProfile(false) }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setNotice('')
    if (selected.length === 0) { setError('请至少选择一笔可开票的充值订单。'); return }
    setSubmitting(true)
    try {
      await apiClient.post<AuxEnvelope<InvoiceRequest>>('/invoices/requests', { ...form, order_ids: selected })
      setSelected([]); setForm(emptyForm); setSubmitCompleted(true); setNotice('发票申请已提交。管理员开具并上传后，会在申请记录中出现下载入口。')
      await Promise.all([refreshOrders(), refreshRequests()])
    } catch (caught) { console.error('[InvoicePortalPage] failed to submit invoice request', caught); setSubmitCompleted(false); setError(caught instanceof Error ? caught.message : '提交申请失败，请稍后重试。')
    } finally { setSubmitting(false) }
  }

  const handleRequestScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    if (target.scrollHeight - target.scrollTop - target.clientHeight < 120) void loadMoreRequests()
  }

  const download = async (id: number) => {
    setDownloading(id); setError('')
    try { await downloadInvoiceFile(`/api/aux/invoices/requests/${id}/document`) }
    catch (caught) { console.error('[InvoicePortalPage] failed to download invoice', caught); setError(caught instanceof Error ? caught.message : '发票下载失败，请稍后重试。') }
    finally { setDownloading(null) }
  }

  if (loading) return <LoadingState />
  if (enabled === false) return <DisabledState />

  return (
    <div ref={portalRef} className="invoice-portal min-h-screen overflow-x-hidden">
      <a href="#invoice-main" className="invoice-skip-link">跳到主要内容</a>
      <header className="invoice-nav">
        <div className="invoice-nav-inner">
          <div className="invoice-brand"><span className="invoice-brand-mark">AUX</span><span>企业客户发票中心</span></div>
          <span className="hidden text-xs text-white/50 sm:inline">资料加密保存于扩展服务</span>
        </div>
      </header>

      <main id="invoice-main">
        <section className="invoice-hero">
          <div className="invoice-hero-grid" aria-hidden="true" />
          <div className="invoice-hero-orb invoice-hero-orb--one" aria-hidden="true" />
          <div className="invoice-hero-orb invoice-hero-orb--two" aria-hidden="true" />
          <div className="invoice-hero-content invoice-shell"><div className="invoice-hero-copy"><p className="invoice-eyebrow"><span className="invoice-eyebrow-dot" />充值完成，开票资料随时可用</p><h1>充值，按实付金额开票。</h1><p className="invoice-hero-lede">选择已完成的余额充值订单，确认企业抬头与收票信息，提交后由管理员人工开具并上传发票。</p><div className="invoice-hero-actions"><a href="#invoice-orders" className="invoice-button invoice-button--light">选择充值订单 <ArrowDownRight className="h-4 w-4" /></a><a href="#invoice-profile" className="invoice-button invoice-button--ghost">查看默认资料 <ArrowRight className="h-4 w-4" /></a></div></div><div className="invoice-hero-footnote"><ShieldCheck className="h-4 w-4" />仅展示当前登录账号的充值记录</div></div>
        </section>

        {error && <div className="invoice-shell invoice-message-wrap"><Message tone="error">{error}</Message></div>}
        {notice && <div className="invoice-shell invoice-message-wrap"><Message tone="success">{notice}</Message></div>}

        <section id="invoice-orders" className="invoice-section invoice-orders-section invoice-shell"><div className="invoice-section-heading"><div><p className="invoice-section-kicker">可开票订单</p><h2>从充值记录开始</h2><p>每笔订单只能开票一次，已申请订单会自动隐藏。</p></div><button type="button" onClick={() => void refreshOrders()} disabled={refreshingOrders} className="invoice-section-action" aria-label="刷新可开票订单"><RefreshCw className={refreshingOrders ? 'invoice-spin-icon' : ''} /><span>{refreshingOrders ? '刷新中…' : '刷新订单'}</span></button></div><div className="invoice-orders-layout"><div className="invoice-panel invoice-orders-panel">{orders.length === 0 ? <EmptyOrders /> : <div className="grid grid-flow-dense gap-3 sm:grid-cols-2">{orders.map((order) => { const checked = selected.includes(order.payment_order_id); return <label key={order.payment_order_id} className={`invoice-order-card group ${checked ? 'is-selected' : ''}`} onPointerEnter={hoverIn} onPointerLeave={hoverOut}><input aria-label={`选择订单 ${order.payment_order_id}`} type="checkbox" checked={checked} onChange={() => toggleOrder(order.payment_order_id)} className="sr-only" /><span className="invoice-order-card-top"><span className="invoice-checkbox">{checked && <Check className="h-3.5 w-3.5" />}</span><span className="invoice-order-date">{formatDate(order.paid_at)}</span></span><span className="mt-8 block font-mono text-xs text-slate-500">{order.out_trade_no || `订单 #${order.payment_order_id}`}</span><span className="mt-2 flex items-end justify-between gap-3"><span className="text-sm text-slate-500">充值金额</span><span className="text-2xl font-semibold tracking-tight text-slate-950">{formatMoney(order.amount)}</span></span><span className="invoice-order-card-bar" /></label> })}</div>}</div><aside className="space-y-4"><div className="invoice-panel invoice-summary-card"><div className="flex items-center justify-between text-sm text-white/60"><span>本次申请概览</span><Sparkles className="h-4 w-4 text-[#a9f3df]" /></div><div className="mt-8"><span className="text-xs uppercase tracking-[0.18em] text-white/45">申请金额</span><strong className="mt-2 block text-4xl font-semibold tracking-tight text-white">{formatMoney(total)}</strong></div><div className="mt-8 grid grid-flow-dense grid-cols-2 gap-3 border-t border-white/10 pt-4 text-sm"><div><span className="block text-white/45">已选订单</span><strong className="mt-1 block text-white">{selected.length} 笔</strong></div><div><span className="block text-white/45">开票规则</span><strong className="mt-1 block text-[#a9f3df]">按充值金额</strong></div></div></div><div className="invoice-panel invoice-flow-card"><div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Clock3 className="h-4 w-4 text-indigo-600" />处理流程</div><p className="invoice-flow-copy mt-5 text-xl leading-relaxed text-slate-700"><span className="invoice-reveal-word">勾选订单</span><span className="mx-1 text-indigo-500">→</span><span className="invoice-reveal-word">确认资料</span><span className="mx-1 text-indigo-500">→</span><span className="invoice-reveal-word">人工开票</span><span className="mx-1 text-indigo-500">→</span><span className="invoice-reveal-word">下载发票</span></p></div></aside></div></section>

        <section id="invoice-profile" className="invoice-section invoice-form-section invoice-shell"><form onSubmit={submit} className="invoice-form-layout"><div className="invoice-panel invoice-form-intro"><div className="invoice-intro-icon"><Building2 className="h-5 w-5" /></div><p className="invoice-section-kicker">企业开票资料</p><h2>把资料保存下来，下次直接使用。</h2><p className="mt-4">默认资料只属于当前账号。提交申请时会保存一份资料快照，之后修改默认资料不会影响历史申请。</p><div className="invoice-form-benefits"><div><Landmark className="h-4 w-4" /><span>支持企业增值税发票信息</span></div><div><Mail className="h-4 w-4" /><span>发票开具后发送至收票邮箱</span></div></div>{profileFeedback && <div className="mt-6"><Message tone={profileFeedback.tone}>{profileFeedback.message}</Message></div>}<button type="button" onClick={() => void saveProfile()} disabled={savingProfile} className="invoice-button invoice-button--dark mt-8 w-full justify-center">{savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : profileSaved ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}{savingProfile ? '保存中…' : profileSaved ? '已保存默认资料' : profile ? '更新默认资料' : '保存为默认资料'}</button></div><div className="invoice-panel invoice-form-fields"><div className="mb-7 flex items-start justify-between gap-4"><div><p className="invoice-section-kicker">资料确认</p><h3>填写本次开票信息</h3></div><div className="flex items-center gap-3"><button type="button" onClick={() => void refreshProfile()} disabled={refreshingProfile} className="invoice-section-action invoice-section-action--compact" aria-label="重新载入默认资料"><RefreshCw className={refreshingProfile ? 'invoice-spin-icon' : ''} /><span>{refreshingProfile ? '载入中…' : '刷新资料'}</span></button><ReceiptText className="h-6 w-6 text-indigo-500" /></div></div><div className="grid gap-5 md:grid-cols-2"><Field label="发票抬头" required><Input value={form.invoice_title} onChange={(event) => change('invoice_title', event.target.value)} required placeholder="企业全称" /></Field><Field label="纳税人识别号" required><Input value={form.taxpayer_id} onChange={(event) => change('taxpayer_id', event.target.value)} required placeholder="统一社会信用代码" /></Field><Field label="收票邮箱" required><Input type="email" value={form.contact_email} onChange={(event) => change('contact_email', event.target.value)} required placeholder="finance@example.com" /></Field><Field label="联系电话"><Input value={form.contact_phone} onChange={(event) => change('contact_phone', event.target.value)} placeholder="方便核对资料" /></Field><Field label="注册地址" className="md:col-span-2"><Input value={form.registered_address} onChange={(event) => change('registered_address', event.target.value)} placeholder="选填" /></Field><Field label="开户行"><Input value={form.bank_name} onChange={(event) => change('bank_name', event.target.value)} placeholder="选填" /></Field><Field label="银行账号"><Input value={form.bank_account} onChange={(event) => change('bank_account', event.target.value)} placeholder="选填" /></Field><Field label="本次备注" className="md:col-span-2"><textarea value={form.remark} onChange={(event) => change('remark', event.target.value)} maxLength={2000} rows={3} className="invoice-textarea" placeholder="可填写特殊说明，不会保存到默认资料" /></Field></div><div className="invoice-submit-row"><p>本次申请金额 <strong>{formatMoney(total)}</strong></p><button type="submit" disabled={submitting || selected.length === 0} className="invoice-button invoice-button--primary">{submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : submitCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}{submitting ? '提交中' : submitCompleted ? '已提交申请' : '提交开票申请'}</button></div></div></form></section>

        <section className="invoice-section invoice-history-section invoice-shell"><div className="invoice-section-heading"><div><p className="invoice-section-kicker">申请记录</p><h2>我的开票申请</h2><p>管理员上传发票后，你可以在这里下载文件。</p></div><button type="button" onClick={() => void refreshRequests()} disabled={refreshingRequests} className="invoice-section-action" aria-label="刷新我的开票申请"><RefreshCw className={refreshingRequests ? 'invoice-spin-icon' : ''} /><span>{refreshingRequests ? '刷新中…' : '刷新记录'}</span></button></div>{requests.length === 0 ? <div className="invoice-panel invoice-empty-history"><FileText className="h-8 w-8 text-slate-300" /><p>暂无开票申请记录</p><span>提交第一笔申请后，处理进度会显示在这里。</span></div> : <><div className="max-h-[760px] overflow-y-auto pr-1" onScroll={handleRequestScroll}><div className="grid gap-3 md:grid-cols-2">{requests.map((request) => <article key={request.id} className="invoice-panel invoice-request-card" onPointerEnter={hoverIn} onPointerLeave={hoverOut}><div className="flex items-start justify-between gap-4"><div><p className="font-mono text-xs text-slate-400">申请 #{request.id}</p><h3 className="mt-2 text-lg font-semibold text-slate-950">{request.invoice_title}</h3></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${invoiceStatusClass(request.status)}`}>{invoiceStatusLabel(request.status)}</span></div><div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500"><span>{formatMoney(request.amount)}</span><span>{request.orders.length > 0 ? `${request.orders.length} 笔订单` : '线下支付'}</span><span>{formatDate(request.created_at)}</span></div>{request.admin_note && <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">管理员备注：{request.admin_note}</p>}<div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">{request.document_available ? <button type="button" onClick={() => void download(request.id)} disabled={downloading === request.id} className="invoice-download-button">{downloading === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}下载发票</button> : <span className="text-sm text-slate-400">{request.status === 'REJECTED' ? '申请已驳回，请联系管理员处理' : '等待管理员开具'}</span>}<span className="text-xs text-slate-400">{request.document_name || '未上传文件'}</span></div></article>)}</div></div><div className="mt-4 flex items-center justify-between text-xs text-slate-400"><span>已显示 {requests.length} / {requestTotal} 条</span>{requestPage < requestTotalPages ? <button type="button" onClick={() => void loadMoreRequests()} disabled={loadingMoreRequests} className="invoice-section-action invoice-section-action--compact">{loadingMoreRequests ? <Loader2 className="invoice-spin-icon" /> : <ArrowDownRight />}{loadingMoreRequests ? '加载中…' : '加载更多记录'}</button> : <span>已加载全部记录</span>}</div></>}</section>
      </main>
      <footer className="invoice-footer"><div className="invoice-shell flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>Sub2API 企业客户服务</span><span>开票资料仅用于本次发票处理</span></div></footer>
    </div>
  )
}

function prefersReducedMotion(): boolean { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches }

function profileInput(form: typeof emptyForm) { const { remark: _remark, ...input } = form; return input }
function profileToForm(profile: InvoiceProfile | null): typeof emptyForm { if (!profile) return { ...emptyForm }; return { invoice_title: profile.invoice_title ?? '', taxpayer_id: profile.taxpayer_id ?? '', contact_email: profile.contact_email ?? '', contact_phone: profile.contact_phone ?? '', registered_address: profile.registered_address ?? '', bank_name: profile.bank_name ?? '', bank_account: profile.bank_account ?? '', remark: '' } }
function hasFormValues(form: typeof emptyForm): boolean { return Object.values(form).some((value) => value.trim() !== '') }
function validateProfileForm(form: typeof emptyForm): string { if (!form.invoice_title.trim() || !form.taxpayer_id.trim() || !form.contact_email.trim()) return '请先填写发票抬头、纳税人识别号和收票邮箱。'; if (!form.contact_email.includes('@')) return '请输入有效的收票邮箱。'; return '' }
function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: ReactNode }) { return <div className={className}><Label className="mb-2 block text-sm font-medium text-slate-700">{label}{required && <span className="ml-1 text-rose-500">*</span>}</Label>{children}</div> }
function Message({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) { const styles = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'; return <div role={tone === 'error' ? 'alert' : 'status'} aria-live={tone === 'error' ? 'assertive' : 'polite'} className={`rounded-xl border px-4 py-3 text-sm ${styles}`}>{children}</div> }
function LoadingState() { return <main className="invoice-state invoice-state--loading"><div className="invoice-state-card"><span className="invoice-state-mark"><Loader2 className="h-5 w-5 animate-spin" /></span><h1>正在打开企业发票中心</h1><p>正在同步你的充值记录与默认开票资料…</p></div></main> }
function DisabledState() { return <main className="invoice-state"><div className="invoice-state-card"><span className="invoice-state-mark"><FileText className="h-5 w-5" /></span><h1>发票服务暂未开放</h1><p>管理员暂时关闭了在线发票申请入口，请联系客户服务获取帮助。</p></div></main> }
function EmptyOrders() { return <div className="invoice-empty-orders"><CheckCircle2 className="h-8 w-8 text-emerald-500" /><p>暂无可申请开票的订单</p><span>已完成订单申请过发票后将不会重复出现。</span></div> }
