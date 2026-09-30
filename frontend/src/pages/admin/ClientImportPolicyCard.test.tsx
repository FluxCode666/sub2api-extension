import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { apiClient, AuxApiError } from '@/lib/api-client'
import { ClientImportPolicyCard } from './ClientImportPolicyCard'

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, apiClient: { get: vi.fn(), put: vi.fn() } }
})

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const groups = [
  { id: 5, name: 'Claude 主组', platform: 'anthropic', status: 'active' },
  { id: 8, name: 'OpenAI 备用', platform: 'openai', status: 'inactive' },
]

function mockGet(policy: unknown, groupsResult: unknown = { code: 0, data: { items: groups } }) {
  vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
    if (url === '/admin/client-import/policy') return { code: 0, data: policy }
    if (url === '/admin/client-import/groups') {
      if (groupsResult instanceof Error) throw groupsResult
      return groupsResult
    }
    throw new Error(`unexpected GET ${url}`)
  })
}

beforeAll(() => {
  // Radix Select 在 jsdom 中需要的指针与滚动 API。
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

beforeEach(() => {
  vi.mocked(apiClient.put).mockImplementation(async (_url: string, body?: unknown) => ({ code: 0, data: body }))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('ClientImportPolicyCard', () => {
  it('defaults to allowing every client and keeps save disabled until a change', async () => {
    mockGet({ platforms: [], groups: [] })
    render(<ClientImportPolicyCard />)

    expect(await screen.findByText('全部客户端可导入', { selector: '.aux-system-config-status' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Anthropic 平台自定义限制' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存限制' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '恢复不限制' })).toBeDisabled()
    expect(screen.getByText('暂无分组规则，分组按所属平台的规则生效。')).toBeInTheDocument()
  })

  it('saves a platform allow-list', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [], groups: [] })
    render(<ClientImportPolicyCard />)

    await user.click(await screen.findByRole('switch', { name: 'OpenAI 平台自定义限制' }))
    await user.click(screen.getByRole('button', { name: 'OpenAI 平台：全不选客户端' }))
    expect(screen.getByText('不允许导入任何客户端')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'OpenAI 平台允许导入 Pi' }))
    await user.click(screen.getByRole('switch', { name: 'OpenAI 平台允许导入 Codex' }))
    expect(screen.getByText('已允许 2/13')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存限制' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/client-import/policy', {
      platforms: [{ platform: 'openai', allowedClients: ['codex', 'pi'] }],
      groups: [],
      multiModelClients: ['chatbox', 'zcode', 'workbuddy', 'pi'],
    }))
    expect(toast.success).toHaveBeenCalledWith('客户端导入限制已保存', expect.anything())
    expect(screen.getByRole('button', { name: '保存限制' })).toBeDisabled()
  })

  it('adds a group rule seeded from the platform rule and removes it again', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [{ platform: 'anthropic', allowedClients: ['claude-code'] }], groups: [] })
    render(<ClientImportPolicyCard />)

    await user.click(await screen.findByRole('combobox', { name: '选择要限制的分组' }))
    expect(screen.getByRole('option', { name: 'OpenAI 备用（已停用） · OpenAI' })).toBeInTheDocument()
    await user.click(screen.getByRole('option', { name: 'Claude 主组 · Anthropic' }))
    await user.click(screen.getByRole('button', { name: '添加分组规则' }))

    const grid = screen.getByRole('group', { name: 'Claude 主组 · Anthropic允许导入的客户端' })
    expect(within(grid).getByRole('switch', { name: /允许导入 Claude Code$/ })).toBeChecked()
    expect(within(grid).getByRole('switch', { name: /允许导入 Codex$/ })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存限制' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: '移除 Claude 主组 · Anthropic 的分组规则' }))
    expect(screen.queryByRole('group', { name: 'Claude 主组 · Anthropic允许导入的客户端' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存限制' })).toBeDisabled()
  })

  it('keeps platform rules usable when Sub2API groups are unavailable', async () => {
    mockGet({ platforms: [], groups: [{ groupId: 12, allowedClients: [] }] }, new AuxApiError(503, 'Sub2API database is unavailable'))
    render(<ClientImportPolicyCard />)

    expect(await screen.findByText(/未配置 Sub2API 数据库，无法读取分组列表/)).toBeInTheDocument()
    expect(screen.getByText('分组 #12')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: '选择要限制的分组' })).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'Gemini 平台自定义限制' })).toBeEnabled()
  })

  it('reports save failures with a toast and keeps the draft', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [], groups: [] })
    vi.mocked(apiClient.put).mockRejectedValue(new AuxApiError(400, 'invalid client import policy'))
    render(<ClientImportPolicyCard />)

    await user.click(await screen.findByRole('switch', { name: 'Grok 平台自定义限制' }))
    await user.click(screen.getByRole('button', { name: '保存限制' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('客户端导入限制保存失败', { description: 'invalid client import policy' }))
    expect(screen.getByRole('switch', { name: 'Grok 平台自定义限制' })).toBeChecked()
    expect(screen.getByRole('button', { name: '保存限制' })).toBeEnabled()
  })

  it('enables every multi-model client by default and saves the chosen ones', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [], groups: [] })
    render(<ClientImportPolicyCard />)

    const grid = await screen.findByRole('group', { name: '允许配置多个模型 ID 的客户端' })
    expect(within(grid).getAllByRole('switch').map((item) => item.getAttribute('aria-label'))).toEqual([
      'Chatbox 允许配置多个模型 ID',
      'ZCode 允许配置多个模型 ID',
      'WorkBuddy 允许配置多个模型 ID',
      'Pi 允许配置多个模型 ID',
    ])
    expect(within(grid).getAllByRole('switch').every((item) => item.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(screen.getByText('支持多模型的客户端均已开启')).toBeInTheDocument()

    await user.click(within(grid).getByRole('switch', { name: 'Chatbox 允许配置多个模型 ID' }))
    await user.click(within(grid).getByRole('switch', { name: 'WorkBuddy 允许配置多个模型 ID' }))
    expect(screen.getByText('已开启 2/4')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '保存限制' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/client-import/policy', {
      platforms: [],
      groups: [],
      multiModelClients: ['zcode', 'pi'],
    }))
    expect(toast.success).toHaveBeenCalledWith('客户端导入限制已保存', expect.anything())
  })

  it('keeps the multi-model setting when resetting import restrictions', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [{ platform: 'openai', allowedClients: ['pi'] }], groups: [], multiModelClients: [] })
    render(<ClientImportPolicyCard />)

    expect(await screen.findByText('全部客户端只能配置单个模型 ID')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '恢复不限制' }))
    await user.click(screen.getByRole('button', { name: '保存限制' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/client-import/policy', {
      platforms: [],
      groups: [],
      multiModelClients: [],
    }))
    expect(screen.getByRole('switch', { name: 'Pi 允许配置多个模型 ID' })).not.toBeChecked()
  })

  it('shows a retryable error when the policy cannot be loaded', async () => {
    const user = userEvent.setup()
    mockGet({ platforms: [], groups: [] })
    vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('network down'))
    render(<ClientImportPolicyCard />)

    expect(await screen.findByText('客户端导入限制加载失败')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '重新加载' }))
    expect(await screen.findByRole('switch', { name: 'Anthropic 平台自定义限制' })).toBeInTheDocument()
  })
})
