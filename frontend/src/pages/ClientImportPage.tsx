import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowLeft, ArrowUpRight, Check, Download, ExternalLink, KeyRound, Link2, LockKeyhole, Sparkles, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import ErrorState from '@/components/ErrorState'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { buildCCSwitchImportURL, buildConfigFile, buildDirectImportURL, CLIENT_IMPORT_TARGETS, configFileName, defaultImportBaseURL, getClientImportTarget, maskAPIKey, normalizeImportBaseURL, type ClientConfigTargetId, type ClientImportKey, type ClientImportTargetId, type DirectImportTargetId } from '@/lib/client-import'
import { fetchHomepageConfig } from '@/lib/homepage'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { withAppBasePath } from '@/lib/app-base-path'
import { isEmbeddedDocument } from '@/lib/embedded'
import '@fontsource-variable/geist'
import './ClientImportPage.css'

type TargetKind = 'cc-switch' | 'direct-import' | 'config-file'
type LoadState = { status: 'loading' } | { status: 'ready'; keys: ClientImportKey[] } | { status: 'error'; message: string }

const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_PROVIDER_NAME = 'Gateway'

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function formatExpiry(value: string | null): string {
  if (!value) return '长期有效'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '已设置期限'
  return `有效至 ${date.toLocaleDateString('zh-CN')}`
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('clipboard is unavailable')
}

function downloadJSON(filename: string, data: Record<string, unknown>): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

export default function ClientImportPage() {
  const [searchParams] = useSearchParams()
  const pageRef = useRef<HTMLDivElement>(null)
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [selectedKeyID, setSelectedKeyID] = useState('')
  const [targetKind, setTargetKind] = useState<TargetKind>('cc-switch')
  const [targetID, setTargetID] = useState<ClientImportTargetId>('claude-code')
  const [baseInput, setBaseInput] = useState(() => defaultImportBaseURL(searchParams.toString(), currentOrigin()))
  const [providerName, setProviderName] = useState(DEFAULT_PROVIDER_NAME)
  const [model, setModel] = useState(DEFAULT_MODEL)
  const [systemName, setSystemName] = useState('')
  const embedded = isEmbeddedDocument(searchParams.toString())

  const loadKeys = () => {
    setLoadState({ status: 'loading' })
    apiClient.get<AuxEnvelope<{ items: ClientImportKey[] }>>('/client-import/keys')
      .then((envelope) => {
        if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取 API Key')
        const keys = envelope.data.items.filter((key) => key.status === 'active' && key.key.trim())
        setLoadState({ status: 'ready', keys })
        setSelectedKeyID((current) => current || String(keys[0]?.id ?? ''))
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '无法读取 API Key，请从 Sub2API 用户菜单重新打开此页面。'
        setLoadState({ status: 'error', message })
      })
  }

  useEffect(() => {
    loadKeys()
    fetchHomepageConfig()
      .then((config) => {
        setSystemName(config.siteName)
        setProviderName(config.siteName || DEFAULT_PROVIDER_NAME)
      })
      .catch(() => {
        // 系统名称不是导入流程的阻塞条件，保留默认供应商名称。
      })
  }, [])

  useGSAP(() => {
    if (loadState.status !== 'ready' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    gsap.from('.client-import-hero > *, .client-import-step', {
      y: 18,
      opacity: 0,
      stagger: 0.07,
      duration: 0.55,
      ease: 'power2.out',
    })
  }, { scope: pageRef, dependencies: [loadState.status], revertOnUpdate: true })

  const selectedKey = useMemo(
    () => loadState.status === 'ready' ? loadState.keys.find((key) => String(key.id) === selectedKeyID) ?? null : null,
    [loadState, selectedKeyID],
  )
  const selectedTarget = getClientImportTarget(targetID)
  const configTargetID: ClientConfigTargetId | null = ['cherry-studio', 'chatbox', 'zcode', 'workbuddy'].includes(targetID) ? targetID as ClientConfigTargetId : null
  const directTargetID: DirectImportTargetId | null = targetID === 'cherry-studio' || targetID === 'chatbox' ? targetID : null
  const baseURL = normalizeImportBaseURL(baseInput)
  const configData = selectedKey && configTargetID && baseURL
    ? buildConfigFile(configTargetID, selectedKey, baseURL, model, providerName || DEFAULT_PROVIDER_NAME)
    : null
  const maskedConfigData = configData && selectedKey && configTargetID && baseURL
    ? buildConfigFile(configTargetID, { ...selectedKey, key: maskAPIKey(selectedKey.key) }, baseURL, model, providerName || DEFAULT_PROVIDER_NAME)
    : null
  const ccSwitchURL = selectedKey && selectedTarget.kind === 'cc-switch' && baseURL
    ? buildCCSwitchImportURL({ key: selectedKey, target: selectedTarget, baseURL, providerName: providerName || DEFAULT_PROVIDER_NAME, model })
    : null
  const canImport = !!selectedKey && !!baseURL && providerName.trim().length > 0
  const directImportURL = configData && directTargetID && canImport
    ? buildDirectImportURL(directTargetID, configData)
    : null

  function selectTarget(nextID: ClientImportTargetId) {
    const nextTarget = getClientImportTarget(nextID)
    setTargetID(nextID)
    setTargetKind(nextTarget.kind)
    trackFeatureClick('client-import', `select-${nextID}`)
  }

  function handleKeyChange(value: string) {
    setSelectedKeyID(value)
    trackFeatureClick('client-import', 'select-api-key')
  }

  async function handleCopyConfig() {
    if (!configData) return
    try {
      await copyText(JSON.stringify(configData, null, 2))
      toast.success('配置 JSON 已复制', { description: '现在可以在客户端的自定义供应商设置中粘贴。' })
      trackFeatureClick('client-import', `copy-${selectedTarget.id}`)
    } catch {
      toast.error('复制配置失败', { description: '请使用下载配置文件，再在客户端中导入。' })
    }
  }

  function handleDownloadConfig() {
    if (!configData || !configTargetID) return
    downloadJSON(configFileName(configTargetID), configData)
    toast.success('配置文件已下载', { description: '导入客户端前请确认文件仅保存在你信任的设备上。' })
    trackFeatureClick('client-import', `download-${selectedTarget.id}`)
  }

  if (loadState.status === 'loading') {
    return <main className="client-import-page" role="status" aria-label="正在读取 API Key"><div className="client-import-loading"><Sparkles size={20} aria-hidden="true" />正在准备客户端导入工具…</div></main>
  }

  if (loadState.status === 'error') {
    return <main className="client-import-page"><div className="client-import-error"><ErrorState title="无法读取 API Key" description="请从 Sub2API 用户控制台打开客户端导入页，并确认登录状态仍然有效。" detail={loadState.message} /><Button type="button" onClick={loadKeys}>重新读取</Button></div><Toaster position="top-right" /></main>
  }

  return (
    <div ref={pageRef} className={`client-import-page${embedded ? ' client-import-page--embedded' : ''}`}>
      {!embedded && <header className="client-import-header">
        <Link to="/client-docs" className="client-import-brand"><span className="client-import-brand-mark"><Terminal size={17} aria-hidden="true" /></span><span>{systemName || '客户端工具'}<small>客户端导入</small></span></Link>
        <Button asChild type="button" variant="ghost" size="sm"><Link to="/client-docs"><ArrowLeft size={16} aria-hidden="true" />查看接入文档</Link></Button>
      </header>}

      <main className="client-import-shell">
        <section className="client-import-hero">
          <div>
            <p className="client-import-eyebrow"><span className="client-import-live-dot" />安全导入工作台</p>
            <h1>把一个 API Key，带到你正在使用的客户端。</h1>
            <p className="client-import-lede">先选择密钥，再选择目标客户端。CC Switch、Cherry Studio 和 Chatbox 均可一键唤起导入确认；如未安装客户端，也可下载或复制配置。</p>
          </div>
          <div className="client-import-hero-aside"><LockKeyhole size={17} aria-hidden="true" /><span>不保存密钥<br />不写入浏览器存储</span></div>
        </section>

        {loadState.keys.length === 0 ? (
          <Card className="client-import-empty"><CardContent><KeyRound size={24} aria-hidden="true" /><h2>还没有可用的 API Key</h2><p>回到 Sub2API 用户控制台创建一个有效密钥，再打开此页面。</p><Button asChild type="button"><a href={withAppBasePath('/user-guide')}><ArrowUpRight size={16} aria-hidden="true" />查看创建指南</a></Button></CardContent></Card>
        ) : (
          <div className="client-import-workflow">
            <Card className="client-import-step client-import-key-step">
              <CardHeader><span className="client-import-step-number">01</span><CardTitle>选择 API Key</CardTitle><CardDescription>仅显示当前账号的有效密钥，导入时不会展示完整密钥。</CardDescription></CardHeader>
              <CardContent className="space-y-5">
                <div className="space-y-2"><Label htmlFor="client-import-key">API Key</Label><Select value={selectedKeyID} onValueChange={handleKeyChange}><SelectTrigger id="client-import-key"><SelectValue placeholder="选择一个 API Key" /></SelectTrigger><SelectContent>{loadState.keys.map((key) => <SelectItem key={key.id} value={String(key.id)}>{key.name || `API Key #${key.id}`} · {key.group?.name || '未分组'}</SelectItem>)}</SelectContent></Select></div>
                {selectedKey && <div className="client-import-key-summary"><div><span>当前选择</span><strong>{selectedKey.name || `API Key #${selectedKey.id}`}</strong></div><code>{maskAPIKey(selectedKey.key)}</code><small>{selectedKey.group?.name || '未分组'} · {formatExpiry(selectedKey.expires_at)}</small></div>}
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-target-step">
              <CardHeader><span className="client-import-step-number">02</span><CardTitle>选择导入目标</CardTitle><CardDescription>支持 CC Switch、Cherry Studio、Chatbox、ZCode 和 WorkBuddy。</CardDescription></CardHeader>
              <CardContent>
                <Tabs value={targetKind} onValueChange={(value) => { const nextKind = value as TargetKind; setTargetKind(nextKind); if (nextKind === 'cc-switch' && selectedTarget.kind !== 'cc-switch') selectTarget('claude-code'); if (nextKind === 'direct-import' && selectedTarget.kind !== 'direct-import') selectTarget('cherry-studio'); if (nextKind === 'config-file' && selectedTarget.kind !== 'config-file') selectTarget('zcode') }}>
                  <TabsList className="client-import-tabs"><TabsTrigger value="cc-switch"><Link2 size={15} aria-hidden="true" />CC Switch</TabsTrigger><TabsTrigger value="direct-import"><ExternalLink size={15} aria-hidden="true" />Cherry / Chatbox</TabsTrigger><TabsTrigger value="config-file"><Download size={15} aria-hidden="true" />配置文件</TabsTrigger></TabsList>
                </Tabs>
                <div className="client-import-target-grid" role="radiogroup" aria-label="选择客户端">
                  {CLIENT_IMPORT_TARGETS.filter((target) => target.kind === targetKind).map((target) => <Button key={target.id} type="button" variant="outline" className={`client-import-target ${target.id === targetID ? 'is-selected' : ''}`} role="radio" aria-checked={target.id === targetID} onClick={() => selectTarget(target.id)}><span className="client-import-target-icon">{target.icon}</span><span className="client-import-target-copy"><strong>{target.name}</strong><small>{target.description}</small></span>{target.id === targetID && <Check className="client-import-target-check" size={17} aria-hidden="true" />}</Button>)}
                </div>
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-config-step">
              <CardHeader><span className="client-import-step-number">03</span><CardTitle>确认连接参数</CardTitle><CardDescription>网关地址默认使用当前站点；如你的 API 网关与文档站点不同，请在这里替换。</CardDescription></CardHeader>
              <CardContent className="client-import-config-fields">
                <div className="client-import-field"><Label htmlFor="client-import-base">API 基础地址</Label><Input id="client-import-base" type="url" value={baseInput} onChange={(event) => setBaseInput(event.target.value)} placeholder="https://api.example.com" spellCheck={false} autoComplete="off" aria-invalid={!baseURL} /><small className={!baseURL ? 'is-error' : ''}>{baseURL ? '导入时会按客户端协议自动补充 /v1 或其他端点。' : '请输入不含凭据、查询参数和接口路径的 HTTP(S) 地址。'}</small></div>
                <div className="client-import-field"><Label htmlFor="client-import-provider">供应商名称</Label><Input id="client-import-provider" value={providerName} onChange={(event) => setProviderName(event.target.value)} maxLength={80} placeholder="Gateway" /><small>这个名称会显示在目标客户端的供应商列表中。</small></div>
                <div className="client-import-field"><Label htmlFor="client-import-model">默认模型 ID <span>可选</span></Label><Input id="client-import-model" value={model} onChange={(event) => setModel(event.target.value)} maxLength={160} placeholder="按控制台模型列表填写" spellCheck={false} /><small>{selectedTarget.id === 'workbuddy' ? 'WorkBuddy 会将模型写入 models.json 的 models 和 availableModels。' : selectedTarget.id === 'zcode' ? 'ZCode 配置文件用于快速填写；官方未提供 JSON 导入协议。' : selectedTarget.kind === 'direct-import' ? '请确认目标客户端使用的模型 ID；Chatbox 会将其加入导入的模型列表。' : 'Claude Desktop 的非 Claude 模型可能需要在 CC Switch 内使用模型映射。'}</small></div>
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-preview-step">
              <CardHeader><span className="client-import-step-number">04</span><CardTitle>{selectedTarget.kind === 'config-file' ? '下载配置' : '导入配置'}</CardTitle><CardDescription>{selectedTarget.kind === 'cc-switch' ? '点击后会尝试唤起 CC Switch，应用会再次显示确认弹窗。' : selectedTarget.kind === 'config-file' ? '生成包含当前 API Key、地址和模型 ID 的配置文件。' : `点击后会尝试唤起 ${selectedTarget.name}，请在客户端内检查并确认导入。`}</CardDescription></CardHeader>
              <CardContent>
                <div className="client-import-preview"><div className="client-import-preview-head"><div><span className="client-import-preview-icon">{selectedTarget.icon}</span><div><strong>{selectedTarget.name}</strong><small>{selectedKey ? `${selectedKey.name || 'API Key'} · ${maskAPIKey(selectedKey.key)}` : '未选择 API Key'}</small></div></div><span className="client-import-preview-status">待导入</span></div>{selectedTarget.kind === 'cc-switch' ? <dl className="client-import-detail-list"><div><dt>导入方式</dt><dd>CC Switch 深度链接</dd></div><div><dt>API 地址</dt><dd>{baseURL ? `${baseURL}${selectedTarget.id === 'claude-code' || selectedTarget.id === 'claude-desktop' ? '' : '/v1'}` : '等待填写'}</dd></div><div><dt>密钥</dt><dd>{selectedKey ? maskAPIKey(selectedKey.key) : '等待选择'}</dd></div></dl> : <pre className="client-import-json-preview" aria-label={`${selectedTarget.name} 配置预览`}><code>{maskedConfigData ? JSON.stringify(maskedConfigData, null, 2) : '填写参数后显示配置预览'}</code></pre>}</div>
                <div className="client-import-actions">{selectedTarget.kind === 'cc-switch' && ccSwitchURL ? <Button asChild type="button" size="lg" onClick={() => trackFeatureClick('client-import', `launch-${selectedTarget.id}`)}><a href={ccSwitchURL} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden="true" />打开 CC Switch 导入确认</a></Button> : selectedTarget.kind === 'direct-import' ? <><Button asChild={!!directImportURL} type="button" size="lg" disabled={!directImportURL} onClick={directImportURL ? () => trackFeatureClick('client-import', `launch-${selectedTarget.id}`) : undefined}>{directImportURL ? <a href={directImportURL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={17} aria-hidden="true" />一键导入 {selectedTarget.name}</a> : <>填写完整参数后继续</>}</Button><Button type="button" variant="outline" size="lg" onClick={handleDownloadConfig} disabled={!canImport}><Download size={17} aria-hidden="true" />下载配置文件</Button><Button type="button" variant="outline" size="lg" onClick={() => void handleCopyConfig()} disabled={!canImport}><Check size={17} aria-hidden="true" />复制 JSON</Button></> : selectedTarget.kind === 'config-file' ? <><Button type="button" size="lg" onClick={handleDownloadConfig} disabled={!canImport}><Download size={17} aria-hidden="true" />下载 {selectedTarget.name} 配置</Button><Button type="button" variant="outline" size="lg" onClick={() => void handleCopyConfig()} disabled={!canImport}><Check size={17} aria-hidden="true" />复制 JSON</Button></> : <Button type="button" size="lg" disabled>填写完整参数后继续</Button>}</div>
                {selectedTarget.kind === 'direct-import' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />请先安装目标客户端。深度链接仅传递到本机客户端；如果浏览器未唤起应用，可下载配置文件或复制 JSON 后在客户端内导入。不要分享包含密钥的链接。</p>}
                {selectedTarget.id === 'zcode' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />ZCode 官方当前未提供 JSON 导入协议。下载文件用于快速复制到「设置 → 模型设置 → 添加供应商」，请在 ZCode 中确认 API 格式并添加模型。</p>}
                {selectedTarget.id === 'workbuddy' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />WorkBuddy 使用官方 models.json 格式。下载后按 WorkBuddy 文档放入用户级或项目级 .codebuddy/models.json，再重新打开或刷新模型设置。</p>}
              </CardContent>
            </Card>
          </div>
        )}

        <section className="client-import-footer-note"><div><LockKeyhole size={17} aria-hidden="true" /><p><strong>安全提示</strong><br />不要把导入链接或配置文件发给他人。完成导入后可以删除下载文件，并在不再使用时回收对应 API Key。</p></div><Link to="/client-docs">需要手动配置？查看完整接入文档 <ArrowUpRight size={15} aria-hidden="true" /></Link></section>
      </main>
      <Toaster position="top-right" />
    </div>
  )
}
