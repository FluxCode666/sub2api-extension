import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, ArrowUp, Check, ChevronDown, Copy, ExternalLink, Moon, Sun } from 'lucide-react'
import { CC_SWITCH_DOWNLOAD_URL } from '@/lib/client-guides'
import { Button } from '@/components/ui/button'
import { trackFeatureClick, trackPageView } from '@/lib/telemetry-sdk'
import { apiClient, type AuxEnvelope } from '@/lib/api-client'
import { DEFAULT_HOMEPAGE_CONFIG, isHomepageNavigationHref } from '@/lib/homepage'
import { DEFAULT_SUB2API_SYSTEM_NAME, resolveSystemName } from '@/lib/system-name'
import { toCurrentOriginURI, toSameOriginPath } from '@/lib/app-base-path'
import '@fontsource-variable/geist'
import './UserGuidePage.css'

type Theme = 'light' | 'dark'

type GuideSection = { id: string; label: string }
type GuideGroup = { label: string; sections: GuideSection[] }

const SECTION_GROUPS: GuideGroup[] = [
  {
    label: '开始',
    sections: [
      { id: 'overview', label: '教程首页' },
      { id: 'prepare', label: '你要准备什么' },
    ],
  },
  {
    label: '一步一步',
    sections: [
      { id: 'step-1', label: '第 1 步 · 准备客户端' },
      { id: 'step-2', label: '第 2 步 · 登录控制台' },
      { id: 'step-3', label: '第 3 步 · 创建密钥' },
      { id: 'step-4', label: '第 4 步 · 配置客户端' },
      { id: 'step-5', label: '第 5 步 · 启用配置' },
      { id: 'step-6', label: '第 6 步 · 打开 Codex' },
      { id: 'step-7', label: '第 7 步 · 验证用量' },
    ],
  },
  {
    label: '继续',
    sections: [
      { id: 'optional-api', label: 'API 调用（可选）' },
      { id: 'faq', label: '常见问题' },
      { id: 'security', label: '密钥安全' },
    ],
  },
] as const

const SECTIONS = SECTION_GROUPS.flatMap(group => group.sections)

const SCREENSHOTS = [
  ['console-home', '用户控制台首页', '建议标出 API Keys、用量和进入 API Key 列表的位置'],
  ['api-keys', 'API Keys 列表与导入按钮', '建议标出目标 Key、所属分组和“导入到 CCSwitch”按钮'],
  ['create-key', '创建 API Key 表单', '建议展示名称、分组和创建按钮，遮盖完整密钥'],
  ['cc-switch-import', 'CC Switch 导入 Provider', '建议展示导入确认和 Codex Provider 配置区域'],
  ['cc-switch-enabled', 'CC Switch 已启用的配置', '建议展示平台配置卡片的“使用中”状态'],
  ['codex-usage', 'Codex 回复与用量记录', '建议同时展示 Codex 的正常回复和平台用量记录'],
] as const

function currentOrigin(): string {
  return typeof window !== 'undefined' ? window.location.origin : ''
}

function versionedBaseURL(baseURL: string): string {
  const root = baseURL.trim().replace(/\/+$/, '').replace(/\/v1$/i, '')
  return root ? `${root}/v1` : '/v1'
}

function buildCode(baseURL: string, providerName: string) {
  const apiBaseURL = versionedBaseURL(baseURL)
  return {
    manualProvider: `应用          Codex
Provider 名称 ${providerName}
Base URL      ${baseURL}
API Key       sk-YOUR_API_KEY
模型          按控制台模型列表选择`,
    models: `curl ${apiBaseURL}/models \\
  -H "Authorization: Bearer sk-YOUR_API_KEY"`,
    response: `curl ${apiBaseURL}/responses \\
  -H "Authorization: Bearer sk-YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "YOUR_MODEL_ID",
    "input": "hi"
  }'`,
    python: `from openai import OpenAI

client = OpenAI(
    base_url="${apiBaseURL}",
    api_key="YOUR_API_KEY",
)

response = client.responses.create(
    model="YOUR_MODEL_ID",
    input="hi",
)

print(response.output_text)`,
  } as const
}

function ScreenshotPlaceholder({ id, title, hint }: { id: string; title: string; hint: string }) {
  return (
    <figure className="user-guide-shot" data-screenshot-slot={id}>
      <div className="user-guide-shot-placeholder" role="img" aria-label={`${title}，截图待补充`}>
        <span>截图待补充 · {id}.png</span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <figcaption>补图时请使用测试数据，并遮盖邮箱、余额、订单和所有凭据。</figcaption>
    </figure>
  )
}

function CodeBlock({ id, label, code, onCopy }: { id: string; label: string; code: string; onCopy: (id: string) => void }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      onCopy(id)
    } catch {
      setCopied(false)
    }
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="user-guide-code">
      <div className="user-guide-code-head">
        <span>{label}</span>
        <Button type="button" variant="ghost" onClick={() => void copy()} aria-label={`复制${label}`}>
          {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
          {copied ? '已复制' : '复制'}
        </Button>
      </div>
      <pre tabIndex={0} aria-label={label}><code>{code}</code></pre>
    </div>
  )
}

function ThemeToggle({ theme, onToggle }: { theme: Theme; onToggle: () => void }) {
  return (
    <Button className="user-guide-control" type="button" variant="ghost" onClick={onToggle} aria-label={theme === 'dark' ? '切换浅色主题' : '切换深色主题'}>
      {theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      <span>{theme === 'dark' ? '浅色' : '深色'}</span>
    </Button>
  )
}

export default function UserGuidePage() {
  const [theme, setTheme] = useState<Theme>(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const [activeSection, setActiveSection] = useState('overview')
  const [mobileTocOpen, setMobileTocOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  const [systemName, setSystemName] = useState(DEFAULT_SUB2API_SYSTEM_NAME)
  const [baseURL] = useState(currentOrigin)
  const [consoleHref, setConsoleHref] = useState(DEFAULT_HOMEPAGE_CONFIG.consoleHref)
  const code = useMemo(() => buildCode(baseURL, systemName), [baseURL, systemName])
  const currentLabel = useMemo(() => SECTIONS.find(section => section.id === activeSection)?.label ?? SECTIONS[0].label, [activeSection])
  const consoleURI = toCurrentOriginURI(toSameOriginPath(consoleHref, '/admin'), { includeAppBasePath: false })

  useEffect(() => { trackPageView('user-guide') }, [])

  useEffect(() => {
    let active = true
    void apiClient.get<AuxEnvelope<{ siteName?: string; heroTitle?: string; consoleHref?: string }>>('/homepage/config').then(envelope => {
      if (active && envelope.code === 0) {
        setSystemName(resolveSystemName(envelope.data))
        const configuredConsole = envelope.data?.consoleHref?.trim()
        if (configuredConsole && isHomepageNavigationHref(configuredConsole)) setConsoleHref(configuredConsole)
      }
    }).catch(() => {
      // 配置服务不可用时保留默认品牌，教程内容仍应可阅读。
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = `新手教程 · ${systemName} Docs`
    return () => { document.title = previousTitle }
  }, [systemName])

  useEffect(() => {
    const nodes = SECTIONS.map(section => document.getElementById(section.id)).filter((node): node is HTMLElement => Boolean(node))
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      if (visible[0]) setActiveSection(visible[0].target.id)
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.01] }) : null
    nodes.forEach(node => observer?.observe(node))
    const onScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { observer?.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])

  function goToSection(id: string) {
    setActiveSection(id)
    setMobileTocOpen(false)
    trackFeatureClick('user-guide', `section-${id}`)
  }

  function onCopy(id: string) {
    trackFeatureClick('user-guide', `copy-${id}`)
  }

  return (
    <div className="user-guide" data-theme={theme}>
      <div className="user-guide-progress" aria-hidden="true"><span style={{ transform: `scaleX(${progress})` }} /></div>
      <a className="user-guide-skip" href="#user-guide-content">跳到正文</a>

      <header className="user-guide-header">
        <div className="user-guide-shell user-guide-header-inner">
          <Link className="user-guide-brand" to="/user-guide" onClick={() => trackFeatureClick('user-guide', 'back-top')}>
            <span>01</span><strong>{systemName}</strong>
          </Link>
          <div className="user-guide-header-actions">
            <ThemeToggle theme={theme} onToggle={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); trackFeatureClick('user-guide', `theme-${theme === 'dark' ? 'light' : 'dark'}`) }} />
            <a className="user-guide-console" href={consoleURI} target="_top" onClick={() => trackFeatureClick('user-guide', 'open-dashboard')}>返回控制台</a>
          </div>
        </div>
      </header>

      <main id="user-guide-content">
        <section id="overview" className="user-guide-intro user-guide-shell" aria-labelledby="user-guide-title">
          <div>
            <p className="user-guide-kicker">BEGINNER GUIDE / 01</p>
            <h1 id="user-guide-title">照着 7 步走，第一次请求就能跑通。</h1>
            <p className="user-guide-lede">给第一次使用 API 的用户：从安装客户端、创建 API Key、导入 CC Switch，到在 Codex 里发送第一句 <code>hi</code>。跟着顺序操作，不需要先理解所有 API 概念。</p>
            <div className="user-guide-base-url"><span>API BASE URL</span><code>{baseURL}</code></div>
            <div className="user-guide-intro-links">
              <a href="#prepare" onClick={() => goToSection('prepare')}>从准备开始 <ArrowRight size={16} aria-hidden="true" /></a>
              <Link to="/client-docs?client=codex" onClick={() => trackFeatureClick('user-guide', 'open-codex-docs')}>查看 Codex 详细配置 <ExternalLink size={15} aria-hidden="true" /></Link>
            </div>
          </div>
          <div className="user-guide-intro-index" aria-label="教程流程">
            <div><span>01</span><strong>准备客户端</strong></div>
            <div><span>02</span><strong>创建密钥</strong></div>
            <div><span>03</span><strong>导入 CC Switch</strong></div>
            <div><span>04</span><strong>Codex 开始用</strong></div>
          </div>
        </section>

        <details className="user-guide-mobile-toc" open={mobileTocOpen} onToggle={event => setMobileTocOpen(event.currentTarget.open)}>
          <summary>本页内容 <ChevronDown size={18} aria-hidden="true" /></summary>
          <nav>{SECTION_GROUPS.flatMap(group => group.sections).map(section => <a key={section.id} className={activeSection === section.id ? 'is-active' : ''} href={`#${section.id}`} onClick={() => goToSection(section.id)}>{section.label}</a>)}</nav>
        </details>

        <div className="user-guide-layout user-guide-shell">
          <aside className="user-guide-toc" aria-label="章节目录">
            {SECTION_GROUPS.map(group => <div className="user-guide-toc-group" key={group.label}><p>{group.label}</p><nav>{group.sections.map(section => <a key={section.id} className={activeSection === section.id ? 'is-active' : ''} href={`#${section.id}`} onClick={() => goToSection(section.id)}>{section.label}</a>)}</nav></div>)}
          </aside>

          <article className="user-guide-article">
            <section id="prepare" className="user-guide-section">
              <Step number="准备" title="开始前，你只需要准备这些" />
              <p>这套教程按 <strong>CC Switch + Codex</strong> 编写。如果你只想直接调用 API，可以跳到最后的“API 调用（可选）”。</p>
              <dl className="user-guide-concepts">
                <div><dt>一个 {systemName} 账号</dt><dd>用来登录控制台、查看 API Keys 和核对用量。</dd></div>
                <div><dt>一个调用客户端</dt><dd>本教程使用 Codex，也可以把同样的 Provider 信息交给其他兼容客户端。</dd></div>
                <div><dt>一枚自己的 API Key</dt><dd>创建后绑定可用分组，再由 CC Switch 导入到 Codex。</dd></div>
              </dl>
              <Notice tone="success"><strong>完成标志：</strong>Codex 能正常回复，并且用量页面出现本次请求。</Notice>
            </section>

            <section id="step-1" className="user-guide-section">
              <Step number="第 1 步" title="先把工具装好" />
              <h3>安装 Codex 和 CC Switch</h3>
              <ol>
                <li>安装 Codex，并确认终端中可以打开它。</li>
                <li>从 <a className="user-guide-inline-link" href={CC_SWITCH_DOWNLOAD_URL} target="_blank" rel="noreferrer" onClick={() => trackFeatureClick('user-guide', 'download-cc-switch')}>CC Switch 官方发布页 <ExternalLink size={14} aria-hidden="true" /></a> 下载并安装 CC Switch。</li>
                <li>确认两个程序都能打开；本教程会让 CC Switch 负责写入 Codex 配置。</li>
              </ol>
              <Notice>只调用 API 的开发者可以跳过这一步，直接阅读“API 调用（可选）”。</Notice>
            </section>

            <section id="step-2" className="user-guide-section">
              <Step number="第 2 步" title="进入你的控制台" />
              <h3>注册或登录 {systemName}</h3>
              <p>打开 {systemName} 控制台，完成登录或注册。登录后，在左侧菜单或页面中找到 <strong>API Keys / API 密钥</strong>。</p>
              <ScreenshotPlaceholder {...screenshot('console-home')} />
              <Notice tone="warning">如果看不到 API Keys，先确认你进入的是用户控制台，并联系管理员确认账号已开通 API 权限。</Notice>
            </section>

            <section id="step-3" className="user-guide-section">
              <Step number="第 3 步" title="创建一枚专用密钥" />
              <h3>创建 API Key，并马上保存</h3>
              <ol>
                <li>进入 <strong>API Keys</strong> 页面。</li>
                <li>点击“创建密钥”或“Create API Key”。</li>
                <li>填写用途名称，例如 <code>codex-mac</code>、<code>开发测试</code>。</li>
                <li>选择要使用的分组，然后创建。</li>
              </ol>
              <ScreenshotPlaceholder {...screenshot('api-keys')} />
              <ScreenshotPlaceholder {...screenshot('create-key')} />
              <h3>创建后需要换分组？</h3>
              <p>回到 API Keys 列表，点击目标 Key 当前显示的分组名称，选择新的可用分组并等待保存完成。切换后，模型和计费路线可能变化；重新导入 CC Switch 前先确认列表中的分组已经更新。</p>
              <Notice tone="warning"><strong>API Key 只显示一次。</strong>创建后立即复制到密码管理器或安全的本地配置中。不要发到群里、截图、Git、公开 issue 或聊天记录；建议每台设备、每个用途单独创建。</Notice>
            </section>

            <section id="step-4" className="user-guide-section">
              <Step number="第 4 步" title="把配置交给 CC Switch" />
              <h3>导入 Provider，先不用手动填模型</h3>
              <p>优先使用控制台 API Key 列表中的“导入到 CC Switch”按钮。它会把地址和密钥带入 CC Switch，减少手动输入错误。</p>
              <ol>
                <li>回到 API Key 列表，找到刚创建的 Key，点击“导入到 CC Switch”。</li>
                <li>浏览器询问是否打开 CC Switch 时选择允许。</li>
                <li>在 CC Switch 中确认应用为 <strong>Codex</strong>，命名并保存 Provider。</li>
              </ol>
              <ScreenshotPlaceholder {...screenshot('cc-switch-import')} />
              <details className="user-guide-details">
                <summary>导入按钮不可用时，手动填写这些值 <ChevronDown size={17} aria-hidden="true" /></summary>
                <CodeBlock id="manual-provider" label="CC Switch · Codex Provider" code={code.manualProvider} onCopy={onCopy} />
              </details>
              <Notice>Codex Base URL 使用 <code>{baseURL}</code>，不要在末尾添加 <code>/v1</code>。导入路线通常不需要新手额外填写模型；如果 CC Switch 要求选择模型，再从平台的模型列表中复制完整模型 ID。</Notice>
            </section>

            <section id="step-5" className="user-guide-section">
              <Step number="第 5 步" title="启用刚导入的配置" />
              <h3>在 CCSwitch 里点击启用</h3>
              <ol>
                <li>找到刚导入的 {systemName} Provider。</li>
                <li>点击“启用”或切换到这张配置卡片。</li>
                <li>确认状态显示“使用中”或同等的启用状态。</li>
              </ol>
              <ScreenshotPlaceholder {...screenshot('cc-switch-enabled')} />
              <Notice tone="warning">不要在启用前重复新建第二份配置。若列表中已有同名 Provider，先检查它的 Base URL 和 API Key，再决定是否更新。</Notice>
            </section>

            <section id="step-6" className="user-guide-section">
              <Step number="第 6 步" title="回到 Codex" />
              <h3>打开 Codex，输入 <code>hi</code></h3>
              <p>如果 Codex 在 CC Switch 配置前已经打开，请先完全关闭，再重新打开，让新配置生效。</p>
              <ol>
                <li>打开 Codex。</li>
                <li>第一次只发送一条短消息：<code>hi</code>。</li>
                <li>看到正常回复，就说明 Codex 已经接入。</li>
              </ol>
              <Notice tone="success">第一次验证只发短消息即可。不要一开始就发送长文档或开启复杂任务，这样更容易判断是配置问题还是请求内容问题。</Notice>
            </section>

            <section id="step-7" className="user-guide-section">
              <Step number="第 7 步" title="确认这次调用" />
              <h3>回控制台看用量</h3>
              <ol>
                <li>确认 Codex 已经收到正常回复。</li>
                <li>打开控制台的使用记录或用量页面。</li>
                <li>确认出现本次调用、使用的模型和消耗。</li>
              </ol>
              <ScreenshotPlaceholder {...screenshot('codex-usage')} />
              <div className="user-guide-finish">
                <h3>你已经跑通了 {systemName}</h3>
                <p>以后换模型或换客户端，只需要重新检查三项：Base URL、API Key、Model。</p>
                <div><Link to="/client-docs?client=codex" onClick={() => trackFeatureClick('user-guide', 'finish-codex-docs')}>查看 Codex 详细配置 <ArrowRight size={16} aria-hidden="true" /></Link></div>
              </div>
            </section>

            <section id="optional-api" className="user-guide-section">
              <Step number="可选" title="开发者可选 · 不走 CC Switch 时再看" />
              <h3>需要直接调用 API？</h3>
              <p>如果你使用的是自己的程序或 SDK，可以跳过 CC Switch。先用模型列表确认当前分组能看到哪些模型，再按 API 文档发起请求。</p>
              <ul>
                <li><code>GET /v1/models</code>：查询可用模型。</li>
                <li><code>POST /v1/responses</code>：发送一次 Responses 请求。</li>
              </ul>
              <CodeBlock id="models" label="查询模型列表" code={code.models} onCopy={onCopy} />
              <CodeBlock id="response" label="发送最小 Responses 请求" code={code.response} onCopy={onCopy} />
              <CodeBlock id="python" label="Python SDK" code={code.python} onCopy={onCopy} />
            </section>

            <section id="faq" className="user-guide-section">
              <Step number="排查" title="常见问题：先看状态码" />
              <p>遇到问题时，先记录状态码、请求路径、客户端和模型 ID。排查信息中不要包含完整 API Key、密码或 Cookie。</p>
              <div className="user-guide-errors">
                <ErrorRow code="401" text="API Key 缺失或无效。重新复制密钥，确认 CC Switch 的 Provider 已启用，并检查 Base URL 是否正确。" />
                <ErrorRow code="404" text="找不到 chat/completions 时，优先使用 /v1/responses，并确认 Codex 的 Base URL 是当前站点根地址。" />
                <ErrorRow code="200" text="有响应但模型不可用。回控制台重新请求 /v1/models，并把当前分组支持的模型 ID 更新到 CC Switch。" />
                <ErrorRow code="—" text="请求卡住或超时。先用短文本测试，检查流式设置，确认 Codex Base URL 未附加 /v1，再重启 Codex。" />
                <ErrorRow code="↗" text="CC Switch 导入后 Codex 没反应。检查 Provider 是否启用、Base URL 是否为当前站点根地址，并完全重启 Codex。" />
              </div>
              <Faq title="为什么看不到可用分组？">账号可能没有对应订阅、余额或管理员授权。先回到 API Key 创建页面确认可选分组，再联系平台管理员。</Faq>
              <Faq title="为什么导入后还要手动选模型？">不同分组支持的模型不一样。打开 /v1/models，复制返回结果中的完整 id，再填入 CC Switch，不要使用显示名称。</Faq>
              <Faq title="请求成功，为什么用量页面还没有记录？">用量统计可能有短暂延迟。等待几分钟再刷新，不要因为页面暂未更新而连续发送大量重复请求。</Faq>
            </section>

            <section id="security" className="user-guide-section">
              <Step number="安全" title="API Key 安全：三条底线" />
              <ul>
                <li><strong>不要写进截图：</strong>补图、教程、工单和演示都要遮盖完整 Key。</li>
                <li><strong>不要提交 Git：</strong>不要把 Key 写进源码、配置文件、日志或公开 issue。</li>
                <li><strong>泄露后立即撤销：</strong>停用旧 Key，创建新 Key，并检查最近的用量记录。</li>
              </ul>
              <div className="user-guide-finish">
                <p className="user-guide-kicker">CHAPTER 01 COMPLETE</p>
                <h3>下一章可以继续看什么？</h3>
                <p>余额与计费、不同客户端配置、流式响应、图像请求，以及更完整的故障排查。</p>
                <div><Link to="/api-docs" onClick={() => trackFeatureClick('user-guide', 'finish-api-docs')}>打开 API 文档 <ArrowRight size={16} aria-hidden="true" /></Link><Link to="/client-docs" onClick={() => trackFeatureClick('user-guide', 'finish-client-docs')}>选择其他客户端 <ArrowRight size={16} aria-hidden="true" /></Link></div>
              </div>
            </section>
          </article>

          <aside className="user-guide-reading-rail" aria-live="polite"><p>正在阅读</p><strong>{currentLabel}</strong><span>按顺序完成 7 步。遇到错误时，从状态码开始排查。</span></aside>
        </div>
      </main>

      <footer className="user-guide-footer"><div className="user-guide-shell"><span>{systemName} 新手教程 · 示例模型 ID 和 API Key 均为占位值。</span><a href="#user-guide-content" onClick={() => trackFeatureClick('user-guide', 'back-top')}>回到顶部 <ArrowUp size={15} aria-hidden="true" /></a></div></footer>
    </div>
  )
}

function Step({ number, title }: { number: string; title: string }) {
  return <header className="user-guide-step-heading"><span>{number}</span><h2>{title}</h2></header>
}

function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warning' | 'success' }) {
  return <div className={`user-guide-notice is-${tone}`}>{children}</div>
}

function ErrorRow({ code, text }: { code: string; text: string }) {
  return <div><code>{code}</code><p>{text}</p></div>
}

function Faq({ title, children }: { title: string; children: ReactNode }) {
  return <details className="user-guide-faq"><summary>{title}<ChevronDown size={17} aria-hidden="true" /></summary><p>{children}</p></details>
}

function screenshot(id: string) {
  const item = SCREENSHOTS.find(entry => entry[0] === id)
  return { id, title: item?.[1] ?? '界面截图', hint: item?.[2] ?? '建议展示相关配置区域' }
}
