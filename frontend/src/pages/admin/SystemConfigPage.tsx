import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { BadgeCheck, BookOpen, CircleCheck, ImageIcon, Loader2, LocateFixed, PanelsTopLeft, RefreshCw, Save, Settings2, ShieldCheck, Trash2, TriangleAlert, UploadCloud } from 'lucide-react'
import { toast } from 'sonner'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_SUB2API_SYSTEM_NAME, resolveSystemName } from '@/lib/system-name'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DEFAULT_SYSTEM_POSITION, normalizeSystemPosition, type SystemPosition } from '@/lib/system-position'
import './SystemConfigPage.css'
import { ClientImportPolicyCard } from './ClientImportPolicyCard'
import { SystemConfigNav, SystemConfigSectionHeading as SectionHeading, useSystemConfigScrollSpy, type SystemConfigNavGroup } from './SystemConfigNav'
import { toCurrentOriginURI, withAppBasePath } from '@/lib/app-base-path'

const SECTION_IDS = {
  brand: 'system-config-brand',
  docs: 'system-config-docs',
  menu: 'system-config-menu',
  clientImport: 'system-config-client-import',
} as const

/** 共用「保存配置」的基础配置分类。 */
const BASIC_SECTIONS = [
  { id: SECTION_IDS.brand, title: '品牌标识', hint: '系统名称与 Logo', icon: BadgeCheck },
  { id: SECTION_IDS.docs, title: '文档与站点', hint: '系统域名、默认模型与定位', icon: BookOpen },
  { id: SECTION_IDS.menu, title: 'Sub2API 菜单', hint: '公网地址与菜单上架', icon: PanelsTopLeft },
]

const NAV_GROUPS: SystemConfigNavGroup[] = [
  { label: '基础配置', note: '统一保存', sections: BASIC_SECTIONS },
  {
    label: '访问控制',
    note: '独立保存',
    sections: [{ id: SECTION_IDS.clientImport, title: '客户端导入限制', hint: '导入白名单与多模型候选', icon: ShieldCheck }],
  },
]

const SECTION_ORDER = NAV_GROUPS.flatMap((group) => group.sections.map((section) => section.id))

const DEFAULT_MODEL = 'gpt-6-astra'
const ALLOWED_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const EXTENSION_PUBLIC_URL_LIMIT = 300

/** Sub2API 菜单实际使用的扩展地址；source 为 config（系统配置）、env（环境变量）或空（未配置）。 */
interface MenuPublication {
  available: boolean
  effectiveUrl: string
  source: '' | 'config' | 'env'
}

interface UploadedImageAsset {
  id: number
  url?: string
}

/** 系统名称优先使用 siteName，兼容旧版 system_meta 配置中的 heroTitle。 */
interface HomepageConfig {
  siteName?: string
  systemPosition?: SystemPosition
  systemDomain?: string
  siteLogoUrl?: string
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
  clientImportPublished?: boolean
  asyncTasksPublished?: boolean
  extensionPublicUrl?: string
  menuPublication?: MenuPublication
  [key: string]: unknown
}

const DEFAULT_CONFIG: HomepageConfig = {
  siteName: DEFAULT_SUB2API_SYSTEM_NAME,
  systemPosition: DEFAULT_SYSTEM_POSITION,
  heroLabel: '面向生产环境的 AI 网关',
  heroTitle: 'AI API 网关，面向下一次调用',
  systemDomain: '',
  siteLogoUrl: '',
  heroDescription: '将安全准入、智能路由、稳定保障、用量管理与运行观测统一到同一网关层。',
  model: DEFAULT_MODEL,
  primaryCta: '获取接入方案',
  primaryHref: '#contact',
  docsCta: '查看开发者文档',
  docsHref: '#developers',
  consoleHref: '/admin',
  trustedPartners: [],
  sub2apiPublished: false,
  clientImportPublished: false,
  asyncTasksPublished: false,
  extensionPublicUrl: '',
}

/** 与后端 NormalizeExtensionPublicURL 一致：仅接受无账号、查询串和片段的 HTTP(S) 基础地址。 */
function normalizeExtensionPublicUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  if (trimmed.length > EXTENSION_PUBLIC_URL_LIMIT || /[\s\\#]/.test(trimmed)) return null
  try {
    const parsed = new URL(trimmed)
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !parsed.host) return null
    if (parsed.username || parsed.password || parsed.search || trimmed.includes('?')) return null
    return trimmed
  } catch {
    return null
  }
}

function describeMenuPublication(publication?: MenuPublication): { text: string; warning: boolean } {
  if (!publication?.effectiveUrl) {
    return { text: '当前未配置：Sub2API 菜单无法上架扩展控制台、发票、工单等入口。', warning: true }
  }
  const source = publication.source === 'config' ? '系统配置' : '环境变量 SUB2API_EXTENSION_PUBLIC_URL'
  return { text: `当前生效：${publication.effectiveUrl}（来自${source}）`, warning: false }
}

function mergeConfig(value?: HomepageConfig): HomepageConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(value ?? {}),
    siteName: resolveSystemName(value),
    systemPosition: normalizeSystemPosition(value?.systemPosition),
    model: value?.model?.trim() || DEFAULT_MODEL,
  }
}

export default function SystemConfigPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const { activeId, jumpTo } = useSystemConfigScrollSpy(SECTION_ORDER, pageRef)
  const [clientImportDirty, setClientImportDirty] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const logoDragDepthRef = useRef(0)
  const [config, setConfig] = useState<HomepageConfig>(DEFAULT_CONFIG)
  const [draftSystemName, setDraftSystemName] = useState(DEFAULT_CONFIG.siteName ?? DEFAULT_SUB2API_SYSTEM_NAME)
  const [draftSystemPosition, setDraftSystemPosition] = useState<SystemPosition>(DEFAULT_SYSTEM_POSITION)
  const [draftSystemDomain, setDraftSystemDomain] = useState(DEFAULT_CONFIG.systemDomain ?? '')
  const [draftSiteLogoUrl, setDraftSiteLogoUrl] = useState(DEFAULT_CONFIG.siteLogoUrl ?? '')
  const [draftModel, setDraftModel] = useState(DEFAULT_MODEL)
  const [draftSub2APIPublished, setDraftSub2APIPublished] = useState(false)
  const [draftClientImportPublished, setDraftClientImportPublished] = useState(false)
  const [draftAsyncTasksPublished, setDraftAsyncTasksPublished] = useState(false)
  const [draftExtensionPublicUrl, setDraftExtensionPublicUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoDragActive, setLogoDragActive] = useState(false)
  const [logoPreviewFailed, setLogoPreviewFailed] = useState(false)
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
      setDraftSystemName(resolveSystemName(nextConfig))
      setDraftSystemPosition(normalizeSystemPosition(nextConfig.systemPosition))
      setDraftSystemDomain(nextConfig.systemDomain ?? DEFAULT_CONFIG.systemDomain ?? '')
      setDraftSiteLogoUrl(nextConfig.siteLogoUrl?.trim() ?? '')
      setDraftModel(nextConfig.model)
      setDraftSub2APIPublished(nextConfig.sub2apiPublished === true)
      setDraftClientImportPublished(nextConfig.clientImportPublished === true)
      setDraftAsyncTasksPublished(nextConfig.asyncTasksPublished === true)
      setDraftExtensionPublicUrl(nextConfig.extensionPublicUrl?.trim() ?? '')
      setLogoPreviewFailed(false)
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

  const uploadLogo = async (file: File) => {
    setError('')
    if (!ALLOWED_LOGO_TYPES.has(file.type)) {
      const message = '只能上传 PNG、JPEG、GIF 或 WebP 图片。'
      setError(message)
      toast.error(message)
      if (logoInputRef.current) logoInputRef.current.value = ''
      return
    }
    if (uploadingLogo || saving) return

    setUploadingLogo(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await apiClient.upload<AuxEnvelope<UploadedImageAsset>>('/admin/assets', formData, { timeout: 0 })
      const uploadedURL = response.data?.url?.trim() || (response.data?.id ? `/api/aux/assets/${response.data.id}` : '')
      if (response.code !== 0 || !uploadedURL) throw new Error(response.message || 'Logo 上传失败')
      setDraftSiteLogoUrl(uploadedURL)
      setLogoPreviewFailed(false)
      toast.success('Logo 上传成功', { description: '保存系统配置后，公开页面将使用新 Logo。' })
    } catch (reason) {
      console.error('[SystemConfigPage] failed to upload logo', reason)
      const message = reason instanceof Error ? reason.message : 'Logo 上传失败，请稍后重试。'
      setError(message)
      toast.error(message)
    } finally {
      setUploadingLogo(false)
      if (logoInputRef.current) logoInputRef.current.value = ''
    }
  }

  const handleLogoFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void uploadLogo(file)
  }

  const handleLogoDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (uploadingLogo || saving) return
    logoDragDepthRef.current += 1
    setLogoDragActive(true)
  }

  const handleLogoDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!uploadingLogo && !saving) event.dataTransfer.dropEffect = 'copy'
  }

  const handleLogoDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    logoDragDepthRef.current = Math.max(0, logoDragDepthRef.current - 1)
    if (logoDragDepthRef.current === 0) setLogoDragActive(false)
  }

  const handleLogoDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    logoDragDepthRef.current = 0
    setLogoDragActive(false)
    if (uploadingLogo || saving) return
    const file = event.dataTransfer.files?.[0]
    if (file) void uploadLogo(file)
  }

  const removeLogo = () => {
    setDraftSiteLogoUrl('')
    setLogoPreviewFailed(false)
    setError('')
  }

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
    const extensionPublicUrl = normalizeExtensionPublicUrl(draftExtensionPublicUrl)
    if (extensionPublicUrl === null) {
      const message = '扩展系统公网地址必须是完整的 HTTP(S) 地址，且不能包含账号、查询参数或 # 片段。'
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
      // 将已读取的完整配置一起提交，避免只保存 model 时覆盖其他兼容字段；
      // menuPublication 是服务端计算的只读状态，不回传。
      const { menuPublication: _menuPublication, ...persistedConfig } = config
      const response = await apiClient.put<AuxEnvelope<HomepageConfig>>('/admin/homepage/config', {
        ...persistedConfig,
        [config.siteName !== undefined ? 'siteName' : 'heroTitle']: systemName,
        systemPosition: draftSystemPosition,
        systemDomain,
        siteLogoUrl: draftSiteLogoUrl,
        model,
        sub2apiPublished: draftSub2APIPublished,
        clientImportPublished: draftClientImportPublished,
        asyncTasksPublished: draftAsyncTasksPublished,
        extensionPublicUrl,
      })
      if (response.code !== 0 || !response.data) throw new Error(response.message || '系统配置保存失败')
      const savedConfig = mergeConfig(response.data)
      setConfig(savedConfig)
      setDraftSystemName(resolveSystemName(savedConfig))
      setDraftSystemPosition(normalizeSystemPosition(savedConfig.systemPosition))
      setDraftSystemDomain(savedConfig.systemDomain ?? DEFAULT_CONFIG.systemDomain ?? '')
      setDraftSiteLogoUrl(savedConfig.siteLogoUrl?.trim() ?? '')
      setDraftModel(savedConfig.model)
      setDraftSub2APIPublished(savedConfig.sub2apiPublished === true)
      setDraftClientImportPublished(savedConfig.clientImportPublished === true)
      setDraftAsyncTasksPublished(savedConfig.asyncTasksPublished === true)
      setDraftExtensionPublicUrl(savedConfig.extensionPublicUrl?.trim() ?? '')
      setLogoPreviewFailed(false)
      if (response.reason) {
        toast.warning('系统配置已保存，但菜单同步未完成', { description: response.reason })
      } else {
        toast.success('系统配置已保存', { description: 'Sub2API 系统名称、Logo 和 API 文档中的调用示例会立即更新。' })
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '系统配置保存失败'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const restoreDefault = () => {
    setDraftSystemName(DEFAULT_CONFIG.siteName ?? DEFAULT_SUB2API_SYSTEM_NAME)
    setDraftSystemPosition(DEFAULT_SYSTEM_POSITION)
    setDraftSystemDomain(DEFAULT_CONFIG.systemDomain ?? '')
    setDraftSiteLogoUrl(DEFAULT_CONFIG.siteLogoUrl ?? '')
    setDraftModel(DEFAULT_MODEL)
    setDraftSub2APIPublished(false)
    setDraftClientImportPublished(false)
    setDraftAsyncTasksPublished(false)
    setDraftExtensionPublicUrl('')
    setLogoPreviewFailed(false)
    setError('')
  }

  const fillCurrentOrigin = () => {
    setDraftExtensionPublicUrl(toCurrentOriginURI('/').replace(/\/+$/, ''))
  }

  const publicationHint = describeMenuPublication(config.menuPublication)

  const draftIsDefault = draftSystemName === (DEFAULT_CONFIG.siteName ?? DEFAULT_SUB2API_SYSTEM_NAME)
    && draftSystemPosition === DEFAULT_SYSTEM_POSITION
    && draftSystemDomain === (DEFAULT_CONFIG.systemDomain ?? '')
    && draftSiteLogoUrl === (DEFAULT_CONFIG.siteLogoUrl ?? '')
    && draftModel === DEFAULT_MODEL
    && !draftSub2APIPublished
    && !draftClientImportPublished
    && !draftAsyncTasksPublished
    && draftExtensionPublicUrl === ''

  // 各分类相对已保存配置的未保存修改，用于目录标记和保存栏提示。
  const dirtyIds = new Set<string>()
  if (draftSystemName !== resolveSystemName(config) || draftSiteLogoUrl !== (config.siteLogoUrl?.trim() ?? '')) dirtyIds.add(SECTION_IDS.brand)
  if (
    draftSystemDomain !== (config.systemDomain ?? '')
    || draftModel !== config.model
    || draftSystemPosition !== normalizeSystemPosition(config.systemPosition)
  ) dirtyIds.add(SECTION_IDS.docs)
  if (
    draftExtensionPublicUrl !== (config.extensionPublicUrl?.trim() ?? '')
    || draftSub2APIPublished !== (config.sub2apiPublished === true)
    || draftClientImportPublished !== (config.clientImportPublished === true)
    || draftAsyncTasksPublished !== (config.asyncTasksPublished === true)
  ) dirtyIds.add(SECTION_IDS.menu)
  const dirtyBasicTitles = BASIC_SECTIONS.filter((section) => dirtyIds.has(section.id)).map((section) => section.title)
  if (clientImportDirty) dirtyIds.add(SECTION_IDS.clientImport)

  if (loading) {
    return (
      <div ref={pageRef} className="aux-system-config-page aux-system-config-state">
        <RefreshCw className="aux-system-config-spin" aria-hidden="true" />
        <span>正在读取系统配置…</span>
      </div>
    )
  }

  return (
    <div ref={pageRef} className="aux-system-config-page">
      <header className="aux-system-config-header">
        <div>
          <p className="aux-system-config-eyebrow"><Settings2 aria-hidden="true" />控制台设置 / 系统配置</p>
          <h1>系统配置</h1>
          <p>按类别管理 Sub2API 品牌、文档默认值、菜单集成与客户端导入限制；通过目录快速定位，保存后无需重新部署页面。</p>
        </div>
        <Button type="button" variant="outline" className="aux-system-config-refresh" onClick={() => void loadConfig(true)} disabled={refreshing || saving || uploadingLogo}>
          <RefreshCw className={refreshing ? 'aux-system-config-spin' : ''} aria-hidden="true" />
          {refreshing ? '刷新中…' : '刷新配置'}
        </Button>
      </header>

      {error && <div className="aux-system-config-alert" role="alert">{error}</div>}

      <div className="aux-system-config-shell">
        <SystemConfigNav groups={NAV_GROUPS} activeId={activeId} dirtyIds={dirtyIds} onSelect={jumpTo} />

        <div className="aux-system-config-layout">
          <div className="aux-system-config-group">
            <section id={SECTION_IDS.brand} className="aux-system-config-card aux-system-config-form-card aux-system-config-section" aria-labelledby={`${SECTION_IDS.brand}-title`}>
              <SectionHeading id={SECTION_IDS.brand} icon={BadgeCheck} title="品牌标识" />
              <p className="aux-system-config-description">系统名称和 Logo 会显示在官网、API 文档与客户端接入页中。</p>
              <div className="aux-system-config-field">
                <Label htmlFor="system-name">Sub2API 系统名称</Label>
                <Input
                  id="system-name"
                  aria-label="Sub2API 系统名称"
                  value={draftSystemName}
                  maxLength={systemNameLimit}
                  autoComplete="organization"
                  onChange={(event) => setDraftSystemName(event.target.value)}
                />
                <small>填写 Sub2API「系统设置」中使用的系统名称，公开页面会统一读取此值。</small>
              </div>
              <div className="aux-system-config-field aux-system-config-logo-field">
                <Label htmlFor="system-logo-file">Sub2API 系统 Logo</Label>
                <div
                  className={`aux-system-config-logo-upload${logoDragActive ? ' is-dragging' : ''}${uploadingLogo ? ' is-uploading' : ''}`}
                  role="group"
                  aria-label="Logo 上传区域"
                  aria-busy={uploadingLogo}
                  data-dragging={logoDragActive}
                  onDragEnter={handleLogoDragEnter}
                  onDragOver={handleLogoDragOver}
                  onDragLeave={handleLogoDragLeave}
                  onDrop={handleLogoDrop}
                >
                  <div className={`aux-system-config-logo-preview${logoPreviewFailed ? ' is-error' : ''}`}>
                    {draftSiteLogoUrl && !logoPreviewFailed ? (
                      <img src={withAppBasePath(draftSiteLogoUrl)} alt="Sub2API 系统 Logo 预览" onError={() => setLogoPreviewFailed(true)} />
                    ) : (
                      <ImageIcon aria-hidden="true" />
                    )}
                    {uploadingLogo && <span className="aux-system-config-logo-progress"><Loader2 aria-hidden="true" /></span>}
                  </div>
                  <div className="aux-system-config-logo-copy">
                    <strong>{logoPreviewFailed ? '当前 Logo 无法预览' : draftSiteLogoUrl ? '替换当前 Logo' : '拖拽图片到这里上传'}</strong>
                    <p>{logoPreviewFailed ? '请重新上传有效图片。' : '支持 PNG、JPEG、GIF、WebP，一次上传一张图片。'}</p>
                    <div className="aux-system-config-logo-actions">
                      <Input
                        ref={logoInputRef}
                        id="system-logo-file"
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        className="aux-system-config-logo-input sr-only"
                        aria-label="上传 Sub2API 系统 Logo"
                        tabIndex={-1}
                        onChange={handleLogoFileChange}
                        disabled={uploadingLogo || saving}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={() => logoInputRef.current?.click()} disabled={uploadingLogo || saving}>
                        {uploadingLogo ? <Loader2 className="aux-system-config-spin" aria-hidden="true" /> : <UploadCloud aria-hidden="true" />}
                        {uploadingLogo ? '正在上传…' : draftSiteLogoUrl ? '选择新图片' : '选择图片'}
                      </Button>
                      {draftSiteLogoUrl && (
                        <Button type="button" variant="outline" size="sm" className="aux-system-config-logo-remove" onClick={removeLogo} disabled={uploadingLogo || saving}>
                          <Trash2 aria-hidden="true" />移除 Logo
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
                <small>图片上传后会进入文件管理；点击“保存配置”后，官网与 API 文档会统一使用此 Logo。</small>
                <span className="sr-only" aria-live="polite">{uploadingLogo ? 'Logo 正在上传' : draftSiteLogoUrl ? 'Logo 已选择，等待保存配置' : '当前未配置 Logo'}</span>
              </div>
            </section>

            <section id={SECTION_IDS.docs} className="aux-system-config-card aux-system-config-form-card aux-system-config-section" aria-labelledby={`${SECTION_IDS.docs}-title`}>
              <SectionHeading id={SECTION_IDS.docs} icon={BookOpen} title="文档与站点" />
              <p className="aux-system-config-description">系统域名会作为动态页面与接入文档的默认地址；默认模型显示在首页预览、快速开始 cURL 与各接口多语言示例中；系统定位决定文档页“官网”按钮进入 ToC 还是 ToB 官网。</p>
              <div className="aux-system-config-field">
                <Label htmlFor="system-domain">Sub2API 系统域名</Label>
                <Input
                  id="system-domain"
                  aria-label="Sub2API 系统域名"
                  value={draftSystemDomain}
                  maxLength={300}
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://api.example.com"
                  onChange={(event) => setDraftSystemDomain(event.target.value)}
                />
                <small>提供给动态页面的系统域名变量；接入文档默认使用浏览器当前访问的站点域名。</small>
              </div>
              <div className="aux-system-config-field">
                <Label htmlFor="system-example-model">模型名称</Label>
                <Input
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
              </div>
              <div className="aux-system-config-position">
                <div>
                  <span>系统定位</span>
                  <small>{draftSystemPosition === 'tob' ? '当前为 ToB 企业端，API 文档与接入文档的官网按钮进入 ToB 官网。' : '当前为 ToC 用户端，API 文档与接入文档的官网按钮进入 ToC 官网。'}</small>
                </div>
                <div className="aux-system-config-position-control">
                  <span aria-hidden="true">{draftSystemPosition === 'tob' ? 'ToB' : 'ToC'}</span>
                  <Switch
                    checked={draftSystemPosition === 'tob'}
                    onCheckedChange={(checked) => setDraftSystemPosition(checked ? 'tob' : 'toc')}
                    disabled={saving}
                    aria-label="系统定位 ToB"
                  />
                </div>
              </div>
            </section>

            <section id={SECTION_IDS.menu} className="aux-system-config-card aux-system-config-form-card aux-system-config-section" aria-labelledby={`${SECTION_IDS.menu}-title`}>
              <SectionHeading
                id={SECTION_IDS.menu}
                icon={PanelsTopLeft}
                title="Sub2API 菜单"
                status={publicationHint.warning
                  ? <span className="aux-system-config-status is-warning"><TriangleAlert aria-hidden="true" />菜单地址未配置</span>
                  : <span className="aux-system-config-status"><CircleCheck aria-hidden="true" />菜单地址已生效</span>}
              />
              <p className="aux-system-config-description">配置扩展系统的公网地址，并选择要上架到 Sub2API 管理员或用户菜单的入口；保存时会同步 Sub2API 菜单。</p>
              <div className="aux-system-config-field aux-system-config-extension-url">
                <Label htmlFor="extension-public-url">扩展系统公网地址</Label>
                <div className="aux-system-config-url-row">
                  <Input
                    id="extension-public-url"
                    aria-label="扩展系统公网地址"
                    aria-describedby="extension-public-url-hint extension-public-url-status"
                    value={draftExtensionPublicUrl}
                    maxLength={EXTENSION_PUBLIC_URL_LIMIT}
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder="https://example.com/aux"
                    disabled={saving}
                    onChange={(event) => setDraftExtensionPublicUrl(event.target.value)}
                  />
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="outline" size="icon" className="aux-system-config-url-action" onClick={fillCurrentOrigin} disabled={saving} aria-label="使用当前访问地址">
                          <LocateFixed aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>使用当前访问地址</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <small id="extension-public-url-hint">浏览器访问本扩展的完整地址（含反向代理路径，如 <code>/aux</code>），用于生成 Sub2API 菜单链接；留空则使用环境变量 <code>SUB2API_EXTENSION_PUBLIC_URL</code>。</small>
                <small id="extension-public-url-status" className={publicationHint.warning ? 'is-warning' : undefined}>{publicationHint.text}</small>
              </div>
              <div className="aux-system-config-publication">
                <div>
                  <span>扩展控制台上架到 Sub2API</span>
                  <small>开启后会将扩展控制台入口添加到 Sub2API 管理员菜单，关闭后会移除该菜单项。</small>
                </div>
                <Switch
                  checked={draftSub2APIPublished}
                  onCheckedChange={setDraftSub2APIPublished}
                  disabled={saving}
                  aria-label="上架到 Sub2API"
                />
              </div>
              <div className="aux-system-config-publication">
                <div>
                  <span>客户端导入页上架到 Sub2API</span>
                  <small>开启后会将“客户端导入”添加到 Sub2API 用户菜单，用户可选择 API Key 并导入 CC Switch、Cherry Studio 或 ChatBox。</small>
                </div>
                <Switch
                  checked={draftClientImportPublished}
                  onCheckedChange={setDraftClientImportPublished}
                  disabled={saving}
                  aria-label="客户端导入页上架到 Sub2API"
                />
              </div>
              <div className="aux-system-config-publication">
                <div>
                  <span>异步任务页上架到 Sub2API</span>
                  <small>开启后会将“异步任务”添加到 Sub2API 用户菜单，用户可查看自己近期的异步生图、视频生成和批量生图任务。</small>
                </div>
                <Switch
                  checked={draftAsyncTasksPublished}
                  onCheckedChange={setDraftAsyncTasksPublished}
                  disabled={saving}
                  aria-label="异步任务页上架到 Sub2API"
                />
              </div>
            </section>

            <div className={`aux-system-config-savebar${dirtyBasicTitles.length ? ' is-dirty' : ''}`} role="region" aria-label="基础配置保存">
              <p className="aux-system-config-savebar-status" aria-live="polite">
                {dirtyBasicTitles.length
                  ? <><span className="aux-system-config-savebar-dot" aria-hidden="true" />未保存：{dirtyBasicTitles.join('、')}</>
                  : <><CircleCheck aria-hidden="true" />基础配置已保存</>}
                <small>品牌标识、文档与站点、Sub2API 菜单统一保存</small>
              </p>
              <div className="aux-system-config-savebar-actions">
                <Button type="button" variant="outline" className="aux-system-config-secondary" onClick={restoreDefault} disabled={saving || uploadingLogo || draftIsDefault}>恢复默认</Button>
                <Button type="button" className="aux-system-config-primary" onClick={() => void saveConfig()} disabled={saving || uploadingLogo || !draftSystemName.trim() || !draftModel.trim()}>
                  <Save aria-hidden="true" />{saving ? '保存中…' : '保存配置'}
                </Button>
              </div>
            </div>
          </div>

          <ClientImportPolicyCard id={SECTION_IDS.clientImport} onDirtyChange={setClientImportDirty} />
        </div>
      </div>
    </div>
  )
}
