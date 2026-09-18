import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, isHomepageNavigationHref, type HomepageConfig, type HomepageNavigationItem, type IntegrationApp, type TrustedPartner } from '@/lib/homepage'
import { DEFAULT_TOB_HOMEPAGE_CONFIG, DEFAULT_TOB_MAP_SETTINGS, type TobHomepageConfig, type TobMapNode, type TobMapSettings } from '@/lib/tob-homepage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { withAppBasePath } from '@/lib/app-base-path'

const EMPTY_PARTNER: TrustedPartner = { name: '', logoUrl: '', linkUrl: '' }
const EMPTY_INTEGRATION: IntegrationApp = { name: '', logoUrl: '', documentationUrl: '' }

type ConfigDraft = HomepageConfig | TobHomepageConfig
type NodeKey = 'primaryServers' | 'cdnLocations' | 'customerLocations'
type MapColorKey = 'primaryServerColor' | 'cdnColor' | 'customerColor'
type HomepageConfigPageProps = { variant?: 'default' | 'tob' }

const EMPTY_NODE: TobMapNode = { name: '', latitude: Number.NaN, longitude: Number.NaN, description: '' }
const NODE_SECTIONS: Array<{ key: NodeKey; title: string; description: string }> = [
  { key: 'primaryServers', title: '主服务器', description: '核心 API 与控制面位置，可配置多个区域。' },
  { key: 'cdnLocations', title: 'CDN 集群', description: '主服务器会先连接这些边缘节点，再由边缘节点指向客户位置。' },
  { key: 'customerLocations', title: '客户位置', description: '企业客户所在的服务区域，只保存公开展示所需的名称和坐标。' },
]
const MAP_COLOR_FIELDS: Array<{ key: MapColorKey; label: string }> = [
  { key: 'primaryServerColor', label: '主服务器颜色' },
  { key: 'cdnColor', label: 'CDN 集群颜色' },
  { key: 'customerColor', label: '客户节点颜色' },
]
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function isEmptyNode(node: TobMapNode): boolean {
  return !node.name.trim()
    && !(node.description ?? '').trim()
    && !Number.isFinite(node.latitude)
    && !Number.isFinite(node.longitude)
}

function withoutEmptyNodes(config: TobHomepageConfig): TobHomepageConfig {
  return {
    ...config,
    primaryServers: config.primaryServers.filter((node) => !isEmptyNode(node)),
    cdnLocations: config.cdnLocations.filter((node) => !isEmptyNode(node)),
    customerLocations: config.customerLocations.filter((node) => !isEmptyNode(node)),
  }
}

function getNodeValidationMessage(title: string, index: number, node: TobMapNode): string | null {
  const prefix = `${title} ${index + 1}`
  if (!node.name.trim()) return `${prefix}：请填写名称。`
  if (!Number.isFinite(node.latitude)) return `${prefix}：请填写纬度。`
  if (node.latitude < -90 || node.latitude > 90) return `${prefix}：纬度必须在 -90 到 90 之间。`
  if (!Number.isFinite(node.longitude)) return `${prefix}：请填写经度。`
  if (node.longitude < -180 || node.longitude > 180) return `${prefix}：经度必须在 -180 到 180 之间。`
  return null
}

function mergeConfig(value: Partial<ConfigDraft> | undefined, isTob: boolean): ConfigDraft {
  if (!isTob) {
    const homepage = value as Partial<HomepageConfig> | undefined
    return { ...DEFAULT_HOMEPAGE_CONFIG, ...(homepage ?? {}), navigationItems: homepage?.navigationItems ?? DEFAULT_HOMEPAGE_CONFIG.navigationItems, trustedPartners: homepage?.trustedPartners ?? [], integrations: homepage?.integrations ?? [] }
  }
  const tob = value as Partial<TobHomepageConfig> | undefined
  return {
    ...DEFAULT_TOB_HOMEPAGE_CONFIG,
    ...(tob ?? {}),
    navigationItems: tob?.navigationItems ?? DEFAULT_TOB_HOMEPAGE_CONFIG.navigationItems,
    trustedPartners: tob?.trustedPartners ?? [],
    integrations: tob?.integrations ?? [],
    primaryServers: tob?.primaryServers ?? DEFAULT_TOB_HOMEPAGE_CONFIG.primaryServers,
    cdnLocations: tob?.cdnLocations ?? [],
    customerLocations: tob?.customerLocations ?? [],
    mapSettings: { ...DEFAULT_TOB_MAP_SETTINGS, ...(tob?.mapSettings ?? {}) },
  }
}

export default function HomepageConfigPage({ variant = 'default' }: HomepageConfigPageProps) {
  const isTob = variant === 'tob'
  const endpoint = isTob ? '/admin/tob-homepage/config' : '/admin/homepage/config'
  const [draft, setDraft] = useState<ConfigDraft>(() => mergeConfig(undefined, isTob))
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<AuxEnvelope<ConfigDraft>>(endpoint)
      .then((envelope) => {
        if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取官网配置')
        setDraft(mergeConfig(envelope.data, isTob))
      })
      .catch((reason: unknown) => toast.error(reason instanceof Error ? reason.message : '无法读取官网配置'))
      .finally(() => setLoading(false))
  }, [endpoint, isTob])

  const update = <K extends keyof HomepageConfig>(key: K, value: HomepageConfig[K]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const updatePartner = (index: number, key: keyof TrustedPartner, value: string) => {
    const partners = draft.trustedPartners.map((partner, currentIndex) => currentIndex === index ? { ...partner, [key]: value } : partner)
    update('trustedPartners', partners)
  }

  const updateNavigationItem = (index: number, key: keyof HomepageNavigationItem, value: string) => {
    update('navigationItems', draft.navigationItems.map((item, currentIndex) => currentIndex === index ? { ...item, [key]: value } : item))
  }

  const moveNavigationItem = (index: number, direction: number) => {
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= draft.navigationItems.length) return
    const items = [...draft.navigationItems]
    const movedItem = items[index]
    items[index] = items[targetIndex]
    items[targetIndex] = movedItem
    update('navigationItems', items)
  }

  const updateNode = (key: NodeKey, index: number, field: keyof TobMapNode, value: string) => {
    setDraft((current) => {
      const tob = current as TobHomepageConfig
      const nextValue = field === 'name' || field === 'description' ? value : value === '' ? Number.NaN : Number(value)
      const nodes = tob[key].map((node, currentIndex) => currentIndex === index ? { ...node, [field]: nextValue } : node)
      return { ...tob, [key]: nodes }
    })
  }

  const addNode = (key: NodeKey) => setDraft((current) => {
    const tob = current as TobHomepageConfig
    return { ...tob, [key]: [...tob[key], { ...EMPTY_NODE }] }
  })

  const removeNode = (key: NodeKey, index: number) => setDraft((current) => {
    const tob = current as TobHomepageConfig
    return { ...tob, [key]: tob[key].filter((_, currentIndex) => currentIndex !== index) }
  })

  const updateMapSetting = <K extends keyof TobMapSettings>(key: K, value: TobMapSettings[K]) => setDraft((current) => {
    const tob = current as TobHomepageConfig
    return { ...tob, mapSettings: { ...tob.mapSettings, [key]: value } }
  })

  const save = async () => {
    const invalidIndex = draft.navigationItems.findIndex((item) => !item.label.trim() || !isHomepageNavigationHref(item.href))
    if (invalidIndex !== -1) {
      toast.error(`请为菜单 ${invalidIndex + 1} 填写名称和有效链接（页内锚点、站内路径或 HTTP/HTTPS 地址）。`)
      return
    }
    let payload = draft
    if (isTob) {
      const tob = withoutEmptyNodes(draft as TobHomepageConfig)
      const invalidColor = MAP_COLOR_FIELDS.find(({ key }) => !HEX_COLOR_PATTERN.test(tob.mapSettings[key]))
      if (invalidColor) {
        toast.error(`${invalidColor.label}：请输入 #RRGGBB 格式的颜色值。`)
        return
      }
      const invalidNode = NODE_SECTIONS
        .flatMap(({ key, title }) => tob[key].map((node, index) => ({ message: getNodeValidationMessage(title, index, node) })))
        .find(({ message }) => message !== null)
      if (invalidNode) {
        toast.error(invalidNode.message)
        return
      }
      payload = tob
    }
    setSaving(true)
    try {
      const envelope = await apiClient.put<AuxEnvelope<ConfigDraft>>(endpoint, payload)
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '保存失败')
      setDraft(mergeConfig(envelope.data, isTob))
      toast.success(isTob ? 'ToB 官网配置已保存' : 'ToC 官网配置已保存')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败'
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="aux-admin-page"><p>{isTob ? '正在读取 ToB 官网配置…' : '正在读取 ToC 官网配置…'}</p></div>

  return (
    <div className="aux-admin-page aux-homepage-config-page">
      <header className="aux-page-header">
        <div><p className="aux-page-kicker">品牌与内容</p><h1>{isTob ? 'ToB 官网配置' : 'ToC 官网配置'}</h1><p>{isTob ? '基于现有 Sub2API 官网的完整副本维护企业版内容，并配置全球主服务器、CDN 和客户节点。' : '维护 Sub2API 官网的品牌信息、顶部导航、合作伙伴与合规协议链接。保存后会同步到独立官网和嵌入页面。'}</p></div>
        <a className="aux-config-preview" href={withAppBasePath(isTob ? '/tob-home' : '/sub2api-home')} target="_blank" rel="noreferrer">预览 {isTob ? 'ToB' : 'ToC'} 官网 <ArrowUpRight size={15} /></a>
      </header>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>01</span><h2>品牌与 Hero</h2></div><p>首页首屏会优先使用这些内容，建议标题保持在两行以内。</p></div>
        <div className="aux-config-grid">
          <label>网站名称<input value={draft.siteName} onChange={(event) => update('siteName', event.target.value)} placeholder="Sub2API" /></label>
          <label>官网 Logo URL<input value={draft.siteLogoUrl} onChange={(event) => update('siteLogoUrl', event.target.value)} placeholder="https://example.com/logo.svg" /></label>
          <label>Hero 标签<input value={draft.heroLabel} onChange={(event) => update('heroLabel', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 标题<input value={draft.heroTitle} onChange={(event) => update('heroTitle', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 描述<textarea value={draft.heroDescription} onChange={(event) => update('heroDescription', event.target.value)} rows={3} /></label>
          <label>主按钮文字<input value={draft.primaryCta} onChange={(event) => update('primaryCta', event.target.value)} /></label>
          <label>主按钮链接<input value={draft.primaryHref} onChange={(event) => update('primaryHref', event.target.value)} placeholder="/login 或 https://…" aria-describedby="configured-link-help" /></label>
          <label>文档按钮文字<input value={draft.docsCta} onChange={(event) => update('docsCta', event.target.value)} /></label>
          <label>文档按钮链接<input value={draft.docsHref} onChange={(event) => update('docsHref', event.target.value)} placeholder="#developers 或 https://…" /></label>
          <div className="aux-config-toggle aux-config-span-2"><div><strong>展示开发者板块</strong><span>控制首页「BUILT FOR BUILDERS · 从代码，到增长」板块及其导航入口是否显示。</span></div><Switch checked={draft.showDevelopersSection} onCheckedChange={(checked) => update('showDevelopersSection', checked)} aria-label="展示开发者板块" /></div>
          <label className="aux-config-span-2">接入文档 URL<input value={draft.developersDocsUrl} onChange={(event) => update('developersDocsUrl', event.target.value)} placeholder="https://docs.example.com/quickstart" aria-describedby="developers-docs-help" /></label>
          <p className="aux-config-section-note aux-config-span-2" id="developers-docs-help">用于「BUILT FOR BUILDERS」板块的接入文档按钮。留空时使用下方「资源与协议」中的使用文档 URL；两者均为空时隐藏按钮。</p>
          <p className="aux-config-section-note aux-config-span-2" id="configured-link-help">站内路径按当前域名原样跳转：填写 <code>/login</code>、<code>/dashboard</code> 会进入 Sub2API；进入 aux-system 请显式填写 <code>/aux/login</code>、<code>/aux/admin/...</code>。页内位置使用 <code>#锚点</code>，跨域地址填写完整 HTTP/HTTPS URL。此规则同样适用于顶部导航、合作伙伴、接入生态以及资源与协议链接。</p>
          <div className="aux-config-toggle aux-config-span-2"><div><strong>展示快速接入板块</strong><span>控制首页「START IN MINUTES」三步接入板块是否显示。</span></div><Switch checked={draft.showQuickstartSection} onCheckedChange={(checked) => update('showQuickstartSection', checked)} aria-label="展示快速接入板块" /></div>
        </div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>02</span><h2>顶部导航</h2></div><button className="aux-config-add aux-navigation-add" type="button" disabled={draft.navigationItems.length >= 8} onClick={() => update('navigationItems', [...draft.navigationItems, { label: '', href: '' }])}><Plus size={15} />添加菜单</button></div>
        <p className="aux-config-section-note">配置「进入控制台」左侧的菜单，最多 8 项，按列表顺序展示。支持 #security、#metrics、#quickstart、#developers、#ecosystem、#partners 等页内锚点，也支持站内路径和外部链接。对应板块关闭或合作伙伴为空时，该锚点菜单自动隐藏。</p>
        <div className="aux-navigation-editor">{draft.navigationItems.map((item, index) => <div className="aux-config-grid aux-navigation-row" key={`navigation-${index}`}>
          <label>菜单名称<input aria-label={`菜单 ${index + 1} 名称`} value={item.label} maxLength={24} onChange={(event) => updateNavigationItem(index, 'label', event.target.value)} placeholder="如：使用文档" /></label>
          <label>跳转链接<input aria-label={`菜单 ${index + 1} 链接`} value={item.href} onChange={(event) => updateNavigationItem(index, 'href', event.target.value)} placeholder="#metrics 或 https://docs.example.com" /></label>
          <div className="aux-navigation-actions">
            <button className="aux-config-reorder" type="button" aria-label={`上移菜单 ${index + 1}`} disabled={index === 0} onClick={() => moveNavigationItem(index, -1)}><ArrowUp size={16} /></button>
            <button className="aux-config-reorder" type="button" aria-label={`下移菜单 ${index + 1}`} disabled={index === draft.navigationItems.length - 1} onClick={() => moveNavigationItem(index, 1)}><ArrowDown size={16} /></button>
            <button className="aux-config-delete" type="button" aria-label={`删除菜单 ${index + 1}`} onClick={() => update('navigationItems', draft.navigationItems.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button>
          </div>
        </div>)}{draft.navigationItems.length === 0 ? <p className="aux-config-empty">未配置导航菜单，顶部仅显示品牌和「进入控制台」按钮。</p> : null}</div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>03</span><h2>合作伙伴</h2></div><button className="aux-config-add" type="button" onClick={() => update('trustedPartners', [...draft.trustedPartners, { ...EMPTY_PARTNER }])}><Plus size={15} />添加伙伴</button></div>
        <div className="aux-partner-editor">{draft.trustedPartners.map((partner, index) => <div className="aux-partner-row" key={`partner-${index}`}><input aria-label={`伙伴 ${index + 1} 名称`} value={partner.name} onChange={(event) => updatePartner(index, 'name', event.target.value)} placeholder="伙伴名称" /><input aria-label={`伙伴 ${index + 1} Logo`} value={partner.logoUrl ?? ''} onChange={(event) => updatePartner(index, 'logoUrl', event.target.value)} placeholder="Logo URL（可选）" /><input aria-label={`伙伴 ${index + 1} 链接`} value={partner.linkUrl ?? ''} onChange={(event) => updatePartner(index, 'linkUrl', event.target.value)} placeholder="官网 URL（可选）" /><button className="aux-config-delete" type="button" aria-label={`删除伙伴 ${index + 1}`} onClick={() => update('trustedPartners', draft.trustedPartners.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button></div>)}{draft.trustedPartners.length === 0 ? <p className="aux-config-empty">暂未添加伙伴。官网会展示默认邀请文案。</p> : null}</div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>04</span><h2>接入生态</h2></div><button className="aux-config-add" type="button" onClick={() => update('integrations', [...draft.integrations, { ...EMPTY_INTEGRATION }])}><Plus size={15} />添加应用</button></div>
        <p className="aux-config-section-note">维护官网生态板块中的应用 Logo 与文档链接，点击官网节点可查看对应文档。</p>
        <div className="aux-integration-editor">{draft.integrations.map((integration, index) => <div className="aux-integration-row" key={`integration-${index}`}><input aria-label={`应用 ${index + 1} 名称`} value={integration.name} onChange={(event) => update('integrations', draft.integrations.map((item, currentIndex) => currentIndex === index ? { ...item, name: event.target.value } : item))} placeholder="应用名称" /><input aria-label={`应用 ${index + 1} Logo`} value={integration.logoUrl ?? ''} onChange={(event) => update('integrations', draft.integrations.map((item, currentIndex) => currentIndex === index ? { ...item, logoUrl: event.target.value } : item))} placeholder="Logo URL" /><input aria-label={`应用 ${index + 1} 文档`} value={integration.documentationUrl ?? ''} onChange={(event) => update('integrations', draft.integrations.map((item, currentIndex) => currentIndex === index ? { ...item, documentationUrl: event.target.value } : item))} placeholder="文档 URL" /><button className="aux-config-delete" type="button" aria-label={`删除应用 ${index + 1}`} onClick={() => update('integrations', draft.integrations.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button></div>)}{draft.integrations.length === 0 ? <p className="aux-config-empty">暂未添加应用。添加后会显示在官网的接入生态板块。</p> : null}</div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>05</span><h2>服务指标</h2></div><p>这些数据会展示在官网首页，建议填写近期真实运行数据。</p></div>
        <div className="aux-config-grid">
          <label>服务可用性<input aria-label="服务可用性" value={draft.availability} onChange={(event) => update('availability', event.target.value)} placeholder="99.99%" /></label>
          <label>首 Token 响应时间<input aria-label="首 Token 响应时间" value={draft.firstTokenResponseTime} onChange={(event) => update('firstTokenResponseTime', event.target.value)} placeholder="≤ 200ms" /></label>
          <label>提示词缓存率<input aria-label="提示词缓存率" value={draft.promptCacheRate} onChange={(event) => update('promptCacheRate', event.target.value)} placeholder="≥ 85%" /></label>
          <label>可用性描述<textarea aria-label="可用性描述" value={draft.availabilityDescription} onChange={(event) => update('availabilityDescription', event.target.value)} rows={3} /></label>
          <label>首 Token 描述<textarea aria-label="首 Token 描述" value={draft.firstTokenResponseTimeDescription} onChange={(event) => update('firstTokenResponseTimeDescription', event.target.value)} rows={3} /></label>
          <label>缓存率描述<textarea aria-label="缓存率描述" value={draft.promptCacheRateDescription} onChange={(event) => update('promptCacheRateDescription', event.target.value)} rows={3} /></label>
        </div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>06</span><h2>资源与协议</h2></div><p>仅接受 HTTPS、HTTP、站内路径或锚点链接。</p></div>
        <div className="aux-config-grid">
          <label className="aux-config-span-2">使用文档 URL<input value={draft.documentationUrl} onChange={(event) => update('documentationUrl', event.target.value)} placeholder="https://docs.example.com" /></label>
          <label>服务条款 URL<input value={draft.termsUrl} onChange={(event) => update('termsUrl', event.target.value)} placeholder="https://…" /></label>
          <label>用户条款 URL<input value={draft.userTermsUrl} onChange={(event) => update('userTermsUrl', event.target.value)} placeholder="https://…" /></label>
          <label>隐私协议 URL<input value={draft.privacyUrl} onChange={(event) => update('privacyUrl', event.target.value)} placeholder="https://…" /></label>
          <label>控制台链接<input value={draft.consoleHref} onChange={(event) => update('consoleHref', event.target.value)} placeholder="/admin" /></label>
        </div>
      </section>
      {isTob ? <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>07</span><h2>全球网络节点</h2></div><p>配置地图上的主服务器、CDN 集群和客户位置，每类最多保存 32 个节点。</p></div>
        <div className="space-y-6">
          <div className="grid gap-4 border-b pb-6 md:grid-cols-2">
            <div className="aux-config-toggle"><div><strong>展示节点名称</strong><span>关闭后地图仍保留节点与悬停说明。</span></div><Switch checked={(draft as TobHomepageConfig).mapSettings.showNodeLabels} onCheckedChange={(checked) => updateMapSetting('showNodeLabels', checked)} aria-label="展示节点名称" /></div>
            <div className="aux-config-toggle"><div><strong>数据流动效果</strong><span>沿连线展示持续流动的数据点。</span></div><Switch checked={(draft as TobHomepageConfig).mapSettings.flowAnimation} onCheckedChange={(checked) => updateMapSetting('flowAnimation', checked)} aria-label="数据流动效果" /></div>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="tob-route-curvature">连线曲度</Label><output className="text-xs font-medium tabular-nums" htmlFor="tob-route-curvature">{(draft as TobHomepageConfig).mapSettings.routeCurvature}%</output></div>
              <Slider id="tob-route-curvature" aria-label="连线曲度" min={0} max={100} step={1} value={[(draft as TobHomepageConfig).mapSettings.routeCurvature]} onValueChange={([value]) => updateMapSetting('routeCurvature', value)} />
              <p className="text-xs text-muted-foreground">0 为直线，数值越高弧线跳跃感越强。</p>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="tob-node-size">节点大小</Label><output className="text-xs font-medium tabular-nums" htmlFor="tob-node-size">{(draft as TobHomepageConfig).mapSettings.nodeSize}%</output></div>
              <Slider id="tob-node-size" aria-label="节点大小" min={10} max={200} step={5} value={[(draft as TobHomepageConfig).mapSettings.nodeSize]} onValueChange={([value]) => updateMapSetting('nodeSize', value)} />
              <p className="text-xs text-muted-foreground">统一缩放主服务器、CDN 和客户节点。</p>
            </div>
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4 md:col-span-2">
              <Label>连线样式</Label>
              <div className="inline-flex rounded-md border bg-background p-1" role="group" aria-label="连线样式">
                <Button type="button" size="sm" variant={(draft as TobHomepageConfig).mapSettings.routeStyle === 'solid' ? 'default' : 'ghost'} aria-pressed={(draft as TobHomepageConfig).mapSettings.routeStyle === 'solid'} onClick={() => updateMapSetting('routeStyle', 'solid')}>实线</Button>
                <Button type="button" size="sm" variant={(draft as TobHomepageConfig).mapSettings.routeStyle === 'dashed' ? 'default' : 'ghost'} aria-pressed={(draft as TobHomepageConfig).mapSettings.routeStyle === 'dashed'} onClick={() => updateMapSetting('routeStyle', 'dashed')}>虚线</Button>
              </div>
            </div>
            <div className="grid gap-4 md:col-span-2 md:grid-cols-3">
              {MAP_COLOR_FIELDS.map(({ key, label }) => <div className="space-y-2 rounded-lg border bg-muted/30 p-4" key={key}>
                <Label htmlFor={`tob-map-${key}`}>{label}</Label>
                <div className="flex items-center gap-3">
                  <Input className="h-9 w-12 shrink-0 cursor-pointer p-1" type="color" aria-label={`${label}色板`} value={(draft as TobHomepageConfig).mapSettings[key]} onChange={(event) => updateMapSetting(key, event.target.value)} />
                  <Input id={`tob-map-${key}`} aria-label={label} value={(draft as TobHomepageConfig).mapSettings[key]} maxLength={7} spellCheck={false} onChange={(event) => updateMapSetting(key, event.target.value)} placeholder="#112233" />
                </div>
              </div>)}
            </div>
          </div>
          {NODE_SECTIONS.map(({ key, title, description }) => {
            const nodes = (draft as TobHomepageConfig)[key]
            return <div className="border-t pt-5 first:border-t-0 first:pt-0" key={key}>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
                <Button type="button" variant="outline" size="sm" disabled={nodes.length >= 32} onClick={() => addNode(key)}><Plus size={15} />添加{title}节点</Button>
              </div>
              <div className="space-y-3">
                {nodes.map((node, index) => <div className="grid gap-3 rounded-lg border bg-muted/30 p-4 md:grid-cols-[1.2fr_.7fr_.7fr_auto]" key={`${key}-${index}`}>
                  <div className="space-y-2"><Label htmlFor={`${key}-${index}-name`}>名称</Label><Input id={`${key}-${index}-name`} aria-label={`${title} ${index + 1} 名称`} value={node.name} maxLength={80} onChange={(event) => updateNode(key, index, 'name', event.target.value)} placeholder="例如：东京 CDN" /></div>
                  <div className="space-y-2"><Label htmlFor={`${key}-${index}-latitude`}>纬度</Label><Input id={`${key}-${index}-latitude`} aria-label={`${title} ${index + 1} 纬度`} type="number" step="any" min={-90} max={90} value={Number.isFinite(node.latitude) ? node.latitude : ''} onChange={(event) => updateNode(key, index, 'latitude', event.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor={`${key}-${index}-longitude`}>经度</Label><Input id={`${key}-${index}-longitude`} aria-label={`${title} ${index + 1} 经度`} type="number" step="any" min={-180} max={180} value={Number.isFinite(node.longitude) ? node.longitude : ''} onChange={(event) => updateNode(key, index, 'longitude', event.target.value)} /></div>
                  <div className="flex items-end justify-end"><Button type="button" variant="ghost" size="icon" aria-label={`删除${title} ${index + 1}`} onClick={() => removeNode(key, index)}><Trash2 size={16} /></Button></div>
                  <div className="space-y-2 md:col-span-3"><Label htmlFor={`${key}-${index}-description`}>说明</Label><Input id={`${key}-${index}-description`} aria-label={`${title} ${index + 1} 说明`} value={node.description ?? ''} maxLength={160} onChange={(event) => updateNode(key, index, 'description', event.target.value)} placeholder="可选" /></div>
                </div>)}
                {nodes.length === 0 ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">暂未添加{title}</p> : null}
              </div>
            </div>
          })}
        </div>
      </section> : null}
      <div className="aux-config-save-row"><span>{saving ? '正在保存…' : <><Check size={15} /> 更改会立即同步到公开页面</>}</span><button className="aux-config-save" type="button" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? '保存中' : '保存配置'}</button></div>
    </div>
  )
}
