import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientDocsPage from './ClientDocsPage'
import { CLIENT_GUIDES } from '@/lib/client-guides'
import { apiClient } from '@/lib/api-client'
import { trackFeatureClick } from '@/lib/telemetry-sdk'

const HIDDEN_CLIENT_IDS = new Set(['grok-build', 'gemini-cli', 'vscode-codex', 'vscode-claude', 'openai-compatible', 'ide-plugins'])
const DIRECTORY_GUIDES = CLIENT_GUIDES.filter(client => !HIDDEN_CLIENT_IDS.has(client.id))

vi.mock('@gsap/react', () => ({ useGSAP: vi.fn() }))
vi.mock('gsap', () => ({ default: { registerPlugin: vi.fn() } }))
vi.mock('@/lib/telemetry-sdk', () => ({ trackFeatureClick: vi.fn() }))
vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn() } }))

function BackButton() {
  const navigate = useNavigate()
  return <button onClick={() => navigate(-1)}>浏览器后退</button>
}

function renderPage(entry = '/client-docs') {
  return render(<MemoryRouter initialEntries={[entry]}><ClientDocsPage /><BackButton /></MemoryRouter>)
}

function mockSystemTheme(initialDark: boolean) {
  let dark = initialDark
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    get matches() { return dark },
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  })))
  return {
    listeners,
    change(nextDark: boolean) { act(() => { dark = nextDark; listeners.forEach(listener => listener()) }) },
  }
}

beforeEach(() => {
  vi.mocked(trackFeatureClick).mockClear()
  window.localStorage.removeItem('aux-client-docs-theme')
  vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {} })
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ClientDocsPage', () => {
  it('tracks guide actions once across desktop, mobile and keyboard controls', () => {
    renderPage('/client-docs?client=claude-code&embed=1')
    expect(trackFeatureClick).not.toHaveBeenCalled()

    fireEvent.click(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '配置连接' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: '当前指南章节' })).getByRole('link', { name: '安装客户端与 CC Switch' }))
    expect(screen.queryByText('已安装客户端？')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '直接配置' })).not.toBeInTheDocument()
    const windowsTab = screen.getByRole('tab', { name: 'Windows' })
    expect(within(document.querySelector('#install') as HTMLElement).getByRole('tablist', { name: '操作系统' })).toContainElement(windowsTab)
    fireEvent.mouseDown(windowsTab, { button: 0 })
    fireEvent.mouseDown(windowsTab, { button: 0 })
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'macOS / Linux' }), { button: 0 })

    expect(vi.mocked(trackFeatureClick).mock.calls).toEqual([
      ['client-docs', 'section-claude-code-cc-switch-configure'],
      ['client-docs', 'section-claude-code-cc-switch-install'],
      ['client-docs', 'platform-claude-code-windows'],
      ['client-docs', 'platform-claude-code-unix'],
    ])
    expect(screen.getByRole('tab', { name: 'macOS / Linux' })).toHaveAttribute('aria-selected', 'true')
  })

  it('tracks downloads without collecting input or illustration contents', () => {
    renderPage('/client-docs?client=claude-desktop&token=private-token&api_base=https%3A%2F%2Fprivate-gateway.test')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'private-model' } })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'private-search' } })
    expect(trackFeatureClick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('link', { name: '下载 Claude Desktop' }))
    fireEvent.click(screen.getByRole('link', { name: '官方文档' }))
    const config = screen.getByRole('region', { name: 'CC Switch · Claude Desktop 配置' })
    fireEvent.click(within(config).getByRole('link', { name: '下载 CC Switch' }))
    fireEvent.click(within(config).getByRole('link', { name: '配置说明' }))
    expect(vi.mocked(trackFeatureClick).mock.calls).toEqual([
      ['client-docs', 'open-claude-desktop-install'],
      ['client-docs', 'open-claude-desktop-official'],
      ['client-docs', 'open-cc-switch-claude-desktop-download'],
      ['client-docs', 'open-cc-switch-claude-desktop-docs'],
    ])

    const diagram = screen.getByRole('figure', { name: 'claude-desktop 界面操作示意' })
    expect(diagram).toHaveTextContent('private-model')
    expect(diagram.querySelector('img')).not.toBeInTheDocument()
    expect(trackFeatureClick).toHaveBeenCalledTimes(4)
    expect(JSON.stringify(vi.mocked(trackFeatureClick).mock.calls)).not.toContain('private-')
  })

  it('tracks prerequisite guide links and cross-document navigation', () => {
    renderPage('/client-docs?client=paseo')
    fireEvent.click(screen.getAllByRole('link', { name: '查看 Codex 接入指南' })[0])
    expect(vi.mocked(trackFeatureClick).mock.calls).toEqual([['client-docs', 'select-codex']])
    expect(screen.getByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: '查看 API 文档' }))
    expect(trackFeatureClick).toHaveBeenLastCalledWith('client-docs', 'open-api-docs')
  })

  it('counts a successful configuration copy without collecting its contents', async () => {
    renderPage('/client-docs?client=codex&method=manual&api_base=https%3A%2F%2Fprivate-gateway.test')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'private-model' } })
    fireEvent.click(screen.getByRole('button', { name: '复制~/.codex/config.toml' }))
    await waitFor(() => expect(vi.mocked(trackFeatureClick).mock.calls).toEqual([['client-docs', 'copy-codex-config']]))
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('private-model'))
  })

  it('links back to the public website from the top navigation', () => {
    renderPage()
    expect(screen.getByRole('link', { name: '返回官网' })).toHaveAttribute('href', `${window.location.origin}/aux/sub2api-home`)
    expect(screen.getByRole('link', { name: '返回官网' })).toHaveAttribute('target', '_top')
  })

  it('uses the ToB homepage for every website link when the system is positioned for ToB', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { systemPosition: 'tob' } })

    renderPage()

    await waitFor(() => expect(screen.getByRole('link', { name: '返回官网' })).toHaveAttribute('href', `${window.location.origin}/aux/tob-home`))
    const footer = screen.getByRole('contentinfo')
    expect(within(footer).getByRole('link', { name: /API 参考/ })).toBeInTheDocument()
  })

  it('follows system appearance by default and reacts to live system changes', () => {
    const system = mockSystemTheme(true)
    const { unmount } = renderPage()
    expect(screen.getByRole('combobox', { name: '外观主题' })).toHaveValue('system')
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'dark')
    system.change(false)
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'light')
    unmount()
    expect(system.listeners.size).toBe(0)
  })

  it('honors URL themes, remembers manual choices and can resume following the system', () => {
    const system = mockSystemTheme(true)
    window.localStorage.setItem('aux-client-docs-theme', 'light')
    const first = renderPage('/client-docs?client=obsidian&theme=dark')
    expect(screen.getByRole('combobox', { name: '外观主题' })).toHaveValue('dark')
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'dark')
    expect(window.localStorage.getItem('aux-client-docs-theme')).toBe('light')
    fireEvent.change(screen.getByRole('combobox', { name: '外观主题' }), { target: { value: 'light' } })
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'light')
    expect(screen.getByRole('link', { name: '查看 API 文档' }).getAttribute('href')).toContain('theme=light')
    expect(window.localStorage.getItem('aux-client-docs-theme')).toBe('light')
    first.unmount()

    renderPage('/client-docs?client=obsidian')
    expect(screen.getByRole('combobox', { name: '外观主题' })).toHaveValue('light')
    system.change(false)
    system.change(true)
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'light')
    fireEvent.change(screen.getByRole('combobox', { name: '外观主题' }), { target: { value: 'system' } })
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'dark')
    system.change(false)
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'light')
    fireEvent.click(within(screen.getByRole('navigation', { name: '接入目录' })).getByRole('button', { name: 'Codex' }))
    expect(screen.getByRole('combobox', { name: '外观主题' })).toHaveValue('system')
  })

  it('keeps theme switching usable when browser storage is unavailable', () => {
    mockSystemTheme(true)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    renderPage('/client-docs?theme=unknown')
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'dark')
    fireEvent.change(screen.getByRole('combobox', { name: '外观主题' }), { target: { value: 'light' } })
    expect(document.querySelector('.client-docs')).toHaveAttribute('data-theme', 'light')
  })

  it('uses the current site origin as the API base default without overriding an explicit URL', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { systemDomain: 'https://gateway.example.com' } })
    const configured = renderPage('/client-docs?client=codex&method=manual')
    await waitFor(() => expect(screen.getByLabelText('API 基础地址')).toHaveValue(window.location.origin))
    expect(screen.getByText(/base_url =/, { selector: 'code' })).toHaveTextContent(`base_url = "${window.location.origin}"`)
    expect(screen.getByText(/base_url =/, { selector: 'code' })).not.toHaveTextContent(`${window.location.origin}/v1`)
    expect(screen.getByText(/Codex 的 base_url/)).toHaveTextContent('均不加 /v1')
    configured.unmount()

    const explicit = renderPage('/client-docs?client=codex&method=manual&api_base=https%3A%2F%2Fexplicit.example.com')
    await waitFor(() => expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://explicit.example.com'))
    explicit.unmount()
  })

  it('keeps a same-origin Sub2API console path unchanged', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { consoleHref: '/dashboard' } })

    renderPage()

    const consoleLink = await screen.findByRole('link', { name: '控制台' })
    await waitFor(() => expect(consoleLink).toHaveAttribute('href', `${window.location.origin}/dashboard`))
    expect(consoleLink).toHaveAttribute('target', '_top')
  })

  it('maps an external console URL to the current browser origin', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { consoleHref: 'https://console.example.com/dashboard?tab=home' } })

    renderPage()

    const consoleLink = await screen.findByRole('link', { name: '控制台' })
    await waitFor(() => expect(consoleLink).toHaveAttribute('href', `${window.location.origin}/dashboard?tab=home`))
    expect(consoleLink).toHaveAttribute('target', '_top')
  })

  it('uses the configured site name in the copyright footer', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { siteName: '示例平台' } })
    renderPage('/client-docs?client=codex')
    await waitFor(() => expect(screen.getByText('© 2026 示例平台. All rights reserved.')).toBeInTheDocument())
  })

  it('supports direct links, switching every client and browser history', async () => {
    renderPage('/client-docs?client=codex&method=manual')
    expect(screen.getByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
    const directory = screen.getByRole('navigation', { name: '接入目录' })
    expect(within(directory).getAllByRole('button')).toHaveLength(DIRECTORY_GUIDES.length)
    for (const client of DIRECTORY_GUIDES) {
      expect(within(directory).getByRole('button', { name: client.name })).toBeInTheDocument()
    }
    for (const client of DIRECTORY_GUIDES) {
      const search = screen.getByRole('searchbox', { name: '搜索客户端' })
      fireEvent.change(search, { target: { value: client.id } })
      fireEvent.click(within(directory).getByRole('button', { name: client.name }))
      if (screen.queryByRole('tab', { name: '手动配置' })) fireEvent.mouseDown(screen.getByRole('tab', { name: '手动配置' }), { button: 0 })
      expect(screen.getByRole('heading', { name: `${client.name} 接入指南` })).toBeInTheDocument()
      if (client.id === 'paseo' || client.id === 'zcode' || client.id === 'deepseek-harness') {
        expect(screen.getByRole('figure', { name: `${client.id} 界面操作示意` })).toBeInTheDocument()
      }
      if (client.screenshots) {
        for (const screenshot of Object.values(client.screenshots)) {
          const imageName = screenshot.src ? screenshot.alt : `${client.name}：${screenshot.caption}（截图待补充）`
          expect(screen.getByRole('img', { name: imageName })).toBeInTheDocument()
        }
      }
      expect(screen.getByText('当前时间', { selector: 'code' })).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('/status')
    }
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    await screen.findByRole('heading', { name: `${DIRECTORY_GUIDES[DIRECTORY_GUIDES.length - 2].name} 接入指南` })
  })

  it('searches only listed guides, supports aliases and restores search focus', () => {
    renderPage('/client-docs?client=codex')
    const search = screen.getByRole('searchbox', { name: '搜索客户端' })
    const directory = screen.getByRole('navigation', { name: '接入目录' })
    fireEvent.change(search, { target: { value: '  DSH  ' } })
    expect(within(directory).getByRole('button', { name: 'DeepSeek Harness' })).toBeInTheDocument()
    expect(within(directory).queryByRole('button', { name: 'Claude Code' })).not.toBeInTheDocument()
    fireEvent.click(within(directory).getByRole('button', { name: 'DeepSeek Harness' }))
    expect(screen.getByRole('heading', { level: 1, name: 'DeepSeek Harness 接入指南' })).toBeInTheDocument()
    expect(search).toHaveValue('')
    fireEvent.change(search, { target: { value: 'claudian' } })
    expect(within(directory).getAllByRole('button')).toHaveLength(1)
    expect(within(directory).getByRole('button', { name: 'Obsidian' })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'cursor' } })
    expect(within(directory).queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('未找到匹配的接入指南')).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'no-such-client' } })
    expect(screen.getByText('未找到匹配的接入指南')).toBeInTheDocument()
    expect(within(directory).queryAllByRole('button')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '显示全部指南' }))
    expect(within(directory).getAllByRole('button')).toHaveLength(DIRECTORY_GUIDES.length)
    for (const client of CLIENT_GUIDES.filter(client => HIDDEN_CLIENT_IDS.has(client.id))) {
      expect(within(directory).queryByRole('button', { name: client.name })).not.toBeInTheDocument()
    }
    expect(within(directory).queryByRole('button', { name: /CC Switch/ })).not.toBeInTheDocument()
    expect(search).toHaveFocus()
  })

  it('switches clients from the mobile selector while preserving configuration and links', () => {
    renderPage('/client-docs?client=codex&theme=dark&embed=1&api_base=https%3A%2F%2Fgateway.test')
    const selector = screen.getByRole('combobox', { name: '选择接入指南' })
    fireEvent.click(selector)
    expect(screen.getAllByRole('option')).toHaveLength(DIRECTORY_GUIDES.length)
    expect(screen.queryByRole('option', { name: 'Grok Build' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Gemini CLI' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: 'Paseo' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Paseo 接入指南' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看 Codex 接入指南' }).getAttribute('href')).toContain('api_base=https%3A%2F%2Fgateway.test')
    const footerLink = within(screen.getByRole('navigation', { name: '相关文档' })).getByRole('link', { name: 'API 参考' })
    expect(footerLink.getAttribute('href')).toContain('theme=dark')
    expect(footerLink.getAttribute('href')).toContain('embed=1')
    fireEvent.click(selector)
    fireEvent.click(screen.getByRole('option', { name: 'Codex' }))
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手动配置' }), { button: 0 })
    expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.test')
  })

  it('prevents duplicate pending copies and ignores completion after the displayed config changes', async () => {
    let completeCopy!: () => void
    vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>(resolve => { completeCopy = resolve }))
    renderPage('/client-docs?client=codex&method=manual')
    const button = screen.getByRole('button', { name: '复制~/.codex/config.toml' })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'updated-model' } })
    await act(async () => { completeCopy() })
    expect(button).toBeEnabled()
    expect(button).toHaveTextContent('复制')
    expect(button).not.toHaveTextContent('已复制')
    fireEvent.click(button)
    await waitFor(() => expect(button).toHaveTextContent('已复制'))
    expect(vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0]).toContain('updated-model')
  })

  it('guides desktop and plugin installation without inventing shell commands', () => {
    renderPage('/client-docs?client=zcode&api_base=https%3A%2F%2Fgateway.test&token=private-token')
    expect(screen.getByRole('link', { name: '下载 ZCode' })).toHaveAttribute('href', 'https://zcode.z.ai/cn')
    expect(screen.queryByRole('tablist', { name: '操作系统' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制启动并验证 ZCode' })).not.toBeInTheDocument()
    const directory = screen.getByRole('navigation', { name: '接入目录' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'Obsidian' } })
    fireEvent.click(within(directory).getByRole('button', { name: 'Obsidian' }))
    expect(screen.getByRole('link', { name: 'Claudian 插件页' })).toHaveAttribute('href', 'https://community.obsidian.md/plugins/realclaudian')
    expect(screen.getByText(/ANTHROPIC_BASE_URL=/, { selector: 'code' })).not.toHaveTextContent('export ')
    expect(screen.queryByRole('tablist', { name: '操作系统' })).not.toBeInTheDocument()
    expect(document.querySelector('#install code')).not.toBeInTheDocument()
    const claudeGuide = screen.getByRole('link', { name: '查看 Claude Code 接入指南' })
    expect(claudeGuide.getAttribute('href')).toContain('client=claude-code')
    expect(claudeGuide.getAttribute('href')).not.toContain('private-token')
    fireEvent.click(claudeGuide)
    expect(screen.getByRole('heading', { name: 'Claude Code 接入指南' })).toBeInTheDocument()
    expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.test')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'Paseo' } })
    fireEvent.click(within(directory).getByRole('button', { name: 'Paseo' }))
    expect(screen.getByRole('link', { name: '下载 Paseo' })).toHaveAttribute('href', 'https://paseo.sh/download')
    expect(screen.getByRole('link', { name: '查看 Codex 接入指南' }).getAttribute('href')).toContain('client=codex')
    expect(document.querySelector('#install code')).not.toBeInTheDocument()
  })

  it('generates copyable config from the address and model while retaining each client model', async () => {
    renderPage('/client-docs?client=pi&method=manual&api_base=https%3A%2F%2Fgateway.test%2Fv1%2F')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'custom-model' } })
    fireEvent.click(screen.getByRole('button', { name: '复制~/.pi/agent/models.json' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const value = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(JSON.parse(value).providers.gateway).toMatchObject({ baseUrl: 'https://gateway.test/v1', models: [{ id: 'custom-model' }] })
    const directory = screen.getByRole('navigation', { name: '接入目录' })
    fireEvent.click(within(directory).getByRole('button', { name: 'Codex' }))
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'Pi' } })
    fireEvent.click(within(directory).getByRole('button', { name: 'Pi' }))
    expect(screen.getByLabelText('模型名称')).toHaveValue('custom-model')
  })

  it('routes Paseo prerequisites to each supported guide while preserving gateway and display context', () => {
    renderPage('/client-docs?client=paseo&api_base=https%3A%2F%2Fgateway.test%2Fv1&embed=1&theme=dark&token=private-token')
    for (const [id, name] of [['claude-code', 'Claude Code'], ['codex', 'Codex'], ['pi', 'Pi'], ['hermes', 'Hermes']]) {
      const link = screen.getByRole('link', { name: `查看 ${name} 接入指南` })
      const params = new URL(link.getAttribute('href')!, 'https://docs.test').searchParams
      expect(params.get('client')).toBe(id)
      expect(params.get('api_base')).toBe('https://gateway.test')
      expect(params.get('embed')).toBe('1')
      expect(params.get('theme')).toBe('dark')
      expect(params.has('token')).toBe(false)
      fireEvent.click(link)
      expect(screen.getByRole('heading', { name: `${name} 接入指南` })).toBeInTheDocument()
      if (id === 'codex') {
        expect(screen.queryByLabelText('API 基础地址')).not.toBeInTheDocument()
        expect(screen.getAllByRole('figure')).toHaveLength(4)
      } else {
        expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.test/v1')
      }
      fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
      expect(screen.getByRole('heading', { name: 'Paseo 接入指南' })).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument()
    expect(document.querySelector('#configure code')).not.toBeInTheDocument()
    expect(document.querySelector('.client-config-error')).not.toBeInTheDocument()
    expect(screen.getByText('当前时间', { selector: 'code' })).toBeInTheDocument()
  })

  it('switches shell commands with keyboard accessible platform tabs', async () => {
    renderPage('/client-docs?client=claude-code&method=manual')
    act(() => { screen.getByRole('tab', { name: 'macOS / Linux' }).focus() })
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveFocus()
    expect(screen.getByText(/\$env:ANTHROPIC_BASE_URL/)).toBeInTheDocument()
    expect(screen.getByText('irm https://claude.ai/install.ps1 | iex')).toBeInTheDocument()
  })

  it('provides a separate copyable Codex auth.json for API key authentication', async () => {
    renderPage('/client-docs?client=codex&method=manual')
    fireEvent.click(screen.getByRole('button', { name: '复制~/.codex/auth.json' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0])).toEqual({ OPENAI_API_KEY: 'sk-YOUR_API_KEY' })
    expect(screen.getByText(/cli_auth_credentials_store = "file"/, { selector: 'code' })).toHaveTextContent('requires_openai_auth = true')
    expect(document.body.textContent).not.toContain('GATEWAY_API_KEY')
  })

  it.each([
    ['hermes', 'Hermes', 'https://gateway.test/proxy/v1'],
    ['pi', 'Pi', 'https://gateway.test/proxy/v1'],
  ])('keeps %s CC Switch parameters in sync with valid input and hides stale values', async (id, name, expectedBase) => {
    renderPage(`/client-docs?client=${id}&api_base=https%3A%2F%2Fgateway.test%2Fproxy%2Fv1%2F`)
    const quickConfig = screen.getByRole('region', { name: 'CC Switch 快捷配置' })
    expect(document.querySelector('#configure')).toContainElement(quickConfig)
    expect(within(quickConfig).getByRole('link', { name: '下载 CC Switch' })).toHaveAttribute('href', 'https://ccswitch.io/')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'custom-model' } })
    fireEvent.click(within(quickConfig).getByText('复制填写参数'))
    fireEvent.click(within(quickConfig).getByRole('button', { name: `复制${name} · CC Switch 填写参考` }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.lastCall![0]
    expect(copied.match(/接口地址\s+(\S+)/)?.[1]).toBe(expectedBase)
    expect(copied).toContain('custom-model')
    expect(copied).toContain('sk-YOUR_API_KEY')
    expect(copied).toContain(name)

    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://gateway.test/v1/responses' } })
    expect(within(quickConfig).queryByRole('button', { name: `复制${name} · CC Switch 填写参考` })).not.toBeInTheDocument()
    expect(within(quickConfig).queryByText(/custom-model/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://updated.test' } })
    fireEvent.click(within(quickConfig).getByText('复制填写参数'))
    expect(within(quickConfig).getByRole('button', { name: `复制${name} · CC Switch 填写参考` })).toBeEnabled()
    expect(quickConfig).toHaveTextContent('https://updated.test')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: ' ' } })
    expect(within(quickConfig).queryByRole('button', { name: `复制${name} · CC Switch 填写参考` })).not.toBeInTheDocument()
  })

  it.each([
    ['claude-code', 'Claude Code', 'https://gateway.test/proxy'],
    ['claude-desktop', 'Claude Desktop', 'https://gateway.test/proxy'],
    ['grok-build', 'Grok Build', 'https://gateway.test/proxy/v1'],
  ])('renders the in-page CC Switch method for %s with live parameters', async (id, name, expectedBase) => {
    renderPage(`/client-docs?method=cc-switch&client=${id}&api_base=https%3A%2F%2Fgateway.test%2Fproxy%2Fv1`)
    expect(screen.getByRole('heading', { name: `${name} 接入指南` })).toBeInTheDocument()
    if (id !== 'claude-desktop') expect(screen.getByRole('tab', { name: 'CC Switch（推荐）' })).toHaveAttribute('data-state', 'active')
    const config = screen.getByRole('region', { name: `CC Switch · ${name} 配置` })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'custom-model' } })
    fireEvent.click(within(config).getByText('复制填写参数'))
    fireEvent.click(within(config).getByRole('button', { name: `复制${name} · CC Switch 填写参考` }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.lastCall![0]
    expect(copied.match(/接口地址\s+(\S+)/)?.[1]).toBe(expectedBase)
    expect(copied).toContain('custom-model')
    if (id === 'claude-desktop') expect(config).toHaveTextContent('需要模型映射')
  })

  it('recommends CC Switch inside Codex with its own flow directory and switches to manual setup', async () => {
    const regular = renderPage('/client-docs?client=codex&api_base=https%3A%2F%2Fgateway.test')
    expect(screen.getByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'CC Switch（推荐）' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'CC Switch（推荐）' })).toHaveAttribute('aria-controls', 'client-method-panel')
    expect(screen.getByRole('tabpanel', { name: 'CC Switch（推荐）' })).toHaveAttribute('aria-labelledby', 'client-method-cc-switch')
    expect(screen.queryByRole('button', { name: '复制~/.codex/config.toml' })).not.toBeInTheDocument()

    const directory = screen.getByRole('navigation', { name: '接入目录' })
    expect(within(directory).getAllByRole('button')).toHaveLength(DIRECTORY_GUIDES.length)
    expect(within(directory).queryByRole('button', { name: /CC Switch/ })).not.toBeInTheDocument()
    const config = screen.getByRole('region', { name: 'CC Switch · Codex Desktop 配置' })
    expect(config).toHaveTextContent('OpenAI Responses')
    expect(config).toHaveTextContent('先在平台控制台的 API Key 管理页创建一个 API Key')
    expect(config).toHaveTextContent('在刚创建的 API Key 所在行点击「导入到 CCS」')
    expect(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '创建 API Key' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '导入到 CCS' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '确认导入' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '启用配置' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '本页内容' })).getByRole('link', { name: '重启并验证' })).toBeInTheDocument()
    const breadcrumb = document.querySelector('.client-breadcrumb')
    expect(breadcrumb).toHaveTextContent('客户端接入')
    expect(breadcrumb).toHaveTextContent('CC Switch')
    expect(within(config).getAllByRole('figure')).toHaveLength(4)
    expect(within(config).getByRole('figure', { name: 'Codex 操作示意：创建 API Key' })).toHaveTextContent('创建 API Key')
    expect(within(config).getByRole('heading', { level: 3, name: '重启 Codex 客户端' })).toBeInTheDocument()
    expect(config.querySelector('.codex-setup-text-step')).toHaveTextContent('重新打开 Codex Desktop')
    expect(screen.queryByLabelText('API 基础地址')).not.toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手动配置' }), { button: 0 })
    expect(screen.getByRole('tabpanel', { name: '手动配置' })).toHaveAttribute('aria-labelledby', 'client-method-manual')
    expect(screen.getByRole('button', { name: '复制~/.codex/config.toml' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'CC Switch · Codex Desktop 配置' })).not.toBeInTheDocument()
    expect(trackFeatureClick).toHaveBeenCalledWith('client-docs', 'method-codex-manual')
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    expect(screen.getByRole('tab', { name: 'CC Switch（推荐）' })).toHaveAttribute('data-state', 'active')
    regular.unmount()

    renderPage('/client-docs?method=cc-switch&client=codex&api_base=https%3A%2F%2Fdirect.test')
    expect(screen.getByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: '接入目录' })).getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('combobox', { name: '选择接入指南' })).toHaveTextContent('Codex')
    expect(screen.queryByRole('tab', { name: 'Codex CLI' })).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'CC Switch · Codex Desktop 配置' })).toHaveTextContent('导入到 CCS')
    expect(screen.getAllByRole('figure')).toHaveLength(4)
  })

  it('keeps Codex focused on the Desktop path for first-time users', () => {
    renderPage('/client-docs?client=codex&api_base=https%3A%2F%2Fgateway.test')

    expect(screen.queryByRole('tab', { name: 'Codex Desktop' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Codex CLI' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('适用客户端')).not.toBeInTheDocument()
    expect(screen.getAllByText(/无需安装 Codex CLI、Node\.js 或 npm/)).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: '准备接入信息' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '安装 Codex Desktop 与 CC Switch' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '准备接入信息' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '安装客户端与 CC Switch' })).not.toBeInTheDocument()
    expect(screen.queryByText('npm install -g @openai/codex')).not.toBeInTheDocument()
    expect(screen.queryByText('codex', { selector: '#verify code' })).not.toBeInTheDocument()
    const config = screen.getByRole('region', { name: 'CC Switch · Codex Desktop 配置' })
    expect(config).toBeInTheDocument()
    expect(within(config).getByRole('link', { name: '下载 CC Switch' })).toHaveAttribute('href', 'https://ccswitch.io/')
    expect(within(config).getByRole('link', { name: '下载 Codex Desktop' })).toHaveAttribute('href', 'https://openai.com/codex/')
    expect(within(config).queryByRole('link', { name: '配置说明' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('API 基础地址')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument()
    expect(within(config).getByRole('figure', { name: 'Codex 操作示意：创建 API Key' })).toHaveTextContent('①')
    expect(within(config).getByRole('heading', { level: 3, name: '重启 Codex 客户端' })).toBeInTheDocument()
    expect(config.querySelector('.codex-setup-text-step')).toHaveTextContent('重新打开 Codex Desktop')
    expect(screen.getByText('CC Switch · Codex Desktop 配置提示')).toBeInTheDocument()
  })

  it('keeps file-based Codex setup available as a manual fallback', () => {
    renderPage('/client-docs?client=codex')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手动配置' }), { button: 0 })

    expect(screen.getByLabelText('API 基础地址')).toBeInTheDocument()
    expect(screen.getByLabelText('模型名称')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制~/.codex/config.toml' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制~/.codex/auth.json' })).toBeInTheDocument()
    expect(screen.queryByRole('figure', { name: /Codex 操作示意/ })).not.toBeInTheDocument()
  })

  it('keeps Claude Desktop on its own CC Switch setup without offering a fake manual method', () => {
    renderPage('/client-docs?client=claude-desktop')
    expect(screen.getByRole('heading', { name: 'Claude Desktop 接入指南' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '下载 Claude Desktop' })).toHaveAttribute('href', 'https://claude.ai/download')
    expect(screen.getByLabelText('模型名称')).toHaveValue('claude-opus-5')
    expect(document.querySelector('#install code')).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '操作系统' })).not.toBeInTheDocument()
    expect(document.querySelector('#verify code')).toHaveTextContent('当前时间')
    expect(screen.queryByRole('heading', { name: '手动配置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '配置方式' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Claude Desktop 接入指南' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'CC Switch · Claude Desktop 配置' })).toHaveTextContent('需要模型映射')

    const directory = screen.getByRole('navigation', { name: '接入目录' })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'Pi' } })
    fireEvent.click(within(directory).getByRole('button', { name: 'Pi' }))
    expect(screen.getByText('pi', { selector: '#verify code' })).toBeInTheDocument()
    expect(document.querySelector('#verify')).not.toHaveTextContent('--provider gateway')
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索客户端' }), { target: { value: 'Paseo' } })
    fireEvent.click(within(directory).getByRole('button', { name: 'Paseo' }))
    expect(screen.queryByRole('region', { name: 'CC Switch 快捷配置' })).not.toBeInTheDocument()
  })

  it('shares Codex CC Switch setup with the VS Code / Cursor extension', () => {
    renderPage('/client-docs?client=vscode-codex')
    expect(screen.getByRole('tab', { name: 'CC Switch（推荐）' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('region', { name: 'CC Switch · IDE · Codex 配置' })).toHaveTextContent('OpenAI Responses')
    expect(document.querySelector('#verify')).toHaveTextContent('重载 VS Code 或 Cursor 窗口')
    fireEvent.mouseDown(screen.getByRole('tab', { name: '手动配置' }), { button: 0 })
    expect(screen.getByRole('button', { name: '复制~/.codex/config.toml' })).toBeInTheDocument()
  })

  it('covers other compatible clients and supplies a request example without real credentials', async () => {
    renderPage('/client-docs?client=openai-compatible&api_base=https%3A%2F%2Fgateway.test')
    expect(screen.getByText('OpenCode')).toBeInTheDocument()
    expect(screen.getByText('LangChain')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制Python 3 请求示例' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('https://gateway.test/v1/chat/completions')))
    expect(vi.mocked(navigator.clipboard.writeText).mock.lastCall?.[0]).toContain('Bearer sk-YOUR_API_KEY')
  })

  it('blocks invalid config instead of copying stale values', () => {
    renderPage('/client-docs?client=codex&method=manual')
    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://gateway.test/v1/responses' } })
    expect(screen.getByLabelText('API 基础地址')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('button', { name: '复制~/.codex/config.toml' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://gateway.test' } })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '   ' } })
    expect(screen.queryByRole('button', { name: '复制~/.codex/config.toml' })).not.toBeInTheDocument()
  })

  it('offers manual copying when the clipboard is unavailable', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('blocked'))
    renderPage('/client-docs?client=codex&method=manual')
    fireEvent.click(screen.getByRole('button', { name: '复制~/.codex/config.toml' }))
    await screen.findByText('自动复制不可用，代码已选中，请按 Ctrl+C 或 ⌘C 复制。')
    expect(window.getSelection()?.toString()).toContain('wire_api = "responses"')
    expect(trackFeatureClick).not.toHaveBeenCalled()
  })

  it('preserves presentation parameters without forwarding credentials to documentation links', () => {
    renderPage('/client-docs?client=unknown&embed=1&theme=dark&token=private-token&api_base=https%3A%2F%2Fgateway.test')
    expect(screen.getByRole('heading', { name: 'Claude Code 接入指南' })).toBeInTheDocument()
    const link = within(screen.getByRole('navigation', { name: '相关文档' })).getByRole('link', { name: 'API 参考' })
    expect(link.getAttribute('href')).toContain('embed=1')
    expect(link.getAttribute('href')).toContain('theme=dark')
    expect(link.getAttribute('href')).not.toContain('token')
    expect(document.querySelector('.client-docs')).toHaveClass('client-docs--embedded')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('private-token')
  })

  it.each([
    '/client-docs?embed=1',
    '/client-docs?ui_mode=embedded',
  ])('removes the top menu for embedded entry %s', (entry) => {
    renderPage(entry)

    expect(document.querySelector('.client-docs')).toHaveClass('client-docs--embedded')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '外观主题' })).not.toBeInTheDocument()
  })

  it('draws Paseo setup steps and keeps its original screenshot', () => {
    renderPage('/client-docs?client=paseo')
    const diagram = screen.getByRole('figure', { name: 'paseo 界面操作示意' })
    expect(diagram).toHaveTextContent('Settings → 当前主机 → Providers')
    expect(diagram).toHaveTextContent('启用提供方')
    expect(screen.getByRole('img', { name: 'Paseo 当前主机的 Providers 设置，Claude、Codex 与 Pi 显示可用，右侧开关已启用' })).toHaveAttribute('src', '/aux/client-docs/paseo/configure.png')
  })
})
