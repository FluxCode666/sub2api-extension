import { useCallback, useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import { CheckCircle2, ChevronDown, ChevronRight, Gift, Loader2, WalletCards } from 'lucide-react'
import gsap from 'gsap'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { apiClient, AuxApiError, type AuxEnvelope } from '@/lib/api-client'
import { fetchHomepageConfig } from '@/lib/homepage'
import { formatPromotionMoney, promotionIsEnded, promotionRewardLabel, type Promotion, type PromotionClaim, type PromotionOrder } from '@/lib/promotions'
import { renderPromotionMarkdown } from '@/lib/promotion-markdown'
import './PromotionMarkdown.css'

gsap.registerPlugin(useGSAP)

export default function PromotionPortalPage() {
  const pageRef = useRef<HTMLElement>(null)
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [claims, setClaims] = useState<PromotionClaim[]>([])
  const [siteName, setSiteName] = useState('')
  const [endedOpen, setEndedOpen] = useState(false)
  const [selected, setSelected] = useState<Promotion | null>(null)
  // 说明、返利规则与订单必须属于同一活动，切换请求完成后整体替换。
  const [detail, setDetail] = useState<{ promotion: Promotion; orders: PromotionOrder[] } | null>(null)
  const [selectedOrders, setSelectedOrders] = useState<number[]>([])
  const [loading, setLoading] = useState(true)
  const [orderLoading, setOrderLoading] = useState(false)
  const [orderError, setOrderError] = useState(false)
  const [claiming, setClaiming] = useState(false)
  const [error, setError] = useState('')
  const orderRequest = useRef(0)

  const selectPromotion = useCallback(async (promotion: Promotion) => {
    const request = ++orderRequest.current
    setSelected(promotion)
    setSelectedOrders([])
    setOrderLoading(true)
    setOrderError(false)
    if (promotionIsEnded(promotion)) {
      setDetail({ promotion, orders: [] })
      setOrderLoading(false)
      return
    }
    try {
      const result = await apiClient.get<AuxEnvelope<{ items: PromotionOrder[] }>>(`/promotions/${promotion.id}/orders`)
      if (request === orderRequest.current) setDetail({ promotion, orders: result.data?.items ?? [] })
    } catch {
      if (request === orderRequest.current) setOrderError(true)
    } finally {
      // 旧请求不能覆盖新活动的数据、错误或加载状态；保留 API 客户端默认超时。
      if (request === orderRequest.current) setOrderLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    void Promise.all([
      apiClient.get<AuxEnvelope<{ items: Promotion[] }>>('/promotions'),
      apiClient.get<AuxEnvelope<{ items: PromotionClaim[] }>>('/promotions/claims'),
      fetchHomepageConfig(),
    ]).then(([promotionResult, claimResult, homepageConfig]) => {
      if (!active) return
      const next = promotionResult.data?.items ?? []
      setPromotions(next)
      setClaims(claimResult.data?.items ?? [])
      setSiteName(homepageConfig.siteName.trim() || homepageConfig.heroTitle.trim())
      const firstActive = next.find((promotion) => !promotionIsEnded(promotion))
      if (firstActive) void selectPromotion(firstActive)
    }).catch(() => {
      if (active) setError('促销活动加载失败，请确认已从 Sub2API 登录')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => { active = false; orderRequest.current += 1 }
  }, [selectPromotion])

  const displayed = detail?.promotion ?? selected
  const orders = detail?.orders ?? []
  const selectedEnded = selected ? promotionIsEnded(selected) : false
  const orderReady = !selectedEnded && !orderLoading && !orderError && detail?.promotion.id === selected?.id
  const activePromotions = promotions.filter((promotion) => !promotionIsEnded(promotion))
  const endedPromotions = promotions.filter((promotion) => promotionIsEnded(promotion)).sort((a, b) => {
    const endDifference = Date.parse(b.ends_at ?? '') - Date.parse(a.ends_at ?? '')
    return endDifference || Date.parse(b.created_at) - Date.parse(a.created_at)
  })

  useGSAP(() => {
    if (loading || typeof window === 'undefined' || typeof window.matchMedia !== 'function' || /jsdom/i.test(window.navigator.userAgent)) return
    const media = gsap.matchMedia()
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, ({ conditions }) => {
      if (conditions?.reduceMotion) return
      const intro = gsap.timeline({ defaults: { ease: 'power2.out' } })
      intro.from('.promotion-page-header > *', { y: 12, autoAlpha: 0, duration: 0.38, stagger: 0.06 })
      intro.from('.promotion-sidebar', { x: -12, autoAlpha: 0, duration: 0.42 }, '<0.08')
      intro.from('.promotion-main-column > *', { y: 12, autoAlpha: 0, duration: 0.38, stagger: 0.06 }, '<0.04')
    })
    return () => media.revert()
  }, { scope: pageRef, dependencies: [loading], revertOnUpdate: true })

  useGSAP(() => {
    if (loading || !displayed || typeof window === 'undefined' || typeof window.matchMedia !== 'function' || /jsdom/i.test(window.navigator.userAgent)) return
    const media = gsap.matchMedia()
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, ({ conditions }) => {
      if (conditions?.reduceMotion) return
      gsap.from('.promotion-detail-card', { y: 8, autoAlpha: 0, duration: 0.28, ease: 'power2.out' })
    })
    return () => media.revert()
  }, { scope: pageRef, dependencies: [displayed?.id], revertOnUpdate: true })

  useGSAP(() => {
    if (!endedOpen || typeof window === 'undefined' || typeof window.matchMedia !== 'function' || /jsdom/i.test(window.navigator.userAgent)) return
    const media = gsap.matchMedia()
    media.add({ reduceMotion: '(prefers-reduced-motion: reduce)' }, ({ conditions }) => {
      if (conditions?.reduceMotion) return
      gsap.from('.promotion-ended-item', { y: 6, autoAlpha: 0, duration: 0.24, stagger: 0.05, ease: 'power2.out' })
    })
    return () => media.revert()
  }, { scope: pageRef, dependencies: [endedOpen], revertOnUpdate: true })

  const claim = async () => {
    if (!selected || !orderReady || claiming || selectedOrders.length === 0) return
    setClaiming(true)
    try {
      const result = await apiClient.post<AuxEnvelope<{ items: PromotionClaim[] }>>(`/promotions/${selected.id}/claim`, { order_ids: selectedOrders })
      const newClaims = result.data?.items ?? []
      setClaims((current) => [...newClaims, ...current])
      setDetail((current) => current && current.promotion.id === selected.id ? {
        ...current,
        orders: current.orders.map((order) => selectedOrders.includes(order.payment_order_id) ? { ...order, claimed: true } : order),
      } : current)
      setSelectedOrders([])
      toast.success(`已到账 ${newClaims.length} 笔返利，合计 ${formatPromotionMoney(newClaims.reduce((sum, item) => sum + item.rebate_amount, 0))}`)
    } catch (error) {
      toast.error(error instanceof AuxApiError && error.status === 503 ? '返利入账服务暂时不可用，请稍后重试' : '返利领取失败，订单可能已被领取')
    } finally {
      setClaiming(false)
    }
  }

  if (loading) return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />正在加载促销活动…</main>
  if (error) return <main className="mx-auto max-w-xl p-6"><Alert className="border-destructive/30 bg-destructive/5 text-destructive"><AlertDescription>{error}</AlertDescription></Alert></main>

  return (
    <main ref={pageRef} className="min-h-screen bg-muted/30 p-4 sm:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="promotion-page-header">
          <p className="text-sm font-medium text-primary">{siteName ? `${siteName} 用户福利` : '用户福利'}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">促销活动</h1>
          <p className="mt-2 text-sm text-muted-foreground">选择活动和已完成的充值订单，按活动规则领取返利。</p>
        </header>
        {promotions.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-sm text-muted-foreground"><Gift className="mx-auto mb-3 h-8 w-8" />当前没有进行中的促销活动。</CardContent></Card>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
            <Card className="promotion-sidebar h-fit">
              <CardHeader><CardTitle className="text-base">进行中的活动</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {activePromotions.map((promotion) => (
                  <Button key={promotion.id} type="button" variant={selected?.id === promotion.id ? 'secondary' : 'ghost'} disabled={claiming} aria-pressed={selected?.id === promotion.id} className="h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => {
                    if (selected?.id !== promotion.id || orderError) void selectPromotion(promotion)
                  }}>
                    <span><span className="block font-medium">{promotion.title}</span><span className="mt-1 block text-xs text-muted-foreground">{promotionRewardLabel(promotion)}</span></span>
                  </Button>
                ))}
                {endedPromotions.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <Button type="button" variant="ghost" className="h-auto w-full justify-between px-2 py-2 text-left text-sm" aria-expanded={endedOpen} onClick={() => setEndedOpen((open) => !open)}>
                      <span className="flex items-center gap-2">{endedOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}已结束的活动<Badge variant="outline">{endedPromotions.length}</Badge></span>
                    </Button>
                    {endedOpen && <div className="mt-1 space-y-2">
                      {endedPromotions.map((promotion) => (
                        <Button key={promotion.id} type="button" variant={selected?.id === promotion.id ? 'secondary' : 'ghost'} disabled={claiming} aria-pressed={selected?.id === promotion.id} className="promotion-ended-item h-auto w-full justify-start whitespace-normal py-3 text-left" onClick={() => void selectPromotion(promotion)}>
                          <span><span className="block font-medium">{promotion.title}</span><span className="mt-1 block text-xs text-muted-foreground">活动已结束</span></span>
                        </Button>
                      ))}
                    </div>}
                  </div>
                )}
              </CardContent>
            </Card>
            <div className="promotion-main-column min-w-0 space-y-6">
              {displayed && (
                <Card className="promotion-detail-card">
                  <CardHeader>
                    <CardTitle>{displayed.title}</CardTitle>
                    <CardDescription><div className="promotion-markdown">{displayed.description ? <span dangerouslySetInnerHTML={{ __html: renderPromotionMarkdown(displayed.description) }} /> : <span>按已完成充值订单计算返利。</span>}</div></CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-2 rounded-md bg-primary/5 p-3 text-sm"><WalletCards className="h-4 w-4 shrink-0 text-primary" />返利规则：<strong>{promotionRewardLabel(displayed)}</strong></div>
                    <div role="status" className="flex h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
                      {orderLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                      <span className="truncate">{selectedEnded ? '活动已结束，无法领取返利' : orderLoading ? `正在加载「${selected?.title}」的订单…` : orderError ? '订单加载失败，请重试。' : '选择可用订单领取返利'}</span>
                    </div>
                    {orderError && selected && (
                      <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
                        <AlertDescription className="flex items-center justify-between gap-3">
                          <span>「{selected.title}」的订单加载失败，请稍后重试。</span>
                          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void selectPromotion(selected)}>重试</Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div role="group" aria-label="活动订单" aria-busy={orderLoading} className="min-h-32 space-y-2">
                      {orders.length > 0 ? orders.map((order) => (
                        <Button key={order.payment_order_id} type="button" variant={selectedOrders.includes(order.payment_order_id) ? 'secondary' : 'outline'} disabled={order.claimed || !orderReady || claiming} aria-pressed={selectedOrders.includes(order.payment_order_id)} className={`h-auto w-full justify-between gap-4 py-3 text-left ${!order.claimed ? 'disabled:opacity-100' : ''}`} onClick={() => setSelectedOrders((current) => current.includes(order.payment_order_id) ? current.filter((id) => id !== order.payment_order_id) : [...current, order.payment_order_id])}>
                          <span className="min-w-0 whitespace-normal break-words"><span className="block font-medium">订单 {order.out_trade_no || `#${order.payment_order_id}`}</span><span className="mt-1 block text-xs text-muted-foreground">支付 {formatPromotionMoney(order.amount)} · {new Date(order.paid_at).toLocaleString('zh-CN')}</span></span>
                          <span className="shrink-0 text-right text-sm font-semibold">{order.claimed ? <Badge variant="secondary">已领取</Badge> : `返 ${formatPromotionMoney(order.rebate_amount)}`}</span>
                        </Button>
                      )) : detail || orderReady ? <p className="py-8 text-center text-sm text-muted-foreground">没有可参与的已完成充值订单。</p> : null}
                    </div>
                    <Button className="w-full" disabled={claiming || !orderReady || selectedOrders.length === 0} onClick={() => void claim()}>
                      {claiming && <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}领取选中订单返利（{selectedOrders.length}）
                    </Button>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-emerald-600" />我的返利记录</CardTitle></CardHeader>
                <CardContent>
                  {claims.length === 0 ? <p className="text-sm text-muted-foreground">还没有领取记录。</p> : (
                    <div className="space-y-3">
                      {claims.slice(0, 20).map((claim) => (
                        <div key={claim.id} className="flex items-center justify-between border-b pb-3 text-sm last:border-0 last:pb-0">
                          <div><p className="font-medium">订单 {claim.out_trade_no || `#${claim.payment_order_id}`}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(claim.claimed_at).toLocaleString('zh-CN')}</p></div>
                          <div className="flex items-center gap-2"><Badge variant="secondary">已到账</Badge><strong className="text-emerald-600">+{formatPromotionMoney(claim.rebate_amount)}</strong></div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
