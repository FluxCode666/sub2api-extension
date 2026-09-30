import {
  Activity,
  ArrowLeft,
  Ban,
  Bell,
  BookOpen,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  Clock3,
  CodeXml,
  Copy,
  CornerDownRight,
  Download,
  ExternalLink,
  Eye,
  Gift,
  GripVertical,
  History,
  KeyRound,
  Monitor,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Save,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SquarePen,
  Terminal,
  Trash2,
  UserRound,
  WalletCards,
  Wrench,
  X,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { ClientId } from '@/lib/client-guides'
import { DEFAULT_SUB2API_SYSTEM_NAME } from '@/lib/system-name'
import { withAppBasePath } from '@/lib/app-base-path'
import { CCSWITCH_ICON_ANTHROPIC, CCSWITCH_ICON_CLAUDE, CCSWITCH_ICON_GEMINI, CCSWITCH_ICON_DEEPSEEK, CCSWITCH_ICON_GROK, CCSWITCH_ICON_MINIMAX, CCSWITCH_ICON_OPENAI, CCSWITCH_ICON_OPENCLAW, CCSWITCH_ICON_OPENCODE, CCSWITCH_ICON_PI, CCSWITCH_ICON_ZHIPU } from './ccswitch-sketch-icons'

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
const CLAUDE_CODE_STEP_TITLES = [
  '创建 API Key',
  '点击「导入到 CCS」',
  '确认导入',
  '启用导入的配置',
  '打开 Claude Code 并验证',
] as const
const CLAUDE_DESKTOP_STEP_TITLES = [
  '创建 API Key',
  '点击「导入到 CCS」',
  '确认导入',
  '导入 Claude Desktop 并启用',
  '重启 Claude Desktop 并验证',
] as const
const CODEX_STEP_MARKERS = ['①', '②', '③', '④'] as const

type KeyImportClient = 'codex' | 'claude-code' | 'claude-desktop'

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

function CreateAPIKeyDialog({ clientId = 'codex', systemName }: { clientId?: KeyImportClient; systemName: string }) {
  const anthropic = clientId !== 'codex'
  return <div className="sub2api-dialog-backdrop">
    <div className="sub2api-create-dialog">
      <header><strong>创建密钥</strong><X size={18} /></header>
      <div className="sub2api-dialog-fields">
        <label>名称<span>{systemName}</span></label>
        <div className="sub2api-vendor-label">厂商</div>
        <div className="sub2api-vendor-options">
          <span className={anthropic ? 'is-selected' : undefined}><i className="sub2api-vendor-symbol sub2api-vendor-symbol-anthropic">✳</i>Anthropic{anthropic && <b>✓</b>}</span>
          <span className={anthropic ? undefined : 'is-selected'}><i className="sub2api-vendor-symbol sub2api-vendor-symbol-openai">◎</i>OpenAI{!anthropic && <b>✓</b>}</span>
          <span><i className="sub2api-vendor-symbol sub2api-vendor-symbol-cn">K</i>国产模型</span>
          <span><i className="sub2api-vendor-symbol sub2api-vendor-symbol-other">✦</i>其他</span>
        </div>
        <small className="sub2api-vendor-hint">选择 {anthropic ? 'Anthropic / Claude' : 'OpenAI / GPT'} 的可用分组</small>
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

function Sub2APIKeyManagement({ highlight, showCreateDialog = false, baseURL, systemName, siteLogoUrl, clientId }: { highlight: 'create' | 'import'; showCreateDialog?: boolean; baseURL: string | null; systemName: string; siteLogoUrl: string; clientId: KeyImportClient }) {
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
    {showCreateDialog && <CreateAPIKeyDialog clientId={clientId} systemName={systemName} />}
  </div>
}

type CCSwitchApp = 'claude-code' | 'claude-desktop' | 'codex' | 'gemini' | 'grok-build' | 'opencode' | 'openclaw' | 'hermes' | 'pi' | 'minimax'
type CCSwitchPanel = 'claude-code' | 'claude-desktop' | 'codex' | 'pi'

// 与 CC Switch 官网产品预览的应用切换顺序一致。
const CCSWITCH_APPS: readonly [CCSwitchApp, string][] = [
  ['claude-code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['codex', 'Codex'],
  ['gemini', 'Gemini'],
  ['grok-build', 'Grok Build'],
  ['opencode', 'OpenCode'],
  ['openclaw', 'OpenClaw'],
  ['hermes', 'Hermes'],
  ['pi', 'Pi'],
  ['minimax', 'MiniMax Code'],
]

const CCSWITCH_APP_ICONS: Record<CCSwitchApp, string> = {
  'claude-code': CCSWITCH_ICON_CLAUDE,
  'claude-desktop': CCSWITCH_ICON_CLAUDE,
  codex: CCSWITCH_ICON_OPENAI,
  gemini: CCSWITCH_ICON_GEMINI,
  'grok-build': CCSWITCH_ICON_GROK,
  opencode: CCSWITCH_ICON_OPENCODE,
  openclaw: CCSWITCH_ICON_OPENCLAW,
  hermes: '/client-icons/hermes.svg',
  pi: CCSWITCH_ICON_PI,
  minimax: CCSWITCH_ICON_MINIMAX,
}

function CCSwitchAppIcon({ app }: { app: CCSwitchApp }) {
  const src = CCSWITCH_APP_ICONS[app]
  const Badge = app === 'claude-code' ? Terminal : app === 'claude-desktop' ? Monitor : null
  return <>
    <img src={src.startsWith('data:') ? src : withAppBasePath(src)} alt="" aria-hidden="true" />
    {Badge && <b className="ccswitch-app-badge"><Badge size={8} strokeWidth={2.5} /></b>}
  </>
}

interface CCSwitchProviderProps {
  name: string
  url: string
  icon?: string
  updated?: string
  usage?: ReactNode
  state: 'active' | 'inactive' | 'new'
  callout?: string
  /** Pi 等累加模式应用可同时写入多个供应商，未加入配置的卡片显示绿色「启用」。 */
  additive?: boolean
}

function CCSwitchProvider({ name, url, icon, updated, usage, state, callout, additive = false }: CCSwitchProviderProps) {
  const slug = name.toLowerCase().replace(/\s+/g, '-')
  return <li className={`ccswitch-provider-card ccswitch-provider-${state}`}>
    <GripVertical className="ccswitch-provider-drag" size={14} aria-hidden="true" />
    <span className={`ccswitch-provider-logo ccswitch-provider-logo-${slug}`}>{icon ? <img src={icon} alt="" aria-hidden="true" /> : <b>{name.slice(0, 1).toUpperCase()}</b>}</span>
    <div className="ccswitch-provider-info"><strong>{name}</strong><span>{url}</span></div>
    {(updated || usage) && <div className="ccswitch-provider-meta">
      {updated && <span className="ccswitch-provider-sync"><Clock3 size={10} />{updated}<RefreshCw size={10} /></span>}
      {usage && <span className="ccswitch-provider-usage">{usage}</span>}
    </div>}
    {/* 官网卡片的操作区只在悬停时出现；草图只为需要点击的卡片展示，模拟鼠标停留状态。 */}
    {state === 'new' && <div className="ccswitch-provider-actions">
      <b className={`ccswitch-enable${additive ? ' ccswitch-enable-additive' : ''}`}>{additive ? <Plus size={11} /> : <Play size={10} />}启用{callout && <NumberCallout>{callout}</NumberCallout>}</b>
      <div className="ccswitch-provider-tools">
        <span title="编辑供应商"><SquarePen size={14} /></span>
        <span title="复制供应商"><Copy size={14} /></span>
        <span title="检测连通"><Activity size={14} /></span>
        <span title="配置用量查询"><ChartColumn size={14} /></span>
        <span title="删除供应商"><Trash2 size={14} /></span>
      </div>
    </div>}
  </li>
}

function QuotaUsage({ fiveHour, fiveHourReset, week, weekReset }: { fiveHour: string; fiveHourReset: string; week: string; weekReset: string }) {
  return <>
    <span>5h: <em>{fiveHour}</em><small><Clock3 size={9} />{fiveHourReset}</small></span>
    <span>7d: <em>{week}</em><small><Clock3 size={9} />{weekReset}</small></span>
  </>
}

const OFFICIAL_QUOTA = <QuotaUsage fiveHour="36%" fiveHourReset="2h10m" week="64%" weekReset="3d8h" />

// 草图只展示 CC Switch 内置的官方预设，不出现第三方中转供应商。
function OfficialPresets() {
  return <>
    <CCSwitchProvider name="DeepSeek" url="https://platform.deepseek.com" icon={CCSWITCH_ICON_DEEPSEEK} state="inactive" />
    <CCSwitchProvider name="智谱 GLM" url="https://open.bigmodel.cn" icon={CCSWITCH_ICON_ZHIPU} state="inactive" />
  </>
}

function CCSwitchProviders({ panel, view, systemName, endpoint }: { panel: CCSwitchPanel; view: 'list' | 'confirm' | 'enable'; systemName: string; endpoint: string }) {
  const imported = view === 'enable'
  const newCallout = imported ? CODEX_STEP_MARKERS[3] : undefined
  const importedCard = imported && <CCSwitchProvider name={systemName} url={endpoint} updated="刚刚" state="new" callout={newCallout} additive={panel === 'pi'} />
  if (panel === 'claude-desktop') return <ul className="ccswitch-content">
    <li className="ccswitch-import-hint"><Check size={12} />将 Claude Code 中已有的供应商导入</li>
    {importedCard}
    <CCSwitchProvider name="Claude Desktop Official" url="Claude 官方登录" icon={CCSWITCH_ICON_CLAUDE} state="active" />
    <OfficialPresets />
  </ul>
  if (panel === 'codex') return <ul className="ccswitch-content">
    {importedCard}
    <CCSwitchProvider name="OpenAI Official" url="https://chatgpt.com/codex" icon={CCSWITCH_ICON_OPENAI} updated="1 分钟前" usage={OFFICIAL_QUOTA} state="active" />
    <OfficialPresets />
  </ul>
  if (panel === 'pi') return <ul className="ccswitch-content">
    {importedCard}
    <CCSwitchProvider name="OpenAI" url="https://platform.openai.com" icon={CCSWITCH_ICON_OPENAI} state="active" />
    <CCSwitchProvider name="Anthropic" url="https://console.anthropic.com" icon={CCSWITCH_ICON_ANTHROPIC} state="inactive" />
    <OfficialPresets />
  </ul>
  return <ul className="ccswitch-content">
    {importedCard}
    <CCSwitchProvider name="Claude Official" url="https://www.anthropic.com/claude-code" icon={CCSWITCH_ICON_ANTHROPIC} updated="1 分钟前" usage={OFFICIAL_QUOTA} state="active" />
    <OfficialPresets />
  </ul>
}

/** 参照 ccswitch.io 产品预览重绘的主窗口：标题、本地路由开关、应用切换、工具组与供应商列表。 */
function CCSwitchFrame({ panel, addCallout, children }: { panel: CCSwitchPanel; addCallout?: string; children: ReactNode }) {
  return <div className="codex-product-window ccswitch-window" aria-hidden="true">
    <div className="ccswitch-window-controls"><i /><i /><i /></div>
    <div className="ccswitch-main">
      <header className="ccswitch-topbar">
        <div className="ccswitch-brand">
          <strong>CC Switch</strong>
          <span className="ccswitch-icon-button" title="设置"><Settings size={15} /></span>
          <span className="ccswitch-route" title="路由"><Radio size={14} /><i /></span>
        </div>
        <div className="ccswitch-appbar">
          <div className="ccswitch-app-tabs" aria-label="客户端">
            {CCSWITCH_APPS.map(([app, label]) => <span className={app === panel ? 'is-current' : undefined} title={label} key={app} aria-label={label}>
              <i className={`ccswitch-app-icon ccswitch-app-icon-${app}`}><CCSwitchAppIcon app={app} /></i>
            </span>)}
          </div>
          <div className="ccswitch-toolbar">
            <div className="ccswitch-tool-group">
              <span title="Skills 管理"><Wrench size={15} /></span>
              <span title="提示词管理"><BookOpen size={15} /></span>
              <span title="会话管理"><History size={15} /></span>
              <span title="MCP 管理"><Server size={15} /></span>
            </div>
            <b className="ccswitch-add" title="添加供应商"><Plus size={17} />{addCallout && <NumberCallout>{addCallout}</NumberCallout>}</b>
          </div>
        </div>
      </header>
      {children}
    </div>
  </div>
}

function CCSwitchWindow({ view, baseURL, systemName, clientId = 'codex' }: { view: 'confirm' | 'enable'; baseURL: string | null; systemName: string; clientId?: KeyImportClient }) {
  const endpoint = baseURL ?? 'https://你的 Sub2API 域名'
  // CC Switch 深度链接只能导入 Claude 面板，Claude Desktop 需在自己的面板中再导入已有供应商。
  const panel = clientId === 'claude-desktop' && view === 'confirm' ? 'claude-code' : clientId
  const clientName = panel === 'claude-code' ? 'Claude Code' : 'Codex'
  return <CCSwitchFrame panel={panel}>
    <CCSwitchProviders panel={panel} view={view} systemName={systemName} endpoint={endpoint} />
    {view === 'confirm' && <div className="ccswitch-dialog-backdrop"><div className="ccswitch-confirm-dialog">
      <header><strong>导入供应商配置</strong><X size={16} /></header>
      <div className="ccswitch-confirm-content"><span className="ccswitch-confirm-mark"><Download size={15} /></span><div><strong>确认导入到 CC Switch？</strong><p>该 API Key 将作为 {clientName} 的供应商配置保存。</p></div></div>
      <dl><div><dt>客户端</dt><dd>{clientName}</dd></div><div><dt>供应商名称</dt><dd>{systemName}</dd></div><div><dt>API 地址</dt><dd>{endpoint}</dd></div><div><dt>API Key</dt><dd>sk-••••••••••••</dd></div></dl>
      <footer><span>取消</span><b>确认导入 <NumberCallout>{CODEX_STEP_MARKERS[2]}</NumberCallout></b></footer>
    </div></div>}
  </CCSwitchFrame>
}

// 与 CC Switch Pi 表单的接口格式选项一致；Bedrock 不经过本平台网关，仅保留选项以对齐界面。
const PI_API_FORMATS = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions', baseSuffix: '/v1' },
  { value: 'openai-responses', label: 'OpenAI Responses', baseSuffix: '/v1' },
  { value: 'anthropic-messages', label: 'Anthropic Messages', baseSuffix: '' },
  { value: 'google-generative-ai', label: 'Google Generative AI', baseSuffix: '' },
  { value: 'bedrock-converse-stream', label: 'Amazon Bedrock', baseSuffix: null },
] as const

type PiAPIFormat = typeof PI_API_FORMATS[number]['value']

/** Pi 供应商编辑页草图，版式参照 CC Switch「编辑供应商」全屏表单；接口格式可切换查看，仅影响草图展示。 */
function PiProviderForm({ section, baseURL, model, systemName }: { section: 'provider' | 'models'; baseURL: string | null; model: string; systemName: string }) {
  const [apiFormat, setAPIFormat] = useState<PiAPIFormat>('openai-completions')
  const format = PI_API_FORMATS.find(option => option.value === apiFormat) ?? PI_API_FORMATS[0]
  const gateway = baseURL ?? 'https://你的 Sub2API 域名'
  const endpoint = format.baseSuffix === null ? '平台网关不提供此格式' : `${gateway}${format.baseSuffix}`
  const interactive = section === 'provider'
  return <div className="codex-product-window ccswitch-window ccswitch-form-window" aria-hidden={interactive ? undefined : true}>
    <div className="ccswitch-window-controls" aria-hidden="true"><i /><i /><i /></div>
    <div className="ccswitch-form">
      <header className="ccswitch-form-header" aria-hidden="true"><span className="ccswitch-icon-button ccswitch-back"><ArrowLeft size={16} /></span><strong>添加供应商</strong></header>
      <div className="ccswitch-form-body">
        {interactive ? <>
          <div className="ccswitch-form-row" aria-hidden="true">
            <label>供应商名称<span>{systemName}</span></label>
            <label>备注<span className="is-placeholder">例如：公司专用账号</span></label>
          </div>
          <label aria-hidden="true">供应商标识<span>gateway</span><small>写入 Pi 配置的唯一标识，已存在时请换一个</small></label>
          <label aria-hidden="true">官网链接<span className="is-placeholder">https://example.com（可选）</span></label>
          <div className="ccswitch-form-field ccswitch-field-marked">
            <span className="ccswitch-form-label" aria-hidden="true">接口格式</span>
            <Select value={apiFormat} onValueChange={value => setAPIFormat(value as PiAPIFormat)}>
              <SelectTrigger className="ccswitch-select" aria-label="示意：Pi 接口格式（仅切换草图展示）"><SelectValue /></SelectTrigger>
              <SelectContent className="ccswitch-select-content">
                {PI_API_FORMATS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <small aria-hidden="true">选择 AI 服务的 API 接口格式</small>
            <span aria-hidden="true"><NumberCallout>{CODEX_STEP_MARKERS[1]}</NumberCallout></span>
          </div>
          <label aria-hidden="true">API Key<span className="ccswitch-secret">••••••••••••••••••••••••••••<Eye size={14} /></span></label>
          <label aria-hidden="true">Base URL<span className={format.baseSuffix === null ? 'is-placeholder' : undefined}>{endpoint}</span><small>自定义 API 端点地址</small></label>
        </> : <div className="ccswitch-model-config">
          <div className="ccswitch-model-head"><strong>模型配置</strong><span className="ccswitch-outline-button"><Download size={13} />获取模型列表</span><span className="ccswitch-outline-button">
            <Plus size={13} />添加模型<NumberCallout>{CODEX_STEP_MARKERS[2]}</NumberCallout></span></div>
          <div className="ccswitch-model-grid">
            <span />
            <small>模型 ID <i>*</i></small>
            <small>显示名称 <i>*</i></small>
            <span />
            <ChevronRight size={14} />
            <span className="ccswitch-model-input">{model || 'your-model-id'}<ChevronDown size={13} /></span>
            <span className="ccswitch-model-input">{model || 'your-model-id'}</span>
            <Trash2 size={14} />
          </div>
          <small>配置可用的模型及其显示名称</small>
        </div>}
      </div>
      <footer className="ccswitch-form-footer"><b><Save size={14} />保存</b></footer>
    </div>
  </div>
}

const PI_STEP_TITLES = [
  '打开 Pi 面板并添加供应商',
  '填写供应商信息',
  '添加模型并保存',
  '启用供应商',
  '重新打开 Pi 并验证',
] as const

function PiCCSwitchDiagrams({ steps, baseURL, model, systemName }: { steps: readonly string[]; baseURL: string | null; model: string; systemName: string }) {
  const endpoint = `${baseURL ?? 'https://你的 Sub2API 域名'}/v1`
  const sketches = [
    <CCSwitchFrame panel="pi" addCallout={CODEX_STEP_MARKERS[0]} key="add"><CCSwitchProviders panel="pi" view="list" systemName={systemName} endpoint={endpoint} /></CCSwitchFrame>,
    <PiProviderForm section="provider" baseURL={baseURL} model={model} systemName={systemName} key="provider" />,
    <PiProviderForm section="models" baseURL={baseURL} model={model} systemName={systemName} key="models" />,
    <CCSwitchFrame panel="pi" key="enable"><CCSwitchProviders panel="pi" view="enable" systemName={systemName} endpoint={endpoint} /></CCSwitchFrame>,
  ]
  return <div className="codex-setup-diagrams" aria-label="Pi CC Switch 配置操作示意">
    {PI_STEP_TITLES.map((title, index) => index === 4
      ? <section id="pi-step-5" className="codex-setup-step codex-setup-text-step" key={title} aria-labelledby="pi-step-final-title">
        <h3 id="pi-step-final-title">{title}</h3>
        <p>{steps[index] ?? title}</p>
      </section>
      : <figure id={`pi-step-${index + 1}`} className="codex-setup-step" key={title} aria-label={`Pi 操作示意：${title}`}>
        <figcaption><h3>{title}</h3></figcaption>
        <p>{steps[index] ?? title}</p>
        {sketches[index]}
      </figure>)}
    <p className="codex-setup-diagram-note">界面均为参照 CC Switch 官网产品预览绘制的 HTML/CSS 草图，不是客户端截图；不同版本的按钮位置和文案可能略有差异。</p>
  </div>
}

function CodexSketch({ step, baseURL, systemName, siteLogoUrl, clientId }: { step: number; baseURL: string | null; systemName: string; siteLogoUrl: string; clientId: KeyImportClient }) {
  if (step === 0) return <Sub2APIKeyManagement highlight="create" showCreateDialog baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} clientId={clientId} />
  if (step === 1) return <Sub2APIKeyManagement highlight="import" baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} clientId={clientId} />
  if (step === 2) return <CCSwitchWindow view="confirm" baseURL={baseURL} systemName={systemName} clientId={clientId} />
  if (step === 3) return <CCSwitchWindow view="enable" baseURL={baseURL} systemName={systemName} clientId={clientId} />
  return null
}

function CodexCCSwitchDiagrams({ steps, baseURL, systemName, siteLogoUrl, clientId }: { steps: readonly string[]; baseURL: string | null; systemName: string; siteLogoUrl: string; clientId: KeyImportClient }) {
  const titles = clientId === 'claude-code' ? CLAUDE_CODE_STEP_TITLES : clientId === 'claude-desktop' ? CLAUDE_DESKTOP_STEP_TITLES : CODEX_STEP_TITLES
  const prefix = `${clientId}-step`
  const clientName = clientId === 'claude-code' ? 'Claude Code' : clientId === 'claude-desktop' ? 'Claude Desktop' : 'Codex'
  return <div className="codex-setup-diagrams" aria-label={`${clientName} CC Switch 配置操作示意`}>
    {titles.map((title, index) => index === 4
      ? <section id={`${prefix}-5`} className="codex-setup-step codex-setup-text-step" key={title} aria-labelledby={`${prefix}-final-title`}>
        <h3 id={`${prefix}-final-title`}>{title}</h3>
        <p>{steps[index] ?? title}</p>
      </section>
      : <figure id={`${prefix}-${index + 1}`} className="codex-setup-step" key={title} aria-label={`${clientName} 操作示意：${title}`}>
        <figcaption><h3>{title}</h3></figcaption>
        <p>{steps[index] ?? title}</p>
        <CodexSketch step={index} baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} clientId={clientId} />
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
    if (clientId === 'claude-desktop') return {
      title: '配置第三方推理网关',
      entry: 'Developer → Configure Third-Party Inference… → Connection',
      fields: [
        { label: 'Inference provider', value: 'Gateway' },
        { label: 'Credential kind', value: 'Static API key' },
        { label: 'Gateway base URL', value: baseURL, wide: true },
        { label: 'Gateway API key', value: 'sk-YOUR_API_KEY' },
        { label: 'Gateway auth scheme', value: 'Bearer' },
        { label: '模型 ID', value: model, wide: true },
      ],
      finish: '点击 Apply Changes，应用重启后生效',
      note: '找不到 Developer 菜单时，先在 Help → Troubleshooting 中启用开发者模式。',
    }
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
    : clientId === 'grok-build' ? 'Grok Build'
      : clientId === 'hermes' ? 'Hermes' : 'Codex'
  const versioned = clientId === 'hermes' || clientId === 'grok-build'
  const protocol = clientId === 'hermes' || clientId === 'grok-build'
    ? 'OpenAI Chat Completions' : clientId === 'claude-code'
      ? 'Anthropic Messages' : 'OpenAI Responses'
  const isCodex = clientId === 'codex' || clientId === 'vscode-codex'
  const note = isCodex ? 'API 请求地址填写网关根地址，兼容 OpenAI Responses。'
    : undefined
  return {
    title: `${target} 供应商`,
    entry: `CC Switch → ${target} → 添加自定义供应商`,
    fields: [
      { label: '供应商名称', value: 'Gateway' },
      { label: 'API Key', value: 'sk-YOUR_API_KEY' },
      { label: isCodex ? 'API 请求地址' : '请求地址', value: `${baseURL}${versioned ? '/v1' : ''}`, wide: true },
      ...(!isCodex ? [{ label: 'API 格式', value: protocol, wide: true }] : []),
      { label: '模型 ID', value: model, wide: true },
    ],
    finish: '保存并启用供应商',
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
  if (method === 'cc-switch' && clientId === 'pi') {
    return <PiCCSwitchDiagrams steps={steps} baseURL={baseURL} model={model} systemName={systemName} />
  }
  if (method === 'cc-switch' && (clientId === 'codex' || clientId === 'vscode-codex' || clientId === 'claude-code' || clientId === 'claude-desktop')) {
    return <CodexCCSwitchDiagrams steps={steps} baseURL={baseURL} systemName={systemName} siteLogoUrl={siteLogoUrl} clientId={clientId === 'vscode-codex' ? 'codex' : clientId} />
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
