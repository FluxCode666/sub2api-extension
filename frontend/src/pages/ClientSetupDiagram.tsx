import {
  Activity,
  Ban,
  Bell,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  CodeXml,
  Copy,
  CornerDownRight,
  ExternalLink,
  Gift,
  GripVertical,
  History,
  KeyRound,
  MoreHorizontal,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Terminal,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'
import type { ClientId } from '@/lib/client-guides'
import { DEFAULT_SUB2API_SYSTEM_NAME } from '@/lib/system-name'
import { withAppBasePath } from '@/lib/app-base-path'

interface DiagramField {
  label: string
  value: string
  wide?: boolean
}

interface DiagramContent {
  title: string
  entry: string
  fields: DiagramField[]
  finish: string
  note?: string
}

const CODEX_STEP_TITLES = [
  '创建 API Key',
  '点击「导入到 CCS」',
  '确认导入',
  '启用导入的配置',
  '重启 Codex 客户端',
] as const
const CODEX_STEP_MARKERS = ['①', '②', '③', '④'] as const

const SUB2API_ACCOUNT_LINKS = ['API 密钥', '使用记录', '兑换', '个人资料', 'API 文档']

function NumberCallout({ children }: { children: string }) {
  return <span className="codex-number-callout">{children}</span>
}

function Sub2APIKeyTable({ highlight, baseURL, systemName }: { highlight: 'create' | 'import'; baseURL: string | null; systemName: string }) {
  const rows = highlight === 'create'
    ? [
      { name: '测试a2', key: 'sk-29...da07', group: '企业分组', multiplier: '0.4x', usage: '近30天：$0.119', created: '2026/09/22 00:06' },
      { name: 'bus', key: 'sk-93...9a73', group: '企业分组', multiplier: '0.4x', usage: '近30天：$513.5756', created: '2026/08/15 21:14' },
    ]
    : [
      { name: 'bus', key: 'sk-93...9a73', group: '企业分组', multiplier: '0.4x', usage: '近30天：$513.5756', created: '2026/08/15 21:14' },
      { name: systemName, key: 'sk-•••2f8c', group: '默认分组', multiplier: '1.0x', usage: '近30天：$0.000', created: '刚刚创建' },
    ]

  return <div className="sub2api-page-body">
    <div className="sub2api-page-actions">
      <span className="sub2api-utility-button" aria-label="刷新"><RefreshCw size={13} /></span>
      <span className="sub2api-utility-button"><span className="sub2api-columns-icon">▥</span>列设置</span>
      <span className="sub2api-primary-button">
        <Plus size={14} />创建密钥
      </span>
    </div>
    <div className="sub2api-filters">
      <span className="sub2api-search"><Search size={13} />搜索名称或 Key...</span>
      <span>全部分组<ChevronDown size={12} /></span>
      <span>全部状态<ChevronDown size={12} /></span>
    </div>
    <div className="sub2api-endpoint"><span>API 端点</span><code>{baseURL ?? 'https://你的 Sub2API 域名'}</code><Copy size={12} /><span className="sub2api-endpoint-bolt">ϟ</span></div>
    <div className="sub2api-table-viewport">
      <div className="sub2api-key-table">
        <div className="sub2api-key-row sub2api-key-header"><span className="sub2api-checkbox" /><span>名称 <small>↕</small></span><span>API 密钥</span><span>分组</span><span>当前并发 <small>↕</small></span><span>用量</span><span>过期时间 <small>↕</small></span><span>状态 <small>↕</small></span><span>创建时间 <small>↕</small></span><span>操作</span></div>
        {rows.map(row => <div className="sub2api-key-row" key={row.name}>
          <span className="sub2api-checkbox" />
          <span className="sub2api-key-name">{row.name}</span>
          <code>{row.key}<Copy size={11} /></code>
          <span className="sub2api-group"><ShieldCheck size={11} />{row.group}<small>{row.multiplier}</small></span>
          <span className="sub2api-concurrency">0</span>
          <span className="sub2api-usage">今日：<b>$0.000</b><br />{row.usage}</span>
          <span>永久有效</span>
          <span className="sub2api-active">活跃</span>
          <span>{row.created}</span>
          <span className="sub2api-key-actions">
            <span><KeyRound size={11} />使用密钥</span>
            <span className={row.name === systemName ? 'is-highlighted' : ''}><ExternalLink size={11} />导入到 CCS{row.name === systemName && <NumberCallout>{CODEX_STEP_MARKERS[1]}</NumberCallout>}</span>
            <span><Ban size={11} />禁用</span>
            <span><Settings size={11} />编辑</span>
            <span><X size={11} />删除</span>
          </span>
        </div>)}
      </div>
    </div>
    <div className="sub2api-table-footer"><span>显示 1 至 {rows.length} 共 {rows.length} 条结果</span><span>每页：　20 <ChevronDown size={12} /></span><span>‹　<b>1</b>　›</span></div>
  </div>
}

function CreateAPIKeyDialog() {
  return <div className="sub2api-dialog-backdrop">
    <div className="sub2api-create-dialog">
      <header><strong>创建密钥</strong><X size={18} /></header>
      <div className="sub2api-dialog-fields">
        <label>名称<span>我的 API 密钥</span></label>
        <div className="sub2api-vendor-label">厂商</div>
        <div className="sub2api-vendor-options">
          <span><i className="sub2api-vendor-symbol sub2api-vendor-symbol-anthropic">✳</i>Anthropic</span>
          <span className="is-selected"><i className="sub2api-vendor-symbol sub2api-vendor-symbol-openai">◎</i>OpenAI<b>✓</b></span>
          <span><i className="sub2api-vendor-symbol sub2api-vendor-symbol-cn">K</i>国产模型</span>
          <span><i className="sub2api-vendor-symbol sub2api-vendor-symbol-other">✦</i>其他</span>
        </div>
        <small className="sub2api-vendor-hint">选择 OpenAI / GPT 的可用分组</small>
        <label>分组<span>选择分组<ChevronDown size={14} /></span></label>
        <div className="sub2api-switch-row">自定义密钥 <i /></div>
        <div className="sub2api-switch-row">IP 限制 <i /></div>
        <label>额度限制<span><b>$</b>输入 USD 额度限制</span><small>设置此密钥可消费的最大金额。0 = 无限。</small></label>
        <div className="sub2api-switch-row">速率限制 <i /></div>
        <div className="sub2api-switch-row">密钥有效期 <i /></div>
      </div>
      <footer><span>取消</span><strong>创建 <NumberCallout>{CODEX_STEP_MARKERS[0]}</NumberCallout></strong></footer>
    </div>
  </div>
}

function Sub2APIKeyManagement({ highlight, showCreateDialog = false, baseURL, systemName, siteLogoUrl }: { highlight: 'create' | 'import'; showCreateDialog?: boolean; baseURL: string | null; systemName: string; siteLogoUrl: string }) {
  return <div className="codex-product-window sub2api-window" aria-hidden="true">
    <aside className="sub2api-sidebar">
      <div className="sub2api-brand"><span>{siteLogoUrl ? <img src={withAppBasePath(siteLogoUrl)} alt="" /> : <b>{systemName.slice(0, 2)}</b>}</span><strong title={systemName}>{systemName}</strong><small>用户中心</small></div>
      <nav><div className="sub2api-nav-group">我的账户</div>{SUB2API_ACCOUNT_LINKS.map((link, index) => <span className={`sub2api-nav-link ${index === 0 ? 'is-active' : ''}`} key={link}><i>{[<KeyRound key="key" />, <Activity key="activity" />, <Gift key="gift" />, <UserRound key="user" />, <CodeXml key="docs" />][index]}</i><span>{link}</span></span>)}</nav>
      <div className="sub2api-sidebar-bottom"><span>◐</span>深色模式 <MoreHorizontal size={14} /></div>
    </aside>
    <main className="sub2api-main">
      <header className="sub2api-topbar"><div><strong>API 密钥</strong><span>管理您的 API 密钥和访问令牌</span></div><div className="sub2api-user-tools"><Bell size={14} /><span>🇨🇳　ZH <ChevronDown size={10} /></span><span className="sub2api-balance"><WalletCards size={12} />$75.76</span><b><UserRound size={12} /></b><span>用户 <ChevronDown size={10} /></span></div></header>
      <Sub2APIKeyTable highlight={highlight} baseURL={baseURL} systemName={systemName} />
    </main>
    {showCreateDialog && <CreateAPIKeyDialog />}
  </div>
}

interface CCSwitchProviderProps {
  name: string
  url: string
  usage: string
  updated?: string
  state: 'active' | 'inactive' | 'new'
}

function CCSwitchProvider({ name, url, usage, updated, state }: CCSwitchProviderProps) {
  const logo = name === 'OpenAI'
    ? <OpenAILogo />
    : name === 'MiniMax'
      ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6m4-10v14m4-17v20m4-15v10m4-12v14m4-10v6" /></svg>
      : name === 'OpenRouter'
        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 8 8-4 8 4-8 4-8-4Zm0 4 8 4 8-4M4 16l8 4 8-4" /></svg>
        : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8.5 8 5h11v3H9l-1 1.5h10l-2 3H6l-2 2 2 3h12" /></svg>
  return <div className={`ccswitch-provider-card ccswitch-provider-${state}`}>
    <GripVertical className="ccswitch-provider-drag" size={14} aria-hidden="true" />
    <span className={`ccswitch-provider-logo ccswitch-provider-logo-${name.toLowerCase().replace(/\s+/g, '-')}`}>{logo}</span>
    <div className="ccswitch-provider-info"><strong>{name}</strong><span>{url}</span></div>
    <div className="ccswitch-provider-meta">
      {usage && <span className="ccswitch-provider-usage">{usage}</span>}
      {updated && <span className="ccswitch-provider-sync"><Clock3 size={11} />{updated}<RefreshCw size={10} /></span>}
    </div>
    <div className="ccswitch-provider-actions">
      {state === 'active'
        ? <span className="ccswitch-current-state">使用中</span>
        : <b className="ccswitch-enable">启用{state === 'new' && <NumberCallout>{CODEX_STEP_MARKERS[3]}</NumberCallout>}</b>}
      <div className="ccswitch-provider-tools">
        <span title="编辑供应商"><Settings size={13} /></span>
        <span title="复制供应商"><Copy size={13} /></span>
        <span title="模型测试"><Activity size={13} /></span>
        <span title="配置用量查询"><WalletCards size={13} /></span>
        <span title="更多操作"><MoreHorizontal size={13} /></span>
      </div>
    </div>
  </div>
}

type CCSwitchApp = 'claude-code' | 'claude-desktop' | 'codex' | 'gemini' | 'opencode' | 'openclaw' | 'hermes'

function OpenAILogo() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.553 5.553 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.02.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.002zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z" /></svg>
}

function CCSwitchAppIcon({ app }: { app: CCSwitchApp }) {
  if (app === 'codex') return <OpenAILogo />

  const iconPath = app === 'claude-code'
    ? '/client-icons/claude-code.svg'
    : app === 'claude-desktop'
      ? '/client-icons/claude-desktop.svg'
      : app === 'openclaw'
        ? '/client-icons/openclaw.svg'
        : app === 'hermes'
          ? '/client-icons/hermes.svg'
          : null

  if (iconPath) return <img src={withAppBasePath(iconPath)} alt="" aria-hidden="true" />

  if (app === 'gemini') return <svg className="ccswitch-gemini-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5c1.05 5.13 3.38 7.46 10.5 10.5-7.12 3.04-9.45 5.37-10.5 10.5C10.95 17.37 8.62 15.04 1.5 12 8.62 8.96 10.95 6.63 12 1.5Z" /></svg>
  if (app === 'opencode') return <svg className="ccswitch-opencode-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 8h7l-6 8h6" /></svg>

  const Icon = app === 'claude-code'
    ? CodeXml
    : app === 'claude-desktop'
      ? Monitor
      : app === 'openclaw'
        ? UserRound
        : Terminal

  return <Icon size={17} strokeWidth={2} aria-hidden="true" />
}

function CCSwitchWindow({ view, baseURL, systemName }: { view: 'confirm' | 'enable'; baseURL: string | null; systemName: string }) {
  const endpoint = baseURL ?? 'https://你的 Sub2API 域名'
  return <div className="codex-product-window ccswitch-window" aria-hidden="true">
    <main className="ccswitch-main">
      <div className="ccswitch-window-controls"><i /><i /><i /></div>
      <header className="ccswitch-topbar">
        <strong><span className="ccswitch-brand-mark" aria-hidden="true" /> CC Switch</strong>
        <span className="ccswitch-settings" title="设置"><Settings size={15} /></span>
        <span className="ccswitch-route-label" title="本地路由开关"><Activity size={12} /><i /></span>
      <div className="ccswitch-appbar">
        <div className="ccswitch-app-tabs" aria-label="客户端">
          {([
            ['claude-code', 'Claude Code'],
            ['claude-desktop', 'Claude Desktop'],
            ['codex', 'Codex'],
            ['gemini', 'Gemini'],
            ['opencode', 'OpenCode'],
            ['openclaw', 'OpenClaw'],
            ['hermes', 'Hermes'],
          ] as const).map(([app, label]) => <span className={app === 'codex' ? 'is-current' : undefined} title={label} key={app} aria-label={label}>
            <i className={`ccswitch-app-icon ccswitch-app-icon-${app}`}><CCSwitchAppIcon app={app} /></i>
          </span>)}
        </div>
        <div className="ccswitch-toolbar">
          <div className="ccswitch-tool-group">
            <span title="Skills 管理"><Sparkles size={13} /></span>
            <span title="提示词管理"><BookOpen size={13} /></span>
            <span title="会话管理"><History size={13} /></span>
            <span title="MCP 管理"><CodeXml size={13} /></span>
          </div>
          <b title="添加供应商"><Plus size={15} /></b>
        </div>
      </div>
      </header>
      <div className="ccswitch-content">
        {view === 'enable' && <CCSwitchProvider name={systemName} url={endpoint} usage="刚刚导入" updated="刚刚" state="new" />}
        <CCSwitchProvider name="PackyCode" url="https://www.packyapi.ai" usage="已使用：672　剩余：66 USD" updated="10 分钟前" state="active" />
        <CCSwitchProvider name="MiniMax" url="https://platform.minimaxi.com" usage="5h：43% · 2h40m　7d：12% · 6d" updated="2 分钟前" state="inactive" />
        <CCSwitchProvider name="OpenRouter" url="https://openrouter.ai" usage="" state="inactive" />
        <CCSwitchProvider name="OpenAI" url="https://chatgpt.com/codex" usage="" state="inactive" />
      </div>
      {view === 'confirm' && <div className="ccswitch-dialog-backdrop"><div className="ccswitch-confirm-dialog">
        <header><strong>导入供应商配置</strong><X size={16} /></header>
        <div className="ccswitch-confirm-content"><span className="ccswitch-confirm-mark">⇧</span><div><strong>确认导入到 CC Switch？</strong><p>该 API Key 将作为 Codex 的供应商配置保存。</p></div></div>
        <dl><div><dt>客户端</dt><dd>Codex</dd></div><div><dt>供应商名称</dt><dd>{systemName}</dd></div><div><dt>API 地址</dt><dd>{endpoint}</dd></div><div><dt>API Key</dt><dd>sk-••••••••••••</dd></div></dl>
        <footer><span>取消</span><b>确认导入 <NumberCallout>{CODEX_STEP_MARKERS[2]}</NumberCallout></b></footer>
      </div></div>}
    </main>
  </div>
}

function CodexSketch({ step, baseURL, systemName, siteLogoUrl }: { step: number; baseURL: string | null; systemName: string; siteLogoUrl: string }) {
  if (step === 0) return <Sub2APIKeyManagement highlight="create" showCreateDialog baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} />
  if (step === 1) return <Sub2APIKeyManagement highlight="import" baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} />
  if (step === 2) return <CCSwitchWindow view="confirm" baseURL={baseURL} systemName={systemName} />
  if (step === 3) return <CCSwitchWindow view="enable" baseURL={baseURL} systemName={systemName} />
  return null
}

function CodexCCSwitchDiagrams({ steps, baseURL, systemName, siteLogoUrl }: { steps: readonly string[]; baseURL: string | null; systemName: string; siteLogoUrl: string }) {
  return <div className="codex-setup-diagrams" aria-label="Codex CC Switch 配置操作示意">
    {CODEX_STEP_TITLES.map((title, index) => index === 4
      ? <section id="codex-step-5" className="codex-setup-step codex-setup-text-step" key={title} aria-labelledby="codex-restart-step-title">
        <h3 id="codex-restart-step-title">{title}</h3>
        <p>{steps[index] ?? title}</p>
      </section>
      : <figure id={`codex-step-${index + 1}`} className="codex-setup-step" key={title} aria-label={`Codex 操作示意：${title}`}>
        <figcaption><h3>{title}</h3></figcaption>
        <p>{steps[index] ?? title}</p>
        <CodexSketch step={index} baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} />
      </figure>)}
    <p className="codex-setup-diagram-note">界面均为可编辑的 HTML/CSS 草图，不是客户端截图；不同版本的按钮位置和文案可能略有差异。</p>
  </div>
}

function diagramContent(clientId: ClientId, method: 'cc-switch' | 'manual', baseURL: string | null, model: string): DiagramContent | null {
  if (method === 'manual') {
    if (clientId === 'paseo') return {
      title: '选择已配置的客户端',
      entry: 'Settings → 当前主机 → Providers',
      fields: [
        { label: '运行主机', value: '当前主机' },
        { label: '提供方', value: 'Claude Code / Codex / Pi' },
        { label: '状态', value: '已配置并可用' },
      ],
      finish: '启用提供方，在工作区选择对应模型',
    }
    if (!baseURL) return null
    if (clientId === 'zcode') return {
      title: '添加自定义供应商',
      entry: '设置 → 模型设置 → 添加供应商',
      fields: [
        { label: 'API 格式', value: 'Anthropic Messages' },
        { label: 'API Key', value: 'sk-YOUR_API_KEY' },
        { label: 'Base URL', value: baseURL, wide: true },
        { label: '模型 ID', value: model, wide: true },
      ],
      finish: '添加模型，保存并启用供应商',
      note: '其他协议请按上方步骤更换 API 格式。',
    }
    if (clientId === 'deepseek-harness') return {
      title: '配置 DeepSeek 提供方',
      entry: '设置 → 模型 → DeepSeek → 自定义设置',
      fields: [
        { label: '提供方', value: 'DeepSeek (deepseek-official)' },
        { label: 'API 密钥', value: 'sk-YOUR_API_KEY' },
        { label: 'API 地址', value: `${baseURL}/v1`, wide: true },
        { label: '模型目录', value: model, wide: true },
      ],
      finish: '添加缺少的模型并保存',
    }
    return null
  }

  if (!baseURL) return null
  const target = clientId === 'codex' ? 'Codex Desktop'
    : clientId === 'vscode-codex' ? 'Codex' : clientId === 'claude-code' ? 'Claude Code'
    : clientId === 'claude-desktop' ? 'Claude Desktop' : clientId === 'grok-build' ? 'Grok Build'
      : clientId === 'pi' ? 'Pi' : clientId === 'hermes' ? 'Hermes' : 'Codex'
  const versioned = clientId === 'pi' || clientId === 'hermes' || clientId === 'grok-build'
  const protocol = clientId === 'pi' || clientId === 'hermes' || clientId === 'grok-build'
    ? 'OpenAI Chat Completions' : clientId === 'claude-code' || clientId === 'claude-desktop'
      ? 'Anthropic Messages' : 'OpenAI Responses'
  const isCodex = clientId === 'codex' || clientId === 'vscode-codex'
  const extraFields: DiagramField[] = clientId === 'pi' ? [{ label: '供应商标识', value: 'gateway' }] : []
  const note = isCodex ? 'API 请求地址填写网关根地址，兼容 OpenAI Responses。'
    : clientId === 'claude-desktop' ? '非 Claude 角色模型需另外启用模型映射和本地路由。'
    : clientId === 'pi' ? '模型还需添加到 Pi 的模型列表。' : undefined
  return {
    title: `${target} 供应商`,
    entry: `CC Switch → ${target} → 添加自定义供应商`,
    fields: [
      { label: '供应商名称', value: 'Gateway' },
      { label: 'API Key', value: 'sk-YOUR_API_KEY' },
      { label: isCodex ? 'API 请求地址' : '请求地址', value: `${baseURL}${versioned ? '/v1' : ''}`, wide: true },
      ...(!isCodex ? [{ label: 'API 格式', value: protocol, wide: true }] : []),
      ...extraFields,
      { label: '模型 ID', value: model, wide: true },
    ],
    finish: clientId === 'claude-desktop' ? '保存并启用，完全退出后重启 Claude Desktop' : '保存并启用供应商',
    note,
  }
}

export function ClientSetupDiagram({ clientId, method, baseURL, model, steps = [], systemName = DEFAULT_SUB2API_SYSTEM_NAME, siteLogoUrl = '' }: {
  clientId: ClientId
  method: 'cc-switch' | 'manual'
  baseURL: string | null
  model: string
  steps?: readonly string[]
  systemName?: string
  siteLogoUrl?: string
}) {
  if (method === 'cc-switch' && (clientId === 'codex' || clientId === 'vscode-codex')) {
    return <CodexCCSwitchDiagrams steps={steps} baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} />
  }

  const content = diagramContent(clientId, method, baseURL, model)
  if (!content) return null

  return <figure className="client-setup-diagram" aria-label={`${clientId} 界面操作示意`}>
    <figcaption><span>界面操作示意</span><strong>{content.title}</strong></figcaption>
    <div className="client-setup-diagram-entry"><span>01</span><CornerDownRight size={17} aria-hidden="true" /><p>{content.entry}</p></div>
    <div className="client-setup-diagram-stage"><span>02</span><p>{method === 'cc-switch' ? '填写供应商参数' : clientId === 'paseo' ? '检查可用提供方' : '填写连接参数'}</p></div>
    <dl className="client-setup-diagram-fields">{content.fields.map(field => <div key={field.label} className={field.wide ? 'client-setup-diagram-field-wide' : undefined}>
      <dt>{field.label}</dt><dd>{field.value}</dd>
    </div>)}</dl>
    <div className="client-setup-diagram-finish"><span>03</span><p>{content.finish}</p><Check size={18} aria-hidden="true" /></div>
    {content.note && <p className="client-setup-diagram-note">{content.note}</p>}
  </figure>
}
