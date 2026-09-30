import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowLeft, ArrowUpRight, Ban, Check, Download, ExternalLink, KeyRound, Link2, LockKeyhole, RefreshCw, Sparkles, Terminal, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import ErrorState from '@/components/ErrorState'
import { apiClient, AuxApiError, type AuxEnvelope } from '@/lib/api-client'
import { allowedClientTargets, buildCCSwitchImportURL, buildConfigFile, buildDirectImportURL, CLIENT_IMPORT_TARGETS, configFileName, defaultImportBaseURL, describeKeyGroup, getClientImportTarget, hasKeyGroup, isClientAllowedForKey, maskAPIKey, normalizeImportBaseURL, normalizeKeyModels, supportsMultiModel, type ClientConfigTargetId, type ClientImportKey, type ClientImportKeysResponse, type ClientImportTargetId, type DirectImportTargetId } from '@/lib/client-import'
import { preferredClientModel } from '@/lib/client-models'
import { fetchHomepageConfig } from '@/lib/homepage'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { withAppBasePath } from '@/lib/app-base-path'
import { isEmbeddedDocument } from '@/lib/embedded'
import '@fontsource-variable/geist'
import { ClientModelMultiSelect } from './ClientModelMultiSelect'
import { ClientModelSelect } from './ClientModelSelect'
import './ClientImportPage.css'

type TargetKind = 'cc-switch' | 'direct-import' | 'config-file'
type LoadState = { status: 'loading' } | { status: 'ready'; keys: ClientImportKey[] } | { status: 'error'; message: string }
type ModelState = { status: 'idle' } | { status: 'loading' } | { status: 'ready'; models: string[] } | { status: 'error'; message: string }

const DEFAULT_MODEL = 'claude-opus-5'
const DEFAULT_PROVIDER_NAME = 'Gateway'

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function keyModelsErrorMessage(error: unknown): string {
  if (error instanceof AuxApiError) {
    if (error.reason === 'API_KEY_MODELS_REJECTED') return '网关拒绝了该密钥的模型列表请求，请确认密钥状态与额度。'
    if (error.status === 401) return '登录已失效，请从 Sub2API 用户菜单重新打开此页面。'
    if (error.status === 503) return 'Sub2API 网关暂时不可用。'
  }
  return '无法读取该密钥的模型列表。'
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
  const [modelState, setModelState] = useState<ModelState>({ status: 'idle' })
  const [modelReload, setModelReload] = useState(0)
  // 候选模型在切换密钥或客户端时保留；只在当前客户端允许多模型时写入配置。
  const [candidateModels, setCandidateModels] = useState<string[]>([])
  const [multiModelClients, setMultiModelClients] = useState<string[]>([])
  // 用户手动选择或清空模型后，切换密钥不再自动替换其选择。
  const modelTouchedRef = useRef(false)
  const [systemName, setSystemName] = useState('')
  const embedded = isEmbeddedDocument(searchParams.toString())

  const loadKeys = () => {
    setLoadState({ status: 'loading' })
    apiClient.get<AuxEnvelope<ClientImportKeysResponse>>('/client-import/keys')
      .then((envelope) => {
        if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取 API Key')
        const keys = envelope.data.items.filter((key) => key.status === 'active' && key.key.trim())
        setMultiModelClients(envelope.data.multi_model_clients ?? [])
        setLoadState({ status: 'ready', keys })
        setSelectedKeyID((current) => current || String((keys.find(hasKeyGroup) ?? keys[0])?.id ?? ''))
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
  const keyHasGroup = !!selectedKey && hasKeyGroup(selectedKey)
  const selectedTarget = getClientImportTarget(targetID)
  const allowedTargets = useMemo(() => selectedKey ? allowedClientTargets(selectedKey) : [], [selectedKey])
  const targetAllowed = !!selectedKey && isClientAllowedForKey(selectedKey, targetID)
  // 已分组但被管理端按平台/分组规则限制的客户端。
  const targetRestricted = keyHasGroup && !targetAllowed
  const importBlocked = !!selectedKey && !targetAllowed
  const configTargetID: ClientConfigTargetId | null = ['cherry-studio', 'chatbox', 'zcode', 'workbuddy', 'pi'].includes(targetID) ? targetID as ClientConfigTargetId : null
  const directTargetID: DirectImportTargetId | null = targetID === 'cherry-studio' || targetID === 'chatbox' ? targetID : null
  const baseURL = normalizeImportBaseURL(baseInput)
  const multiModelEnabled = supportsMultiModel(targetID, multiModelClients)
  const defaultModelID = model.trim()
  // 与默认模型相同的候选会在配置中去重，这里同步从已选列表和选项中隐藏。
  const activeCandidates = multiModelEnabled ? candidateModels.filter((item) => item !== defaultModelID) : []
  const configData = selectedKey && targetAllowed && configTargetID && baseURL
    ? buildConfigFile(configTargetID, selectedKey, baseURL, model, providerName || DEFAULT_PROVIDER_NAME, activeCandidates)
    : null
  const maskedConfigData = configData && selectedKey && targetAllowed && configTargetID && baseURL
    ? buildConfigFile(configTargetID, { ...selectedKey, key: maskAPIKey(selectedKey.key) }, baseURL, model, providerName || DEFAULT_PROVIDER_NAME, activeCandidates)
    : null
  const ccSwitchURL = selectedKey && targetAllowed && selectedTarget.kind === 'cc-switch' && baseURL
    ? buildCCSwitchImportURL({ key: selectedKey, target: selectedTarget, baseURL, providerName: providerName || DEFAULT_PROVIDER_NAME, model })
    : null
  const canImport = !!selectedKey && targetAllowed && !!baseURL && providerName.trim().length > 0
  const blockedLabel = selectedKey && !keyHasGroup ? '请先为 API Key 选择分组' : targetRestricted ? '该客户端已被限制导入' : '填写完整参数后继续'
  const directImportURL = configData && directTargetID && canImport
    ? buildDirectImportURL(directTargetID, configData)
    : null

  // 模型列表按所选密钥读取：Sub2API 网关依据该密钥的分组平台与模型白名单返回可调用模型。
  const modelKeyID = selectedKey && keyHasGroup ? selectedKey.id : null
  useEffect(() => {
    if (modelKeyID === null) {
      setModelState({ status: 'idle' })
      return
    }
    let cancelled = false
    setModelState({ status: 'loading' })
    apiClient.get<AuxEnvelope<{ items: unknown }>>(`/client-import/keys/${modelKeyID}/models`)
      .then((envelope) => {
        if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || '无法读取模型列表')
        const models = normalizeKeyModels(envelope.data.items)
        if (cancelled) return
        setModelState({ status: 'ready', models })
        // 未手动选择时，保留列表中已有的默认模型，否则改用该密钥的第一个模型。
        if (!modelTouchedRef.current) setModel((current) => preferredClientModel(models, current))
      })
      .catch((error: unknown) => {
        if (!cancelled) setModelState({ status: 'error', message: keyModelsErrorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [modelKeyID, modelReload])

  const handleModelChange = (value: string) => {
    modelTouchedRef.current = true
    setModel(value)
  }
  const modelOptions = modelState.status === 'ready' ? modelState.models : []
  const modelStatus = modelState.status === 'ready' ? 'ready' : modelState.status === 'error' ? 'error' : 'loading'

  const targetIDRef = useRef(targetID)
  targetIDRef.current = targetID
  // 受限客户端不可选择；读取或切换密钥后若当前客户端被限制，切到第一个允许导入的客户端。
  useEffect(() => {
    if (!selectedKey || isClientAllowedForKey(selectedKey, targetIDRef.current)) return
    const fallback = allowedClientTargets(selectedKey)[0]
    if (!fallback) return
    setTargetID(fallback.id)
    setTargetKind(fallback.kind)
  }, [selectedKey])

  // 已分组密钥在某类导入方式下没有任何允许的客户端时，禁止切换到该页签。
  function kindRestricted(kind: TargetKind): boolean {
    return keyHasGroup && kind !== targetKind && !allowedTargets.some((target) => target.kind === kind)
  }

  function firstTargetOfKind(kind: TargetKind): ClientImportTargetId {
    const candidates = CLIENT_IMPORT_TARGETS.filter((target) => target.kind === kind)
    return (candidates.find((target) => allowedTargets.includes(target)) ?? candidates[0]).id
  }

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
                <div className="space-y-2"><Label htmlFor="client-import-key">API Key</Label><Select value={selectedKeyID} onValueChange={handleKeyChange}><SelectTrigger id="client-import-key"><SelectValue placeholder="选择一个 API Key" /></SelectTrigger><SelectContent>{loadState.keys.map((key) => <SelectItem key={key.id} value={String(key.id)}>{key.name || `API Key #${key.id}`} · {describeKeyGroup(key)}</SelectItem>)}</SelectContent></Select></div>
                {selectedKey && <div className="client-import-key-summary"><div><span>当前选择</span><strong>{selectedKey.name || `API Key #${selectedKey.id}`}</strong></div><code>{maskAPIKey(selectedKey.key)}</code><small>{describeKeyGroup(selectedKey)} · {formatExpiry(selectedKey.expires_at)}</small></div>}
                {keyHasGroup && allowedTargets.length === 0 && <Alert className="client-import-group-alert"><Ban aria-hidden="true" /><AlertTitle>该分组暂不允许导入客户端</AlertTitle><AlertDescription><p>管理员已限制「{describeKeyGroup(selectedKey)}」可导入的客户端。请改选其他分组的密钥，或联系管理员调整导入限制。</p></AlertDescription></Alert>}
                {selectedKey && !keyHasGroup && <Alert className="client-import-group-alert"><TriangleAlert aria-hidden="true" /><AlertTitle>该 API Key 未选择分组</AlertTitle><AlertDescription><p>未选择分组的密钥不能导入任何客户端。请先在 Sub2API 的 API 密钥页为它选择分组，或改选其他已分组的密钥。</p><Button type="button" variant="outline" size="sm" onClick={loadKeys}><RefreshCw size={14} aria-hidden="true" />设置分组后重新读取</Button></AlertDescription></Alert>}
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-target-step">
              <CardHeader><span className="client-import-step-number">02</span><CardTitle>选择导入目标</CardTitle><CardDescription>支持 CC Switch、Cherry Studio、Chatbox、ZCode、WorkBuddy 和 Pi。</CardDescription></CardHeader>
              <CardContent>
                <Tabs value={targetKind} onValueChange={(value) => { const nextKind = value as TargetKind; setTargetKind(nextKind); if (selectedTarget.kind !== nextKind) selectTarget(firstTargetOfKind(nextKind)) }}>
                  <TabsList className="client-import-tabs"><TabsTrigger value="cc-switch" disabled={kindRestricted('cc-switch')}><Link2 size={15} aria-hidden="true" />CC Switch</TabsTrigger><TabsTrigger value="direct-import" disabled={kindRestricted('direct-import')}><ExternalLink size={15} aria-hidden="true" />Cherry / Chatbox</TabsTrigger><TabsTrigger value="config-file" disabled={kindRestricted('config-file')}><Download size={15} aria-hidden="true" />配置文件</TabsTrigger></TabsList>
                </Tabs>
                <div className="client-import-target-grid" role="radiogroup" aria-label="选择客户端">
                  {CLIENT_IMPORT_TARGETS.filter((target) => target.kind === targetKind).map((target) => { const restricted = keyHasGroup && !allowedTargets.includes(target); const selected = target.id === targetID && !restricted; return <Button key={target.id} type="button" variant="outline" className={`client-import-target${selected ? ' is-selected' : ''}${restricted ? ' is-restricted' : ''}`} role="radio" aria-checked={selected} disabled={restricted} aria-description={restricted ? '该分组不允许导入此客户端' : undefined} onClick={() => selectTarget(target.id)}><span className="client-import-target-icon">{target.icon}</span><span className="client-import-target-copy"><strong>{target.name}</strong><small>{restricted ? '管理员已限制当前分组导入此客户端。' : target.description}</small></span>{selected ? <Check className="client-import-target-check" size={17} aria-hidden="true" /> : restricted && <Ban className="client-import-target-check" size={15} aria-hidden="true" />}</Button> })}
                </div>
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-config-step">
              <CardHeader><span className="client-import-step-number">03</span><CardTitle>确认连接参数</CardTitle><CardDescription>网关地址默认使用当前站点；如你的 API 网关与文档站点不同，请在这里替换。</CardDescription></CardHeader>
              <CardContent className="client-import-config-fields">
                <div className="client-import-field"><Label htmlFor="client-import-base">API 基础地址</Label><Input id="client-import-base" type="url" value={baseInput} onChange={(event) => setBaseInput(event.target.value)} placeholder="https://api.example.com" spellCheck={false} autoComplete="off" aria-invalid={!baseURL} /><small className={!baseURL ? 'is-error' : ''}>{baseURL ? '导入时会按客户端协议自动补充 /v1 或其他端点。' : '请输入不含凭据、查询参数和接口路径的 HTTP(S) 地址。'}</small></div>
                <div className="client-import-field"><Label htmlFor="client-import-provider">供应商名称</Label><Input id="client-import-provider" value={providerName} onChange={(event) => setProviderName(event.target.value)} maxLength={80} placeholder="Gateway" /><small>这个名称会显示在目标客户端的供应商列表中。</small></div>
                <div className="client-import-field">
                  <Label htmlFor="client-import-model">默认模型 ID <span>可选</span></Label>
                  <ClientModelSelect id="client-import-model" value={model} options={modelOptions} status={modelStatus} disabled={modelState.status === 'idle'} describedBy="client-import-model-help" onChange={handleModelChange} triggerClassName="client-import-model-trigger" contentClassName="client-import-model-popover" groupHeading="该密钥可用模型" placeholder="不指定，使用客户端默认" clearLabel="不指定默认模型" />
                  <small id="client-import-model-help" className={modelState.status === 'error' ? 'is-error' : undefined}>
                    {modelState.status === 'error'
                      ? <>{modelState.message}可直接在下拉搜索框输入模型 ID。<Button type="button" variant="link" size="sm" className="client-import-model-retry" onClick={() => setModelReload((count) => count + 1)}>重新读取</Button></>
                      : modelState.status === 'ready' && modelState.models.length === 0
                        ? '该密钥暂无可用模型列表，可直接在下拉搜索框输入模型 ID。'
                        : selectedTarget.id === 'workbuddy' ? 'WorkBuddy 会将模型写入 models.json 的 models 和 availableModels。' : selectedTarget.id === 'pi' ? 'Pi 需要至少一个模型 ID，才能在 /model 中选择该供应商。' : selectedTarget.id === 'zcode' ? 'ZCode 配置文件用于快速填写；官方未提供 JSON 导入协议。' : selectedTarget.kind === 'direct-import' ? '请确认目标客户端使用的模型 ID；Chatbox 会将其加入导入的模型列表。' : 'Claude Desktop 的非 Claude 模型可能需要在 CC Switch 内使用模型映射。'}
                  </small>
                </div>
                {multiModelEnabled && targetAllowed && <div className="client-import-field client-import-field--wide">
                  <Label htmlFor="client-import-candidates">候选模型 ID <span>可选，可多选</span></Label>
                  <ClientModelMultiSelect id="client-import-candidates" values={activeCandidates} options={modelOptions.filter((item) => item !== defaultModelID)} status={modelStatus} disabled={modelState.status === 'idle'} describedBy="client-import-candidates-help" onChange={setCandidateModels} />
                  <small id="client-import-candidates-help">{selectedTarget.name} 支持配置多个模型：默认模型排在首位，候选模型按选择顺序追加{defaultModelID ? '' : '；未指定默认模型时，第一个候选模型即为默认'}。</small>
                </div>}
              </CardContent>
            </Card>

            <Card className="client-import-step client-import-preview-step">
              <CardHeader><span className="client-import-step-number">04</span><CardTitle>{selectedTarget.kind === 'config-file' ? '下载配置' : '导入配置'}</CardTitle><CardDescription>{selectedTarget.kind === 'cc-switch' ? '点击后会尝试唤起 CC Switch，应用会再次显示确认弹窗。' : selectedTarget.kind === 'config-file' ? '生成包含当前 API Key、地址和模型 ID 的配置文件。' : `点击后会尝试唤起 ${selectedTarget.name}，请在客户端内检查并确认导入。`}</CardDescription></CardHeader>
              <CardContent>
                <div className="client-import-preview"><div className="client-import-preview-head"><div><span className="client-import-preview-icon">{selectedTarget.icon}</span><div><strong>{selectedTarget.name}</strong><small>{selectedKey ? `${selectedKey.name || 'API Key'} · ${maskAPIKey(selectedKey.key)}` : '未选择 API Key'}</small></div></div><span className={`client-import-preview-status${importBlocked ? ' is-blocked' : ''}`}>{importBlocked ? '不可导入' : '待导入'}</span></div>{selectedTarget.kind === 'cc-switch' ? <dl className="client-import-detail-list"><div><dt>导入方式</dt><dd>CC Switch 深度链接</dd></div><div><dt>API 地址</dt><dd>{baseURL ? `${baseURL}${selectedTarget.id === 'claude-code' || selectedTarget.id === 'claude-desktop' ? '' : '/v1'}` : '等待填写'}</dd></div><div><dt>分组</dt><dd>{selectedKey ? describeKeyGroup(selectedKey) : '等待选择'}</dd></div><div><dt>密钥</dt><dd>{selectedKey ? maskAPIKey(selectedKey.key) : '等待选择'}</dd></div></dl> : <pre className="client-import-json-preview" aria-label={`${selectedTarget.name} 配置预览`}><code>{maskedConfigData ? JSON.stringify(maskedConfigData, null, 2) : selectedKey && !keyHasGroup ? 'API Key 未选择分组，无法生成配置' : targetRestricted ? `管理员已限制当前分组导入 ${selectedTarget.name}，无法生成配置` : '填写参数后显示配置预览'}</code></pre>}</div>
                <div className="client-import-actions">{selectedTarget.kind === 'cc-switch' && ccSwitchURL ? <Button asChild type="button" size="lg" onClick={() => trackFeatureClick('client-import', `launch-${selectedTarget.id}`)}><a href={ccSwitchURL} target="_blank" rel="noopener noreferrer"><ExternalLink size={17} aria-hidden="true" />一键导入 CC Switch</a></Button> : selectedTarget.kind === 'direct-import' ? <><Button asChild={!!directImportURL} type="button" size="lg" disabled={!directImportURL} onClick={directImportURL ? () => trackFeatureClick('client-import', `launch-${selectedTarget.id}`) : undefined}>{directImportURL ? <a href={directImportURL} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={17} aria-hidden="true" />一键导入 {selectedTarget.name}</a> : <>{blockedLabel}</>}</Button><Button type="button" variant="outline" size="lg" onClick={handleDownloadConfig} disabled={!canImport}><Download size={17} aria-hidden="true" />下载配置文件</Button><Button type="button" variant="outline" size="lg" onClick={() => void handleCopyConfig()} disabled={!canImport}><Check size={17} aria-hidden="true" />复制 JSON</Button></> : selectedTarget.kind === 'config-file' ? <><Button type="button" size="lg" onClick={handleDownloadConfig} disabled={!canImport}><Download size={17} aria-hidden="true" />下载 {selectedTarget.name} 配置</Button><Button type="button" variant="outline" size="lg" onClick={() => void handleCopyConfig()} disabled={!canImport}><Check size={17} aria-hidden="true" />复制 JSON</Button></> : <Button type="button" size="lg" disabled>{blockedLabel}</Button>}</div>
                {selectedTarget.kind === 'direct-import' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />请先安装目标客户端。深度链接仅传递到本机客户端；如果浏览器未唤起应用，可下载配置文件或复制 JSON 后在客户端内导入。不要分享包含密钥的链接。</p>}
                {selectedTarget.id === 'zcode' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />ZCode 官方当前未提供 JSON 导入协议。下载文件用于快速复制到「设置 → 模型设置 → 添加供应商」，请在 ZCode 中确认 API 格式并添加模型。</p>}
                {selectedTarget.kind === 'cc-switch' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />CC Switch 的深度链接暂不支持 Pi 供应商。使用 Pi 时请切换到「配置文件」页签下载 Pi 的 models.json。</p>}
                {selectedTarget.id === 'pi' && <p className="client-import-manual-note"><LockKeyhole size={15} aria-hidden="true" />CC Switch 暂不支持通过深度链接导入 Pi。下载后放到 ~/.pi/agent/models.json（Windows 为 %USERPROFILE%\.pi\agent\models.json）；已有该文件时，只把 providers.gateway 合并进去，保留其他供应商。重新打开 /model 即可读取。</p>}
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
