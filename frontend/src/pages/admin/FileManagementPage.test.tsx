import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileManagementPage from './FileManagementPage'

vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return {
    ...actual,
    apiClient: {
      get: vi.fn(),
      upload: vi.fn(),
      patch: vi.fn(),
    },
  }
})

vi.mock('@/lib/invoices', () => ({
  downloadInvoiceFile: vi.fn(),
}))

import { apiClient, AuxApiError } from '@/lib/api-client'

const initialAsset = {
  source: 'image' as const,
  source_id: 7,
  original_name: '客户 Logo.png',
  note: '首页品牌图',
  mime_type: 'image/png',
  size: 42,
  created_at: '2026-01-02T03:04:05Z',
}

describe('FileManagementPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({
      code: 0,
      message: 'success',
      data: { items: [initialAsset] },
    })
  })

  it('shows uploaded original names and notes', async () => {
    render(<FileManagementPage />)

    expect(await screen.findByText('客户 Logo.png')).toBeInTheDocument()
    expect(screen.getByText('首页品牌图')).toBeInTheDocument()
    expect(apiClient.get).toHaveBeenCalledWith('/admin/files')
  })

  it('edits and saves a file note', async () => {
    const user = userEvent.setup()
    const updatedAsset = { ...initialAsset, note: '新备注' }
    vi.mocked(apiClient.patch).mockResolvedValue({
      code: 0,
      message: 'success',
      data: updatedAsset,
    })

    render(<FileManagementPage />)
    await screen.findByText('首页品牌图')

    await user.click(screen.getByRole('button', { name: '编辑备注' }))
    const noteInput = screen.getByLabelText('备注')
    await user.clear(noteInput)
    await user.type(noteInput, '新备注')
    await user.click(screen.getByRole('button', { name: '保存备注' }))

    await waitFor(() => {
      expect(apiClient.patch).toHaveBeenCalledWith('/admin/files/image/7', { note: '新备注' })
    })
    expect(await screen.findByText('新备注')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('uploads images larger than 10MB without rejecting them in the browser', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.upload).mockResolvedValue({ code: 0, message: 'success', data: initialAsset })
    const { container } = render(<FileManagementPage />)
    await screen.findByText('客户 Logo.png')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    requireInput(input)
    const file = new File(['png'], 'large.png', { type: 'image/png' })
    Object.defineProperty(file, 'size', { value: 11 * 1024 * 1024 })

    await user.upload(input, file)

    await waitFor(() => {
      expect(apiClient.upload).toHaveBeenCalledWith('/admin/assets', expect.any(FormData), { timeout: 0 })
    })
    expect(screen.queryByText(/10MB/)).not.toBeInTheDocument()
  })

  it('shows the specific backend upload error', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.upload).mockRejectedValue(new AuxApiError(500, '上传目录不可写，请检查服务器挂载目录权限。'))
    const { container } = render(<FileManagementPage />)
    await screen.findByText('客户 Logo.png')
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')
    requireInput(input)

    await user.upload(input, new File(['png'], 'logo.png', { type: 'image/png' }))

    expect(await screen.findByText('上传目录不可写，请检查服务器挂载目录权限。')).toBeInTheDocument()
    expect(screen.queryByText(/数据库迁移/)).not.toBeInTheDocument()
  })
})

function requireInput(input: HTMLInputElement | null): asserts input is HTMLInputElement {
  if (!input) throw new Error('file input not found')
}
