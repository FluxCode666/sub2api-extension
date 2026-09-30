import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SystemConfigPage from './SystemConfigPage'
import { toast } from 'sonner'
import { toCurrentOriginURI } from '@/lib/app-base-path'

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
    warning: vi.fn(),
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
    expect(screen.queryByText('示例将使用')).not.toBeInTheDocument()
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

  it('switches the system positioning and persists the ToB destination', async () => {
    const config = { siteName: 'Sub2API', systemPosition: 'toc', model: 'gpt-6-astra' }
    getConfig.mockResolvedValue({ code: 0, data: config })
    putConfig.mockResolvedValue({ code: 0, data: { ...config, systemPosition: 'tob' } })
    render(<SystemConfigPage />)

    const toggle = await screen.findByRole('switch', { name: '系统定位 ToB' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ systemPosition: 'tob' })))
  })

  it('publishes the client import page through the system config', async () => {
    getConfig.mockResolvedValue({ code: 0, data: { siteName: 'Sub2API', model: 'gpt-6-astra', clientImportPublished: false } })
    putConfig.mockResolvedValue({ code: 0, data: { siteName: 'Sub2API', model: 'gpt-6-astra', clientImportPublished: true } })
    render(<SystemConfigPage />)

    const toggle = await screen.findByRole('switch', { name: '客户端导入页上架到 Sub2API' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ clientImportPublished: true })))
  })

  it('publishes the async task page and warns when menu sync is incomplete', async () => {
    getConfig.mockResolvedValue({ code: 0, data: { siteName: 'Sub2API', model: 'gpt-6-astra', asyncTasksPublished: false } })
    putConfig.mockResolvedValue({ code: 0, reason: 'Sub2API 菜单同步失败', data: { siteName: 'Sub2API', model: 'gpt-6-astra', asyncTasksPublished: true } })
    render(<SystemConfigPage />)

    const toggle = await screen.findByRole('switch', { name: '异步任务页上架到 Sub2API' })
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ asyncTasksPublished: true, clientImportPublished: false })))
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('系统配置已保存，但菜单同步未完成', { description: 'Sub2API 菜单同步失败' }))
    expect(screen.getByRole('switch', { name: '异步任务页上架到 Sub2API' })).toBeChecked()
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
    expect(await screen.findByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/aux/api/aux/assets/7')

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

    expect(await screen.findByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/aux/api/aux/assets/3')
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
    expect(screen.getByRole('img', { name: 'Sub2API 系统 Logo 预览' })).toHaveAttribute('src', '/aux/api/aux/assets/3')
  })
  it('shows the unconfigured public URL warning and fills the current origin', async () => {
    // 当前访问地址包含应用挂载路径（如 /aux），与 Sub2API 菜单 URL 前缀一致。
    const currentURL = toCurrentOriginURI('/').replace(/\/+$/, '')
    getConfig.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { model: 'gpt-6-astra', siteName: '示例平台', extensionPublicUrl: '', menuPublication: { available: false, effectiveUrl: '', source: '' } },
    })
    putConfig.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { model: 'gpt-6-astra', siteName: '示例平台', extensionPublicUrl: currentURL, menuPublication: { available: true, effectiveUrl: currentURL, source: 'config' } },
    })
    render(<SystemConfigPage />)

    expect(await screen.findByText(/当前未配置：Sub2API 菜单无法上架/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用当前访问地址' }))
    const input = screen.getByRole('textbox', { name: '扩展系统公网地址' })
    expect(input).toHaveValue(currentURL)
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ extensionPublicUrl: currentURL })))
    expect(putConfig.mock.calls[0][1]).not.toHaveProperty('menuPublication')
    expect(await screen.findByText(`当前生效：${currentURL}（来自系统配置）`)).toBeInTheDocument()
  })

  it('shows the environment fallback and rejects an invalid public URL', async () => {
    getConfig.mockResolvedValue({
      code: 0,
      message: 'ok',
      data: { model: 'gpt-6-astra', siteName: '示例平台', menuPublication: { available: true, effectiveUrl: 'https://env.example.com/aux', source: 'env' } },
    })
    render(<SystemConfigPage />)

    expect(await screen.findByText('当前生效：https://env.example.com/aux（来自环境变量 SUB2API_EXTENSION_PUBLIC_URL）')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '扩展系统公网地址' }), { target: { value: 'https://code.example.com/aux?token=1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('扩展系统公网地址')))
    expect(putConfig).not.toHaveBeenCalled()
  })

  it('groups sections in the table of contents and jumps to the selected section', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(<SystemConfigPage />)

    const nav = await screen.findByRole('navigation', { name: '配置目录' })
    expect(within(nav).getByRole('group', { name: '基础配置' })).toBeInTheDocument()
    expect(within(nav).getByRole('group', { name: '访问控制' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: '品牌标识' })).toHaveAttribute('aria-current', 'location')

    const target = within(nav).getByRole('button', { name: 'Sub2API 菜单' })
    fireEvent.click(target)

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }))
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('system-config-menu'))
    expect(target).toHaveAttribute('aria-current', 'location')
    expect(within(nav).getByRole('button', { name: '品牌标识' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('heading', { level: 2, name: 'Sub2API 菜单' })).toHaveFocus()
  })

  it('marks sections with unsaved changes in the table of contents and save bar', async () => {
    render(<SystemConfigPage />)

    const input = await screen.findByRole('textbox', { name: 'Sub2API 系统名称' })
    const saveBar = screen.getByRole('region', { name: '基础配置保存' })
    expect(saveBar).toHaveTextContent('基础配置已保存')

    fireEvent.change(input, { target: { value: 'Example Cloud' } })

    const nav = screen.getByRole('navigation', { name: '配置目录' })
    expect(within(nav).getByRole('button', { name: '品牌标识（有未保存的更改）' })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: '文档与站点' })).toBeInTheDocument()
    expect(saveBar).toHaveTextContent('未保存：品牌标识')
  })

  it('normalizes a trailing slash before saving the public URL', async () => {
    render(<SystemConfigPage />)

    fireEvent.change(await screen.findByRole('textbox', { name: '扩展系统公网地址' }), { target: { value: ' https://code.example.com/aux/ ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(putConfig).toHaveBeenCalledWith('/admin/homepage/config', expect.objectContaining({ extensionPublicUrl: 'https://code.example.com/aux' })))
  })
})
