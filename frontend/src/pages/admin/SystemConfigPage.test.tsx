import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemConfigPage from './SystemConfigPage'

const { getConfig, putConfig } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  putConfig: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: getConfig,
    put: putConfig,
  },
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}))

describe('SystemConfigPage', () => {
  beforeEach(() => {
    getConfig.mockReset()
    putConfig.mockReset()
    getConfig.mockResolvedValue({ code: 0, message: 'ok', data: { model: 'gpt-5.6-sol', heroTitle: 'TERALEMO' } })
    putConfig.mockResolvedValue({ code: 0, message: 'ok', data: { model: 'gpt-6-astra', heroTitle: 'TERALEMO' } })
  })

  it('loads the configured model and preserves the complete config on save', async () => {
    render(<SystemConfigPage />)

    expect(await screen.findByDisplayValue('gpt-5.6-sol')).toBeInTheDocument()
    const input = screen.getByDisplayValue('gpt-5.6-sol')
    fireEvent.change(input, { target: { value: 'gpt-6-astra' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ model: 'gpt-6-astra', heroTitle: 'TERALEMO' })))
  })

  it('allows updating the system name used by the API docs', async () => {
    render(<SystemConfigPage />)

    expect(await screen.findByRole('textbox', { name: 'Sub2API 系统名称' })).toHaveValue('TERALEMO')
    const input = await screen.findByDisplayValue('TERALEMO')
    fireEvent.change(input, { target: { value: 'Example Cloud' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ heroTitle: 'Example Cloud' })))
  })
})
