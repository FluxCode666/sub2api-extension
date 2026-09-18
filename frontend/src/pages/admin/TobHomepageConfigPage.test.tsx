import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { DEFAULT_TOB_HOMEPAGE_CONFIG } from '@/lib/tob-homepage'
import TobHomepageConfigPage from './TobHomepageConfigPage'

vi.mock('@/lib/api-client', () => ({ apiClient: { get: vi.fn(), put: vi.fn() } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

describe('TobHomepageConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(apiClient.get).mockResolvedValue({ code: 0, data: DEFAULT_TOB_HOMEPAGE_CONFIG })
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: DEFAULT_TOB_HOMEPAGE_CONFIG })
  })

  it('uses the complete homepage editor and appends the network node editor', async () => {
    render(<TobHomepageConfigPage />)

    expect(await screen.findByRole('heading', { name: 'ToB 官网配置' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Hero 标题' })).toHaveValue(DEFAULT_TOB_HOMEPAGE_CONFIG.heroTitle)
    expect(screen.getByRole('textbox', { name: '服务可用性' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '全球网络节点' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: '主服务器 1 纬度' })).toHaveValue(31.23)
    expect(screen.getByRole('switch', { name: '展示节点名称' })).toBeChecked()
    expect(screen.getByRole('switch', { name: '数据流动效果' })).toBeChecked()
    expect(screen.getByRole('slider', { name: '连线曲度' })).toHaveAttribute('aria-valuenow', '24')
    expect(screen.getByRole('slider', { name: '节点大小' })).toHaveAttribute('aria-valuemin', '10')
    expect(screen.getByRole('slider', { name: '节点大小' })).toHaveAttribute('aria-valuemax', '200')
    expect(screen.getByRole('slider', { name: '节点大小' })).toHaveAttribute('aria-valuenow', '100')
    expect(screen.getByRole('textbox', { name: '主服务器颜色' })).toHaveValue('#d97706')
    expect(screen.getByRole('button', { name: '虚线' })).toHaveAttribute('aria-pressed', 'true')
    expect(apiClient.get).toHaveBeenCalledWith('/admin/tob-homepage/config')
  })

  it('saves map appearance controls with the node configuration', async () => {
    const user = userEvent.setup()
    render(<TobHomepageConfigPage />)

    await screen.findByRole('heading', { name: 'ToB 官网配置' })
    await user.click(screen.getByRole('switch', { name: '展示节点名称' }))
    await user.click(screen.getByRole('switch', { name: '数据流动效果' }))
    await user.click(screen.getByRole('button', { name: '实线' }))
    const curvature = screen.getByRole('slider', { name: '连线曲度' })
    curvature.focus()
    await user.keyboard('{ArrowRight}{ArrowRight}')
    const nodeSize = screen.getByRole('slider', { name: '节点大小' })
    nodeSize.focus()
    await user.keyboard('{ArrowRight}')
    const serverColor = screen.getByRole('textbox', { name: '主服务器颜色' })
    await user.clear(serverColor)
    await user.type(serverColor, '#112233')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/tob-homepage/config', expect.objectContaining({
      mapSettings: expect.objectContaining({
        showNodeLabels: false,
        flowAnimation: false,
        routeStyle: 'solid',
        routeCurvature: 26,
        nodeSize: 105,
        primaryServerColor: '#112233',
      }),
    })))
  })

  it('rejects invalid map colors with an error notification', async () => {
    const user = userEvent.setup()
    render(<TobHomepageConfigPage />)

    const serverColor = await screen.findByRole('textbox', { name: '主服务器颜色' })
    await user.clear(serverColor)
    await user.type(serverColor, '#123')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(toast.error).toHaveBeenCalledWith('主服务器颜色：请输入 #RRGGBB 格式的颜色值。')
    expect(apiClient.put).not.toHaveBeenCalled()
  })

  it('saves copied homepage fields and multiple network nodes together', async () => {
    const user = userEvent.setup()
    render(<TobHomepageConfigPage />)

    const title = await screen.findByRole('textbox', { name: 'Hero 标题' })
    await user.clear(title)
    await user.type(title, '企业版官网标题')
    await user.click(screen.getByRole('button', { name: '添加主服务器节点' }))
    await user.type(screen.getByRole('textbox', { name: '主服务器 2 名称' }), '新加坡主站')
    await user.clear(screen.getByRole('spinbutton', { name: '主服务器 2 纬度' }))
    await user.type(screen.getByRole('spinbutton', { name: '主服务器 2 纬度' }), '1.35')
    await user.clear(screen.getByRole('spinbutton', { name: '主服务器 2 经度' }))
    await user.type(screen.getByRole('spinbutton', { name: '主服务器 2 经度' }), '103.82')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/tob-homepage/config', expect.objectContaining({
      heroTitle: '企业版官网标题',
      primaryServers: expect.arrayContaining([expect.objectContaining({ name: '新加坡主站', latitude: 1.35, longitude: 103.82 })]),
    })))
  })

  it('ignores untouched empty node rows when saving', async () => {
    const user = userEvent.setup()
    render(<TobHomepageConfigPage />)

    await screen.findByRole('heading', { name: 'ToB 官网配置' })
    await user.click(screen.getByRole('button', { name: '添加CDN 集群节点' }))
    expect(screen.getByRole('spinbutton', { name: 'CDN 集群 1 纬度' })).toHaveValue(null)
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith('/admin/tob-homepage/config', expect.objectContaining({
      cdnLocations: [],
    })))
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows precise node validation failures in an error toast', async () => {
    const user = userEvent.setup()
    render(<TobHomepageConfigPage />)

    await screen.findByRole('heading', { name: 'ToB 官网配置' })
    await user.click(screen.getByRole('button', { name: '添加客户位置节点' }))
    await user.type(screen.getByRole('textbox', { name: '客户位置 1 名称' }), '伦敦客户')
    await user.type(screen.getByRole('spinbutton', { name: '客户位置 1 纬度' }), '91')
    await user.type(screen.getByRole('spinbutton', { name: '客户位置 1 经度' }), '0')
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    expect(toast.error).toHaveBeenCalledWith('客户位置 1：纬度必须在 -90 到 90 之间。')
    expect(apiClient.put).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows API save failures in an error toast instead of a page banner', async () => {
    const user = userEvent.setup()
    vi.mocked(apiClient.put).mockRejectedValue(new Error('配置保存失败'))
    render(<TobHomepageConfigPage />)

    await screen.findByRole('heading', { name: 'ToB 官网配置' })
    await user.click(screen.getByRole('button', { name: '保存配置' }))

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('配置保存失败'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
