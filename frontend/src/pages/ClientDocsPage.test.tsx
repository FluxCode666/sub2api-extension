import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ClientDocsPage from './ClientDocsPage'
import { CLIENT_GUIDES } from '@/lib/client-guides'
import { apiClient } from '@/lib/api-client'

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
  window.localStorage.removeItem('aux-client-docs-theme')
  vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: {} })
  Element.prototype.scrollIntoView = vi.fn()
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.open = true })
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) { this.open = false })
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('ClientDocsPage', () => {
  it('links back to the public website from the top navigation', () => {
    renderPage()
    expect(screen.getByRole('link', { name: '返回官网' })).toHaveAttribute('href', '/sub2api-home')
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
    const first = renderPage('/client-docs?client=obsidian&theme=dark&embed=1')
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
    fireEvent.click(within(screen.getByRole('navigation', { name: '客户端目录' })).getByRole('button', { name: 'Codex' }))
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

  it('uses the configured system domain as the API base default without overriding an explicit URL', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: { systemDomain: 'https://gateway.example.com' } })
    const configured = renderPage('/client-docs?client=codex')
    await waitFor(() => expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.example.com'))
    configured.unmount()

    const explicit = renderPage('/client-docs?client=codex&api_base=https%3A%2F%2Fexplicit.example.com')
    await waitFor(() => expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://explicit.example.com'))
    explicit.unmount()
  })

  it('supports direct links, switching every client and browser history', async () => {
    renderPage('/client-docs?client=codex')
    expect(screen.getByRole('heading', { name: 'Codex 接入指南' })).toBeInTheDocument()
    const directory = screen.getByRole('navigation', { name: '客户端目录' })
    for (const client of CLIENT_GUIDES) {
      fireEvent.click(within(directory).getByRole('button', { name: client.name }))
      expect(screen.getByRole('heading', { name: `${client.name} 接入指南` })).toBeInTheDocument()
      for (const screenshot of Object.values(client.screenshots)) {
        const image = screen.getByRole('img', { name: screenshot.src ? screenshot.alt : `${client.name}：${screenshot.caption}（截图待补充）` })
        expect(image).toBeInTheDocument()
        if (screenshot.src) expect(image).toHaveAttribute('src', screenshot.src)
      }
      expect(screen.getByText('当前时间', { selector: 'code' })).toBeInTheDocument()
      expect(document.body.textContent).not.toContain('/status')
    }
    fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
    await screen.findByRole('heading', { name: `${CLIENT_GUIDES[CLIENT_GUIDES.length - 2].name} 接入指南` })
  })

  it('finds guides by client or plugin name, supports aliases and restores search focus', () => {
    renderPage('/client-docs?client=codex')
    const search = screen.getByRole('searchbox', { name: '搜索客户端' })
    const directory = screen.getByRole('navigation', { name: '客户端目录' })
    fireEvent.change(search, { target: { value: '  DSH  ' } })
    expect(within(directory).getAllByRole('button')).toHaveLength(1)
    fireEvent.click(within(directory).getByRole('button', { name: 'DeepSeek Harness' }))
    expect(screen.getByRole('heading', { level: 1, name: 'DeepSeek Harness 接入指南' })).toBeInTheDocument()
    expect(search).toHaveValue('')
    fireEvent.change(search, { target: { value: 'claudian' } })
    expect(within(directory).getAllByRole('button')).toHaveLength(1)
    expect(within(directory).getByRole('button', { name: 'Obsidian' })).toBeInTheDocument()
    fireEvent.change(search, { target: { value: 'no-such-client' } })
    expect(screen.getByText('未找到匹配的客户端')).toBeInTheDocument()
    expect(within(directory).queryAllByRole('button')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '显示全部客户端' }))
    expect(within(directory).getAllByRole('button')).toHaveLength(CLIENT_GUIDES.length)
    expect(search).toHaveFocus()
  })

  it('switches clients from the mobile selector while preserving configuration and links', () => {
    renderPage('/client-docs?client=codex&theme=dark&embed=1&api_base=https%3A%2F%2Fgateway.test')
    const selector = screen.getByRole('combobox', { name: '选择客户端' })
    expect(within(selector).getAllByRole('option')).toHaveLength(CLIENT_GUIDES.length)
    fireEvent.change(selector, { target: { value: 'paseo' } })
    expect(screen.getByRole('heading', { level: 1, name: 'Paseo 接入指南' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '查看 Codex 接入指南' }).getAttribute('href')).toContain('api_base=https%3A%2F%2Fgateway.test')
    const footerLink = within(screen.getByRole('navigation', { name: '相关文档' })).getByRole('link', { name: 'API 参考' })
    expect(footerLink.getAttribute('href')).toContain('theme=dark')
    expect(footerLink.getAttribute('href')).toContain('embed=1')
    fireEvent.change(selector, { target: { value: 'codex' } })
    expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.test')
  })

  it('prevents duplicate pending copies and ignores completion after the displayed config changes', async () => {
    let completeCopy!: () => void
    vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise<void>(resolve => { completeCopy = resolve }))
    renderPage('/client-docs?client=codex')
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
    const directory = screen.getByRole('navigation', { name: '客户端目录' })
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
    fireEvent.click(within(directory).getByRole('button', { name: 'Paseo' }))
    expect(screen.getByRole('link', { name: '下载 Paseo' })).toHaveAttribute('href', 'https://paseo.sh/download')
    expect(screen.getByRole('link', { name: '查看 Codex 接入指南' }).getAttribute('href')).toContain('client=codex')
    expect(document.querySelector('#install code')).not.toBeInTheDocument()
  })

  it('generates copyable config from the address and model while retaining each client model', async () => {
    renderPage('/client-docs?client=pi&api_base=https%3A%2F%2Fgateway.test%2Fv1%2F')
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'custom-model' } })
    fireEvent.click(screen.getByRole('button', { name: '复制~/.pi/agent/models.json' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const value = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(JSON.parse(value).providers.gateway).toMatchObject({ baseUrl: 'https://gateway.test/v1', models: [{ id: 'custom-model' }] })
    const directory = screen.getByRole('navigation', { name: '客户端目录' })
    fireEvent.click(within(directory).getByRole('button', { name: 'Codex' }))
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
      expect(screen.getByLabelText('API 基础地址')).toHaveValue('https://gateway.test/v1')
      fireEvent.click(screen.getByRole('button', { name: '浏览器后退' }))
      expect(screen.getByRole('heading', { name: 'Paseo 接入指南' })).toBeInTheDocument()
    }
    expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument()
    expect(document.querySelector('#configure code')).not.toBeInTheDocument()
    expect(document.querySelector('.client-config-error')).not.toBeInTheDocument()
    expect(screen.getByText('当前时间', { selector: 'code' })).toBeInTheDocument()
  })

  it('switches shell commands with keyboard accessible platform tabs', () => {
    renderPage()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'macOS / Linux' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Windows PowerShell' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Windows PowerShell' })).toHaveFocus()
    expect(screen.getByText(/\$env:ANTHROPIC_BASE_URL/)).toBeInTheDocument()
    expect(screen.getByText('irm https://claude.ai/install.ps1 | iex')).toBeInTheDocument()
  })

  it('provides a separate copyable Codex auth.json for API key authentication', async () => {
    renderPage('/client-docs?client=codex')
    fireEvent.click(screen.getByRole('button', { name: '复制~/.codex/auth.json' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    expect(JSON.parse(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0])).toEqual({ OPENAI_API_KEY: 'sk-YOUR_API_KEY' })
    expect(screen.getByText(/cli_auth_credentials_store = "file"/, { selector: 'code' })).toHaveTextContent('requires_openai_auth = true')
    expect(screen.getByText('codex', { selector: 'code' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('GATEWAY_API_KEY')
  })

  it('blocks invalid config instead of copying stale values', () => {
    renderPage('/client-docs?client=codex')
    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://gateway.test/v1/responses' } })
    expect(screen.getByLabelText('API 基础地址')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('button', { name: '复制~/.codex/config.toml' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('API 基础地址'), { target: { value: 'https://gateway.test' } })
    fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: '   ' } })
    expect(screen.queryByRole('button', { name: '复制~/.codex/config.toml' })).not.toBeInTheDocument()
  })

  it('offers manual copying when the clipboard is unavailable', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('blocked'))
    renderPage('/client-docs?client=codex')
    fireEvent.click(screen.getByRole('button', { name: '复制~/.codex/config.toml' }))
    await screen.findByText('自动复制不可用，代码已选中，请按 Ctrl+C 或 ⌘C 复制。')
    expect(window.getSelection()?.toString()).toContain('wire_api = "responses"')
  })

  it('preserves presentation parameters without forwarding credentials to documentation links', () => {
    renderPage('/client-docs?client=unknown&embed=1&theme=dark&token=private-token&api_base=https%3A%2F%2Fgateway.test')
    expect(screen.getByRole('heading', { name: 'Claude Code 接入指南' })).toBeInTheDocument()
    const link = screen.getByRole('link', { name: '查看 API 文档' })
    expect(link.getAttribute('href')).toContain('embed=1')
    expect(link.getAttribute('href')).toContain('theme=dark')
    expect(link.getAttribute('href')).not.toContain('token')
    expect(document.querySelector('.client-docs')).toHaveClass('client-docs--embedded')
    expect(document.body.textContent).not.toContain('private-token')
  })

  it('shows a fallback when a supplied screenshot fails to load', () => {
    const image = CLIENT_GUIDES[0].screenshots.configure
    const previous = image.src
    image.src = 'https://assets.example.com/claude-config.png'
    try {
      renderPage()
      fireEvent.error(screen.getByRole('img', { name: image.alt }))
      expect(screen.getByRole('img', { name: `Claude Code：${image.caption}（截图待补充）` })).toBeInTheDocument()
    } finally {
      image.src = previous
    }
  })
})
