import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { toast } from 'sonner'
import { apiClient, AuxApiError } from '@/lib/api-client'
import { fetchHomepageConfig } from '@/lib/homepage'
import { trackFeatureClick } from '@/lib/telemetry-sdk'
import ClientImportPage from './ClientImportPage'

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiClient: { get: vi.fn() },
}))
vi.mock('@/lib/homepage', () => ({ fetchHomepageConfig: vi.fn() }))
vi.mock('@/lib/telemetry-sdk', () => ({ trackFeatureClick: vi.fn(), trackPageView: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }, Toaster: () => null }))

const key = {
  id: 3,
  key: 'sk-secret-client-import-test',
  name: '测试密钥',
  group_id: 5,
  status: 'active',
  expires_at: null,
  created_at: '2026-09-24T00:00:00Z',
  group: { name: 'Claude 主组', platform: 'anthropic' },
}

const ungroupedKey = { ...key, id: 4, key: 'sk-secret-ungrouped-key-test', name: '未分组密钥', group_id: null, group: undefined }

const keyModels = ['claude-sonnet-5', 'claude-opus-5', 'claude-haiku-5']

/** 按请求路径返回密钥列表或所选密钥的模型列表；multiModelClients 为 undefined 时模拟旧后端不返回该字段。 */
function mockAPI(keys: unknown[], models: unknown = keyModels, multiModelClients?: string[]) {
  vi.mocked(apiClient.get).mockImplementation(async (path: string) => {
    if (/^\/client-import\/keys\/\d+\/models$/.test(path)) {
      if (models instanceof Error) throw models
      return { code: 0, data: { items: models } }
    }
    return { code: 0, data: { items: keys, multi_model_clients: multiModelClients } }
  })
}

/** jsdom 的 Blob 不支持 text()，用 FileReader 读取下载内容。 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

beforeAll(() => {
  // Radix Select 在 jsdom 中需要的指针与滚动 API。
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn() })))
  mockAPI([key])
  vi.mocked(fetchHomepageConfig).mockResolvedValue({ siteName: '测试站点' } as Awaited<ReturnType<typeof fetchHomepageConfig>>)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('ClientImportPage', () => {
  it.each(['/client-import?embed=1', '/client-import?ui_mode=embedded'])('hides the top menu for embedded entry %s', async (entry) => {
    render(<MemoryRouter initialEntries={[entry]}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    expect(document.querySelector('.client-import-page')).toHaveClass('client-import-page--embedded')
    expect(screen.queryByRole('banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '查看接入文档' })).not.toBeInTheDocument()
  })

  it('provides confirmed deep links for both clients and masks the nested Chatbox API key', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    const ccSwitchLink = screen.getByRole('link', { name: '一键导入 CC Switch' })
    expect(ccSwitchLink).toHaveAttribute('target', '_blank')
    expect(ccSwitchLink).toHaveAttribute('rel', 'noopener noreferrer')
    await user.click(screen.getByRole('tab', { name: /Cherry \/ Chatbox/ }))

    const cherryLink = screen.getByRole('link', { name: '一键导入 Cherry Studio' })
    expect(cherryLink).toHaveAttribute('href', expect.stringMatching(/^cherrystudio:\/\/providers\/api-keys\?v=1&data=/))
    expect(cherryLink).toHaveAttribute('target', '_blank')
    expect(cherryLink).toHaveAttribute('rel', 'noopener noreferrer')
    expect(within(screen.getByLabelText('Cherry Studio 配置预览')).getByText(/••••/)).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Chatbox/ }))
    const chatboxLink = screen.getByRole('link', { name: '一键导入 Chatbox' })
    expect(chatboxLink).toHaveAttribute('href', expect.stringMatching(/^chatbox:\/\/provider\/import\?config=/))
    expect(chatboxLink).toHaveAttribute('target', '_blank')
    expect(chatboxLink).toHaveAttribute('rel', 'noopener noreferrer')
    const preview = screen.getByLabelText('Chatbox 配置预览')
    expect(preview).toHaveTextContent('apiKey')
    expect(preview).not.toHaveTextContent(key.key)
    expect(trackFeatureClick).toHaveBeenCalledWith('client-import', 'select-chatbox')

    await user.clear(screen.getByLabelText('API 基础地址'))
    expect(screen.queryByRole('link', { name: '一键导入 Chatbox' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '填写完整参数后继续' })).toBeDisabled()
  })

  it('offers ZCode and WorkBuddy configuration downloads with masked previews', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    expect(screen.getByRole('radio', { name: /WorkBuddy/ })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /ZCode/ }))
    expect(screen.getByRole('button', { name: '下载 ZCode 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('ZCode 配置预览')).not.toHaveTextContent(key.key)
    expect(screen.getByLabelText('ZCode 配置预览')).toHaveTextContent('anthropic-messages')

    await user.click(screen.getByRole('radio', { name: /WorkBuddy/ }))
    expect(screen.getByRole('button', { name: '下载 WorkBuddy 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('WorkBuddy 配置预览')).toHaveTextContent('availableModels')
    expect(screen.getByLabelText('WorkBuddy 配置预览')).not.toHaveTextContent(key.key)

    await user.click(screen.getByRole('radio', { name: /Pi/ }))
    expect(screen.getByRole('button', { name: '复制配置命令' })).toBeEnabled()
    await user.click(screen.getByRole('tab', { name: '手动配置' }))
    expect(screen.getByRole('button', { name: '下载 Pi 配置' })).toBeInTheDocument()
    const piPreview = screen.getByLabelText('Pi 配置预览')
    expect(piPreview).toHaveTextContent('openai-completions')
    expect(piPreview).toHaveTextContent('https://api.example.com/v1')
    expect(piPreview).not.toHaveTextContent(key.key)
    expect(screen.getByText(/CC Switch 暂不支持通过深度链接导入 Pi/)).toBeInTheDocument()
  })

  it('opens the native configuration of the current CC Switch client and downloads the full file', async () => {
    const user = userEvent.setup()
    const blobs: Blob[] = []
    const downloads: string[] = []
    const { createObjectURL, revokeObjectURL } = URL
    URL.createObjectURL = vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:client-config' })
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('button', { name: '一键配置命令' }))
    expect(screen.getByRole('tab', { name: '配置文件' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toHaveAttribute('aria-checked', 'true')
    await user.click(screen.getByRole('tab', { name: '手动配置' }))
    const preview = screen.getByLabelText('Claude Code 配置预览')
    expect(preview).toHaveTextContent('"ANTHROPIC_BASE_URL": "https://api.example.com"')
    expect(preview).toHaveTextContent('"ANTHROPIC_MODEL": "claude-opus-5"')
    expect(preview).not.toHaveTextContent(key.key)
    expect(screen.getByText('~/.claude/settings.json', { selector: 'code' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '下载 Claude Code 配置' }))
    expect(downloads).toEqual(['settings.json'])
    expect(JSON.parse(await readBlob(blobs[0]))).toEqual({ env: { ANTHROPIC_BASE_URL: 'https://api.example.com', ANTHROPIC_AUTH_TOKEN: key.key, ANTHROPIC_MODEL: 'claude-opus-5' } })
    expect(toast.success).toHaveBeenCalledWith('settings.json 已下载', { description: expect.stringContaining('~/.claude/settings.json') })
    expect(trackFeatureClick).toHaveBeenCalledWith('client-import', 'download-claude-code')
    click.mockRestore()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
  })

  it('previews each Codex file separately and lists other native clients', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    for (const name of [/Gemini CLI/, /Grok Build/, /OpenCode/, /OpenClaw/]) expect(screen.getByRole('radio', { name })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Claude Desktop/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Hermes/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Codex/ }))
    await user.click(screen.getByRole('tab', { name: '手动配置' }))
    const files = screen.getByRole('tablist', { name: 'Codex 配置文件' })
    expect(within(files).getByRole('tab', { name: 'config.toml' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Codex 配置预览')).toHaveTextContent('base_url = "https://api.example.com/v1"')
    expect(screen.getByLabelText('Codex 配置预览')).toHaveTextContent('wire_api = "responses"')
    expect(screen.getByRole('button', { name: '复制 TOML' })).toBeEnabled()

    await user.click(within(files).getByRole('tab', { name: 'auth.json' }))
    expect(screen.getByLabelText('Codex 配置预览')).toHaveTextContent('OPENAI_API_KEY')
    expect(screen.getByLabelText('Codex 配置预览')).not.toHaveTextContent(key.key)
    expect(screen.getByRole('button', { name: '下载 auth.json' })).toBeEnabled()

    await user.click(screen.getByRole('radio', { name: /OpenCode/ }))
    expect(screen.queryByRole('tablist', { name: /配置文件$/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('OpenCode 配置预览')).toHaveTextContent('"model": "gateway/claude-opus-5"')
    expect(screen.getByRole('button', { name: '下载 OpenCode 配置' })).toBeEnabled()
  })

  it('copies a one-click setup command with the full key while previewing it masked', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('button', { name: '一键配置命令' }))
    expect(screen.getByRole('tablist', { name: '配置方式' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '一键命令' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'macOS / Linux' })).toHaveAttribute('aria-selected', 'true')
    const preview = screen.getByLabelText('Claude Code 配置命令预览')
    expect(preview).toHaveTextContent("bash <<'AUX_SETUP'")
    expect(preview).toHaveTextContent('"ANTHROPIC_BASE_URL": "https://api.example.com"')
    expect(preview).not.toHaveTextContent(key.key)
    expect(screen.getByText('~/.claude/settings.json', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByText(/需要本机安装 Node.js 或 Python 3/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '复制配置命令' }))
    expect(writeText).toHaveBeenCalledTimes(1)
    const [copied] = writeText.mock.calls[0] as unknown as [string]
    expect(copied).toMatch(/^bash <<'AUX_SETUP'\n/)
    expect(copied).toContain(`"ANTHROPIC_AUTH_TOKEN": "${key.key}"`)
    expect(toast.success).toHaveBeenCalledWith('配置命令已复制', { description: expect.stringContaining('粘贴到终端运行') })
    expect(trackFeatureClick).toHaveBeenCalledWith('client-import', 'copy-command-claude-code')

    await user.click(screen.getByRole('tab', { name: 'Windows' }))
    expect(screen.getByLabelText('Claude Code 配置命令预览')).toHaveTextContent('Merge-AuxJson')
    expect(screen.getByText(/不支持 cmd/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '复制配置命令' }))
    expect((writeText.mock.calls[1] as unknown as [string])[0]).toMatch(/^& \{\n/)
    expect(toast.success).toHaveBeenLastCalledWith('配置命令已复制', { description: expect.stringContaining('PowerShell') })

    // 切换客户端后保留配置方式与运行环境；没有命令的 ZCode 只显示配置文件。
    await user.click(screen.getByRole('radio', { name: /Codex/ }))
    expect(screen.getByRole('tab', { name: 'Windows' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('~/.codex/auth.json', { selector: 'code' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /ZCode/ }))
    expect(screen.queryByRole('tablist', { name: '配置方式' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载 ZCode 配置' })).toBeEnabled()
  })

  it('reports a failed command copy without showing an inline error', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async () => { throw new Error('denied') }) } })
    // jsdom 未实现 execCommand，这里模拟旧浏览器的复制兜底也失败。
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) })
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('button', { name: '一键配置命令' }))
    await user.click(screen.getByRole('button', { name: '复制配置命令' }))
    expect(toast.error).toHaveBeenCalledWith('复制配置命令失败', { description: expect.stringContaining('手动配置') })
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    Reflect.deleteProperty(document, 'execCommand')
  })

  it('shows the group name and platform for each API Key', async () => {
    const user = userEvent.setup()
    mockAPI([key, ungroupedKey])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    expect(screen.getByText(/Claude 主组 · Anthropic · 长期有效/)).toBeInTheDocument()
    await user.click(screen.getByLabelText('API Key'))
    expect(screen.getByRole('option', { name: '测试密钥 · Claude 主组 · Anthropic' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '未分组密钥 · 未选择分组' })).toBeInTheDocument()
  })

  it('blocks every import method when the API Key has no group', async () => {
    const user = userEvent.setup()
    mockAPI([ungroupedKey])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('该 API Key 未选择分组')
    expect(screen.queryByRole('link', { name: '一键导入 CC Switch' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '请先为 API Key 选择分组' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: /Cherry \/ Chatbox/ }))
    expect(screen.queryByRole('link', { name: '一键导入 Cherry Studio' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '请先为 API Key 选择分组' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下载配置文件' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制 JSON' })).toBeDisabled()

    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    expect(screen.getByRole('button', { name: '复制配置命令' })).toBeDisabled()
    expect(screen.getByLabelText('Claude Code 配置命令预览')).toHaveTextContent('API Key 未选择分组，无法生成配置')
    expect(screen.getByLabelText('Claude Code 配置命令预览')).not.toHaveTextContent(ungroupedKey.key)
    await user.click(screen.getByRole('tab', { name: '手动配置' }))
    expect(screen.getByRole('button', { name: '下载 Claude Code 配置' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制配置' })).toBeDisabled()
    expect(screen.getByLabelText('Claude Code 配置预览')).toHaveTextContent('API Key 未选择分组，无法生成配置')
    expect(screen.getByLabelText('Claude Code 配置预览')).not.toHaveTextContent(ungroupedKey.key)
  })

  it('switches to an allowed client and prevents selecting clients restricted by the admin policy', async () => {
    const user = userEvent.setup()
    mockAPI([{ ...key, allowed_clients: ['codex', 'pi'] }])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    expect(await screen.findByRole('radio', { name: /Codex/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('link', { name: '一键导入 CC Switch' })).toBeInTheDocument()

    const claudeCode = screen.getByRole('radio', { name: /Claude Code/ })
    expect(claudeCode).toBeDisabled()
    expect(claudeCode).toHaveTextContent('管理员已限制当前分组导入此客户端。')
    await user.click(claudeCode)
    expect(claudeCode).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('radio', { name: /Codex/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('link', { name: '一键导入 CC Switch' })).toBeInTheDocument()

    // Cherry / Chatbox 下没有允许的客户端，整个页签不可切换。
    expect(screen.getByRole('tab', { name: /Cherry \/ Chatbox/ })).toBeDisabled()

    // 配置文件页签同样列出 Codex，切换页签时保持当前选择。
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    expect(screen.getByRole('radio', { name: /Codex/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '复制配置命令' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /Claude Code/ })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /Pi/ }))
    expect(screen.getByRole('radio', { name: /Pi/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '复制配置命令' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /ZCode/ })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /ZCode/ }))
    expect(screen.getByRole('radio', { name: /Pi/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '复制配置命令' })).toBeEnabled()
  })

  it('explains when the key group may not import any client', async () => {
    mockAPI([{ ...key, allowed_clients: [] }])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    expect(await screen.findByText('该分组暂不允许导入客户端')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '一键导入 CC Switch' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '该客户端已被限制导入' })).toBeDisabled()
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).toBeDisabled()
      expect(radio).toHaveAttribute('aria-checked', 'false')
    }
    expect(screen.getByRole('tab', { name: /Cherry \/ Chatbox/ })).toBeDisabled()
    expect(screen.getByRole('tab', { name: '配置文件' })).toBeDisabled()
  })

  it('selects the first grouped API Key by default', async () => {
    mockAPI([ungroupedKey, key])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    expect(await screen.findByRole('link', { name: '一键导入 CC Switch' })).toBeInTheDocument()
    expect(screen.queryByText('该 API Key 未选择分组')).not.toBeInTheDocument()
  })

  it('loads the default model options from the selected API Key', async () => {
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    const trigger = await screen.findByRole('combobox', { name: /默认模型 ID/ })
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/client-import/keys/3/models'))
    // 默认模型在该密钥的列表中时保持不变。
    expect(trigger).toHaveTextContent('claude-opus-5')

    fireEvent.click(trigger)
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getAllByRole('option').map((option) => option.textContent)).toEqual([...keyModels, '不指定默认模型'])
    fireEvent.click(within(listbox).getByRole('option', { name: 'claude-sonnet-5' }))

    expect(trigger).toHaveTextContent('claude-sonnet-5')
    expect(screen.getByRole('link', { name: '一键导入 CC Switch' })).toHaveAttribute('href', expect.stringContaining('model=claude-sonnet-5'))
  })

  it('switches to the first key model when the default model is unavailable and allows clearing it', async () => {
    mockAPI([key], ['gpt-5.5', 'gpt-5.5-mini'])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    const trigger = await screen.findByRole('combobox', { name: /默认模型 ID/ })
    await waitFor(() => expect(trigger).toHaveTextContent('gpt-5.5'))

    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: '不指定默认模型' }))
    expect(trigger).toHaveTextContent('不指定，使用客户端默认')
  })

  it('keeps custom model entry available when the key model list cannot be read', async () => {
    mockAPI([key], new AuxApiError(422, 'sub2api gateway rejected this api key', 'API_KEY_MODELS_REJECTED'))
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    expect(await screen.findByText(/网关拒绝了该密钥的模型列表请求/)).toBeInTheDocument()
    const trigger = screen.getByRole('combobox', { name: /默认模型 ID/ })
    expect(trigger).toHaveTextContent('claude-opus-5')

    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('combobox', { name: '搜索模型' }), { target: { value: 'my-custom-model' } })
    fireEvent.click(screen.getByRole('option', { name: '使用「my-custom-model」' }))
    expect(trigger).toHaveTextContent('my-custom-model')

    mockAPI([key])
    fireEvent.click(screen.getByRole('button', { name: '重新读取' }))
    await waitFor(() => expect(screen.queryByText(/网关拒绝了该密钥的模型列表请求/)).not.toBeInTheDocument())
    // 用户已手动选择的模型不会被重新读取的列表覆盖。
    expect(trigger).toHaveTextContent('my-custom-model')
  })

  it('adds candidate models for clients the admin allows to use multiple models', async () => {
    const user = userEvent.setup()
    mockAPI([key], keyModels, ['zcode', 'pi'])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    // CC Switch 只能传递单个模型，不显示候选模型。
    expect(screen.queryByRole('combobox', { name: /候选模型 ID/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    await user.click(screen.getByRole('radio', { name: /Pi/ }))
    // 配置方式在切换客户端时保留，后续 WorkBuddy、ZCode 继续显示配置文件预览。
    await user.click(screen.getByRole('tab', { name: '手动配置' }))

    const trigger = await screen.findByRole('combobox', { name: /候选模型 ID/ })
    await waitFor(() => expect(trigger).toBeEnabled())
    expect(trigger).toHaveTextContent('不添加候选模型')
    fireEvent.click(trigger)
    const listbox = await screen.findByRole('listbox')
    // 默认模型不会重复出现在候选列表中。
    expect(within(listbox).queryByRole('option', { name: 'claude-opus-5' })).not.toBeInTheDocument()
    fireEvent.click(within(listbox).getByRole('option', { name: 'claude-haiku-5' }))
    fireEvent.click(within(listbox).getByRole('option', { name: 'claude-sonnet-5' }))
    fireEvent.change(screen.getByRole('combobox', { name: '搜索候选模型' }), { target: { value: 'my-extra-model' } })
    fireEvent.click(screen.getByRole('option', { name: '添加「my-extra-model」' }))

    expect(trigger).toHaveTextContent('已选择 3 个候选模型')
    const preview = screen.getByLabelText('Pi 配置预览').textContent ?? ''
    const order = ['claude-opus-5', 'claude-haiku-5', 'claude-sonnet-5', 'my-extra-model'].map((model) => preview.indexOf(`"id": "${model}"`))
    expect(order.every((index) => index >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: '移除候选模型 claude-haiku-5' }))
    expect(within(screen.getByRole('list', { name: '已选择的候选模型' })).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['claude-sonnet-5', 'my-extra-model'])
    expect(screen.getByLabelText('Pi 配置预览')).not.toHaveTextContent('claude-haiku-5')

    // 切换到未开启多模型的 WorkBuddy 后隐藏候选模型且不写入配置。
    await user.click(screen.getByRole('radio', { name: /WorkBuddy/ }))
    expect(screen.queryByRole('combobox', { name: /候选模型 ID/ })).not.toBeInTheDocument()
    expect(screen.getByLabelText('WorkBuddy 配置预览')).not.toHaveTextContent('my-extra-model')

    await user.click(screen.getByRole('radio', { name: /ZCode/ }))
    expect(screen.getByLabelText('ZCode 配置预览')).toHaveTextContent('my-extra-model')
  })

  it('hides candidate models when the backend does not enable multiple models', async () => {
    const user = userEvent.setup()
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('测试密钥')
    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    await user.click(screen.getByRole('radio', { name: /Pi/ }))
    expect(screen.queryByRole('combobox', { name: /候选模型 ID/ })).not.toBeInTheDocument()
  })

  it('does not request models for an ungrouped API Key', async () => {
    mockAPI([ungroupedKey])
    render(<MemoryRouter initialEntries={['/client-import?api_base=https%3A%2F%2Fapi.example.com']}><ClientImportPage /></MemoryRouter>)

    await screen.findByText('该 API Key 未选择分组')
    expect(screen.getByRole('combobox', { name: /默认模型 ID/ })).toBeDisabled()
    expect(apiClient.get).not.toHaveBeenCalledWith(expect.stringMatching(/\/models$/))
  })
})
