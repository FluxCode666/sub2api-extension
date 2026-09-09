import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import gsap from 'gsap'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Code2,
  ExternalLink,
  FileText,
  Home,
  Menu,
  Monitor,
  Moon,
  ArrowUp,
  ArrowUpRight,
  ShieldCheck,
  Sun,
  Terminal,
  X,
} from 'lucide-react'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import '@fontsource-variable/geist'
import './ApiDocsPage.css'

type EndpointGroup = 'OpenAI 兼容' | '多模态' | 'Anthropic 兼容' | 'Google 原生'
type ExampleLanguage = 'curl' | 'python' | 'go' | 'java'
type DetailPanel = 'request' | 'response' | 'examples'

interface Parameter {
  name: string
  type: string
  required: boolean
  defaultValue: string
  description: string
}

interface Endpoint {
  id: string
  group: EndpointGroup
  method: 'GET' | 'POST'
  path: string
  title: string
  description: string
  auth: string
  request?: string
  response: string
  requestParams: Parameter[]
  responseParams: Parameter[]
}

const endpointGroups: EndpointGroup[] = ['OpenAI 兼容', '多模态', 'Anthropic 兼容', 'Google 原生']

const endpointGroupSlugs: Record<EndpointGroup, string> = {
  'OpenAI 兼容': 'openai',
  '多模态': 'multimodal',
  'Anthropic 兼容': 'anthropic',
  'Google 原生': 'google',
}

function endpointGroupClass(group: EndpointGroup): string {
  return `aux-api-endpoint-group--${endpointGroupSlugs[group]}`
}

const endpoints: Endpoint[] = [
  {
    id: 'models',
    group: 'OpenAI 兼容',
    method: 'GET',
    path: '/v1/models',
    title: '列出可用模型',
    description: '返回当前 API Key 可以使用的模型列表，可用于启动时探测模型能力。',
    auth: '需要 API Key',
    requestParams: [],
    response: `{
  "object": "list",
  "data": [{
    "id": "gpt-4o-mini",
    "object": "model",
    "owned_by": "provider"
  }]
}`,
    responseParams: [
      { name: 'object', type: 'string', required: true, defaultValue: '"list"', description: '响应对象类型，固定为 list。' },
      { name: 'data', type: 'array', required: true, defaultValue: '[]', description: '模型对象数组。' },
      { name: 'data[].id', type: 'string', required: true, defaultValue: '-', description: '可用于其他接口 model 字段的模型标识。' },
      { name: 'data[].object', type: 'string', required: true, defaultValue: '"model"', description: '模型对象类型，固定为 model。' },
      { name: 'data[].owned_by', type: 'string', required: false, defaultValue: '"provider"', description: '模型归属或上游提供方。' },
    ],
  },
  {
    id: 'chat-completions',
    group: 'OpenAI 兼容',
    method: 'POST',
    path: '/v1/chat/completions',
    title: 'Chat Completions',
    description: 'OpenAI 兼容的对话接口，支持普通响应和 `stream: true` 的 SSE 流式响应。',
    auth: '需要 API Key',
    request: `{
  "model": "gpt-4o-mini",
  "messages": [
    { "role": "user", "content": "用一句话介绍这个接口" }
  ],
  "temperature": 0.7,
  "stream": false
}`,
    response: `{
  "id": "chatcmpl-...",
  "object": "chat.completion",
  "choices": [{
    "message": { "role": "assistant", "content": "..." },
    "finish_reason": "stop"
  }]
}`,
    requestParams: [
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: '要调用的模型 ID，来自 /v1/models。' },
      { name: 'messages', type: 'array', required: true, defaultValue: '[]', description: '按时间顺序排列的对话消息。' },
      { name: 'messages[].role', type: 'string', required: true, defaultValue: '-', description: '消息角色，通常为 system、user 或 assistant。' },
      { name: 'messages[].content', type: 'string | array', required: true, defaultValue: '-', description: '文本内容，也可使用多模态内容块。' },
      { name: 'temperature', type: 'number', required: false, defaultValue: '服务端默认', description: '采样随机性，范围通常为 0 到 2。' },
      { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '是否以 SSE 流式返回增量内容。' },
    ],
    responseParams: [
      { name: 'id', type: 'string', required: true, defaultValue: '-', description: '本次生成请求的唯一 ID。' },
      { name: 'object', type: 'string', required: true, defaultValue: '"chat.completion"', description: '响应对象类型。' },
      { name: 'choices', type: 'array', required: true, defaultValue: '[]', description: '候选回复数组。' },
      { name: 'choices[].message', type: 'object', required: true, defaultValue: '-', description: '模型生成的消息对象。' },
      { name: 'choices[].finish_reason', type: 'string | null', required: false, defaultValue: 'null', description: '结束原因，例如 stop、length 或 content_filter。' },
      { name: 'usage', type: 'object', required: false, defaultValue: 'null', description: 'token 用量，服务端可能不返回。' },
    ],
  },
  {
    id: 'responses',
    group: 'OpenAI 兼容',
    method: 'POST',
    path: '/v1/responses',
    title: 'Responses',
    description: '面向新客户端的统一响应接口，适合文本、工具调用和多轮响应工作流。',
    auth: '需要 API Key',
    request: `{
  "model": "gpt-4o-mini",
  "input": "Explain this API in one sentence",
  "max_output_tokens": 128
}`,
    response: `{
  "id": "resp_...",
  "object": "response",
  "status": "completed",
  "output": [{ "type": "message", "role": "assistant" }]
}`,
    requestParams: [
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: '要调用的模型 ID。' },
      { name: 'input', type: 'string | array', required: true, defaultValue: '-', description: '用户输入，可以是文本或结构化输入项数组。' },
      { name: 'max_output_tokens', type: 'integer', required: false, defaultValue: '服务端默认', description: '限制模型最多生成的 token 数。' },
      { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '是否以事件流返回增量事件。' },
      { name: 'tools', type: 'array', required: false, defaultValue: '[]', description: '可供模型选择的工具定义。' },
    ],
    responseParams: [
      { name: 'id', type: 'string', required: true, defaultValue: '-', description: '响应对象唯一 ID。' },
      { name: 'object', type: 'string', required: true, defaultValue: '"response"', description: '响应对象类型。' },
      { name: 'status', type: 'string', required: true, defaultValue: '"completed"', description: '响应状态。' },
      { name: 'output', type: 'array', required: true, defaultValue: '[]', description: '模型输出项，通常包含 message、tool_call 等类型。' },
      { name: 'usage', type: 'object', required: false, defaultValue: 'null', description: 'token 用量信息。' },
    ],
  },
  {
    id: 'embeddings',
    group: 'OpenAI 兼容',
    method: 'POST',
    path: '/v1/embeddings',
    title: '文本向量',
    description: '将一个或多个文本转换为向量，适合语义搜索、RAG 和相似度计算。',
    auth: '需要 API Key',
    request: `{
  "model": "text-embedding-3-small",
  "input": ["API documentation"]
}`,
    response: `{
  "object": "list",
  "data": [{ "object": "embedding", "index": 0, "embedding": [0.01, -0.02] }],
  "model": "text-embedding-3-small"
}`,
    requestParams: [
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: '向量模型 ID。' },
      { name: 'input', type: 'string | array', required: true, defaultValue: '-', description: '待向量化的单段文本或文本数组。' },
      { name: 'encoding_format', type: 'string', required: false, defaultValue: '"float"', description: '向量编码格式，通常为 float 或 base64。' },
      { name: 'dimensions', type: 'integer', required: false, defaultValue: '模型默认', description: '可选输出维度，是否生效取决于模型。' },
    ],
    responseParams: [
      { name: 'object', type: 'string', required: true, defaultValue: '"list"', description: '响应对象类型。' },
      { name: 'data', type: 'array', required: true, defaultValue: '[]', description: '向量结果数组。' },
      { name: 'data[].embedding', type: 'array<number> | string', required: true, defaultValue: '-', description: '向量值，格式由 encoding_format 决定。' },
      { name: 'data[].index', type: 'integer', required: true, defaultValue: '0', description: '对应输入数组中的索引。' },
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: '实际使用的向量模型。' },
      { name: 'usage', type: 'object', required: false, defaultValue: 'null', description: 'token 用量信息。' },
    ],
  },
  {
    id: 'images',
    group: '多模态',
    method: 'POST',
    path: '/v1/images/generations',
    title: '生成图片',
    description: '使用 OpenAI 兼容格式发起图片生成请求。返回 URL 或 base64 数据取决于服务端配置。',
    auth: '需要 API Key',
    request: `{
  "model": "gpt-image-1",
  "prompt": "A clean developer portal",
  "size": "1024x1024",
  "n": 1
}`,
    response: `{
  "created": 1710000000,
  "data": [{ "url": "https://..." }]
}`,
    requestParams: [
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: '图片生成模型 ID。' },
      { name: 'prompt', type: 'string', required: true, defaultValue: '-', description: '用于生成图片的自然语言描述。' },
      { name: 'size', type: 'string', required: false, defaultValue: '"1024x1024"', description: '输出尺寸，可用值由模型决定。' },
      { name: 'n', type: 'integer', required: false, defaultValue: '1', description: '生成图片数量。' },
      { name: 'response_format', type: 'string', required: false, defaultValue: '服务端默认', description: '返回 URL 或 b64_json。' },
    ],
    responseParams: [
      { name: 'created', type: 'integer', required: true, defaultValue: '-', description: 'Unix 时间戳格式的创建时间。' },
      { name: 'data', type: 'array', required: true, defaultValue: '[]', description: '生成结果数组。' },
      { name: 'data[].url', type: 'string', required: false, defaultValue: 'null', description: '图片临时 URL，与 b64_json 二选一。' },
      { name: 'data[].b64_json', type: 'string', required: false, defaultValue: 'null', description: 'Base64 图片数据，与 url 二选一。' },
    ],
  },
  {
    id: 'messages',
    group: 'Anthropic 兼容',
    method: 'POST',
    path: '/v1/messages',
    title: 'Messages',
    description: 'Anthropic Messages 兼容接口。将现有 Anthropic SDK 的 base URL 指向 API 服务即可复用。',
    auth: '需要 API Key',
    request: `{
  "model": "claude-sonnet-4-5",
  "max_tokens": 512,
  "messages": [{ "role": "user", "content": "Hello" }]
}`,
    response: `{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "content": [{ "type": "text", "text": "Hello!" }],
  "stop_reason": "end_turn"
}`,
    requestParams: [
      { name: 'model', type: 'string', required: true, defaultValue: '-', description: 'Claude 模型 ID。' },
      { name: 'max_tokens', type: 'integer', required: true, defaultValue: '-', description: '本次请求允许生成的最大 token 数。' },
      { name: 'messages', type: 'array', required: true, defaultValue: '[]', description: 'Anthropic 消息数组。' },
      { name: 'system', type: 'string | array', required: false, defaultValue: 'null', description: '系统提示词。' },
      { name: 'temperature', type: 'number', required: false, defaultValue: '服务端默认', description: '采样随机性。' },
      { name: 'stream', type: 'boolean', required: false, defaultValue: 'false', description: '是否返回 Anthropic SSE 事件流。' },
    ],
    responseParams: [
      { name: 'id', type: 'string', required: true, defaultValue: '-', description: '消息响应唯一 ID。' },
      { name: 'type', type: 'string', required: true, defaultValue: '"message"', description: '响应类型。' },
      { name: 'role', type: 'string', required: true, defaultValue: '"assistant"', description: '响应角色。' },
      { name: 'content', type: 'array', required: true, defaultValue: '[]', description: '模型生成的内容块数组。' },
      { name: 'stop_reason', type: 'string | null', required: false, defaultValue: 'null', description: '生成结束原因。' },
      { name: 'usage', type: 'object', required: false, defaultValue: 'null', description: '输入与输出 token 用量。' },
    ],
  },
  {
    id: 'gemini-generate-content',
    group: 'Google 原生',
    method: 'POST',
    path: '/v1beta/models/{model}:generateContent',
    title: 'Gemini Generate Content',
    description: '保留 Gemini 原生请求格式。流式请求将动作名替换为 `streamGenerateContent`，并追加 `?alt=sse`。',
    auth: 'x-goog-api-key',
    request: `{
  "contents": [{
    "role": "user",
    "parts": [{ "text": "Hello from the API" }]
  }]
}`,
    response: `{
  "candidates": [{
    "content": { "role": "model", "parts": [{ "text": "Hello!" }] },
    "finishReason": "STOP"
  }]
}`,
    requestParams: [
      { name: 'model', type: 'path string', required: true, defaultValue: '-', description: 'Gemini 模型名称，替换路径中的 {model}。' },
      { name: 'contents', type: 'array', required: true, defaultValue: '[]', description: 'Gemini 原生内容数组，包含 role 和 parts。' },
      { name: 'contents[].parts', type: 'array', required: true, defaultValue: '[]', description: '文本、图片或其他多模态内容块。' },
      { name: 'generationConfig', type: 'object', required: false, defaultValue: '{}', description: '温度、最大输出 token 等生成参数。' },
      { name: 'safetySettings', type: 'array', required: false, defaultValue: '[]', description: '安全阈值配置。' },
    ],
    responseParams: [
      { name: 'candidates', type: 'array', required: true, defaultValue: '[]', description: '模型候选回复数组。' },
      { name: 'candidates[].content', type: 'object', required: true, defaultValue: '-', description: '包含 model 角色和 parts 的内容对象。' },
      { name: 'candidates[].finishReason', type: 'string', required: false, defaultValue: 'null', description: '生成结束原因，例如 STOP。' },
      { name: 'usageMetadata', type: 'object', required: false, defaultValue: 'null', description: '提示词和候选内容的 token 统计。' },
    ],
  },
]

const DEFAULT_EXAMPLE_MODEL = 'gpt-6-astra'
type ThemePreference = 'system' | 'light' | 'dark'
const THEME_STORAGE_KEY = 'aux-client-docs-theme'
const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

const quickstartCurl = `curl "$API_BASE/v1/chat/completions" \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "$EXAMPLE_MODEL",
    "messages": [{"role":"user","content":"Hello"}]
  }'`

function currentPageOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function configuredDocumentName(config?: { systemName?: string; siteName?: string; heroTitle?: string }): string {
  return config?.systemName?.trim() || config?.siteName?.trim() || config?.heroTitle?.trim() || ''
}

function configuredDomain(value?: string): string {
  return value?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '') || ''
}

function siteHrefProps(href: string): { href: string; target?: string; rel?: string } {
  return /^https?:\/\//i.test(href)
    ? { href, target: '_blank', rel: 'noreferrer' }
    : { href }
}

function initialBaseURL(search: string): string {
  const value = new URLSearchParams(search).get('api_base')
  return value?.trim().replace(/\/$/, '') || currentPageOrigin()
}

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
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const media = window.matchMedia(SYSTEM_DARK_QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export default function ApiDocsPage() {
  const pageRef = useRef<HTMLDivElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const pageOrigin = currentPageOrigin()
  const embedded = searchParams.get('embed') === '1' || searchParams.get('ui_mode') === 'embedded'
  const [savedTheme, setSavedTheme] = useState(readSavedTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false)
  const themePreference = parseThemePreference(searchParams.get('theme')) ?? savedTheme
  const theme = themePreference === 'system' ? (systemDark ? 'dark' : 'light') : themePreference
  const ThemeIcon = themePreference === 'system' ? Monitor : themePreference === 'dark' ? Moon : Sun
  const [baseURL, setBaseURL] = useState(() => initialBaseURL(searchParams.toString()))
  const [exampleModel, setExampleModel] = useState(DEFAULT_EXAMPLE_MODEL)
  const [systemName, setSystemName] = useState('')
  const [siteLogoUrl, setSiteLogoUrl] = useState('')
  const [systemDomain, setSystemDomain] = useState('')
  const [documentationUrl, setDocumentationUrl] = useState('')
  const [termsUrl, setTermsUrl] = useState('')
  const [privacyUrl, setPrivacyUrl] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [expandedEndpoints, setExpandedEndpoints] = useState<Set<string>>(() => new Set(['chat-completions']))
  const [activeSection, setActiveSection] = useState('quickstart')
  const [sidebarPinned, setSidebarPinned] = useState(false)

  useLayoutEffect(() => {
    const context = gsap.context(() => {
      gsap.from('.aux-api-hero-copy', { opacity: 0, x: -28, duration: 0.75, ease: 'power3.out' })
      gsap.from('.aux-api-hero-panel', { opacity: 0, x: 28, duration: 0.75, delay: 0.08, ease: 'power3.out' })
      gsap.fromTo('.aux-api-hero-lede span', { opacity: 0.25, y: 8 }, {
        opacity: 1,
        y: 0,
        stagger: 0.08,
        duration: 0.36,
        ease: 'none',
      })
    }, pageRef)
    return () => context.revert()
  }, [])

  useEffect(() => {
    let active = true
    void apiClient.get<AuxEnvelope<{ model?: string; systemName?: string; siteName?: string; heroTitle?: string; siteLogoUrl?: string; systemDomain?: string; documentationUrl?: string; termsUrl?: string; privacyUrl?: string }>>('/homepage/config').then((envelope) => {
      const model = envelope.data?.model?.trim()
      const name = configuredDocumentName(envelope.data)
      if (active && envelope.code === 0) {
        if (model) setExampleModel(model)
        if (name) setSystemName(name)
        if (envelope.data?.siteLogoUrl?.trim()) setSiteLogoUrl(envelope.data.siteLogoUrl.trim())
        if (envelope.data?.systemDomain?.trim()) setSystemDomain(configuredDomain(envelope.data.systemDomain))
        if (envelope.data?.documentationUrl?.trim()) setDocumentationUrl(envelope.data.documentationUrl.trim())
        if (envelope.data?.termsUrl?.trim()) setTermsUrl(envelope.data.termsUrl.trim())
        if (envelope.data?.privacyUrl?.trim()) setPrivacyUrl(envelope.data.privacyUrl.trim())
      }
    }).catch(() => {
      // API 文档必须可离线打开；未读取到配置时继续使用内置默认模型。
    })
    return () => { active = false }
  }, [])

  const documentName = systemName ? `${systemName} API 文档` : 'API 文档'
  const clientDocsParams = new URLSearchParams({ api_base: baseURL })
  for (const key of ['embed', 'ui_mode', 'theme']) {
    const value = searchParams.get(key)
    if (value) clientDocsParams.set(key, value)
  }

  function selectTheme(value: string) {
    const preference = parseThemePreference(value)
    if (!preference) return
    setSavedTheme(preference)
    try { window.localStorage.setItem(THEME_STORAGE_KEY, preference) } catch { /* 当前页面仍可切换主题。 */ }
    setSearchParams(current => {
      const next = new URLSearchParams(current)
      next.set('theme', preference)
      return next
    }, { replace: true })
  }

  useEffect(() => {
    const ids = ['quickstart', 'authentication', ...endpoints.map((endpoint) => `endpoint-${endpoint.id}`), 'errors']
    const sections = ids.map((id) => document.getElementById(id)).filter((section): section is HTMLElement => Boolean(section))
    let observer: IntersectionObserver | undefined
    if (sections.length > 0 && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible[0]?.target instanceof HTMLElement) setActiveSection(visible[0].target.id)
      }, { rootMargin: '-16% 0px -66% 0px', threshold: [0.05, 0.2, 0.5] })
      sections.forEach((section) => observer?.observe(section))
    }

    const layout = pageRef.current?.querySelector<HTMLElement>('.aux-api-doc-layout')
    const updateSidebarVisibility = () => {
      if (!layout) return
      const bounds = layout.getBoundingClientRect()
      setSidebarPinned(bounds.top <= 112 && bounds.bottom > 112)
    }
    updateSidebarVisibility()
    window.addEventListener('scroll', updateSidebarVisibility, { passive: true })
    window.addEventListener('resize', updateSidebarVisibility)
    return () => {
      observer?.disconnect()
      window.removeEventListener('scroll', updateSidebarVisibility)
      window.removeEventListener('resize', updateSidebarVisibility)
    }
  }, [])

  function toggleEndpoint(endpointId: string) {
    setExpandedEndpoints((current) => {
      const next = new Set(current)
      if (next.has(endpointId)) next.delete(endpointId)
      else next.add(endpointId)
      return next
    })
  }

  async function copyText(id: string, value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(id)
      window.setTimeout(() => setCopied((current) => current === id ? null : current), 1600)
    } catch {
      setCopied(null)
    }
  }

  return (
    <div ref={pageRef} data-theme={theme} className={`aux-api-docs${embedded ? ' aux-api-docs--embedded' : ''}`}>
      <header className="aux-api-docs-header">
        <div className="aux-api-header-inner">
          <a className="aux-api-brand" href="#top" aria-label={`${documentName}首页`}>
            <span className="aux-api-brand-mark"><Code2 aria-hidden="true" /></span>
            <span><strong>{systemName || 'API 文档'}</strong><small>配置你的模型接口</small></span>
          </a>
          <div className="aux-api-header-tools">
            <nav className={`aux-api-header-nav${menuOpen ? ' is-open' : ''}`} aria-label="文档导航">
              <Link className="aux-api-header-home" to="/sub2api-home"><Home aria-hidden="true" /><span>官网</span></Link>
              <Link to={`/client-docs?${clientDocsParams}`}>客户端接入 <ArrowUpRight aria-hidden="true" /></Link>
              <a href="#quickstart" onClick={() => setMenuOpen(false)}>快速开始</a>
              <a href="#errors" onClick={() => setMenuOpen(false)}>错误处理</a>
            </nav>
            <div className="aux-api-theme-picker">
              <ThemeIcon size={15} aria-hidden="true" />
              <select aria-label="外观主题" value={themePreference} onChange={event => selectTheme(event.target.value)}>
                <option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option>
              </select>
              <ChevronDown size={12} className="aux-api-theme-chevron" aria-hidden="true" />
            </div>
            <button className="aux-api-menu-button" type="button" aria-label={menuOpen ? '关闭导航' : '打开导航'} onClick={() => setMenuOpen((open) => !open)}>
              {menuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="aux-api-hero">
          <div className="aux-api-hero-copy">
            <p className="aux-api-eyebrow"><span className="aux-api-status-dot" /> {systemName ? `${systemName} API reference` : 'API reference'}</p>
            <h1>
              <span className="aux-api-title-line">把模型能力，</span>
              <span className="aux-api-title-line aux-api-title-line--accent"><em>接入你的产品。</em></span>
            </h1>
            <p className="aux-api-hero-lede"><span>一套兼容 OpenAI 与 Anthropic SDK 的统一接口。</span><span>使用 API Key 接入模型、流式响应、向量和图片能力，</span><span>无需改动现有业务代码。</span></p>
            <div className="aux-api-hero-actions">
              <a className="aux-api-primary-button" href="#quickstart">开始接入 <ChevronRight aria-hidden="true" /></a>
              <a className="aux-api-secondary-button" href="#endpoint-chat-completions">查看端点</a>
            </div>
          </div>
          <div className="aux-api-hero-visual">
            <div className="aux-api-hero-panel" aria-label="API 地址预览">
              <div className="aux-api-panel-top"><small>request preview</small></div>
              <div className="aux-api-panel-body"><p><i>POST</i> <code>/v1/chat/completions</code></p><p className="aux-api-code-muted">Authorization: Bearer <b>$API_KEY</b></p><p className="aux-api-code-muted">Content-Type: application/json</p><p className="aux-api-code-gap">&#123; <span>"model"</span>: <strong>"{exampleModel}"</strong> &#125;</p><p className="aux-api-response"><span>200</span> response ready <b>●</b></p></div>
            </div>
          </div>
        </section>

        <section className="aux-api-interest" aria-label="接口能力概览">
          <div className="aux-api-section-heading aux-api-interest-heading">
            <div><p className="aux-api-kicker">接口索引</p><h2>常用能力，按需组合。</h2><p>先选一类能力，再进入对应端点；每个端点都附带完整参数契约与可复制示例。</p></div>
            <a className="aux-api-index-link" href="#endpoint-list">浏览全部端点 <ChevronRight aria-hidden="true" /></a>
          </div>
          <div className="aux-api-capability-index">
            <a href="#endpoint-models"><span className="aux-api-capability-method">GET</span><span><strong>发现模型</strong><small>先读取当前密钥可用的模型列表</small></span><code>/v1/models</code><ChevronRight aria-hidden="true" /></a>
            <a href="#endpoint-chat-completions"><span className="aux-api-capability-method">POST</span><span><strong>生成对话</strong><small>OpenAI 兼容消息、流式响应与多轮上下文</small></span><code>/v1/chat/completions</code><ChevronRight aria-hidden="true" /></a>
            <a href="#endpoint-responses"><span className="aux-api-capability-method">POST</span><span><strong>统一响应</strong><small>面向工具调用和新客户端的响应工作流</small></span><code>/v1/responses</code><ChevronRight aria-hidden="true" /></a>
            <a href="#endpoint-embeddings"><span className="aux-api-capability-method">POST</span><span><strong>语义检索</strong><small>将文本转换为向量，用于搜索与 RAG</small></span><code>/v1/embeddings</code><ChevronRight aria-hidden="true" /></a>
          </div>
        </section>

        <div className="aux-api-doc-layout">
          <aside className={`aux-api-sidebar${sidebarPinned ? ' is-pinned' : ''}`} aria-label="文档与接口端点目录">
            <div className="aux-api-sidebar-label">ON THIS PAGE</div>
            <a className={activeSection === 'quickstart' ? 'is-active' : ''} href="#quickstart">快速开始</a>
            <a className={activeSection === 'authentication' ? 'is-active' : ''} href="#authentication">认证方式</a>
            <div className="aux-api-sidebar-section-label">接口端点</div>
            {endpointGroups.map((group) => {
              const groupEndpoints = endpoints.filter((endpoint) => endpoint.group === group)
              return (
                <div className={`aux-api-sidebar-group ${endpointGroupClass(group)}`} key={group}>
                  <span className="aux-api-sidebar-group-label">{group}</span>
                  {groupEndpoints.map((endpoint) => (
                    <a
                      className={`aux-api-sidebar-endpoint${activeSection === `endpoint-${endpoint.id}` ? ' is-active' : ''}`}
                      href={`#endpoint-${endpoint.id}`}
                      key={endpoint.id}
                      aria-label={`${endpoint.method} ${endpoint.path}`}
                    >
                      <span className={`aux-api-sidebar-method aux-api-sidebar-method--${endpoint.method.toLowerCase()}`}>{endpoint.method}</span>
                      <code title={endpoint.path}>{endpoint.path}</code>
                    </a>
                  ))}
                </div>
              )
            })}
            <a className={activeSection === 'errors' ? 'is-active' : ''} href="#errors">错误处理</a>
          </aside>

          <div className="aux-api-content">
            <section className="aux-api-section" id="quickstart">
              <div className="aux-api-section-heading"><div><h2>五分钟完成第一次请求</h2><p>只需要一个 API Key 和 API 基础地址。下面的示例可以直接复制到终端运行。</p></div></div>
              <div className="aux-api-base-url">
                <label htmlFor="api-base-url">API 基础地址</label>
                <div><input id="api-base-url" value={baseURL} placeholder={pageOrigin} onChange={(event) => setBaseURL(event.target.value.replace(/\s/g, '').replace(/\/$/, ''))} aria-label="API 基础地址" /></div>
                <small>示例请求会使用此地址；跨域部署时请改成实际 API 网关地址。</small>
              </div>
              <CodeBlock id="quickstart-curl" code={quickstartCurl.replace('$API_BASE', baseURL || '$API_BASE').replace('$EXAMPLE_MODEL', exampleModel)} copied={copied} onCopy={copyText} />
            </section>

            <section className="aux-api-section aux-api-auth-section" id="authentication">
              <div className="aux-api-section-heading"><div><h2>用 API Key 保护每一次请求</h2><p>在管理控制台创建 API Key，并通过标准 HTTP Header 传递。不要把 Key 写入浏览器端代码或公开仓库。</p></div></div>
              <div className="aux-api-auth-grid"><div><span>Standard</span><code>Authorization: Bearer $API_KEY</code></div><div><span>Compatible headers</span><code>x-api-key: $API_KEY<br />x-goog-api-key: $API_KEY</code></div><div><span>Streaming</span><code>Accept: text/event-stream</code></div></div>
              <p className="aux-api-auth-note"><ShieldCheck aria-hidden="true" />普通 `/v1` 网关不接受 URL 查询参数中的 `key` / `api_key`。Gemini 的 `/v1beta` 路径可使用 `x-goog-api-key`，但生产环境仍建议使用 Header。</p>
            </section>

            <section className="aux-api-section aux-api-endpoints-section" id="endpoint-list">
              <div className="aux-api-endpoint-list">
                {endpointGroups.map((group) => {
                  const groupEndpoints = endpoints.filter((endpoint) => endpoint.group === group)
                  return <section className={`aux-api-endpoint-group ${endpointGroupClass(group)}`} id={`group-${endpointGroupSlugs[group]}`} key={group}><div className="aux-api-group-heading"><h3>{group}</h3><span>{groupEndpoints.length} 个接口</span></div>{groupEndpoints.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} baseURL={baseURL} exampleModel={exampleModel} copied={copied} onCopy={copyText} expanded={expandedEndpoints.has(endpoint.id)} onToggle={() => toggleEndpoint(endpoint.id)} />)}</section>
                })}
              </div>
            </section>

            <section className="aux-api-section aux-api-errors-section" id="errors">
              <div className="aux-api-section-heading"><div><h2>错误处理</h2><p>错误响应遵循统一 JSON 结构。先检查 HTTP 状态码，再根据 `error.type` 和 `error.code` 定位问题。</p></div></div>
              <CodeBlock id="error-response" code={`{
  "error": {
    "message": "Incorrect API key provided",
    "type": "authentication_error",
    "code": "invalid_api_key"
  }
}`} copied={copied} onCopy={copyText} />
              <div className="aux-api-error-codes"><span><b>401</b> API Key 缺失或无效</span><span><b>403</b> 账户或分组无权限</span><span><b>429</b> 限流或余额不足</span><span><b>5xx</b> 上游或网关异常</span></div>
            </section>

          </div>
        </div>
      </main>
      <footer className="aux-api-footer">
        <div className="aux-api-footer-brand">
          <span className={`aux-api-footer-mark${siteLogoUrl ? ' has-image' : ''}`}>
            {siteLogoUrl ? <img src={siteLogoUrl} alt="" /> : <Terminal aria-hidden="true" />}
          </span>
          <span>{systemName ? `${systemName} · API 文档` : 'API 文档'}</span>
        </div>
        <span className="aux-api-footer-status">{endpoints.length} 个接口 · {systemDomain || configuredDomain(baseURL) || '当前页面服务地址'}</span>
        <nav className="aux-api-footer-nav" aria-label="相关文档">
          <Link to={`/client-docs?${clientDocsParams}`}>客户端接入 <ArrowUpRight aria-hidden="true" /></Link>
          <a {...siteHrefProps('/sub2api-home')}><Home aria-hidden="true" />官网首页</a>
          {documentationUrl ? <a {...siteHrefProps(documentationUrl)}><ExternalLink aria-hidden="true" />使用文档</a> : null}
          {termsUrl ? <a {...siteHrefProps(termsUrl)}>服务条款</a> : null}
          {privacyUrl ? <a {...siteHrefProps(privacyUrl)}>隐私协议</a> : null}
          <a href="#top">回到顶部 <ArrowUp aria-hidden="true" /></a>
        </nav>
      </footer>
    </div>
  )
}

const exampleLanguages: Array<{ id: ExampleLanguage; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'python', label: 'Python' },
  { id: 'go', label: 'Go' },
  { id: 'java', label: 'Java' },
]

function buildExampleCode(endpoint: Endpoint, baseURL: string, exampleModel: string, language: ExampleLanguage): string {
  const model = exampleModel.trim() || DEFAULT_EXAMPLE_MODEL
  const url = `${baseURL || '$API_BASE'}${endpoint.path.replace('{model}', model)}`
  const requestBody = endpoint.request?.trim().replace(/("model"\s*:\s*)"[^"]+"/, `$1"${model}"`)
  const isGoogle = endpoint.group === 'Google 原生'
  const headerName = isGoogle ? 'x-goog-api-key' : 'Authorization'

  if (language === 'curl') {
    const slash = String.fromCharCode(92)
    const lines = [`curl "${url}" \\\n  -H "${headerName}: ${isGoogle ? '$API_KEY' : 'Bearer $API_KEY'}"`]
    if (endpoint.method === 'POST') lines[0] += ` ${slash}`
    if (endpoint.method === 'POST') {
      lines.push(`  -H "Content-Type: application/json"${requestBody ? ` ${slash}` : ''}`)
      if (requestBody) lines.push(`  -d '${requestBody.replace(/'/g, "'\\''")}'`)
    }
    return lines.join('\n')
  }

  if (language === 'python') {
    const authLine = isGoogle
      ? '    "x-goog-api-key": os.environ["API_KEY"],'
      : '    "Authorization": f"Bearer {os.environ[\'API_KEY\']}",'
    const lines = [
      'import os',
      'import requests',
      '',
      `url = ${JSON.stringify(url)}`,
      'headers = {',
      authLine,
      ...(endpoint.method === 'POST' ? ['    "Content-Type": "application/json",'] : []),
      '}',
    ]
    if (requestBody) {
      lines.push('', `payload = r'''${requestBody}'''`, 'response = requests.post(url, headers=headers, data=payload)')
    } else {
      lines.push('', 'response = requests.get(url, headers=headers)')
    }
    lines.push('response.raise_for_status()', 'print(response.json())')
    return lines.join('\n')
  }

  if (language === 'go') {
    const imports = ['"fmt"', '"io"', '"net/http"', '"os"']
    if (requestBody) imports.push('"strings"')
    const lines = [
      'package main',
      '',
      'import (',
      ...imports.map((item) => `\t${item}`),
      ')',
      '',
      'func main() {',
      '    var body io.Reader',
      ...(requestBody ? [`    body = strings.NewReader(\`${requestBody}\`)`] : []),
      `    req, err := http.NewRequest(http.Method${endpoint.method === 'GET' ? 'Get' : 'Post'}, ${JSON.stringify(url)}, body)`,
      '    if err != nil { panic(err) }',
      `    req.Header.Set("${headerName}", ${isGoogle ? 'os.Getenv("API_KEY")' : '"Bearer " + os.Getenv("API_KEY")'})`,
      ...(endpoint.method === 'POST' ? ['    req.Header.Set("Content-Type", "application/json")'] : []),
      '    resp, err := http.DefaultClient.Do(req)',
      '    if err != nil { panic(err) }',
      '    defer resp.Body.Close()',
      '    fmt.Println(resp.Status)',
      '    _, _ = io.Copy(os.Stdout, resp.Body)',
      '}',
    ]
    return lines.join('\n')
  }

  const javaAuth = isGoogle
    ? '.header("x-goog-api-key", apiKey)'
    : '.header("Authorization", "Bearer " + apiKey)'
  const javaRequest = requestBody
    ? `.method("POST", HttpRequest.BodyPublishers.ofString("""\n${requestBody}\n"""))`
    : '.GET()'
  return [
    'import java.net.URI;',
    'import java.net.http.HttpClient;',
    'import java.net.http.HttpRequest;',
    'import java.net.http.HttpResponse;',
    '',
    'public class Main {',
    '  public static void main(String[] args) throws Exception {',
    '    String apiKey = System.getenv("API_KEY");',
    '    HttpRequest.Builder builder = HttpRequest.newBuilder()',
    `        .uri(URI.create(${JSON.stringify(url)}))`,
    `        ${javaAuth}`,
    ...(endpoint.method === 'POST' ? ['        .header("Content-Type", "application/json");'] : ['        ;']),
    `    HttpRequest request = builder${javaRequest}.build();`,
    '    HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());',
    '    System.out.println(response.statusCode());',
    '    System.out.println(response.body());',
    '  }',
    '}',
  ].join('\n')
}

function markdownTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ')
}

function markdownParameterTable(parameters: Parameter[]): string {
  if (parameters.length === 0) return '无参数。'
  return [
    '| 参数名称 | 类型 | 是否可选 | 默认值 | 说明 |',
    '| --- | --- | --- | --- | --- |',
    ...parameters.map((parameter) => `| \`${markdownTableCell(parameter.name)}\` | \`${markdownTableCell(parameter.type)}\` | ${parameter.required ? '否' : '是'} | \`${markdownTableCell(parameter.defaultValue)}\` | ${markdownTableCell(parameter.description)} |`),
  ].join('\n')
}

function buildMarkdownDocument(endpoint: Endpoint, baseURL: string, exampleModel: string): string {
  const requestBody = endpoint.request?.trim().replace(/("model"\s*:\s*)"[^"]+"/, `$1"${exampleModel.trim() || DEFAULT_EXAMPLE_MODEL}"`)
  const examples = (['curl', 'python', 'go', 'java'] as const).map((language) => {
    const label = language === 'curl' ? 'cURL' : language === 'python' ? 'Python' : language === 'go' ? 'Go' : 'Java'
    return `### ${label}\n\n\`\`\`${language}\n${buildExampleCode(endpoint, baseURL, exampleModel, language)}\n\`\`\``
  })
  return [
    `# ${endpoint.title}`,
    '',
    `> ${endpoint.group} · \`${endpoint.method}\` \`${endpoint.path}\``,
    '',
    endpoint.description,
    '',
    '## 认证方式',
    '',
    endpoint.auth,
    '',
    '## 请求参数',
    '',
    markdownParameterTable(endpoint.requestParams),
    '',
    requestBody ? '## 请求体示例' : '',
    requestBody ? '' : '',
    requestBody ? `\`\`\`json\n${requestBody}\n\`\`\`` : '',
    requestBody ? '' : '',
    '## 响应参数',
    '',
    markdownParameterTable(endpoint.responseParams),
    '',
    '## 响应示例',
    '',
    `\`\`\`json\n${endpoint.response.trim()}\n\`\`\``,
    '',
    '## 调用示例',
    '',
    ...examples.flatMap((example) => [example, '']),
  ].filter((line, index, lines) => !(line === '' && lines[index - 1] === '' && lines[index + 1] === '')).join('\n').trimEnd() + '\n'
}

const codeTokenPattern = /(#.*$|\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b|--?[A-Za-z][\w-]*|[A-Za-z_$][\w$.-]*|[{}()[\],.;:=])/gm
const codeKeywords: Record<string, Set<string>> = {
  shell: new Set(['curl']),
  curl: new Set(['curl']),
  python: new Set(['import', 'from', 'as', 'def', 'if', 'for', 'in', 'return', 'True', 'False', 'None']),
  go: new Set(['package', 'import', 'func', 'var', 'if', 'range', 'defer', 'return', 'panic']),
  java: new Set(['import', 'public', 'class', 'static', 'void', 'new', 'throws', 'String']),
  json: new Set(['true', 'false', 'null']),
}

function codeTokenClass(token: string, language: string): string | null {
  if (token.startsWith('#') || token.startsWith('//')) return 'comment'
  if (/^["'`]/.test(token)) return 'string'
  if (/^\d/.test(token)) return 'number'
  if (/^--?/.test(token)) return 'flag'
  if (codeKeywords[language]?.has(token)) return 'keyword'
  if (language === 'json' && /^[A-Za-z_$]/.test(token)) return 'property'
  if (/^[{}()[\],.;:=]$/.test(token)) return 'punctuation'
  return null
}

function highlightCode(code: string, language: string): ReactNode {
  const highlighted: ReactNode[] = []
  let lastIndex = 0
  let tokenIndex = 0
  for (const match of code.matchAll(codeTokenPattern)) {
    const token = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) highlighted.push(code.slice(lastIndex, index))
    const tokenClass = codeTokenClass(token, language)
    highlighted.push(tokenClass
      ? <span className={`aux-api-code-token aux-api-code-token--${tokenClass}`} key={`token-${tokenIndex}`}>{token}</span>
      : token)
    tokenIndex += 1
    lastIndex = index + token.length
  }
  if (lastIndex < code.length) highlighted.push(code.slice(lastIndex))
  return highlighted
}

function codeLanguageLabel(language: string): string {
  return language === 'shell' ? 'shell' : language === 'curl' ? 'cURL' : language
}

function CodeBlock({ id, code, language = 'shell', copied, onCopy }: { id: string; code: string; language?: string; copied: string | null; onCopy: (id: string, value: string) => void }) {
  const isCopied = copied === id
  return <div className="aux-api-code-block" data-code-language={language}><div className="aux-api-code-toolbar"><span><Terminal aria-hidden="true" /> {codeLanguageLabel(language)}</span><button type="button" onClick={() => onCopy(id, code)} aria-label={isCopied ? '已复制' : '复制代码'}>{isCopied ? <Check aria-hidden="true" /> : <Clipboard aria-hidden="true" />}<span>{isCopied ? '已复制' : '复制'}</span></button></div><pre><code>{highlightCode(code, language)}</code></pre></div>
}

function ParameterTable({ parameters, emptyLabel }: { parameters: Parameter[]; emptyLabel: string }) {
  if (parameters.length === 0) return <div className="aux-api-parameter-empty"><Check aria-hidden="true" /><span>{emptyLabel}</span></div>
  return <div className="aux-api-parameter-table-wrap"><table className="aux-api-parameter-table"><thead><tr><th scope="col">参数</th><th scope="col">类型</th><th scope="col">要求</th><th scope="col">默认值</th><th scope="col">说明</th></tr></thead><tbody>{parameters.map((parameter) => <tr key={parameter.name}><td data-label="参数"><code>{parameter.name}</code></td><td data-label="类型"><code>{parameter.type}</code></td><td data-label="要求"><span className={`aux-api-param-badge${parameter.required ? ' is-required' : ''}`}>{parameter.required ? '必填' : '可选'}</span></td><td data-label="默认值"><code>{parameter.defaultValue}</code></td><td data-label="说明">{parameter.description}</td></tr>)}</tbody></table></div>
}

function EndpointCard({ endpoint, baseURL, exampleModel, copied, onCopy, expanded, onToggle }: { endpoint: Endpoint; baseURL: string; exampleModel: string; copied: string | null; onCopy: (id: string, value: string) => void; expanded: boolean; onToggle: () => void }) {
  const [panel, setPanel] = useState<DetailPanel>('request')
  const [language, setLanguage] = useState<ExampleLanguage>('curl')
  const requestCode = buildExampleCode(endpoint, baseURL, exampleModel, language)
  const markdownCopyId = `${endpoint.id}-markdown`
  const markdownCopied = copied === markdownCopyId
  const detailId = `endpoint-details-${endpoint.id}`
  const panelTabs: Array<{ id: DetailPanel; label: string; count?: number }> = [
    { id: 'request', label: '请求参数', count: endpoint.requestParams.length },
    { id: 'response', label: '响应参数', count: endpoint.responseParams.length },
    { id: 'examples', label: '调用示例' },
  ]
  return <article id={`endpoint-${endpoint.id}`} className={`aux-api-endpoint-card${expanded ? ' is-expanded' : ''}`}><div className="aux-api-endpoint-summary"><div className="aux-api-endpoint-topline"><div className="aux-api-method-path"><span className={`aux-api-method aux-api-method--${endpoint.method.toLowerCase()}`}>{endpoint.method}</span><code>{endpoint.path}</code></div><span className="aux-api-auth-badge"><ShieldCheck aria-hidden="true" /> {endpoint.auth}</span></div><h4>{endpoint.title}</h4><p>{endpoint.description}</p><div className="aux-api-endpoint-meta"><span>{endpoint.requestParams.length} 个请求参数</span><span>{endpoint.responseParams.length} 个响应参数</span><div className="aux-api-endpoint-actions"><button className="aux-api-markdown-button" type="button" aria-label={markdownCopied ? '已复制 Markdown' : `复制 ${endpoint.title} Markdown 文档`} onClick={() => onCopy(markdownCopyId, buildMarkdownDocument(endpoint, baseURL, exampleModel))}>{markdownCopied ? <Check aria-hidden="true" /> : <FileText aria-hidden="true" />}<span>{markdownCopied ? '已复制 Markdown' : '复制 Markdown'}</span></button><button className="aux-api-expand-button" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={onToggle}>{expanded ? '收起详情' : '查看参数与示例'} <ChevronDown aria-hidden="true" /></button></div></div></div>{expanded && <div className="aux-api-endpoint-details" id={detailId}><div className="aux-api-detail-tabs" role="tablist" aria-label={`${endpoint.title}详情`}>
    {panelTabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={panel === tab.id} className={panel === tab.id ? 'is-active' : ''} onClick={() => setPanel(tab.id)}>{tab.label}{tab.count !== undefined && <span>{tab.count}</span>}</button>)}
  </div>{panel === 'request' && <ParameterTable parameters={endpoint.requestParams} emptyLabel="此接口不接收请求参数。" />}{panel === 'response' && <ParameterTable parameters={endpoint.responseParams} emptyLabel="暂无结构化响应参数说明。" />}{panel === 'examples' && <div className="aux-api-examples-panel"><div className="aux-api-language-tabs" role="tablist" aria-label={`${endpoint.title}示例语言`}>{exampleLanguages.map((item) => <button key={item.id} type="button" role="tab" aria-selected={language === item.id} className={language === item.id ? 'is-active' : ''} onClick={() => setLanguage(item.id)}>{item.label}</button>)}</div><CodeBlock id={`${endpoint.id}-${language}`} code={requestCode} language={language === 'curl' ? 'shell' : language} copied={copied} onCopy={onCopy} /></div>}</div>}</article>
}
