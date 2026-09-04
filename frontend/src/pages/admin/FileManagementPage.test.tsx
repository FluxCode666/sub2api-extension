import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FileManagementPage from './FileManagementPage'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    upload: vi.fn(),
    patch: vi.fn(),
  },
}))

vi.mock('@/lib/invoices', () => ({
  downloadInvoiceFile: vi.fn(),
}))

import { apiClient } from '@/lib/api-client'

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
})
