import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
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
    expect(screen.getByRole('radio', { name: /ZCode/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /WorkBuddy/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '下载 ZCode 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('ZCode 配置预览')).not.toHaveTextContent(key.key)
    expect(screen.getByLabelText('ZCode 配置预览')).toHaveTextContent('anthropic-messages')

    await user.click(screen.getByRole('radio', { name: /WorkBuddy/ }))
    expect(screen.getByRole('button', { name: '下载 WorkBuddy 配置' })).toBeInTheDocument()
    expect(screen.getByLabelText('WorkBuddy 配置预览')).toHaveTextContent('availableModels')
    expect(screen.getByLabelText('WorkBuddy 配置预览')).not.toHaveTextContent(key.key)

    await user.click(screen.getByRole('radio', { name: /Pi/ }))
    expect(screen.getByRole('button', { name: '下载 Pi 配置' })).toBeInTheDocument()
    const piPreview = screen.getByLabelText('Pi 配置预览')
    expect(piPreview).toHaveTextContent('openai-completions')
    expect(piPreview).toHaveTextContent('https://api.example.com/v1')
    expect(piPreview).not.toHaveTextContent(key.key)
    expect(screen.getByText(/CC Switch 暂不支持通过深度链接导入 Pi/)).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: '下载 ZCode 配置' })).toBeDisabled()
    expect(screen.getByLabelText('ZCode 配置预览')).toHaveTextContent('API Key 未选择分组，无法生成配置')
    expect(screen.getByLabelText('ZCode 配置预览')).not.toHaveTextContent(ungroupedKey.key)
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

    await user.click(screen.getByRole('tab', { name: '配置文件' }))
    expect(screen.getByRole('radio', { name: /Pi/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '下载 Pi 配置' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: /ZCode/ })).toBeDisabled()
    await user.click(screen.getByRole('radio', { name: /ZCode/ }))
    expect(screen.getByRole('radio', { name: /Pi/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('button', { name: '下载 Pi 配置' })).toBeEnabled()
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
