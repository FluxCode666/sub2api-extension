import { useEffect, useState } from 'react'
import { ArrowUpRight, Check, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, type HomepageConfig, type TrustedPartner } from '@/lib/homepage'

const EMPTY_PARTNER: TrustedPartner = { name: '', logoUrl: '', linkUrl: '' }

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
        setDraft({ ...DEFAULT_HOMEPAGE_CONFIG, ...envelope.data, trustedPartners: envelope.data.trustedPartners ?? [] })
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

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const envelope = await apiClient.put<AuxEnvelope<HomepageConfig>>('/admin/homepage/config', draft)
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '保存失败')
      setDraft({ ...DEFAULT_HOMEPAGE_CONFIG, ...envelope.data, trustedPartners: envelope.data.trustedPartners ?? [] })
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
        <div><p className="aux-page-kicker">品牌与内容</p><h1>官网配置</h1><p>维护 Sub2API 官网的品牌信息、合作伙伴与合规协议链接。保存后会同步到独立官网和嵌入页面。</p></div>
        <a className="aux-config-preview" href="/sub2api-home" target="_blank" rel="noreferrer">预览官网 <ArrowUpRight size={15} /></a>
      </header>
      {error ? <div className="aux-config-error" role="alert">{error}</div> : null}
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>01</span><h2>品牌与 Hero</h2></div><p>首页首屏会优先使用这些内容，建议标题保持在两行以内。</p></div>
        <div className="aux-config-grid">
          <label>网站名称<input value={draft.siteName} onChange={(event) => update('siteName', event.target.value)} placeholder="Sub2API" /></label>
          <label>Hero 标签<input value={draft.heroLabel} onChange={(event) => update('heroLabel', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 标题<input value={draft.heroTitle} onChange={(event) => update('heroTitle', event.target.value)} /></label>
          <label className="aux-config-span-2">Hero 描述<textarea value={draft.heroDescription} onChange={(event) => update('heroDescription', event.target.value)} rows={3} /></label>
          <label>主按钮文字<input value={draft.primaryCta} onChange={(event) => update('primaryCta', event.target.value)} /></label>
          <label>主按钮链接<input value={draft.primaryHref} onChange={(event) => update('primaryHref', event.target.value)} placeholder="/login 或 https://…" /></label>
          <label>文档按钮文字<input value={draft.docsCta} onChange={(event) => update('docsCta', event.target.value)} /></label>
          <label>文档按钮链接<input value={draft.docsHref} onChange={(event) => update('docsHref', event.target.value)} placeholder="#developers 或 https://…" /></label>
        </div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>02</span><h2>受信赖的合作伙伴</h2></div><button className="aux-config-add" type="button" onClick={() => update('trustedPartners', [...draft.trustedPartners, { ...EMPTY_PARTNER }])}><Plus size={15} />添加伙伴</button></div>
        <div className="aux-partner-editor">{draft.trustedPartners.map((partner, index) => <div className="aux-partner-row" key={`${index}-${partner.name}`}><input aria-label={`伙伴 ${index + 1} 名称`} value={partner.name} onChange={(event) => updatePartner(index, 'name', event.target.value)} placeholder="伙伴名称" /><input aria-label={`伙伴 ${index + 1} Logo`} value={partner.logoUrl ?? ''} onChange={(event) => updatePartner(index, 'logoUrl', event.target.value)} placeholder="Logo URL（可选）" /><input aria-label={`伙伴 ${index + 1} 链接`} value={partner.linkUrl ?? ''} onChange={(event) => updatePartner(index, 'linkUrl', event.target.value)} placeholder="官网 URL（可选）" /><button className="aux-config-delete" type="button" aria-label={`删除伙伴 ${index + 1}`} onClick={() => update('trustedPartners', draft.trustedPartners.filter((_, currentIndex) => currentIndex !== index))}><Trash2 size={16} /></button></div>)}{draft.trustedPartners.length === 0 ? <p className="aux-config-empty">暂未添加伙伴。官网会展示默认邀请文案。</p> : null}</div>
      </section>
      <section className="aux-config-card">
        <div className="aux-config-section-heading"><div><span>03</span><h2>资源与协议</h2></div><p>仅接受 HTTPS、HTTP、站内路径或锚点链接。</p></div>
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
