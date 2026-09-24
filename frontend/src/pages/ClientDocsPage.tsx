import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, Blocks, BookOpen, Braces, Check, ChevronDown, Code2, Copy, ExternalLink, Gem, Home, ImageIcon, KeyRound, Monitor, Moon, Search, Sun, Terminal, Waypoints, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CC_SWITCH_DOCS_URL, CC_SWITCH_DOWNLOAD_URL, CLIENT_GUIDES, findCCSwitchGuide, getCCSwitchExample, getClientGuide, getConfigExample, getInstallCommand, getVerifyCommand, normalizeGatewayURL, type ClientId, type GuidePlatform, type GuideScreenshot } from '@/lib/client-guides'
import { ClientSetupDiagram } from './ClientSetupDiagram'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, isHomepageNavigationHref, type HomepageConfig } from '@/lib/homepage'
import { DEFAULT_SUB2API_SYSTEM_NAME, resolveSystemName } from '@/lib/system-name'
import '@fontsource-variable/geist'
import './ClientDocsPage.css'
import { toCurrentOriginURI, toSameOriginPath, withAppBasePath } from '@/lib/app-base-path'
import { DEFAULT_SYSTEM_POSITION, homepagePathForPosition, normalizeSystemPosition, type SystemPosition } from '@/lib/system-position'
import { isEmbeddedDocument } from '@/lib/embedded'

gsap.registerPlugin(useGSAP, ScrollToPlugin)
const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function'

const GUIDE_SECTIONS = [
  { id: 'prepare', title: '准备接入信息' },
  { id: 'install', title: '安装客户端' },
  { id: 'configure', title: '配置连接' },
  { id: 'verify', title: '验证接入' },
  { id: 'troubleshooting', title: '常见问题' },
]

const CC_SWITCH_GUIDE_SECTIONS = GUIDE_SECTIONS.map(section => section.id === 'install'
  ? { ...section, title: '安装客户端与 CC Switch' }
  : section)

const CODEX_GUIDE_SECTIONS = GUIDE_SECTIONS
  .filter(section => section.id !== 'prepare' && section.id !== 'install')
  .map(section => section.id === 'configure' ? { ...section, title: 'Codex 配置' } : section)

const CODEX_CC_SWITCH_SECTIONS = [
  { id: 'codex-step-1', title: '创建 API Key' },
  { id: 'codex-step-2', title: '导入到 CCS' },
  { id: 'codex-step-3', title: '确认导入' },
  { id: 'codex-step-4', title: '启用配置' },
  { id: 'codex-step-5', title: '重启并验证' },
  { id: 'troubleshooting', title: '常见问题' },
] as const

const CLIENT_TOPICS: { title: string; clients: ClientId[] }[] = [
  { title: 'Codex', clients: ['codex'] },
  { title: 'Claude', clients: ['claude-code', 'claude-desktop'] },
  { title: 'Grok', clients: ['grok-build'] },
  { title: 'Gemini', clients: ['gemini-cli'] },
  { title: 'VS Code / Cursor', clients: ['vscode-codex', 'vscode-claude'] },
  { title: '其他客户端', clients: ['openai-compatible', 'ide-plugins', 'pi', 'hermes', 'openclaw', 'paseo', 'zcode', 'deepseek-harness', 'obsidian'] },
]

const CLIENT_DIRECTORY_HIDDEN_IDS = new Set<ClientId>([
  'grok-build',
  'gemini-cli',
  'vscode-codex',
  'vscode-claude',
  'openai-compatible',
  'ide-plugins',
])
const CLIENT_DIRECTORY_GUIDES = CLIENT_GUIDES
  .filter(client => !CLIENT_DIRECTORY_HIDDEN_IDS.has(client.id))
  .sort((first, second) => Number(second.id === 'codex') - Number(first.id === 'codex'))

type ThemePreference = 'system' | 'light' | 'dark'
const THEME_STORAGE_KEY = 'aux-client-docs-theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

function parseThemePreference(value: string | null): ThemePreference | null {
  return value === 'light' || value === 'dark' || value === 'system' ? value : null
}

function readSavedTheme(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY)) ?? 'system'
  } catch {
    return 'system'
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(SYSTEM_DARK_QUERY).matches
    : false
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(SYSTEM_DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

function currentPageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function initialBaseURL(search: string): string {
  const value = new URLSearchParams(search).get('api_base')
  return value?.trim().replace(/\/+$/, '') || currentPageOrigin()
}

function ClientMark({ id, small = false }: { id: ClientId; small?: boolean }) {
  const guide = getClientGuide(id)
  const MarkIcon = guide.mark === 'gemini' ? Gem
    : guide.mark === 'editor' ? Code2
      : guide.mark === 'api' ? Braces
        : guide.mark === 'plugin' ? Blocks
          : Terminal
  return <span className={`client-mark client-mark--${id}${small ? ' client-mark--small' : ''}`} aria-hidden="true">
    {guide.icon
      ? <img src={withAppBasePath(guide.icon)} alt="" width={small ? 20 : 38} height={small ? 20 : 38} draggable={false} />
      : <MarkIcon size={small ? 17 : 25} strokeWidth={1.8} />}
  </span>
}

function CodeBlock({ title, language, code, feature }: { title: string; language: string; code: string; feature: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const blockRef = useRef<HTMLDivElement>(null)
  const codeRef = useRef<HTMLElement>(null)
  const copyButtonRef = useRef<HTMLButtonElement>(null)
  const copyAttempt = useRef(0)
  useEffect(() => {
    if (status === 'idle' || status === 'copying') return
    const timer = window.setTimeout(() => setStatus('idle'), 2400)
    return () => window.clearTimeout(timer)
  }, [status])
  useEffect(() => {
    setStatus('idle')
    return () => { copyAttempt.current += 1 }
  }, [code])

  useGSAP(() => {
    if (!canAnimate || status === 'idle' || status === 'copying') return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      if (!copyButtonRef.current) return
      gsap.fromTo(copyButtonRef.current, { scale: 0.96 }, {
        scale: 1,
        duration: 0.22,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'scale',
      })
    })
    return () => media.revert()
  }, { scope: blockRef, dependencies: [status], revertOnUpdate: true })

  async function copy() {
    if (status === 'copying') return
    const attempt = ++copyAttempt.current
    setStatus('copying')
    try {
      await navigator.clipboard.writeText(code)
      if (attempt !== copyAttempt.current) return
      setStatus('copied')
      trackFeatureClick('client-docs', `copy-${feature}`)
    } catch {
      if (attempt !== copyAttempt.current) return
      setStatus('error')
      if (codeRef.current) {
        const range = document.createRange()
        range.selectNodeContents(codeRef.current)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
      }
    }
  }

  return <div ref={blockRef} className="client-code" data-state={status}>
    <div className="client-code-bar"><span>{title}</span><div><small>{language}</small><button ref={copyButtonRef} type="button" onClick={() => void copy()} disabled={status === 'copying'} aria-busy={status === 'copying'} aria-label={`复制${title}`}>
      {status === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{status === 'copied' ? '已复制' : status === 'copying' ? '复制中' : '复制'}
    </button></div></div>
    <pre tabIndex={0} aria-label={title}><code ref={codeRef}>{code}</code></pre>
    <span className={status === 'error' ? 'client-copy-error' : 'sr-only'} role="status">{status === 'error' ? '自动复制不可用，代码已选中，请按 Ctrl+C 或 ⌘C 复制。' : status === 'copied' ? `${title}已复制` : ''}</span>
  </div>
}

function Screenshot({ screenshot, clientName, feature }: { screenshot: GuideScreenshot; clientName: string; feature: string }) {
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const figureRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogImageRef = useRef<HTMLImageElement>(null)
  const hasImage = !!screenshot.src && !failed
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (expanded && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal()
    if (!expanded && typeof dialog.close === 'function' && dialog.open) dialog.close()
    setDialogOpen(expanded)
  }, [expanded])

  useGSAP(() => {
    if (!canAnimate || !dialogOpen || !dialogRef.current?.open) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(dialogRef.current, { autoAlpha: 0, scale: 0.985 }, { autoAlpha: 1, scale: 1, duration: 0.2, ease: 'power2.out', overwrite: 'auto', clearProps: 'autoAlpha,scale' })
      gsap.fromTo(dialogImageRef.current, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.24, ease: 'power2.out', overwrite: 'auto', clearProps: 'autoAlpha,y' })
    })
    return () => media.revert()
  }, { scope: figureRef, dependencies: [dialogOpen], revertOnUpdate: true })

  return <figure ref={figureRef} className="client-screenshot">
    {hasImage ? <button type="button" className="client-screenshot-image" onClick={() => { setExpanded(true); trackFeatureClick('client-docs', `screenshot-${feature}`) }} aria-label={`放大查看：${screenshot.caption}`}>
      <img src={withAppBasePath(screenshot.src)} alt={screenshot.alt} loading="lazy" onError={() => setFailed(true)} />
      <span><ImageIcon size={14} aria-hidden="true" /> 点击放大</span>
    </button> : <div className="client-screenshot-placeholder" role="img" aria-label={`${clientName}：${screenshot.caption}（截图待补充）`}>
      <ImageIcon size={24} strokeWidth={1.5} aria-hidden="true" />
      <div><strong>{screenshot.caption}</strong><span>图示待补充 · 可先按文字步骤完成</span></div>
    </div>}
    {hasImage && <figcaption>{clientName}<span>/</span>{screenshot.caption}</figcaption>}
    {hasImage && <dialog className="client-image-dialog" aria-label={screenshot.caption} ref={dialogRef} onClose={() => { setExpanded(false); setDialogOpen(false) }} onClick={event => { if (event.target === event.currentTarget) setExpanded(false) }}>
      <button type="button" autoFocus onClick={() => setExpanded(false)} aria-label="关闭大图"><X aria-hidden="true" /></button>
      <img ref={dialogImageRef} src={withAppBasePath(screenshot.src)} alt={screenshot.alt} /><p>{screenshot.caption}</p>
    </dialog>}
  </figure>
}

export default function ClientDocsPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollTopRef = useRef<() => void>(() => {})
  const scrollRequested = useRef(false)
  const [params, setParams] = useSearchParams()
  const [savedTheme, setSavedTheme] = useState(readSavedTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false)
  const themePreference = parseThemePreference(params.get('theme')) ?? savedTheme
  const theme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference
  const ThemeIcon = themePreference === 'system' ? Monitor : themePreference === 'dark' ? Moon : Sun
  const guide = getClientGuide(params.get('client'))
  const isCodex = guide.id === 'codex'
  const codexClientName = 'Codex Desktop'
  const ccSwitchGuide = findCCSwitchGuide(guide.id)
  const hasCCSwitch = !!ccSwitchGuide || !!guide.ccSwitch
  const setupMethod = hasCCSwitch && (guide.id === 'claude-desktop' || params.get('method') !== 'manual') ? 'cc-switch' : 'manual'
  const usesCodexCCSwitchFlow = setupMethod === 'cc-switch' && (guide.id === 'codex' || guide.id === 'vscode-codex')
  const pageSections = isCodex
    ? (usesCodexCCSwitchFlow ? CODEX_CC_SWITCH_SECTIONS : CODEX_GUIDE_SECTIONS).map(section => section.id === 'configure'
      ? { ...section, title: setupMethod === 'cc-switch' ? '导入并启动' : '手动配置' }
      : section)
    : setupMethod === 'cc-switch' ? CC_SWITCH_GUIDE_SECTIONS : GUIDE_SECTIONS
  const viewKey = `${guide.id}:${setupMethod}`
  const activeTopic = CLIENT_TOPICS.find(topic => topic.clients.includes(guide.id)) ?? CLIENT_TOPICS[0]
  const [platform, setPlatform] = useState<GuidePlatform>('unix')
  const [baseInput, setBaseInput] = useState(() => initialBaseURL(params.toString()))
  const [models, setModels] = useState<Partial<Record<ClientId, string>>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState(isCodex ? 'configure' : 'prepare')
  const [systemName, setSystemName] = useState(DEFAULT_SUB2API_SYSTEM_NAME)
  const [siteLogoUrl, setSiteLogoUrl] = useState(DEFAULT_HOMEPAGE_CONFIG.siteLogoUrl)
  const [systemPosition, setSystemPosition] = useState<SystemPosition>(DEFAULT_SYSTEM_POSITION)
  const [consoleHref, setConsoleHref] = useState(DEFAULT_HOMEPAGE_CONFIG.consoleHref)
  const embedded = isEmbeddedDocument(params.toString())
  const baseURL = normalizeGatewayURL(baseInput)
  const modelInput = models[guide.id] ?? guide.defaultModel
  const model = modelInput.trim()
  const validModel = !!model && !/[\x00-\x1f\x7f]/.test(model)
  const example = baseURL && validModel ? getConfigExample(guide.id, baseURL, model, platform) : null
  const quickExample = baseURL && validModel ? getCCSwitchExample(guide.id, baseURL, model) : null
  const installCommand = getInstallCommand(guide.id, platform)
  const verifyCommand = validModel ? getVerifyCommand(guide.id, model, platform) : null
  const guideDescription = isCodex
    ? '在 Codex Desktop 中使用平台模型。无需安装 Codex CLI、Node.js 或 npm，适合第一次接入的用户。'
    : guide.description
  const guidePrerequisite = isCodex
    ? 'Codex Desktop 是独立的桌面应用，无需安装 Codex CLI、Node.js 或 npm。下载安装并打开后即可继续。'
    : guide.prerequisite
  const installSteps = isCodex
    ? [{ text: '从 OpenAI 官方页面下载并安装 Codex Desktop，打开应用完成首次启动；已经安装可直接继续。', href: 'https://openai.com/codex/', linkLabel: '获取 Codex Desktop' }, { text: '准备好平台 API 基础地址、API Key 和模型 ID；CC Switch 与手动配置都使用同一组 Codex 配置文件。' }]
    : guide.installSteps
  const guideConfigDescription = isCodex
    ? `Codex Desktop 使用 ~/.codex/config.toml 和 ~/.codex/auth.json 配置模型、网关与 API Key。${guide.configDescription}`
    : guide.configDescription
  const guideVerification = isCodex
    ? setupMethod === 'cc-switch'
      ? '启用导入的配置后，完全退出并重新打开 Codex Desktop；新建任务并发送「当前时间」。收到正常回复后，在平台控制台检查对应 API Key 的用量记录。'
      : '保存配置后，打开或重新打开 Codex Desktop，新建任务并发送「当前时间」。收到正常回复后，在平台控制台检查用量。'
    : guide.verification
  const guideTroubleshooting = isCodex
    ? setupMethod === 'cc-switch'
      ? 'CC Switch 中没有出现新配置时，重新检查 API Key 所在行的「导入到 CCS」操作及确认弹窗。重启后仍使用旧配置时，确认刚导入的配置已启用，再完全退出并重新打开 Codex Desktop。'
      : 'Codex Desktop 不需要安装 CLI。若仍使用旧配置，请完全退出并重新打开桌面应用，同时检查 ~/.codex/config.toml 与 ~/.codex/auth.json 是否位于当前用户目录。'
    : guide.troubleshooting
  const guideAppliesTo = isCodex ? undefined : guide.appliesTo
  const guideInstallUrl = isCodex ? 'https://openai.com/codex/' : guide.installUrl
  const ccSwitchSteps = ccSwitchGuide?.steps.map((step, index) => {
    if (guide.id === 'vscode-codex' && index === ccSwitchGuide.steps.length - 1) {
      return '重载 VS Code 或 Cursor 窗口，让 Codex 扩展读取已启用配置，然后按下方验证步骤发送消息。'
    }
    return step
  })
  const currentIndex = CLIENT_DIRECTORY_GUIDES.findIndex(client => client.id === guide.id)
  const nextGuide = CLIENT_DIRECTORY_GUIDES[(currentIndex + 1) % CLIENT_DIRECTORY_GUIDES.length]
  const search = searchQuery.trim().toLocaleLowerCase()
  const visibleGuides = CLIENT_DIRECTORY_GUIDES.filter(client => `${client.id} ${client.name} ${client.category} ${client.description} ${client.aliases?.join(' ') ?? ''} ${client.appliesTo?.join(' ') ?? ''} ${CLIENT_TOPICS.find(topic => topic.clients.includes(client.id))?.title ?? ''} ${client.ccSwitch || client.ccSwitchGuideId ? 'cc switch ccswitch' : ''} ${client.id === 'deepseek-harness' ? 'dsh' : ''}`.toLocaleLowerCase().includes(search))
  const apiParams = new URLSearchParams()
  for (const key of ['embed', 'ui_mode', 'theme']) { const value = params.get(key); if (value) apiParams.set(key, value) }
  if (baseURL) apiParams.set('api_base', baseURL)
  const apiDocsHref = toCurrentOriginURI(`/api-docs${apiParams.size ? `?${apiParams}` : ''}`)
  const homeHref = toCurrentOriginURI(homepagePathForPosition(systemPosition))
  const consoleURI = toCurrentOriginURI(toSameOriginPath(consoleHref, '/admin'), { includeAppBasePath: false })
  const prerequisiteGuides = (guide.prerequisiteClients ?? []).map(getClientGuide)
  const protocolAddressHelp = guide.id === 'gemini-cli'
    ? '客户端会自动追加 /v1beta 路径，基础地址只填写站点根地址。'
    : guide.id === 'zcode' || guide.id === 'pi' || guide.id === 'codex' || guide.id === 'vscode-codex'
      ? '按协议使用对应端点，基础地址不加 /v1。'
      : guide.endpoint === '/v1/messages'
        ? '由客户端自动添加，基础地址不加 /v1。'
        : '示例已自动补齐 /v1，无需添加完整端点。'
  const prerequisites = prerequisiteGuides.length > 0 && <div className="client-prerequisite">
    <strong>{prerequisiteGuides.length === 1 ? `前置条件：先配置 ${prerequisiteGuides[0].name}` : '前置条件：先配置你要使用的客户端'}</strong>
    <p>{guide.prerequisite}</p>
    <div className="client-prerequisite-links">{prerequisiteGuides.map(client => {
      const linkParams = new URLSearchParams(apiParams)
      linkParams.set('client', client.id)
      return <Link key={client.id} className="client-inline-link" to={`/client-docs?${linkParams}`} onClick={() => { scrollRequested.current = true; setActiveSection('prepare'); trackFeatureClick('client-docs', `select-${client.id}`) }}>查看 {client.name} 接入指南 <ArrowRight size={14} aria-hidden="true" /></Link>
    })}</div>
  </div>

  const faqs = [
    { title: '返回 401 / 403，怎么处理？', text: usesCodexCCSwitchFlow ? '确认导入的是目标 API Key，并在 CC Switch 中启用了对应配置；再检查密钥是否有效、是否有模型与分组权限，以及账户额度是否可用。' : '确认使用的是平台控制台创建的 API Key，复制时没有多余空格。再检查密钥是否启用、是否有模型与分组权限，以及账户额度是否可用。' },
    { title: 'API 地址到底要不要加 /v1？', text: usesCodexCCSwitchFlow ? 'API Key 导入会带入连接配置，本流程无需在本页手动填写地址。若改用手动配置，Codex 的 base_url 填网关根地址，不加 /v1；Pi、Hermes 等配置会由本页按客户端自动补齐所需路径。' : '上方统一填写网关根地址。Codex 的 base_url，以及 Claude Code、Obsidian Claudian、Claude Desktop 与 ZCode 本示例的接口地址均不加 /v1；Pi、Hermes 等配置会由本页按客户端自动补齐所需路径。' },
    { title: '提示模型不存在或接口 404？', text: '模型名称需要与平台提供的模型 ID 完全一致，密钥所属分组也要支持指南标注的协议：Codex 使用 Responses，Claude Code、Claude Desktop、Obsidian Claudian 与 ZCode 示例使用 Messages，Pi、Hermes 与其他示例使用 Chat Completions。Paseo 沿用所选客户端的协议与配置。' },
    { title: '修改配置后为什么没有生效？', text: usesCodexCCSwitchFlow ? guide.id === 'vscode-codex' ? '确认 CC Switch 中刚导入的 Codex 配置处于启用状态，然后重载 VS Code 或 Cursor 窗口，让扩展重新读取配置。' : '确认 CC Switch 中刚导入的 Codex 配置处于启用状态，然后完全退出并重新打开 Codex Desktop。' : '环境变量只影响当前终端及其启动的程序。请从设置变量的终端启动客户端，并检查是否有项目配置覆盖了用户配置。OpenClaw 服务需重启；Pi 重新打开 /model 读取模型文件。' },
  ]

  function selectTheme(value: string) {
    const preference = parseThemePreference(value)
    if (!preference) return
    setSavedTheme(preference)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference) } catch { /* 当前页面仍可切换主题。 */ }
    setParams(current => { const next = new URLSearchParams(current); next.set('theme', preference); return next }, { replace: true })
    trackFeatureClick('client-docs', `theme-${preference}`)
  }

  function selectClient(id: ClientId) {
    scrollRequested.current = id !== guide.id
    if (id === guide.id) articleRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
    setParams(current => { const next = new URLSearchParams(current); next.set('client', id); next.delete('method'); next.delete('target'); return next })
    setSearchQuery('')
    setActiveSection(id === 'codex' ? 'configure' : 'prepare')
    trackFeatureClick('client-docs', `select-${id}`)
  }

  function selectSetupMethod(method: string) {
    if (method !== 'cc-switch' && method !== 'manual') return
    setParams(current => { const next = new URLSearchParams(current); next.set('method', method); return next })
    setActiveSection(isCodex ? 'configure' : 'prepare')
    trackFeatureClick('client-docs', `method-${guide.id}-${method}`)
  }

  function clearSearch() {
    setSearchQuery('')
    searchRef.current?.focus({ preventScroll: true })
  }

  function selectSection(sectionId: string) {
    setActiveSection(sectionId)
    const target = pageRef.current?.querySelector<HTMLElement>(`#${sectionId}`)
    if (target) {
      const reducedMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
      target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' })
    }
    trackFeatureClick('client-docs', `section-${viewKey.replace(':', '-')}-${sectionId}`)
  }

  function selectPlatform(next: GuidePlatform) {
    if (next === platform) return
    setPlatform(next)
    trackFeatureClick('client-docs', `platform-${guide.id}-${next}`)
  }

  useEffect(() => {
    const previous = document.title
    document.title = `${guide.name} 接入指南 · ${systemName}`
    return () => { document.title = previous }
  }, [guide.name, systemName])

  useEffect(() => {
    let active = true
    void apiClient.get<AuxEnvelope<Partial<HomepageConfig>>>('/homepage/config').then(envelope => {
      if (active && envelope.code === 0) {
        setSystemName(resolveSystemName(envelope.data))
        setSiteLogoUrl(envelope.data?.siteLogoUrl?.trim() ?? '')
        setSystemPosition(normalizeSystemPosition(envelope.data?.systemPosition))
      }
      const configuredConsole = envelope.data?.consoleHref?.trim()
      if (active && envelope.code === 0 && configuredConsole && isHomepageNavigationHref(configuredConsole)) {
        setConsoleHref(configuredConsole)
      }
    }).catch(() => {
      // 系统名称读取失败时保留通用页尾，接入步骤仍可正常阅读。
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
      if (visible[0]) setActiveSection(visible[0].target.id)
    }, { rootMargin: '-12% 0px -66% 0px' })
    pageSections.forEach(section => { const element = pageRef.current?.querySelector(`#${section.id}`); if (element) observer.observe(element) })
    return () => observer.disconnect()
  }, [pageSections, viewKey])

  useGSAP((_, contextSafe) => {
    if (!contextSafe) return
    const jumpWithoutMotion = contextSafe(() => {
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
    scrollTopRef.current = jumpWithoutMotion
    if (!canAnimate) return () => { scrollTopRef.current = () => {} }
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      scrollTopRef.current = contextSafe(() => {
        gsap.to(window, {
          duration: 0.56,
          scrollTo: { y: 0, autoKill: true },
          ease: 'power2.out',
          overwrite: 'auto',
        })
      })
      return () => { scrollTopRef.current = jumpWithoutMotion }
    })
    return () => {
      media.revert()
      scrollTopRef.current = () => {}
    }
  }, { scope: pageRef })

  useGSAP(() => {
    if (!canAnimate) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.client-install-panel', { autoAlpha: 0, y: 4 }, {
        autoAlpha: 1,
        y: 0,
        duration: 0.18,
        ease: 'power2.out',
        overwrite: 'auto',
        clearProps: 'autoAlpha,y',
      })
    })
    return () => media.revert()
  }, { scope: pageRef, dependencies: [platform], revertOnUpdate: true })

  useEffect(() => {
    if (!scrollRequested.current) return
    // 切换客户端后定位到正文；目录和主题保持在当前页面。
    const frame = window.requestAnimationFrame(() => {
      articleRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
      scrollRequested.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [viewKey])

  return <div id="top" ref={pageRef} data-theme={theme} className={`client-docs${embedded ? ' client-docs--embedded' : ''}`}>
    <a href="#guide" className="client-skip">跳到接入步骤</a>
    {!embedded && <header className="client-header">
      <div className="client-header-inner client-shell">
        <a className="client-brand" href="#top" aria-label="客户端接入文档首页" onClick={event => { event.preventDefault(); scrollTopRef.current() }}><BookOpen size={22} aria-hidden="true" /><strong>接入文档</strong><span className="client-brand-caption">配置你的工作方式</span></a>
        <div className="client-header-tools">
          <a className="client-header-home" href={homeHref} target="_top" aria-label="返回官网" onClick={() => trackFeatureClick('client-docs', 'open-home')}><Home size={17} aria-hidden="true" /><span>官网</span></a>
          <a className="client-header-api" href={apiDocsHref} target="_top" onClick={() => trackFeatureClick('client-docs', 'open-api-docs')} aria-label="查看 API 文档">API 参考 <ArrowUpRight size={16} aria-hidden="true" /></a>
          <div className="client-theme-picker">
            <ThemeIcon size={16} aria-hidden="true" />
            <select aria-label="外观主题" value={themePreference} onChange={event => selectTheme(event.target.value)}>
              <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
            </select>
            <ChevronDown size={12} className="client-theme-chevron" aria-hidden="true" />
          </div>
          <a className="client-header-console" href={consoleURI} target={consoleURI.startsWith('#') ? undefined : '_top'} onClick={() => trackFeatureClick('client-docs', 'open-console')}>控制台 <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
      </div>
    </header>}

    <main className="client-doc-layout client-shell">
      <aside id="clients" className="client-sidebar" aria-label="接入文档目录"><div className="client-sidebar-inner">
        <div className="client-sidebar-title"><strong>接入目录</strong><span>{search ? visibleGuides.length : CLIENT_DIRECTORY_GUIDES.length}</span></div>
        <div className="client-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="搜索客户端" placeholder="名称或用途" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} autoComplete="off" spellCheck={false} />
          {searchQuery && <button type="button" aria-label="清除搜索" onClick={clearSearch}><X size={14} aria-hidden="true" /></button>}
        </div>
        <nav aria-label="接入目录">
          {visibleGuides.map(client => <Button key={client.id} type="button" variant="ghost" className={guide.id === client.id ? 'is-current' : ''} aria-current={guide.id === client.id ? 'page' : undefined} onClick={() => selectClient(client.id)}><ClientMark id={client.id} small /><span>{client.name}</span>{guide.id === client.id && <ArrowRight size={15} aria-hidden="true" />}</Button>)}
        </nav>
        {search && visibleGuides.length === 0 && <div className="client-search-empty" role="status"><p>未找到匹配的接入指南</p><Button type="button" variant="link" className="client-inline-link" onClick={clearSearch}>显示全部指南</Button></div>}
        <p className="client-sidebar-note">选择客户端，查看安装、配置与验证步骤。</p>
        <a className="client-sidebar-reference" href={apiDocsHref} target="_top" onClick={() => trackFeatureClick('client-docs', 'open-api-docs')}>查阅 API 参考 <ArrowUpRight size={15} aria-hidden="true" /></a>
      </div></aside>

      <article id="guide" ref={articleRef} className="client-article" aria-labelledby="guide-title" tabIndex={-1}>
        <div className="client-mobile-menu">
          <label htmlFor="client-mobile-select">选择接入指南</label>
          <div><ClientMark id={guide.id} small /><Select value={guide.id} onValueChange={value => selectClient(value as ClientId)}>
            <SelectTrigger id="client-mobile-select" className="client-mobile-select-trigger" aria-label="选择接入指南"><SelectValue /></SelectTrigger>
            <SelectContent className="client-directory-select-content" data-theme={theme}>
              {CLIENT_DIRECTORY_GUIDES.map(client => <SelectItem value={client.id} key={client.id}>{client.name}</SelectItem>)}
            </SelectContent>
          </Select></div>
        </div>
        <div className="client-breadcrumb"><span>客户端接入</span><span>/</span><span>{activeTopic.title}</span>{activeTopic.clients.length > 1 && <><span>/</span><span>{guide.name}</span></>}{usesCodexCCSwitchFlow && <><span>/</span><span>CC Switch</span></>}</div>
        <div className="client-article-heading">
          <div className="client-guide-title-row"><ClientMark id={guide.id} /><h1 id="guide-title">{guide.name} 接入指南</h1></div>
          <p>{guideDescription}</p>
          <div className="client-guide-meta"><span>{guide.protocol}</span><a href={guide.officialUrl} onClick={() => trackFeatureClick('client-docs', `open-${guide.id}-official`)} target="_blank" rel="noreferrer">官方文档 <ExternalLink size={14} aria-hidden="true" /></a></div>
          {guideAppliesTo && <div className="client-applies-to" aria-label="适用客户端"><span>适用</span>{guideAppliesTo.map(item => <strong key={item}>{item}</strong>)}</div>}
        </div>
        <Tabs value={setupMethod} onValueChange={selectSetupMethod} className="client-method-tabs">
          {hasCCSwitch && guide.id !== 'claude-desktop' && <TabsList aria-label="配置方式" className="client-tab-list"><TabsTrigger id="client-method-cc-switch" aria-controls="client-method-panel" value="cc-switch" className="client-tab-trigger"><Waypoints size={16} aria-hidden="true" />CC Switch（推荐）</TabsTrigger><TabsTrigger id="client-method-manual" aria-controls="client-method-panel" value="manual" className="client-tab-trigger">手动配置</TabsTrigger></TabsList>}
          <TabsContent id="client-method-panel" value={setupMethod} forceMount className="client-guide-panel" role={hasCCSwitch && guide.id !== 'claude-desktop' ? 'tabpanel' : 'group'} aria-labelledby={hasCCSwitch && guide.id !== 'claude-desktop' ? `client-method-${setupMethod}` : undefined} aria-label={hasCCSwitch && guide.id !== 'claude-desktop' ? undefined : `${guide.name} 接入步骤`}>
        <Tabs value={platform} onValueChange={value => selectPlatform(value as GuidePlatform)} className="client-platform-mode">
        <details className="client-mobile-toc" key={`toc-${viewKey}`}><summary>本页内容 <ChevronDown size={16} aria-hidden="true" /></summary><nav aria-label="当前指南章节">{pageSections.map(section => <a key={section.id} href={`#${section.id}`} onClick={event => { event.preventDefault(); selectSection(section.id); event.currentTarget.closest('details')?.removeAttribute('open') }}>{section.title}</a>)}</nav></details>

          {!isCodex && <section id="prepare" className="client-guide-section">
            <div className="client-step-heading"><h2>准备接入信息</h2></div>
            {guide.endpoint ? <><p>在平台控制台创建 API Key，确认可用模型与额度，然后填写下面两项。后续示例会自动更新。</p>
            <div className="client-settings">
              <div><label htmlFor="client-api-base">API 基础地址</label><input id="client-api-base" type="url" value={baseInput} onChange={event => setBaseInput(event.target.value)} placeholder={currentPageOrigin() || '当前站点域名'} aria-invalid={!baseURL} aria-describedby="client-base-help" spellCheck={false} autoComplete="off" /><p id="client-base-help" className={!baseURL ? 'client-field-error' : ''}>{baseURL ? '默认使用当前访问站点的域名，也可以在这里临时替换。' : '请输入完整的 HTTP(S) 网关根地址，不要附带接口路径、查询参数或凭据。'}</p></div>
              <div><label htmlFor="client-model">模型名称</label><input id="client-model" value={modelInput} onChange={event => setModels(current => ({ ...current, [guide.id]: event.target.value }))} maxLength={160} placeholder={guide.defaultModel} aria-invalid={!validModel} aria-describedby="client-model-help" spellCheck={false} autoComplete="off" /><p id="client-model-help" className={!validModel ? 'client-field-error' : ''}>{validModel ? '替换为当前密钥可用的完整模型 ID，区分大小写。' : '请填写模型 ID，不能包含换行或控制字符。'}</p></div>
              <div className="client-key-note"><KeyRound size={17} aria-hidden="true" /><p>复制后，将 <code>sk-YOUR_API_KEY</code> 替换为你的密钥。<br /><span>无需在本页输入真实密钥。</span></p></div>
            </div></> : prerequisites}
          </section>}

          {!isCodex && <section id="install" className="client-guide-section">
            <div className="client-step-heading"><h2>{setupMethod === 'cc-switch' ? `安装 ${isCodex ? codexClientName : '客户端'} 与 CC Switch` : `安装 ${isCodex ? codexClientName : '客户端'}`}</h2></div>
            {guide.endpoint && (prerequisiteGuides.length ? prerequisites : <p>{guidePrerequisite} <a className="client-inline-link" href={guideInstallUrl} onClick={() => trackFeatureClick('client-docs', `open-${guide.id}-install`)} target="_blank" rel="noreferrer">安装说明 <ArrowUpRight size={13} aria-hidden="true" /></a></p>)}
            {installSteps && <ol className="client-instructions">{installSteps.map(step => <li key={step.text}>{step.text}{step.href && <> <a className="client-inline-link" href={step.href} onClick={() => trackFeatureClick('client-docs', `open-${guide.id}-install`)} target="_blank" rel="noreferrer">{step.linkLabel} <ArrowUpRight size={13} aria-hidden="true" /></a></>}</li>)}</ol>}
            {installCommand && <>
              <TabsList aria-label="操作系统" className="client-platform-tabs">{([{ id: 'unix', label: 'macOS / Linux' }, { id: 'windows', label: 'Windows' }] as const).map(option => <TabsTrigger key={option.id} value={option.id} className="client-platform-trigger">{option.label}</TabsTrigger>)}</TabsList>
              <TabsContent value={platform} forceMount className="client-install-panel"><CodeBlock title={guide.installTitle ?? `安装 ${guide.name}`} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={installCommand} feature={`${guide.id}-install`} /></TabsContent>
            {guide.installAlternatives?.map((method, index) => <div key={method.title}>
              <p>{method.description}</p>
              <CodeBlock title={method.title} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={method.command} feature={`${guide.id}-install-alternative-${index}`} />
            </div>)}
            </>}
            {setupMethod === 'cc-switch' && <p>安装并打开 <a className="client-inline-link" href={CC_SWITCH_DOWNLOAD_URL} onClick={() => trackFeatureClick('client-docs', `open-cc-switch-${guide.id}-download`)} target="_blank" rel="noreferrer">CC Switch <ArrowUpRight size={13} aria-hidden="true" /></a>，在配置前确认 {isCodex ? codexClientName : guide.name} 已可启动。</p>}
          </section>}

          <section id="configure" className={`client-guide-section${usesCodexCCSwitchFlow ? ' client-guide-section--cc-switch-flow' : ''}`}>
            <div className="client-step-heading"><h2>{usesCodexCCSwitchFlow ? '从 API Key 导入并启动' : isCodex ? '手动配置 Codex' : '配置连接'}</h2></div>
            {isCodex && setupMethod === 'manual' && <div className="client-settings">
              <div><label htmlFor="client-api-base">API 基础地址</label><input id="client-api-base" type="url" value={baseInput} onChange={event => setBaseInput(event.target.value)} placeholder={currentPageOrigin() || '当前站点域名'} aria-invalid={!baseURL} aria-describedby="client-base-help" spellCheck={false} autoComplete="off" /><p id="client-base-help" className={!baseURL ? 'client-field-error' : ''}>{baseURL ? '默认使用当前访问站点的域名，也可以在这里临时替换。' : '请输入完整的 HTTP(S) 网关根地址，不要附带接口路径、查询参数或凭据。'}</p></div>
              <div><label htmlFor="client-model">模型名称</label><input id="client-model" value={modelInput} onChange={event => setModels(current => ({ ...current, [guide.id]: event.target.value }))} maxLength={160} placeholder={guide.defaultModel} aria-invalid={!validModel} aria-describedby="client-model-help" spellCheck={false} autoComplete="off" /><p id="client-model-help" className={!validModel ? 'client-field-error' : ''}>{validModel ? '替换为当前密钥可用的完整模型 ID，区分大小写。' : '请填写模型 ID，不能包含换行或控制字符。'}</p></div>
              <div className="client-key-note"><KeyRound size={17} aria-hidden="true" /><p>复制后，将 <code>sk-YOUR_API_KEY</code> 替换为你的密钥。<br /><span>无需在本页输入真实密钥。</span></p></div>
            </div>}
            {setupMethod === 'cc-switch' && ccSwitchGuide ? <div className="client-quick-config" role="region" aria-labelledby="client-cc-switch-config-title">
              <h3 id="client-cc-switch-config-title">CC Switch · {isCodex ? codexClientName : guide.name} 配置</h3>
              <p>{usesCodexCCSwitchFlow ? `开始前先安装并打开 ${guide.id === 'vscode-codex' ? 'CC Switch 和 VS Code/Cursor 中的 Codex 扩展' : 'Codex Desktop 与 CC Switch'}；需要安装时使用上方官方入口。然后从平台 API Key 管理页开始，依次完成下面五步；不需要手动录入 API Key、接口地址或模型。` : ''}{ccSwitchGuide.description}</p>
              <div className="client-quick-config-links">
                <a className="client-inline-link" href={CC_SWITCH_DOWNLOAD_URL} onClick={() => trackFeatureClick('client-docs', `open-cc-switch-${guide.id}-download`)} target="_blank" rel="noreferrer">下载 CC Switch <ArrowUpRight size={14} aria-hidden="true" /></a>
                {isCodex && <a className="client-inline-link" href="https://openai.com/codex/" onClick={() => trackFeatureClick('client-docs', 'open-codex-desktop-install')} target="_blank" rel="noreferrer">下载 Codex Desktop <ArrowUpRight size={14} aria-hidden="true" /></a>}
                {!isCodex && <a className="client-inline-link" href={`${CC_SWITCH_DOCS_URL}${ccSwitchGuide.docsPath ?? '2.1-add.md'}`} onClick={() => trackFeatureClick('client-docs', `open-cc-switch-${guide.id}-docs`)} target="_blank" rel="noreferrer">配置说明 <ArrowUpRight size={14} aria-hidden="true" /></a>}
              </div>
              {usesCodexCCSwitchFlow
                ? <ClientSetupDiagram clientId={guide.id} method="cc-switch" baseURL={baseURL} model={model} steps={ccSwitchSteps ?? []} systemName={systemName} siteLogoUrl={siteLogoUrl} />
                : <>
                  <ol className="client-instructions">{ccSwitchSteps?.map(step => <li key={step}>{step}</li>)}</ol>
                  {quickExample && <ClientSetupDiagram clientId={guide.id} method="cc-switch" baseURL={baseURL} model={model} />}
                  {quickExample ? <details className="client-parameter-details"><summary>复制填写参数 <ChevronDown size={16} aria-hidden="true" /></summary><CodeBlock title={`${guide.name} · CC Switch 填写参考`} language={quickExample.language} code={quickExample.code} feature={`${guide.id}-cc-switch`} /></details> : <div className="client-config-error" role="status">填写有效的 API 基础地址和模型后，即可查看快捷配置参数。</div>}
                </>}
              {!isCodex && ccSwitchGuide.screenshots?.map((screenshot, index) => <Screenshot key={`${guide.id}-cc-switch-${index}`} screenshot={screenshot} clientName={guide.name} feature={`${guide.id}-cc-switch-${index}`} />)}
              <p className="client-quick-config-next">{usesCodexCCSwitchFlow ? '完成五步后，' : '完成并启用供应商后，'}前往<a className="client-inline-link" href="#verify" onClick={() => selectSection('verify')}>验证接入 <ArrowDown size={14} aria-hidden="true" /></a></p>
            </div> : setupMethod === 'cc-switch' && guide.ccSwitch ? <div className="client-quick-config" role="region" aria-labelledby="client-quick-config-title">
              <h3 id="client-quick-config-title">CC Switch 快捷配置</h3>
              <p>{guide.ccSwitch.description}</p>
              <div className="client-quick-config-links">
                <a className="client-inline-link" href={CC_SWITCH_DOWNLOAD_URL} onClick={() => trackFeatureClick('client-docs', `open-${guide.id}-cc-switch-download`)} target="_blank" rel="noreferrer">下载 CC Switch <ArrowUpRight size={14} aria-hidden="true" /></a>
                <a className="client-inline-link" href={`${CC_SWITCH_DOCS_URL}${guide.id === 'claude-desktop' ? '2.6-claude-desktop.md' : '2.1-add.md'}`} onClick={() => trackFeatureClick('client-docs', `open-${guide.id}-cc-switch-docs`)} target="_blank" rel="noreferrer">配置说明 <ArrowUpRight size={14} aria-hidden="true" /></a>
              </div>
              <ol className="client-instructions">{guide.ccSwitch.steps.map(step => <li key={step}>{step}</li>)}</ol>
              {quickExample && <ClientSetupDiagram clientId={guide.id} method="cc-switch" baseURL={baseURL} model={model} />}
              {quickExample ? <details className="client-parameter-details"><summary>复制填写参数 <ChevronDown size={16} aria-hidden="true" /></summary><CodeBlock title={`${guide.name} · CC Switch 填写参考`} language={quickExample.language} code={quickExample.code} feature={`${guide.id}-cc-switch`} /></details> : <div className="client-config-error" role="status">填写有效的 API 基础地址和模型后，即可查看快捷配置参数。</div>}
              {(guide.ccSwitch.screenshots ?? (guide.ccSwitch.screenshot ? [guide.ccSwitch.screenshot] : [])).map((screenshot, index) => <Screenshot key={`${guide.id}-cc-switch-${index}`} screenshot={screenshot} clientName={guide.name} feature={`${guide.id}-cc-switch-${index}`} />)}
              <p className="client-quick-config-next">完成后，前往<a className="client-inline-link" href="#verify" onClick={() => selectSection('verify')}>验证接入 <ArrowDown size={14} aria-hidden="true" /></a></p>
            </div> : <>
            <p>{guideConfigDescription}</p>
            {guide.configSteps && <ol className="client-instructions">{guide.configSteps.map(step => <li key={step}>{step}</li>)}</ol>}
            {guide.id === 'hermes' && <CodeBlock title="启动配置向导" language="Terminal" code="hermes model" feature="hermes-wizard" />}
            {guide.endpoint && (example ? <CodeBlock title={guide.configPath} language={example.language} code={example.code} feature={`${guide.id}-config`} /> : <div className="client-config-error" role="status">请先填写有效地址和模型名称，再生成配置。</div>)}
            {guide.id === 'openai-compatible' && baseURL && validModel && <CodeBlock title="Python 3 请求示例" language="Python" code={`import json
import urllib.request

url = ${JSON.stringify(`${baseURL}/v1/chat/completions`)}
payload = {"model": ${JSON.stringify(model)}, "messages": [{"role": "user", "content": "当前时间"}]}
request = urllib.request.Request(
    url,
    data=json.dumps(payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "Authorization": "Bearer sk-YOUR_API_KEY"},
)
with urllib.request.urlopen(request, timeout=30) as response:
    print(response.read().decode("utf-8"))`} feature="openai-compatible-python" />}
            {guide.authFile && <><p>{guide.authFile.description}</p><CodeBlock title={guide.authFile.path} language="JSON" code={guide.authFile.code} feature={`${guide.id}-auth`} /></>}
            </>}
            {guide.endpoint && <div className="client-protocol-note"><span>请求端点</span><code>{guide.id === 'zcode' || guide.id === 'pi' ? '/v1/messages · /v1/chat/completions · /v1/responses' : guide.endpoint}</code><span>{protocolAddressHelp}</span></div>}
            {!isCodex && setupMethod === 'manual' && guide.screenshots && <Screenshot screenshot={guide.screenshots.configure} clientName={guide.name} feature={`${guide.id}-configure`} />}
            {setupMethod === 'manual' && (guide.id === 'paseo' || ((guide.id === 'zcode' || guide.id === 'deepseek-harness') && example)) && <ClientSetupDiagram clientId={guide.id} method="manual" baseURL={baseURL} model={model} />}
          </section>

          <section id="verify" className="client-guide-section">
            <div className="client-step-heading"><h2>验证接入</h2></div><p>{isCodex ? guideVerification : setupMethod === 'cc-switch' && ccSwitchGuide && guide.id !== 'vscode-codex' ? ccSwitchGuide.verification : guide.verification}</p>
            {verifyCommand && <CodeBlock title={`启动并验证 ${guide.name}`} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={verifyCommand} feature={`${guide.id}-verify`} />}
            <CodeBlock title="发送验证消息" language="对话内容" code="当前时间" feature={`${guide.id}-prompt`} />
            <div className="client-verification-note"><Check size={18} aria-hidden="true" /><div><strong>收到回复，再核对用量</strong><p>客户端正常回复，且平台控制台出现对应请求记录，即可确认本次接入。</p></div></div>
            {!isCodex && guide.screenshots && <Screenshot screenshot={guide.screenshots.verify} clientName={guide.name} feature={`${guide.id}-verify`} />}
          </section>

          <section id="troubleshooting" className="client-guide-section client-faq-section">
            <div className="client-step-heading"><h2>常见问题</h2></div>
            <div className="client-specific-help"><strong>{setupMethod === 'cc-switch' ? `CC Switch · ${isCodex ? codexClientName : guide.name}` : guide.name} 配置提示</strong><p>{isCodex ? guideTroubleshooting : setupMethod === 'cc-switch' && ccSwitchGuide && guide.id !== 'vscode-codex' ? ccSwitchGuide.troubleshooting : guide.troubleshooting}</p></div>
            <div className="client-faq-list">{faqs.map(faq => <details key={faq.title} className="client-faq"><summary>{faq.title}<ChevronDown size={18} aria-hidden="true" /></summary><p>{faq.text}</p></details>)}</div>
          </section>
        <div className="client-next-guide"><span>继续阅读</span><Button type="button" variant="ghost" onClick={() => selectClient(nextGuide.id)}><ClientMark id={nextGuide.id} small />{nextGuide.name}<ArrowRight size={18} aria-hidden="true" /></Button></div>
        </Tabs>
          </TabsContent>
        </Tabs>
      </article>

      <aside className="client-reading-rail" aria-label="阅读导航"><div>
        <p className="client-toc-title">本页内容</p>
        <nav className="client-toc" aria-label="本页内容">{pageSections.map(section => <a key={section.id} href={`#${section.id}`} aria-current={activeSection === section.id ? 'location' : undefined} onClick={event => { event.preventDefault(); selectSection(section.id) }}>{section.title}</a>)}</nav>
        <div className="client-reading-note"><Check size={18} aria-hidden="true" /><p>接入完成后<br />发送「当前时间」<br />确认收到正常回复。</p></div>
      </div></aside>
    </main>
    <footer className="client-footer client-shell"><div className="client-footer-brand"><Terminal size={18} aria-hidden="true" /><span>{systemName} · 客户端接入文档</span></div><span>{CLIENT_DIRECTORY_GUIDES.length} 种客户端 · 持续更新</span><span className="client-footer-copyright">© 2026 {systemName}. All rights reserved.</span><nav aria-label="相关文档"><a href={apiDocsHref} target="_top" onClick={() => trackFeatureClick('client-docs', 'open-api-docs')}>API 参考 <ArrowUpRight size={16} aria-hidden="true" /></a><a href="#top" onClick={event => { event.preventDefault(); scrollTopRef.current() }}>回到顶部 <ArrowUp size={16} aria-hidden="true" /></a></nav></footer>
  </div>
}
