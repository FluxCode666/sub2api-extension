import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, BookOpen, Check, ChevronDown, Copy, ExternalLink, Home, ImageIcon, KeyRound, Monitor, Moon, Search, Sun, Terminal, X } from 'lucide-react'
import { CLIENT_GUIDES, getClientGuide, getConfigExample, getInstallCommand, getVerifyCommand, normalizeGatewayURL, type ClientId, type GuidePlatform, type GuideScreenshot } from '@/lib/client-guides'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import '@fontsource-variable/geist'
import './ClientDocsPage.css'

gsap.registerPlugin(useGSAP)
const canAnimate = typeof window !== 'undefined' && typeof window.matchMedia === 'function'

const GUIDE_SECTIONS = [
  { id: 'prepare', title: '准备接入信息' },
  { id: 'install', title: '安装客户端' },
  { id: 'configure', title: '配置连接' },
  { id: 'verify', title: '验证接入' },
  { id: 'troubleshooting', title: '常见问题' },
]

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

function ClientMark({ id, small = false }: { id: ClientId; small?: boolean }) {
  const guide = getClientGuide(id)
  return <span className={`client-mark client-mark--${id}${small ? ' client-mark--small' : ''}`} aria-hidden="true">
    <img src={guide.icon} alt="" width={small ? 20 : 38} height={small ? 20 : 38} draggable={false} />
  </span>
}

function CodeBlock({ title, language, code, feature }: { title: string; language: string; code: string; feature: string }) {
  const [status, setStatus] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const codeRef = useRef<HTMLElement>(null)
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

  return <div className="client-code" data-state={status}>
    <div className="client-code-bar"><span>{title}</span><div><small>{language}</small><button type="button" onClick={() => void copy()} disabled={status === 'copying'} aria-busy={status === 'copying'} aria-label={`复制${title}`}>
      {status === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{status === 'copied' ? '已复制' : status === 'copying' ? '复制中' : '复制'}
    </button></div></div>
    <pre tabIndex={0} aria-label={title}><code ref={codeRef}>{code}</code></pre>
    <span className={status === 'error' ? 'client-copy-error' : 'sr-only'} role="status">{status === 'error' ? '自动复制不可用，代码已选中，请按 Ctrl+C 或 ⌘C 复制。' : status === 'copied' ? `${title}已复制` : ''}</span>
  </div>
}

function Screenshot({ screenshot, clientName }: { screenshot: GuideScreenshot; clientName: string }) {
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const hasImage = !!screenshot.src && !failed
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (expanded && typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal()
    if (!expanded && typeof dialog.close === 'function' && dialog.open) dialog.close()
  }, [expanded])

  return <figure className="client-screenshot">
    {hasImage ? <button type="button" className="client-screenshot-image" onClick={() => setExpanded(true)} aria-label={`放大查看：${screenshot.caption}`}>
      <img src={screenshot.src} alt={screenshot.alt} loading="lazy" onError={() => setFailed(true)} />
      <span><ImageIcon size={14} aria-hidden="true" /> 点击放大</span>
    </button> : <div className="client-screenshot-placeholder" role="img" aria-label={`${clientName}：${screenshot.caption}（截图待补充）`}>
      <ImageIcon size={24} strokeWidth={1.5} aria-hidden="true" />
      <div><strong>{screenshot.caption}</strong><span>图示待补充 · 可先按文字步骤完成</span></div>
    </div>}
    {hasImage && <figcaption>{clientName}<span>/</span>{screenshot.caption}</figcaption>}
    {hasImage && <dialog className="client-image-dialog" aria-label={screenshot.caption} ref={dialogRef} onClose={() => setExpanded(false)} onClick={event => { if (event.target === event.currentTarget) setExpanded(false) }}>
      <button type="button" autoFocus onClick={() => setExpanded(false)} aria-label="关闭大图"><X aria-hidden="true" /></button>
      <img src={screenshot.src} alt={screenshot.alt} /><p>{screenshot.caption}</p>
    </dialog>}
  </figure>
}

export default function ClientDocsPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const articleRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRequested = useRef(false)
  const [params, setParams] = useSearchParams()
  const [savedTheme, setSavedTheme] = useState(readSavedTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false)
  const themePreference = parseThemePreference(params.get('theme')) ?? savedTheme
  const theme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference
  const ThemeIcon = themePreference === 'system' ? Monitor : themePreference === 'dark' ? Moon : Sun
  const guide = getClientGuide(params.get('client'))
  const [platform, setPlatform] = useState<GuidePlatform>('unix')
  const [baseInput, setBaseInput] = useState(() => params.get('api_base') || 'https://api.example.com')
  const baseInputDirty = useRef(Boolean(params.get('api_base')))
  const [models, setModels] = useState<Partial<Record<ClientId, string>>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [activeSection, setActiveSection] = useState('prepare')
  const [systemName, setSystemName] = useState('')
  const embedded = params.get('embed') === '1' || params.get('ui_mode') === 'embedded'
  const baseURL = normalizeGatewayURL(baseInput)
  const modelInput = models[guide.id] ?? guide.defaultModel
  const model = modelInput.trim()
  const validModel = !!model && !/[\x00-\x1f\x7f]/.test(model)
  const example = baseURL && validModel ? getConfigExample(guide.id, baseURL, model, platform) : null
  const installCommand = getInstallCommand(guide.id, platform)
  const verifyCommand = validModel ? getVerifyCommand(guide.id, model, platform) : null
  const currentIndex = CLIENT_GUIDES.findIndex(client => client.id === guide.id)
  const nextGuide = CLIENT_GUIDES[(currentIndex + 1) % CLIENT_GUIDES.length]
  const search = searchQuery.trim().toLocaleLowerCase()
  const visibleGuides = CLIENT_GUIDES.filter(client => `${client.id} ${client.name} ${client.category} ${client.description} ${client.id === 'deepseek-harness' ? 'dsh' : ''}`.toLocaleLowerCase().includes(search))
  const apiParams = new URLSearchParams()
  for (const key of ['embed', 'ui_mode', 'theme']) { const value = params.get(key); if (value) apiParams.set(key, value) }
  if (baseURL) apiParams.set('api_base', baseURL)
  const apiDocsHref = `/api-docs${apiParams.size ? `?${apiParams}` : ''}`
  const prerequisiteGuides = (guide.prerequisiteClients ?? []).map(getClientGuide)
  const prerequisites = prerequisiteGuides.length > 0 && <div className="client-prerequisite">
    <strong>{prerequisiteGuides.length === 1 ? `前置条件：先配置 ${prerequisiteGuides[0].name}` : '前置条件：先配置你要使用的客户端'}</strong>
    <p>{guide.prerequisite}</p>
    <div className="client-prerequisite-links">{prerequisiteGuides.map(client => {
      const linkParams = new URLSearchParams(apiParams)
      linkParams.set('client', client.id)
      return <Link key={client.id} className="client-inline-link" to={`/client-docs?${linkParams}`} onClick={() => { scrollRequested.current = true; setActiveSection('prepare') }}>查看 {client.name} 接入指南 <ArrowRight size={14} aria-hidden="true" /></Link>
    })}</div>
  </div>

  const faqs = [
    { title: '返回 401 / 403，怎么处理？', text: '确认使用的是平台控制台创建的 API Key，复制时没有多余空格。再检查密钥是否启用、是否有模型与分组权限，以及账户额度是否可用。' },
    { title: 'API 地址到底要不要加 /v1？', text: 'Claude Code 和 Obsidian Claudian 的 ANTHROPIC_BASE_URL、ZCode 本示例的 Base URL 均填网关根地址；本页的 OpenAI 兼容接口示例使用以 /v1 结尾的地址。上方填写根地址即可，示例会按当前指南自动处理，避免重复 /v1。' },
    { title: '提示模型不存在或接口 404？', text: '模型名称需要与平台提供的模型 ID 完全一致，密钥所属分组也要支持指南标注的协议：Codex 使用 Responses，Claude Code、Obsidian Claudian 与 ZCode 示例使用 Messages，Pi、Hermes 与其他示例使用 Chat Completions。Paseo 沿用所选客户端的协议与配置。' },
    { title: '修改配置后为什么没有生效？', text: '环境变量只影响当前终端及其启动的程序。请从设置变量的终端启动客户端，并检查是否有项目配置覆盖了用户配置。OpenClaw 服务需重启；Pi 重新打开 /model 读取模型文件。' },
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
    setParams(current => { const next = new URLSearchParams(current); next.set('client', id); return next })
    setSearchQuery('')
    setActiveSection('prepare')
    trackFeatureClick('client-docs', `select-${id}`)
  }

  function clearSearch() {
    setSearchQuery('')
    searchRef.current?.focus({ preventScroll: true })
  }

  function onPlatformKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? 'unix' : event.key === 'End' ? 'windows' : platform === 'unix' ? 'windows' : 'unix'
    setPlatform(next)
    pageRef.current?.querySelector<HTMLButtonElement>(`#platform-${next}`)?.focus({ preventScroll: true })
  }

  useEffect(() => {
    const previous = document.title
    document.title = `${guide.name} 接入指南 · 客户端文档`
    return () => { document.title = previous }
  }, [guide.name])

  useEffect(() => {
    let active = true
    void apiClient.get<AuxEnvelope<{ siteName?: string; heroTitle?: string; systemDomain?: string }>>('/homepage/config').then(envelope => {
      const name = envelope.data?.siteName?.trim() || envelope.data?.heroTitle?.trim()
      if (active && envelope.code === 0 && name) {
        setSystemName(name)
      }
      const configuredDomain = envelope.data?.systemDomain?.trim()
      if (active && envelope.code === 0 && configuredDomain && !baseInputDirty.current) {
        setBaseInput(configuredDomain)
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
    GUIDE_SECTIONS.forEach(section => { const element = pageRef.current?.querySelector(`#${section.id}`); if (element) observer.observe(element) })
    return () => observer.disconnect()
  }, [guide.id])

  useGSAP(() => {
    if (!canAnimate) return
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.client-article-heading', { opacity: 0.65, y: 4 }, { opacity: 1, y: 0, duration: 0.2, ease: 'power2.out', clearProps: 'all' })
    })
    return () => media.revert()
  }, { scope: pageRef, dependencies: [guide.id], revertOnUpdate: true })

  useEffect(() => {
    if (!scrollRequested.current) return
    // 切换客户端后定位到正文；目录和主题保持在当前页面。
    const frame = window.requestAnimationFrame(() => {
      articleRef.current?.scrollIntoView({ behavior: 'instant', block: 'start' })
      scrollRequested.current = false
    })
    return () => window.cancelAnimationFrame(frame)
  }, [guide.id])

  return <div id="top" ref={pageRef} data-theme={theme} className={`client-docs${embedded ? ' client-docs--embedded' : ''}`}>
    <a href="#guide" className="client-skip">跳到接入步骤</a>
    <header className="client-header">
      <div className="client-header-inner client-shell">
        <a className="client-brand" href="#top" aria-label="客户端接入文档首页"><BookOpen size={22} aria-hidden="true" /><strong>接入文档</strong><span className="client-brand-caption">配置你的工作方式</span></a>
        <div className="client-header-tools">
          <Link className="client-header-home" to="/sub2api-home" aria-label="返回官网"><Home size={17} aria-hidden="true" /><span>官网</span></Link>
          <Link className="client-header-api" to={apiDocsHref} aria-label="查看 API 文档">API 参考 <ArrowUpRight size={16} aria-hidden="true" /></Link>
          <div className="client-theme-picker">
            <ThemeIcon size={16} aria-hidden="true" />
            <select aria-label="外观主题" value={themePreference} onChange={event => selectTheme(event.target.value)}>
              <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
            </select>
            <ChevronDown size={12} className="client-theme-chevron" aria-hidden="true" />
          </div>
        </div>
      </div>
    </header>

    <main className="client-doc-layout client-shell">
      <aside id="clients" className="client-sidebar" aria-label="接入文档目录"><div className="client-sidebar-inner">
        <div className="client-sidebar-title"><strong>选择客户端</strong><span>{CLIENT_GUIDES.length}</span></div>
        <div className="client-search">
          <Search size={16} aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="搜索客户端" placeholder="名称或用途" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} autoComplete="off" spellCheck={false} />
          {searchQuery && <button type="button" aria-label="清除搜索" onClick={clearSearch}><X size={14} aria-hidden="true" /></button>}
        </div>
        <nav aria-label="客户端目录">{visibleGuides.map(client => <button key={client.id} type="button" className={guide.id === client.id ? 'is-current' : ''} aria-current={guide.id === client.id ? 'page' : undefined} onClick={() => selectClient(client.id)}><ClientMark id={client.id} small /><span>{client.name}</span>{guide.id === client.id && <ArrowRight size={15} aria-hidden="true" />}</button>)}</nav>
        {visibleGuides.length === 0 && <div className="client-search-empty" role="status"><p>未找到匹配的客户端</p><button type="button" className="client-inline-link" onClick={clearSearch}>显示全部客户端</button></div>}
        <p className="client-sidebar-note">选择你正在使用的工具，<br />从安装、配置到第一次对话。</p>
        <Link className="client-sidebar-reference" to={apiDocsHref}>查阅 API 参考 <ArrowUpRight size={15} aria-hidden="true" /></Link>
      </div></aside>

      <article id="guide" ref={articleRef} className="client-article" aria-labelledby="guide-title" tabIndex={-1}>
        <div className="client-mobile-menu">
          <label htmlFor="client-mobile-select">选择客户端</label>
          <div><ClientMark id={guide.id} small /><select id="client-mobile-select" value={guide.id} onChange={event => selectClient(event.target.value as ClientId)}>{CLIENT_GUIDES.map(client => <option value={client.id} key={client.id}>{client.name}</option>)}</select><ChevronDown size={16} aria-hidden="true" /></div>
        </div>
        <div className="client-breadcrumb"><span>客户端接入</span><span>/</span><span>{guide.name}</span></div>
        <div className="client-article-heading">
          <div className="client-guide-title-row"><ClientMark id={guide.id} /><h1 id="guide-title">{guide.name} 接入指南</h1></div>
          <p>{guide.description}</p>
          <div className="client-guide-meta"><span>{guide.protocol}</span><a href={guide.officialUrl} target="_blank" rel="noreferrer">官方文档 <ExternalLink size={14} aria-hidden="true" /></a></div>
          <div className="client-quick-links"><span>已安装客户端？</span><a href="#configure" onClick={() => setActiveSection('configure')}>直接配置 <ArrowDown size={14} aria-hidden="true" /></a><a href="#verify" onClick={() => setActiveSection('verify')}>验证接入 <ArrowDown size={14} aria-hidden="true" /></a></div>
        </div>
        <details className="client-mobile-toc" key={`toc-${guide.id}`}><summary>本页内容 <ChevronDown size={16} aria-hidden="true" /></summary><nav aria-label="当前指南章节">{GUIDE_SECTIONS.map(section => <a key={section.id} href={`#${section.id}`} onClick={event => { setActiveSection(section.id); event.currentTarget.closest('details')?.removeAttribute('open') }}>{section.title}</a>)}</nav></details>

          <section id="prepare" className="client-guide-section">
            <div className="client-step-heading"><h2>准备接入信息</h2></div>
            {guide.endpoint ? <><p>在平台控制台创建 API Key，确认可用模型与额度，然后填写下面两项。后续示例会自动更新。</p>
            <div className="client-settings">
              <div><label htmlFor="client-api-base">API 基础地址</label><input id="client-api-base" type="url" value={baseInput} onChange={event => { baseInputDirty.current = true; setBaseInput(event.target.value) }} placeholder="https://api.example.com" aria-invalid={!baseURL} aria-describedby="client-base-help" spellCheck={false} autoComplete="off" /><p id="client-base-help" className={!baseURL ? 'client-field-error' : ''}>{baseURL ? '默认使用系统配置中的域名，也可以在这里临时替换。' : '请输入完整的 HTTP(S) 网关根地址，不要附带接口路径、查询参数或凭据。'}</p></div>
              <div><label htmlFor="client-model">模型名称</label><input id="client-model" value={modelInput} onChange={event => setModels(current => ({ ...current, [guide.id]: event.target.value }))} maxLength={160} placeholder={guide.defaultModel} aria-invalid={!validModel} aria-describedby="client-model-help" spellCheck={false} autoComplete="off" /><p id="client-model-help" className={!validModel ? 'client-field-error' : ''}>{validModel ? '替换为当前密钥可用的完整模型 ID，区分大小写。' : '请填写模型 ID，不能包含换行或控制字符。'}</p></div>
              <div className="client-key-note"><KeyRound size={17} aria-hidden="true" /><p>复制后，将 <code>sk-YOUR_API_KEY</code> 替换为你的密钥。<br /><span>无需在本页输入真实密钥。</span></p></div>
            </div></> : prerequisites}
          </section>

          <section id="install" className="client-guide-section">
            <div className="client-step-heading"><h2>安装客户端</h2></div>
            {guide.endpoint && (prerequisiteGuides.length ? prerequisites : <p>{guide.prerequisite} <a className="client-inline-link" href={guide.installUrl} target="_blank" rel="noreferrer">安装说明 <ArrowUpRight size={13} aria-hidden="true" /></a></p>)}
            {guide.installSteps && <ol className="client-instructions">{guide.installSteps.map(step => <li key={step.text}>{step.text}{step.href && <> <a className="client-inline-link" href={step.href} target="_blank" rel="noreferrer">{step.linkLabel} <ArrowUpRight size={13} aria-hidden="true" /></a></>}</li>)}</ol>}
            {installCommand && <>
              <div className="client-platform-tabs" role="tablist" aria-label="操作系统">{([{ id: 'unix', label: 'macOS / Linux' }, { id: 'windows', label: 'Windows PowerShell' }] as const).map(option => <button type="button" role="tab" id={`platform-${option.id}`} aria-selected={platform === option.id} aria-controls="client-platform-panel" tabIndex={platform === option.id ? 0 : -1} key={option.id} onClick={() => setPlatform(option.id)} onKeyDown={onPlatformKey}>{option.label}</button>)}</div>
              <div id="client-platform-panel" role="tabpanel" aria-labelledby={`platform-${platform}`}><CodeBlock title={guide.installTitle ?? `安装 ${guide.name}`} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={installCommand} feature={`${guide.id}-install`} /></div>
            </>}
            {guide.installAlternatives?.map((method, index) => <div key={method.title}>
              <p>{method.description}</p>
              <CodeBlock title={method.title} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={method.command} feature={`${guide.id}-install-alternative-${index}`} />
            </div>)}
          </section>

          <section id="configure" className="client-guide-section">
            <div className="client-step-heading"><h2>配置连接</h2></div><p>{guide.configDescription}</p>
            {guide.configSteps && <ol className="client-instructions">{guide.configSteps.map(step => <li key={step}>{step}</li>)}</ol>}
            {guide.id === 'hermes' && <CodeBlock title="启动配置向导" language="Terminal" code="hermes model" feature="hermes-wizard" />}
            {guide.endpoint && (example ? <CodeBlock title={guide.configPath} language={example.language} code={example.code} feature={`${guide.id}-config`} /> : <div className="client-config-error" role="status">请先在「准备接入信息」中填写有效地址和模型名称，再生成配置。</div>)}
            {guide.authFile && <><p>{guide.authFile.description}</p><CodeBlock title={guide.authFile.path} language="JSON" code={guide.authFile.code} feature={`${guide.id}-auth`} /></>}
            {guide.endpoint && <div className="client-protocol-note"><span>请求端点</span><code>{guide.endpoint}</code><span>{guide.endpoint === '/v1/messages' ? '由客户端自动添加，基础地址不加 /v1。' : '示例已自动补齐 /v1，无需添加完整端点。'}</span></div>}
            <Screenshot key={`${guide.id}-configure`} screenshot={guide.screenshots.configure} clientName={guide.name} />
          </section>

          <section id="verify" className="client-guide-section">
            <div className="client-step-heading"><h2>验证接入</h2></div><p>{guide.verification}</p>
            {verifyCommand && <CodeBlock title={`启动并验证 ${guide.name}`} language={platform === 'windows' ? 'PowerShell' : 'Bash / Zsh'} code={verifyCommand} feature={`${guide.id}-verify`} />}
            <CodeBlock title="发送验证消息" language="对话内容" code="当前时间" feature={`${guide.id}-prompt`} />
            <div className="client-verification-note"><Check size={18} aria-hidden="true" /><div><strong>收到回复，再核对用量</strong><p>客户端正常回复，且平台控制台出现对应请求记录，即可确认本次接入。</p></div></div>
            <Screenshot key={`${guide.id}-verify`} screenshot={guide.screenshots.verify} clientName={guide.name} />
          </section>

          <section id="troubleshooting" className="client-guide-section client-faq-section">
            <div className="client-step-heading"><h2>常见问题</h2></div>
            <div className="client-specific-help"><strong>{guide.name} 配置提示</strong><p>{guide.troubleshooting}</p></div>
            <div className="client-faq-list">{faqs.map(faq => <details key={faq.title} className="client-faq"><summary>{faq.title}<ChevronDown size={18} aria-hidden="true" /></summary><p>{faq.text}</p></details>)}</div>
          </section>
        <div className="client-next-guide"><span>继续阅读</span><button type="button" onClick={() => selectClient(nextGuide.id)}><ClientMark id={nextGuide.id} small />{nextGuide.name}<ArrowRight size={18} aria-hidden="true" /></button></div>
      </article>

      <aside className="client-reading-rail" aria-label="阅读导航"><div>
        <p className="client-toc-title">本页内容</p>
        <nav className="client-toc" aria-label="本页内容">{GUIDE_SECTIONS.map(section => <a key={section.id} href={`#${section.id}`} aria-current={activeSection === section.id ? 'location' : undefined} onClick={() => setActiveSection(section.id)}>{section.title}</a>)}</nav>
        <div className="client-reading-note"><Check size={18} aria-hidden="true" /><p>接入完成后<br />发送「当前时间」<br />确认收到正常回复。</p></div>
      </div></aside>
    </main>
    <footer className="client-footer client-shell"><div className="client-footer-brand"><Terminal size={18} aria-hidden="true" /><span>{systemName ? `${systemName} · 客户端接入文档` : '客户端接入文档'}</span></div><span>{CLIENT_GUIDES.length} 种客户端 · 持续更新</span><nav aria-label="相关文档"><Link to={apiDocsHref}>API 参考 <ArrowUpRight size={16} aria-hidden="true" /></Link><a href="#top">回到顶部 <ArrowUp size={16} aria-hidden="true" /></a></nav></footer>
  </div>
}
