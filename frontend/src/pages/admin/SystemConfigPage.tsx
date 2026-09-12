import { useCallback, useEffect, useState } from 'react'
import { CircleCheck, Info, RefreshCw, Save, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { Switch } from '@/components/ui/switch'
import './SystemConfigPage.css'

const DEFAULT_MODEL = 'gpt-6-astra'

/** 系统名称优先使用 siteName，兼容旧版 system_meta 配置中的 heroTitle。 */
interface HomepageConfig {
  siteName?: string
  systemDomain?: string
  heroLabel?: string
  heroTitle?: string
  heroDescription?: string
  model: string
  primaryCta?: string
  primaryHref?: string
  docsCta?: string
  docsHref?: string
  consoleHref?: string
  trustedPartners?: unknown[]
  sub2apiPublished?: boolean
  [key: string]: unknown
}

const DEFAULT_CONFIG: HomepageConfig = {
  heroLabel: '面向生产环境的 AI 网关',
  heroTitle: 'TERALEMO',
  systemDomain: '',
  heroDescription: '将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。',
  model: DEFAULT_MODEL,
  primaryCta: '获取接入方案',
  primaryHref: '#contact',
  docsCta: '查看开发者文档',
  docsHref: '#developers',
  consoleHref: '/admin',
  trustedPartners: [],
  sub2apiPublished: false,
}

function mergeConfig(value?: HomepageConfig): HomepageConfig {
  return { ...DEFAULT_CONFIG, ...(value ?? {}), model: value?.model?.trim() || DEFAULT_MODEL }
}

export default function SystemConfigPage() {
  const [config, setConfig] = useState<HomepageConfig>(DEFAULT_CONFIG)
  const [draftSystemName, setDraftSystemName] = useState(DEFAULT_CONFIG.heroTitle ?? '')
  const [draftSystemDomain, setDraftSystemDomain] = useState(DEFAULT_CONFIG.systemDomain ?? '')
  const [draftModel, setDraftModel] = useState(DEFAULT_MODEL)
  const [draftSub2APIPublished, setDraftSub2APIPublished] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const systemNameLimit = config.siteName !== undefined ? 80 : 160

  const loadConfig = useCallback(async (showToast = false) => {
    setError('')
    if (showToast) setRefreshing(true)
    try {
      const response = await apiClient.get<AuxEnvelope<HomepageConfig>>('/admin/homepage/config')
      if (response.code !== 0 || !response.data) throw new Error(response.message || '无法读取系统配置')
      const nextConfig = mergeConfig(response.data)
      setConfig(nextConfig)
      setDraftSystemName(nextConfig.siteName ?? nextConfig.heroTitle ?? DEFAULT_CONFIG.heroTitle ?? '')
      setDraftSystemDomain(nextConfig.systemDomain ?? DEFAULT_CONFIG.systemDomain ?? '')
      setDraftModel(nextConfig.model)
      setDraftSub2APIPublished(nextConfig.sub2apiPublished === true)
      if (showToast) toast.success('系统配置已刷新')
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '无法读取系统配置'
      setError(message)
      if (showToast) toast.error(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void loadConfig()
  }, [loadConfig])

  const saveConfig = async () => {
    const systemName = draftSystemName.trim()
    const systemDomain = draftSystemDomain.trim()
    const model = draftModel.trim()
    if (!systemName) {
      const message = '请填写 Sub2API 系统名称。'
      setError(message)
      toast.error(message)
      return
    }
    if (systemName.length > systemNameLimit) {
      const message = `Sub2API 系统名称不能超过 ${systemNameLimit} 个字符。`
      setError(message)
      toast.error(message)
      return
    }
    if (systemDomain && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(systemDomain)) {
      const message = 'Sub2API 系统域名必须是完整的 HTTP(S) 地址。'
      setError(message)
      toast.error(message)
      return
    }
    if (!model) {
      const message = '请填写默认模型名称。'
      setError(message)
      toast.error(message)
      return
    }
    if (model.length > 120) {
      const message = '模型名称不能超过 120 个字符。'
      setError(message)
      toast.error(message)
      return
    }

    setSaving(true)
    setError('')
    try {
      // 将已读取的完整配置一起提交，避免只保存 model 时覆盖其他兼容字段。
      const response = await apiClient.put<AuxEnvelope<HomepageConfig>>('/admin/homepage/config', {
        ...config,
        [config.siteName !== undefined ? 'siteName' : 'heroTitle']: systemName,
        systemDomain,
        model,
        sub2apiPublished: draftSub2APIPublished,
      })
      if (response.code !== 0 || !response.data) throw new Error(response.message || '系统配置保存失败')
      const savedConfig = mergeConfig(response.data)
      setConfig(savedConfig)
      setDraftSystemName(savedConfig.siteName ?? savedConfig.heroTitle ?? DEFAULT_CONFIG.heroTitle ?? '')
      setDraftSystemDomain(savedConfig.systemDomain ?? DEFAULT_CONFIG.systemDomain ?? '')
      setDraftModel(savedConfig.model)
      setDraftSub2APIPublished(savedConfig.sub2apiPublished === true)
      toast.success('系统配置已保存', { description: 'Sub2API 系统名称和 API 文档中的调用示例会立即更新。' })
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '系统配置保存失败'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = () => {
    setDraftSystemName(DEFAULT_CONFIG.heroTitle ?? '')
    setDraftSystemDomain(DEFAULT_CONFIG.systemDomain ?? '')
    setDraftModel(DEFAULT_MODEL)
    setDraftSub2APIPublished(false)
    setError('')
  }

  if (loading) {
    return (
      <div className="aux-system-config-page aux-system-config-state">
        <RefreshCw className="aux-system-config-spin" aria-hidden="true" />
        <span>正在读取系统配置…</span>
      </div>
    )
  }

  return (
    <div className="aux-system-config-page">
      <header className="aux-system-config-header">
        <div>
          <p className="aux-system-config-eyebrow"><Settings2 aria-hidden="true" />控制台设置 / 系统配置</p>
          <h1>系统配置</h1>
          <p>统一管理 Sub2API 系统名称与开发者文档中展示的默认调用模型。保存后无需重新部署页面。</p>
        </div>
        <button type="button" className="aux-system-config-refresh" onClick={() => void loadConfig(true)} disabled={refreshing || saving}>
          <RefreshCw className={refreshing ? 'aux-system-config-spin' : ''} aria-hidden="true" />
          {refreshing ? '刷新中…' : '刷新配置'}
        </button>
      </header>

      {error && <div className="aux-system-config-alert" role="alert">{error}</div>}

      <div className="aux-system-config-layout">
        <section className="aux-system-config-card aux-system-config-form-card">
          <div className="aux-system-config-card-heading">
            <div>
              <span className="aux-system-config-card-kicker">Developer defaults</span>
              <h2>Sub2API 系统名称与 API 文档默认值</h2>
            </div>
            <span className="aux-system-config-status"><CircleCheck aria-hidden="true" />实时生效</span>
          </div>
          <p className="aux-system-config-description">系统名称会显示在 API 文档和客户端接入文档页脚；系统域名会作为接入文档 API 基础地址的默认值；默认模型会显示在首页预览、快速开始 cURL，以及各接口的多语言示例中。</p>
          <label className="aux-system-config-field" htmlFor="system-name">
            <span>Sub2API 系统名称</span>
            <input
              id="system-name"
              aria-label="Sub2API 系统名称"
              value={draftSystemName}
              maxLength={systemNameLimit}
              autoComplete="organization"
              onChange={(event) => setDraftSystemName(event.target.value)}
            />
            <small>用于 API 文档的 Sub2API 品牌标识，例如 <code>TERALEMO</code>。</small>
          </label>
          <label className="aux-system-config-field" htmlFor="system-domain">
            <span>Sub2API 系统域名</span>
            <input
              id="system-domain"
              aria-label="Sub2API 系统域名"
              value={draftSystemDomain}
              maxLength={300}
              inputMode="url"
              autoComplete="url"
              placeholder="https://api.example.com"
              onChange={(event) => setDraftSystemDomain(event.target.value)}
            />
            <small>用于客户端接入文档的「API 基础地址」默认值，请填写完整的 HTTP(S) 域名。</small>
          </label>
          <label className="aux-system-config-field" htmlFor="system-example-model">
            <span>模型名称</span>
            <input
              id="system-example-model"
              aria-label="模型名称"
              value={draftModel}
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              placeholder={DEFAULT_MODEL}
              onChange={(event) => setDraftModel(event.target.value)}
            />
            <small>填写当前可用的模型 ID，例如 <code>gpt-6-astra</code>。</small>
          </label>
          <div className="aux-system-config-publication">
            <div>
              <span>上架到 Sub2API</span>
              <small>开启后会将当前系统入口添加到 Sub2API 用户菜单，关闭后会移除该菜单项。</small>
            </div>
            <Switch
              checked={draftSub2APIPublished}
              onCheckedChange={setDraftSub2APIPublished}
              disabled={saving}
              aria-label="上架到 Sub2API"
            />
          </div>
          <div className="aux-system-config-actions">
            <button type="button" className="aux-system-config-secondary" onClick={restoreDefault} disabled={saving || (draftSystemName === (DEFAULT_CONFIG.heroTitle ?? '') && draftSystemDomain === (DEFAULT_CONFIG.systemDomain ?? '') && draftModel === DEFAULT_MODEL)}>恢复默认</button>
            <button type="button" className="aux-system-config-primary" onClick={() => void saveConfig()} disabled={saving || !draftSystemName.trim() || !draftModel.trim()}>
              <Save aria-hidden="true" />{saving ? '保存中…' : '保存配置'}
            </button>
          </div>
        </section>

        <aside className="aux-system-config-card aux-system-config-preview-card">
          <div className="aux-system-config-preview-mark"><Settings2 aria-hidden="true" /></div>
          <span className="aux-system-config-card-kicker">Current value</span>
          <h2>示例将使用</h2>
          <code className="aux-system-config-model-preview">{draftModel.trim() || DEFAULT_MODEL}</code>
          <div className="aux-system-config-info"><Info aria-hidden="true" /><span>配置保存在附属系统的 system_meta 中，公开 API 文档只读取 Sub2API 系统名称和模型名称，不会暴露管理会话。</span></div>
        </aside>
      </div>
    </div>
  )
}
