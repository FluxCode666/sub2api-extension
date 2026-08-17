import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applyTheme, detectTheme, type Theme } from '@/lib/theme'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import {
  DEFAULT_HOMEPAGE_CONFIG,
  loadHomepageConfig,
  type HomepageConfig,
  type TrustedPartner,
} from '@/lib/homepage-config'

const PAGE_ID = 'home'

type NetworkPoint = readonly [number, number]

function smoothNetworkPath(points: NetworkPoint[]) {
  let path = `M${points[0][0]} ${points[0][1]}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index]
    const current = points[index]
    const next = points[index + 1]
    const following = points[index + 2] ?? next
    const controlOne: NetworkPoint = [
      current[0] + (next[0] - previous[0]) / 6,
      current[1] + (next[1] - previous[1]) / 6,
    ]
    const controlTwo: NetworkPoint = [
      next[0] - (following[0] - current[0]) / 6,
      next[1] - (following[1] - current[1]) / 6,
    ]
    path += ` C${controlOne[0]} ${controlOne[1]} ${controlTwo[0]} ${controlTwo[1]} ${next[0]} ${next[1]}`
  }
  return path
}

const NETWORK_PATHS = Array.from({ length: 15 }, (_, index) => {
  const edgeY = 44 + index * 62
  const distanceFromHub = edgeY - 430
  const waveAmplitude = 3 + (1 - Math.min(Math.abs(distanceFromHub) / 430, 1)) * 7
  const wavePhase = [-0.16, 0, 0.16][index % 3]
  const wavePoints: NetworkPoint[] = Array.from({ length: 9 }, (_, pointIndex) => {
    const progress = pointIndex / 8
    const envelope = Math.sin(progress * Math.PI)
    const oscillation = Math.sin(progress * Math.PI * 6 + wavePhase)
    const compression = 0.07 + Math.abs(progress - 0.5) * 0.11
    const centerLift = -30 * envelope
    return [
      560 + pointIndex * 60,
      430 + distanceFromHub * compression + centerLift + oscillation * envelope * waveAmplitude,
    ]
  })

  return smoothNetworkPath([
    [-70, edgeY],
    [190, edgeY + distanceFromHub * 0.02],
    [390, 430 + distanceFromHub * 0.56],
    [500, 430 + distanceFromHub * 0.22],
    ...wavePoints,
    [1100, 430 + distanceFromHub * 0.22],
    [1210, 430 + distanceFromHub * 0.56],
    [1410, edgeY + distanceFromHub * 0.02],
    [1670, edgeY],
  ])
})

// A restrained wireframe surface gives the convergence zone a spatial, 3D
// reading without adding another dense illustration behind the headline.
const NETWORK_MESH_PATHS = [
  smoothNetworkPath([[800, 338], [650, 366], [560, 430], [650, 494], [800, 522]]),
  smoothNetworkPath([[800, 338], [720, 366], [680, 430], [720, 494], [800, 522]]),
  smoothNetworkPath([[800, 338], [790, 366], [780, 430], [790, 494], [800, 522]]),
  smoothNetworkPath([[800, 338], [810, 366], [820, 430], [810, 494], [800, 522]]),
  smoothNetworkPath([[800, 338], [880, 366], [920, 430], [880, 494], [800, 522]]),
  smoothNetworkPath([[800, 338], [950, 366], [1040, 430], [950, 494], [800, 522]]),
  smoothNetworkPath([[560, 430], [632, 404], [716, 389], [800, 384], [884, 389], [968, 404], [1040, 430]]),
  smoothNetworkPath([[560, 430], [640, 420], [722, 412], [800, 410], [878, 412], [960, 420], [1040, 430]]),
  smoothNetworkPath([[560, 430], [640, 440], [722, 448], [800, 450], [878, 448], [960, 440], [1040, 430]]),
  smoothNetworkPath([[560, 430], [632, 457], [716, 471], [800, 477], [884, 471], [968, 457], [1040, 430]]),
] as const

const NETWORK_PACKETS = [
  { pathIndex: 2, duration: '2.15s', begin: '-0.2s', radius: 3.4 },
  { pathIndex: 7, duration: '2.35s', begin: '-1.1s', radius: 4.1 },
  { pathIndex: 12, duration: '2.2s', begin: '-1.75s', radius: 3.3 },
] as const

const NETWORK_COLORS = [
  '#5c6fd7', '#6979dc', '#7b81df', '#8d86dd', '#9d8bd9',
  '#aa8bd2', '#b184cb', '#b77ec2', '#aa79c3', '#987bd0',
  '#847fd9', '#7078dd', '#6172d9', '#6b7edb', '#7d89dd',
] as const

const CAPABILITIES = [
  {
    code: 'UNIFIED ACCESS',
    title: '统一接入与身份边界',
    copy: '为产品、Agent 和内部系统提供一致入口。',
    tags: ['协议兼容', '身份鉴权'],
    className: 'capability--wide',
  },
  {
    code: 'POLICY CONTROL',
    title: '策略、安全与配额治理',
    copy: '集中管理访问范围、调用规则和团队边界。',
    tags: ['权限', '配额', '审计'],
    className: 'capability--tall',
  },
  {
    code: 'OBSERVABILITY',
    title: '调用、告警与成本视角',
    copy: '让问题定位、使用复盘和资源规划有据可循。',
    tags: ['指标', '用量'],
    className: '',
  },
  {
    code: 'ROUTING',
    title: '智能路由与稳定保障',
    copy: '在网关层处理模型选择、切换和异常处置。',
    tags: ['路由', '容错'],
    className: '',
  },
  {
    code: 'DEVELOPER EXPERIENCE',
    title: '保持熟悉的调用方式',
    copy: '兼容常用 SDK，减少业务接入成本。',
    tags: ['API', 'SDK'],
    className: '',
  },
] as const

const SCENARIOS = [
  ['AI PRODUCTS', '面向用户的 AI 产品', '让产品迭代不被底层模型和供应商变化牵动。'],
  ['AGENT WORKFLOWS', 'Agent 与自动化', '统一不同推理能力的调用、权限和运行策略。'],
  ['PLATFORM ENGINEERING', '研发与平台团队', '为多个团队提供一致的接入规范和运行视角。'],
] as const

type CodeLanguage = 'curl' | 'python' | 'java' | 'go'
type CodeProtocol = 'chat' | 'responses' | 'anthropic'

const CODE_PROTOCOLS: Array<{ id: CodeProtocol; label: string; caption: string }> = [
  { id: 'chat', label: 'Chat Completions', caption: 'OPENAI-COMPATIBLE API' },
  { id: 'responses', label: 'Responses API', caption: 'OPENAI RESPONSES API' },
  { id: 'anthropic', label: 'Anthropic Messages', caption: 'ANTHROPIC MESSAGES API' },
]

const CODE_LANGUAGE_META: Record<CodeLanguage, { label: string; fileName: string }> = {
  curl: { label: 'cURL', fileName: 'request.sh' },
  python: { label: 'Python', fileName: 'main.py' },
  java: { label: 'Java', fileName: 'Main.java' },
  go: { label: 'Go', fileName: 'main.go' },
}

const CODE_LANGUAGES = Object.keys(CODE_LANGUAGE_META) as CodeLanguage[]
const CODE_PROMPT = '你好，请介绍一下 TERALEMO。'

function buildCodeExamples(protocol: CodeProtocol, model: string) {
  const safeModel = model.trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"') || 'gpt-5.6-sol'
  const endpoint = protocol === 'chat'
    ? '/v1/chat/completions'
    : protocol === 'responses'
      ? '/v1/responses'
      : '/v1/messages'
  const isAnthropic = protocol === 'anthropic'
  const examples: Record<CodeLanguage, string> = {
    curl: protocol === 'chat'
      ? [
          'export TERALEMO_API_KEY="your-api-key"', '',
          `curl https://api.teralemo.com${endpoint} \\`,
          '  -H "Authorization: Bearer $TERALEMO_API_KEY" \\',
          '  -H "Content-Type: application/json" \\',
          "  -d '{", `    "model": "${safeModel}",`, '    "messages": [',
          '      { "role": "user", "content": "你好，请介绍一下 TERALEMO。" }',
          "    ]", "  }'",
        ].join('\n')
      : protocol === 'responses'
        ? [
            'export TERALEMO_API_KEY="your-api-key"', '',
            `curl https://api.teralemo.com${endpoint} \\`,
            '  -H "Authorization: Bearer $TERALEMO_API_KEY" \\',
            '  -H "Content-Type: application/json" \\',
            "  -d '{", `    "model": "${safeModel}",`, '    "input": "你好，请介绍一下 TERALEMO。"', "  }'",
          ].join('\n')
        : [
            'export TERALEMO_API_KEY="your-api-key"', '',
            `curl https://api.teralemo.com${endpoint} \\`,
            '  -H "x-api-key: $TERALEMO_API_KEY" \\',
            '  -H "anthropic-version: 2023-06-01" \\',
            '  -H "content-type: application/json" \\',
            "  -d '{", `    "model": "${safeModel}",`, '    "max_tokens": 1024,',
            '    "messages": [{ "role": "user", "content": "你好，请介绍一下 TERALEMO。" }]', "  }'",
          ].join('\n'),
    python: [
      'import os', 'import requests', '',
      `response = requests.post("https://api.teralemo.com${endpoint}",`,
      '    headers={',
      ...(isAnthropic
        ? ['        "x-api-key": os.environ["TERALEMO_API_KEY"],', '        "anthropic-version": "2023-06-01",']
        : ['        "Authorization": f"Bearer {os.environ[\'TERALEMO_API_KEY\']}",']),
      '        "Content-Type": "application/json",',
      '    },',
      '    json=' + (protocol === 'chat'
        ? `{"model": "${safeModel}", "messages": [{"role": "user", "content": "${CODE_PROMPT}"}]},`
        : protocol === 'responses'
          ? `{"model": "${safeModel}", "input": "${CODE_PROMPT}"},`
          : `{"model": "${safeModel}", "max_tokens": 1024, "messages": [{"role": "user", "content": "${CODE_PROMPT}"}]},`),
      '    timeout=60,', ')', '',
      'response.raise_for_status()', 'print(response.json())',
    ].join('\n'),
    java: [
      'import java.net.URI;', 'import java.net.http.HttpClient;', 'import java.net.http.HttpRequest;', 'import java.net.http.HttpResponse;', '',
      'public class Main {', '  public static void main(String[] args) throws Exception {', '    String body = """', '        {',
      `          "model": "${safeModel}",`,
      ...(protocol === 'responses'
        ? ['          "input": "你好，请介绍一下 TERALEMO。"']
        : protocol === 'anthropic'
          ? ['          "max_tokens": 1024,', '          "messages": [{"role":"user","content":"你好，请介绍一下 TERALEMO。"}]']
          : ['          "messages": [{"role":"user","content":"你好，请介绍一下 TERALEMO。"}]']),
      '        }', '        """;', '', '    HttpRequest request = HttpRequest.newBuilder()',
      `        .uri(URI.create("https://api.teralemo.com${endpoint}"))`,
      ...(isAnthropic
        ? ['        .header("x-api-key", System.getenv("TERALEMO_API_KEY"))', '        .header("anthropic-version", "2023-06-01")']
        : ['        .header("Authorization", "Bearer " + System.getenv("TERALEMO_API_KEY"))']),
      '        .header("Content-Type", "application/json")', '        .POST(HttpRequest.BodyPublishers.ofString(body))', '        .build();', '',
      '    HttpResponse<String> response = HttpClient.newHttpClient().send(request, HttpResponse.BodyHandlers.ofString());',
      '    System.out.println(response.body());', '  }', '}',
    ].join('\n'),
    go: [
      'package main', '', 'import (', '  "bytes"', '  "fmt"', '  "io"', '  "net/http"', '  "os"', '  "time"', ')', '', 'func main() {', '  body := []byte(`{',
      `    "model": "${safeModel}",`,
      ...(protocol === 'responses'
        ? ['    "input": "你好，请介绍一下 TERALEMO。"']
        : protocol === 'anthropic'
          ? ['    "max_tokens": 1024,', '    "messages": [{"role":"user","content":"你好，请介绍一下 TERALEMO。"}]']
          : ['    "messages": [{"role":"user","content":"你好，请介绍一下 TERALEMO。"}]']),
      '  }`)', '', '  req, err := http.NewRequest(', '    http.MethodPost,', `    "https://api.teralemo.com${endpoint}",`, '    bytes.NewReader(body),', '  )', '  if err != nil { panic(err) }', '',
      ...(isAnthropic
        ? ['  req.Header.Set("x-api-key", os.Getenv("TERALEMO_API_KEY"))', '  req.Header.Set("anthropic-version", "2023-06-01")']
        : ['  req.Header.Set("Authorization", "Bearer "+os.Getenv("TERALEMO_API_KEY"))']),
      '  req.Header.Set("Content-Type", "application/json")', '', '  client := &http.Client{Timeout: 60 * time.Second}', '  response, err := client.Do(req)', '  if err != nil { panic(err) }', '  defer response.Body.Close()', '  data, err := io.ReadAll(response.Body)', '  if err != nil { panic(err) }', '  fmt.Println(string(data))', '}',
    ].join('\n'),
  }

  return Object.fromEntries(CODE_LANGUAGES.map((language) => [language, {
    ...CODE_LANGUAGE_META[language],
    code: examples[language],
  }])) as Record<CodeLanguage, { label: string; fileName: string; code: string }>
}

export default function HomePage() {
  const [config, setConfig] = useState<HomepageConfig>(DEFAULT_HOMEPAGE_CONFIG)
  const [compactNav, setCompactNav] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => detectTheme())
  const [activeCodeProtocol, setActiveCodeProtocol] = useState<CodeProtocol>('chat')
  const [activeCodeLanguage, setActiveCodeLanguage] = useState<CodeLanguage>('curl')
  const [copiedCodeLanguage, setCopiedCodeLanguage] = useState<CodeLanguage | null>(null)
  const navSentinelRef = useRef<HTMLSpanElement>(null)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadHomepageConfig().then((nextConfig) => {
      if (!cancelled) setConfig(nextConfig)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
  }, [])

  useEffect(() => {
    const sentinel = navSentinelRef.current
    if (!sentinel || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      ([entry]) => setCompactNav(!entry.isIntersecting),
      { rootMargin: '-48px 0px 0px 0px', threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  const toggleTheme = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }, [theme])

  const action = useCallback((featureId: string) => {
    trackFeatureClick(PAGE_ID, featureId)
  }, [])

  const codeExamples = useMemo(
    () => buildCodeExamples(activeCodeProtocol, config.model),
    [activeCodeProtocol, config.model],
  )
  const activeCodeProtocolMeta = CODE_PROTOCOLS.find((protocol) => protocol.id === activeCodeProtocol) || CODE_PROTOCOLS[0]

  const selectCodeProtocol = useCallback((protocol: CodeProtocol) => {
    setActiveCodeProtocol(protocol)
    setCopiedCodeLanguage(null)
    action(`developer-protocol-${protocol}`)
  }, [action])

  const selectCodeLanguage = useCallback((language: CodeLanguage) => {
    setActiveCodeLanguage(language)
    setCopiedCodeLanguage(null)
    action(`developer-code-${language}`)
  }, [action])

  const copyCodeExample = useCallback(async () => {
    const example = codeExamples[activeCodeLanguage]
    try {
      await writeClipboard(example.code)
      setCopiedCodeLanguage(activeCodeLanguage)
      action(`developer-copy-${activeCodeProtocol}-${activeCodeLanguage}`)
      if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current)
      copyResetTimerRef.current = setTimeout(() => setCopiedCodeLanguage(null), 1800)
    } catch {
      setCopiedCodeLanguage(null)
    }
  }, [activeCodeLanguage, activeCodeProtocol, action, codeExamples])

  const [heroLead, ...heroRest] = config.heroTitle.split('，')

  return (
    <div className="teralemo-page">
      <a className="teralemo-skip-link" href="#main-content">跳至主要内容</a>
      <header className={`teralemo-nav ${compactNav ? 'is-compact' : ''}`}>
        <div className="teralemo-nav-frame">
          <a className="teralemo-brand" href="#top" aria-label="TERALEMO 首页">
            <span className="teralemo-mark" aria-hidden="true">T</span>
            <span>TERALEMO</span>
          </a>
          <nav className="teralemo-nav-links" aria-label="主导航">
            <a href="#platform">平台能力</a>
            <a href="#capabilities">治理能力</a>
            <a href="#developers">开发者文档</a>
            <a href="#contact">服务支持</a>
          </nav>
          <button
            type="button"
            className="teralemo-theme-toggle"
            onClick={toggleTheme}
            aria-label={`切换到${theme === 'dark' ? '浅色' : '深色'}主题`}
          >
            <ThemeIcon theme={theme} />
          </button>
          <a className="teralemo-nav-cta" href={config.consoleHref} onClick={() => action('nav-console')}>
            控制台
          </a>
        </div>
      </header>

      <main id="main-content" tabIndex={-1}>
        <section className="teralemo-hero" id="top">
          <span className="teralemo-nav-sentinel" ref={navSentinelRef} aria-hidden="true" />
          <div className="teralemo-network" aria-hidden="true">
            <svg viewBox="0 0 1600 920" preserveAspectRatio="none">
              <defs>
                <linearGradient id="teralemo-network-gradient" x1="0" y1="0" x2="1" y2="0">
                  <stop className="teralemo-network-stop teralemo-network-stop--edge" offset="0%" />
                  <stop className="teralemo-network-stop teralemo-network-stop--shoulder" offset="28%" />
                  <stop className="teralemo-network-stop teralemo-network-stop--core" offset="50%" />
                  <stop className="teralemo-network-stop teralemo-network-stop--shoulder" offset="72%" />
                  <stop className="teralemo-network-stop teralemo-network-stop--edge" offset="100%" />
                </linearGradient>
                <filter id="teralemo-packet-glow" x="-300%" y="-300%" width="700%" height="700%">
                  <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              {NETWORK_MESH_PATHS.map((path, index) => (
                <path
                  key={`mesh-${index}`}
                  className="teralemo-network-mesh-line"
                  d={path}
                  style={{ stroke: `color-mix(in srgb, ${NETWORK_COLORS[(index + 4) % NETWORK_COLORS.length]} 76%, var(--home-surface))` }}
                />
              ))}
              {NETWORK_PATHS.map((path, index) => (
                <path
                  key={path}
                  className={index === 2 || index === 7 || index === 12 ? 'is-emphasis' : index < 2 || index > 12 ? 'is-outer' : ''}
                  d={path}
                  style={{ stroke: `color-mix(in srgb, ${NETWORK_COLORS[index]} 78%, var(--home-surface))` }}
                />
              ))}
              {NETWORK_PACKETS.map((packet) => {
                const path = NETWORK_PATHS[packet.pathIndex]
                return (
                  <circle className="teralemo-packet" key={packet.pathIndex} r={packet.radius}>
                    <animateMotion path={path} dur={packet.duration} begin={packet.begin} repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.08;0.9;1" dur={packet.duration} begin={packet.begin} repeatCount="indefinite" />
                  </circle>
                )
              })}
            </svg>
            <span className="teralemo-network-core" />
          </div>
          <div className="teralemo-hero-inner">
            <span className="teralemo-eyebrow">{config.heroLabel}</span>
            <h1><span>{heroLead}</span>{heroRest.length ? `，${heroRest.join('，')}` : null}</h1>
            <p className="teralemo-hero-copy">{config.heroDescription}</p>
            <div className="teralemo-hero-actions">
              <a className="teralemo-button teralemo-button--primary" href={config.primaryHref} onClick={() => action('hero-primary')}>
                {config.primaryCta}
              </a>
              <a className="teralemo-button teralemo-button--secondary" href={config.docsHref} onClick={() => action('hero-docs')}>
                {config.docsCta}
              </a>
            </div>
            <div className="teralemo-hero-facts" aria-label="网关能力摘要">
              <div><strong>统一接入</strong><span>应用与 Agent</span></div>
              <div><strong>稳定路由</strong><span>模型与算力</span></div>
              <div><strong>可观测运营</strong><span>用量与成本</span></div>
            </div>
          </div>
        </section>

        <TrustedPartners partners={config.trustedPartners} onAction={action} />

        <section className="teralemo-section" id="platform">
          <div className="teralemo-shell">
            <div className="teralemo-section-head">
              <h2>与主流模型能力保持兼容</h2>
              <p>模型生态由网关统一管理，业务系统不需要分别维护多套连接关系。</p>
            </div>
            <div className="teralemo-provider-list" aria-label="模型生态">
              <span>OpenAI</span><span>Anthropic</span><span>更多</span>
            </div>
          </div>
        </section>

        <section className="teralemo-section teralemo-capabilities" id="capabilities">
          <div className="teralemo-shell">
            <div className="teralemo-section-head">
              <h2>为生产级 AI 网关而设计</h2>
              <p>从接入到运营，为生产环境提供一套完整的控制与运行能力。</p>
            </div>
            <div className="teralemo-capability-grid">
              {CAPABILITIES.map((capability) => (
                <article className={`teralemo-capability ${capability.className}`} key={capability.code}>
                  <span>{capability.code}</span>
                  <h3>{capability.title}</h3>
                  <p>{capability.copy}</p>
                  <div className="teralemo-capability-tags">{capability.tags.map((tag) => <b key={tag}>{tag}</b>)}</div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="teralemo-section teralemo-scenarios">
          <div className="teralemo-shell">
            <div className="teralemo-section-head">
              <p className="teralemo-kicker">应用场景</p>
              <h2>服务不同角色与团队</h2>
              <p>同一套网关能力可以支撑产品交付、平台研发和组织级运营。</p>
            </div>
            <div className="teralemo-scenario-track">
              {SCENARIOS.map(([code, title, copy]) => (
                <article className="teralemo-scenario" key={code}><span>{code}</span><h3>{title}</h3><p>{copy}</p></article>
              ))}
            </div>
          </div>
        </section>

        <section className="teralemo-section teralemo-developer" id="developers">
          <div className="teralemo-shell teralemo-developer-grid">
            <div className="teralemo-developer-copy">
              <p className="teralemo-kicker">开发者体验</p>
              <h2>接入一次，网关持续演进。</h2>
              <p>应用侧保持熟悉的调用方式，策略、路由和治理能力由 TERALEMO 统一承接。</p>
              <a className="teralemo-text-link" href="#contact" onClick={() => action('developer-docs')}>查看 API 文档 ↗</a>
            </div>
            <div className="teralemo-code-block" aria-label={`${activeCodeProtocolMeta.label} 接口示例`}>
              <div className="teralemo-code-protocols" role="tablist" aria-label="接口协议">
                {CODE_PROTOCOLS.map((protocol) => (
                  <button
                    type="button"
                    role="tab"
                    id={`teralemo-code-protocol-${protocol.id}`}
                    aria-controls="teralemo-code-panel"
                    aria-selected={activeCodeProtocol === protocol.id}
                    className={`teralemo-code-protocol ${activeCodeProtocol === protocol.id ? 'is-active' : ''}`}
                    key={protocol.id}
                    onClick={() => selectCodeProtocol(protocol.id)}
                  >
                    {protocol.label}
                  </button>
                ))}
              </div>
              <div className="teralemo-code-head">
                <div className="teralemo-code-tabs" role="tablist" aria-label="代码示例语言">
                  {CODE_LANGUAGES.map((language) => (
                    <button
                      type="button"
                      role="tab"
                      id={`teralemo-code-tab-${language}`}
                      aria-controls="teralemo-code-panel"
                      aria-selected={activeCodeLanguage === language}
                      className={`teralemo-code-tab ${activeCodeLanguage === language ? 'is-active' : ''}`}
                      key={language}
                      onClick={() => selectCodeLanguage(language)}
                    >
                      {codeExamples[language].label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="teralemo-code-copy"
                  onClick={() => void copyCodeExample()}
                  aria-label={`复制 ${codeExamples[activeCodeLanguage].label} 示例`}
                >
                  <CopyIcon />
                  <span aria-live="polite">{copiedCodeLanguage === activeCodeLanguage ? '已复制' : '复制'}</span>
                </button>
              </div>
              <div className="teralemo-code-caption">
                <span>{activeCodeProtocolMeta.caption}</span>
                <span>{codeExamples[activeCodeLanguage].fileName}</span>
              </div>
              <pre
                id="teralemo-code-panel"
                role="tabpanel"
                aria-labelledby={`teralemo-code-protocol-${activeCodeProtocol} teralemo-code-tab-${activeCodeLanguage}`}
                tabIndex={0}
              ><code>{codeExamples[activeCodeLanguage].code}</code></pre>
            </div>
          </div>
        </section>

        <section className="teralemo-contact" id="contact">
          <div className="teralemo-shell">
            <h2>规划 AI 网关与运行体系</h2>
            <p>告诉我们你的业务场景、接入规模和治理要求，我们将提供适合的对接建议。</p>
            <a className="teralemo-button teralemo-button--primary" href="mailto:service@teralemo.com" onClick={() => action('contact-team')}>联系服务团队</a>
          </div>
        </section>
      </main>

      <footer className="teralemo-footer teralemo-shell">
        <div><strong>TERALEMO</strong><p>生产级 AI 网关，为产品、Agent 和研发平台提供统一的接入、治理与运行能力。</p></div>
        <div><strong>产品</strong><a href="#platform">平台能力</a><a href="#capabilities">治理能力</a></div>
        <div><strong>资源</strong><a href="#developers">API 文档</a><a href="#developers">使用指南</a></div>
        <div><strong>服务支持</strong><a href="#contact">联系商务</a><a href="#contact">服务条款</a></div>
      </footer>
    </div>
  )
}

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === 'dark') {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3.75" />
        <path d="M12 2.25v2.1M12 19.65v2.1M21.75 12h-2.1M4.35 12h-2.1M18.9 5.1l-1.5 1.5M6.6 17.4l-1.5 1.5M18.9 18.9l-1.5-1.5M6.6 6.6 5.1 5.1" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M20.1 15.2A8.4 8.4 0 0 1 8.8 3.9 8.5 8.5 0 1 0 20.1 15.2Z" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <rect x="8" y="8" width="11" height="11" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('copy failed')
}

function TrustedPartners({ partners, onAction }: { partners: TrustedPartner[]; onAction: (id: string) => void }) {
  if (!partners.length) return null
  return <TrustedPartnersMarquee partners={partners} onAction={onAction} />
}

function TrustedPartnersMarquee({ partners, onAction }: { partners: TrustedPartner[]; onAction: (id: string) => void }) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const dragDistanceRef = useRef(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef({ startX: 0, startScroll: 0 })
  const partnerGroup = useMemo(
    () => Array.from({ length: Math.max(6, partners.length) }, (_, index) => partners[index % partners.length]),
    [partners],
  )

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    let previous = performance.now()
    let pauseUntil = 0
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const animate = (now: number) => {
      const elapsed = Math.min(now - previous, 48)
      previous = now
      const loopPoint = viewport.scrollWidth / 2
      if (!reduceMotion.matches && !draggingRef.current && now >= pauseUntil && loopPoint > 0) {
        viewport.scrollLeft += elapsed * 0.045
        if (viewport.scrollLeft >= loopPoint) viewport.scrollLeft -= loopPoint
      }
      frame = requestAnimationFrame(animate)
    }
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      drag.current = { startX: event.clientX, startScroll: viewport.scrollLeft }
      dragDistanceRef.current = 0
      draggingRef.current = true
      setDragging(true)
      viewport.setPointerCapture(event.pointerId)
    }
    const onPointerMove = (event: PointerEvent) => {
      if (!draggingRef.current) return
      const distance = event.clientX - drag.current.startX
      dragDistanceRef.current = Math.max(dragDistanceRef.current, Math.abs(distance))
      viewport.scrollLeft = drag.current.startScroll - distance
    }
    const onPointerUp = (event: PointerEvent) => {
      if (!draggingRef.current) return
      draggingRef.current = false
      setDragging(false)
      const loopPoint = viewport.scrollWidth / 2
      if (loopPoint > 0) viewport.scrollLeft %= loopPoint
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId)
      pauseUntil = performance.now() + 500
    }
    viewport.addEventListener('pointerdown', onPointerDown)
    viewport.addEventListener('pointermove', onPointerMove)
    viewport.addEventListener('pointerup', onPointerUp)
    viewport.addEventListener('pointercancel', onPointerUp)
    frame = requestAnimationFrame(animate)
    return () => {
      cancelAnimationFrame(frame)
      viewport.removeEventListener('pointerdown', onPointerDown)
      viewport.removeEventListener('pointermove', onPointerMove)
      viewport.removeEventListener('pointerup', onPointerUp)
      viewport.removeEventListener('pointercancel', onPointerUp)
    }
  }, [])

  return (
    <section className="teralemo-trusted" id="trusted-partners">
      <div className="teralemo-shell">
        <h2>受信赖的伙伴</h2>
        <div
          className={`teralemo-partner-viewport ${dragging ? 'is-dragging' : ''}`}
          ref={viewportRef}
          aria-label="受信赖的伙伴，自动滚动并支持左右拖拽浏览"
          tabIndex={0}
          onClickCapture={(event) => {
            if (dragDistanceRef.current > 5) event.preventDefault()
          }}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
            event.preventDefault()
            viewportRef.current?.scrollBy({ left: event.key === 'ArrowRight' ? 220 : -220, behavior: 'smooth' })
            onAction('trusted-partners-scroll')
          }}
        >
          <div className="teralemo-partner-track">
            {[0, 1].map((groupIndex) => (
              <div className="teralemo-partner-group" key={groupIndex} aria-hidden={groupIndex === 1 ? true : undefined}>
                {partnerGroup.map((partner, index) => {
                  const hiddenClone = groupIndex === 1 || index >= partners.length
                  return (
                    <a
                      className="teralemo-partner"
                      href={partner.linkUrl || '#contact'}
                      key={`${partner.name}-${index}`}
                      onClick={() => onAction('trusted-partner')}
                      aria-hidden={hiddenClone ? true : undefined}
                      tabIndex={hiddenClone ? -1 : undefined}
                    >
                      {partner.logoUrl ? <img src={partner.logoUrl} alt="" draggable={false} onError={(event) => { event.currentTarget.style.display = 'none' }} /> : null}
                      <span>{partner.name}</span>
                    </a>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
