import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemConfigPage from './SystemConfigPage'

const { getConfig, putConfig, uploadAsset } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  putConfig: vi.fn(),
  uploadAsset: vi.fn(),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: getConfig,
    put: putConfig,
    upload: uploadAsset,
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
    uploadAsset.mockReset()
    getConfig.mockResolvedValue({ code: 0, message: 'ok', data: { model: 'gpt-5.6-sol', heroTitle: '示例平台' } })
    putConfig.mockResolvedValue({ code: 0, message: 'ok', data: { model: 'gpt-6-astra', heroTitle: '示例平台' } })
    uploadAsset.mockResolvedValue({ code: 0, message: 'ok', data: { id: 7, url: '/api/aux/assets/7' } })
  })

  it('loads the configured model and preserves the complete config on save', async () => {
    render(<SystemConfigPage />)

    expect(await screen.findByDisplayValue('gpt-5.6-sol')).toBeInTheDocument()
    const input = screen.getByDisplayValue('gpt-5.6-sol')
    fireEvent.change(input, { target: { value: 'gpt-6-astra' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ model: 'gpt-6-astra', siteName: '示例平台' })))
  })

  it('allows updating the system name used by the API docs', async () => {
    render(<SystemConfigPage />)

    expect(await screen.findByRole('textbox', { name: 'Sub2API 系统名称' })).toHaveValue('示例平台')
    const input = await screen.findByDisplayValue('示例平台')
    fireEvent.change(input, { target: { value: 'Example Cloud' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({
      siteName: 'Example Cloud',
      heroTitle: '示例平台',
    })))
  })

  it('updates the shared site name while preserving homepage content', async () => {
    const config = { siteName: 'Sub2API', heroTitle: 'AI API 网关，面向下一次调用', model: 'gpt-6-astra', developersDocsUrl: '/api-docs' }
    getConfig.mockResolvedValue({ code: 0, data: config })
    putConfig.mockResolvedValue({ code: 0, data: { ...config, siteName: 'Example Cloud' } })
    render(<SystemConfigPage />)

    const input = await screen.findByRole('textbox', { name: 'Sub2API 系统名称' })
    expect(input).toHaveValue('Sub2API')
    fireEvent.change(input, { target: { value: 'Example Cloud' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({
      ...config,
      siteName: 'Example Cloud',
    })))
    expect(input).toHaveValue('Example Cloud')
  })

  it('allows configuring the default API domain for client guides', async () => {
    getConfig.mockResolvedValue({ code: 0, data: { siteName: 'Sub2API', systemDomain: 'https://gateway.example.com', model: 'gpt-6-astra' } })
    putConfig.mockResolvedValue({ code: 0, data: { siteName: 'Sub2API', systemDomain: 'https://api.example.com', model: 'gpt-6-astra' } })
    render(<SystemConfigPage />)

    const input = await screen.findByRole('textbox', { name: 'Sub2API 系统域名' })
    expect(input).toHaveValue('https://gateway.example.com')
    fireEvent.change(input, { target: { value: 'https://api.example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ systemDomain: 'https://api.example.com' })))
  })

  it('uploads a dropped logo and saves the returned asset URL', async () => {
    const config = { siteName: 'Sub2API', siteLogoUrl: '', model: 'gpt-6-astra' }
    getConfig.mockResolvedValue({ code: 0, data: config })
    putConfig.mockResolvedValue({ code: 0, data: { ...config, siteLogoUrl: '/api/aux/assets/7' } })
    render(<SystemConfigPage />)

    const dropZone = await screen.findByRole('group', { name: 'Logo 上传区域' })
    expect(screen.getByLabelText('上传 Sub2API 系统 Logo')).toHaveAttribute('tabindex', '-1')
    const logo = new File(['png'], 'brand.png', { type: 'image/png' })
    fireEvent.dragEnter(dropZone)
    expect(dropZone).toHaveAttribute('data-dragging', 'true')
    fireEvent.drop(dropZone, { dataTransfer: { files: [logo] } })

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith('/admin/assets', expect.any(FormData), { timeout: 0 }))
    const formData = uploadAsset.mock.calls[0][1] as FormData
    expect(formData.get('file')).toBe(logo)
    expect(await screen.findByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/api/aux/assets/7')

    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))
    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ siteLogoUrl: '/api/aux/assets/7' })))
  })

  it('rejects unsupported logo formats before uploading', async () => {
    render(<SystemConfigPage />)

    const input = await screen.findByLabelText('上传 Sub2API 系统 Logo')
    fireEvent.change(input, { target: { files: [new File(['svg'], 'brand.svg', { type: 'image/svg+xml' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('只能上传 PNG、JPEG、GIF 或 WebP 图片。')
    expect(uploadAsset).not.toHaveBeenCalled()
  })

  it('can remove the configured logo and persist the empty value', async () => {
    const config = { siteName: 'Sub2API', siteLogoUrl: '/api/aux/assets/3', model: 'gpt-6-astra' }
    getConfig.mockResolvedValue({ code: 0, data: config })
    putConfig.mockResolvedValue({ code: 0, data: { ...config, siteLogoUrl: '' } })
    render(<SystemConfigPage />)

    expect(await screen.findByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/api/aux/assets/3')
    fireEvent.click(screen.getByRole('button', { name: '移除 Logo' }))
    expect(screen.queryByRole('img', { name: 'Sub2API 系统 Logo 预览' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ siteLogoUrl: '' })))
  })

  it('shows the backend upload error and keeps the current logo unchanged', async () => {
    const config = { siteName: 'Sub2API', siteLogoUrl: '/api/aux/assets/3', model: 'gpt-6-astra' }
    getConfig.mockResolvedValue({ code: 0, data: config })
    uploadAsset.mockRejectedValue(new Error('上传目录不可写，请检查服务器挂载目录权限。'))
    render(<SystemConfigPage />)

    const input = await screen.findByLabelText('上传 Sub2API 系统 Logo')
    fireEvent.change(input, { target: { files: [new File(['png'], 'brand.png', { type: 'image/png' })] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('上传目录不可写，请检查服务器挂载目录权限。')
    expect(screen.getByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/api/aux/assets/3')
  })
})
