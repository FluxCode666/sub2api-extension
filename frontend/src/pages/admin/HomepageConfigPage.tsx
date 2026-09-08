import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpRight, Check, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, isHomepageNavigationHref, type HomepageConfig, type HomepageNavigationItem, type IntegrationApp, type TrustedPartner } from '@/lib/homepage'
import { Switch } from '@/components/ui/switch'

const EMPTY_PARTNER: TrustedPartner = { name: '', logoUrl: '', linkUrl: '' }
const EMPTY_INTEGRATION: IntegrationApp = { name: '', logoUrl: '', documentationUrl: '' }

type ConfigDraft = HomepageConfig

export default function HomepageConfigPage() {
  const [draft, setDraft] = useState<ConfigDraft>(DEFAULT_HOMEPAGE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.get<AuxEnvelope<HomepageConfig>>('/admin/homepage/config')
      .then((envelope) => {
        if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取官网配置')
        setDraft({ ...DEFAULT_HOMEPAGE_CONFIG, ...envelope.data, navigationItems: envelope.data.navigationItems ?? DEFAULT_HOMEPAGE_CONFIG.navigationItems, trustedPartners: envelope.data.trustedPartners ?? [], integrations: envelope.data.integrations ?? [] })
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : '无法读取官网配置'))
      .finally(() => setLoading(false))
  }, [])

  const update = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) => {
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

  const save = async () => {
    const invalidIndex = draft.navigationItems.findIndex((item) => !item.label.trim() || !isHomepageNavigationHref(item.href))
    if (invalidIndex !== -1) {
      setError(`请为菜单 ${invalidIndex + 1} 填写名称和有效链接（页内锚点、站内路径或 HTTP/HTTPS 地址）。`)
      return
    }
    setSaving(true)
    setError('')
    try {
      const envelope = await apiClient.put<AuxEnvelope<HomepageConfig>>('/admin/homepage/config', draft)
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '保存失败')
      setDraft({ ...DEFAULT_HOMEPAGE_CONFIG, ...envelope.data, navigationItems: envelope.data.navigationItems ?? DEFAULT_HOMEPAGE_CONFIG.navigationItems, trustedPartners: envelope.data.trustedPartners ?? [], integrations: envelope.data.integrations ?? [] })
      toast.success('官网配置已保存')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '保存失败'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="aux-admin-page"><p>正在读取官网配置…</p></div>

  return (
    <div className="aux-admin-page aux-homepage-config-page">
      <header className="aux-page-header">
        <div><p className="aux-page-kicker">品牌与内容</p><h1>官网配置</h1><p>维护 Sub2API 官网的品牌信息、顶部导航、合作伙伴与合规协议链接。保存后会同步到独立官网和嵌入页面。</p></div>
        <a className="aux-config-preview" href="/sub2api-home" target="_blank" rel="noreferrer">预览官网 <ArrowUpRight size={15} /></a>
      </header>
      {error ? <div className="aux-config-error" role="alert">{error}</div> : null}
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>01</span><h2>品牌与 Hero</h2></div><p>首页首屏会优先使用这些内容，建议标题保持在两行以内。</p></div>
        <div className="aux-config-grid">
          <label>网站名称<input value={draft.siteName} onChange={(event) => update('siteName', event.target.value)} placeholder="Sub2API" /></label>
          <label>官网 Logo URL<input value={draft.siteLogoUrl} onChange={(event) => update('siteLogoUrl', event.target.value)} placeholder="https://example.com/logo.svg" /></label>
          <label>Hero 标签<input value={draft.heroLabel} onChange={(event) => update('heroLabel', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 标题<input value={draft.heroTitle} onChange={(event) => update('heroTitle', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 描述<textarea value={draft.heroDescription} onChange={(event) => update('heroDescription', event.target.value)} rows={3} /></label>
          <label>主按钮文字<input value={draft.primaryCta} onChange={(event) => update('primaryCta', event.target.value)} /></label>
          <label>主按钮链接<input value={draft.primaryHref} onChange={(event) => update('primaryHref', event.target.value)} placeholder="/login 或 https://…" /></label>
          <label>文档按钮文字<input value={draft.docsCta} onChange={(event) => update('docsCta', event.target.value)} /></label>
          <label>文档按钮链接<input value={draft.docsHref} onChange={(event) => update('docsHref', event.target.value)} placeholder="#developers 或 https://…" /></label>
          <div className="aux-config-toggle aux-config-span-2"><div><strong>展示开发者板块</strong><span>控制首页「BUILT FOR BUILDERS · 从代码，到增长」板块及其导航入口是否显示。</span></div><Switch checked={draft.showDevelopersSection} onCheckedChange={(checked) => update('showDevelopersSection', checked)} aria-label="展示开发者板块" /></div>
          <label className="aux-config-span-2">接入文档 URL<input value={draft.developersDocsUrl} onChange={(event) => update('developersDocsUrl', event.target.value)} placeholder="https://docs.example.com/quickstart" aria-describedby="developers-docs-help" /></label>
          <p className="aux-config-section-note aux-config-span-2" id="developers-docs-help">用于「BUILT FOR BUILDERS」板块的接入文档按钮。留空时使用下方「资源与协议」中的使用文档 URL；两者均为空时隐藏按钮。</p>
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
      <div className="aux-config-save-row"><span>{saving ? '正在保存…' : <><Check size={15} /> 更改会立即同步到公开页面</>}</span><button className="aux-config-save" type="button" onClick={() => void save()} disabled={saving}><Save size={16} />{saving ? '保存中' : '保存配置'}</button></div>
    </div>
  )
}
