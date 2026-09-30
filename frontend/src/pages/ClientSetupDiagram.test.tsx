import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ClientSetupDiagram } from './ClientSetupDiagram'

describe('ClientSetupDiagram', () => {
  it.each([
    ['grok-build', 'https://gateway.test/v1', 'OpenAI Chat Completions'],
    ['hermes', 'https://gateway.test/v1', 'OpenAI Chat Completions'],
  ] as const)('renders %s CC Switch fields with the correct gateway version', (clientId, address, protocol) => {
    render(<ClientSetupDiagram clientId={clientId} method="cc-switch" baseURL="https://gateway.test" model="my-model" />)
    const diagram = screen.getByRole('figure', { name: `${clientId} 界面操作示意` })
    expect(diagram).toHaveTextContent('填写供应商参数')
    expect(diagram).toHaveTextContent(address)
    expect(diagram).toHaveTextContent(protocol)
    expect(diagram).toHaveTextContent('my-model')
    expect(diagram).toHaveTextContent('sk-YOUR_API_KEY')
    expect(diagram.querySelector('img')).not.toBeInTheDocument()
  })

  it('illustrates Claude Code key import with the selected client, configured brand and five matching anchors', () => {
    const { container } = render(<ClientSetupDiagram clientId="claude-code" method="cc-switch" baseURL="https://gateway.test" model="claude-opus-5" systemName="演示网关" siteLogoUrl="/brand.svg" steps={['创建密钥', '导入密钥', '核对弹窗', '启用配置', '打开新终端运行 claude']} />)
    const figures = screen.getAllByRole('figure')

    expect(figures).toHaveLength(4)
    expect(figures.map(figure => figure.id)).toEqual(['claude-code-step-1', 'claude-code-step-2', 'claude-code-step-3', 'claude-code-step-4'])
    expect(figures[0].querySelector('.sub2api-vendor-options .is-selected')).toHaveTextContent('Anthropic')
    expect(figures[1].querySelector('.sub2api-key-actions .is-highlighted')).toHaveTextContent('导入到 CCS②')
    expect(figures[2].querySelector('.ccswitch-app-tabs .is-current')).toHaveAttribute('aria-label', 'Claude Code')
    expect(figures[2].querySelector('.ccswitch-confirm-dialog')).toHaveTextContent('客户端Claude Code')
    expect(figures[2].querySelector('.ccswitch-confirm-dialog')).toHaveTextContent('供应商名称演示网关')
    expect(figures[2]).not.toHaveTextContent('chatgpt.com/codex')
    expect(figures[3].querySelector('.ccswitch-provider-info')).toHaveTextContent('演示网关')
    expect(figures[3].querySelector('.ccswitch-provider-logo-claude-official img')).toBeInTheDocument()
    expect(figures[3].querySelector('.ccswitch-provider-actions')).toHaveTextContent('启用④')
    expect(container.querySelectorAll('.sub2api-brand img')).toHaveLength(2)
    expect(container.querySelector('#claude-code-step-5')).toHaveTextContent('打开新终端运行 claude')
    expect(container.querySelector('#claude-code-step-5 .codex-product-window')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.codex-product-window')).toHaveLength(4)
  })

  it('illustrates Claude Desktop key import through the Claude panel before enabling it in the Desktop panel', () => {
    const { container } = render(<ClientSetupDiagram clientId="claude-desktop" method="cc-switch" baseURL="https://gateway.test" model="claude-opus-5" systemName="演示网关" steps={['创建密钥', '导入密钥', '核对弹窗', '导入并启用', '完全退出并重新打开 Claude Desktop']} />)
    const figures = screen.getAllByRole('figure')

    expect(figures.map(figure => figure.id)).toEqual(['claude-desktop-step-1', 'claude-desktop-step-2', 'claude-desktop-step-3', 'claude-desktop-step-4'])
    expect(figures[0].querySelector('.sub2api-vendor-options .is-selected')).toHaveTextContent('Anthropic')
    expect(figures[1].querySelector('.sub2api-key-actions .is-highlighted')).toHaveTextContent('导入到 CCS②')
    expect(figures[2].querySelector('.ccswitch-app-tabs .is-current')).toHaveAttribute('aria-label', 'Claude Code')
    expect(figures[2].querySelector('.ccswitch-confirm-dialog')).toHaveTextContent('客户端Claude Code')
    expect(figures[3].querySelector('.ccswitch-app-tabs .is-current')).toHaveAttribute('aria-label', 'Claude Desktop')
    expect(figures[3].querySelector('.ccswitch-import-hint')).toHaveTextContent('将 Claude Code 中已有的供应商导入')
    expect(figures[3].querySelector('.ccswitch-provider-new')).toHaveTextContent('演示网关')
    expect(figures[3].querySelector('.ccswitch-provider-new .ccswitch-provider-actions')).toHaveTextContent('启用④')
    expect(within(figures[3]).getByRole('heading', { level: 3 })).toHaveTextContent('导入 Claude Desktop 并启用')
    expect(container.querySelector('#claude-desktop-step-5')).toHaveTextContent('完全退出并重新打开 Claude Desktop')
    expect(container.querySelector('#claude-desktop-step-5 .codex-product-window')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.codex-number-callout')).toHaveLength(4)
  })

  it('draws the Claude Desktop in-app gateway fields for manual setup', () => {
    const { rerender } = render(<ClientSetupDiagram clientId="claude-desktop" method="manual" baseURL="https://gateway.test" model="claude-opus-5" />)
    const diagram = screen.getByRole('figure', { name: 'claude-desktop 界面操作示意' })
    expect(diagram).toHaveTextContent('Configure Third-Party Inference')
    expect(within(diagram).getByText('https://gateway.test')).toBeInTheDocument()
    expect(diagram).toHaveTextContent('sk-YOUR_API_KEY')
    expect(diagram).toHaveTextContent('claude-opus-5')
    rerender(<ClientSetupDiagram clientId="claude-desktop" method="manual" baseURL={null} model="claude-opus-5" />)
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
  })

  it('draws the first four Codex actions as editable UI sketches and leaves restart as text', () => {
    const steps = [
      '在平台控制台的 API Key 管理页创建 API Key。',
      '在该 API Key 所在行点击「导入到 CCS」。',
      '确认将配置导入 CC Switch。',
      '在 CC Switch 中启用刚导入的配置。',
      '完全退出并重新打开 Codex Desktop。',
    ]
    const { container } = render(<ClientSetupDiagram clientId="codex" method="cc-switch" baseURL="https://gateway.test" model="my-model" steps={steps} />)
    const figures = screen.getAllByRole('figure')

    expect(figures).toHaveLength(4)
    expect(figures.map(figure => within(figure).getByRole('heading', { level: 3 }).textContent)).toEqual([
      '创建 API Key',
      '点击「导入到 CCS」',
      '确认导入',
      '启用导入的配置',
    ])
    expect(figures[0]).toHaveTextContent('API Key 管理')
    expect(figures[0]).toHaveTextContent('https://gateway.test')
    expect(figures[1]).toHaveTextContent('导入到 CCS')
    expect(figures[1]).toHaveTextContent('Sub2API')
    expect(figures[1]).toHaveTextContent('https://gateway.test')
    expect(figures[2]).toHaveTextContent('确认导入')
    expect(figures[3]).toHaveTextContent('启用')
    expect(screen.getByRole('heading', { level: 3, name: '重启 Codex 客户端' })).toBeInTheDocument()
    expect(container.querySelector('.codex-setup-text-step')).toHaveTextContent('完全退出并重新打开 Codex Desktop。')
    expect([...container.querySelectorAll('.codex-product-window img')].every(image => image.closest('.ccswitch-app-icon, .ccswitch-provider-logo'))).toBe(true)
    expect(container.querySelectorAll('.codex-product-window')).toHaveLength(4)
    expect(container.querySelector('.codex-callout-legend')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.codex-number-callout')).toHaveLength(4)
    expect([...container.querySelectorAll('.codex-number-callout')].every(marker => marker.closest('.codex-product-window'))).toBe(true)
    expect(container.querySelector('.codex-setup-text-step .codex-number-callout')).not.toBeInTheDocument()
    expect(container.querySelector('.codex-setup-step-number')).not.toBeInTheDocument()
    expect(container).toHaveTextContent('①')
    expect(container).toHaveTextContent('②')
    expect(container).toHaveTextContent('③')
    expect(container).toHaveTextContent('④')
    expect(container).not.toHaveTextContent('⑤')
    expect(figures[0].querySelector('.sub2api-sidebar')).toBeInTheDocument()
    expect(figures[0].querySelector('.sub2api-sidebar')).toHaveTextContent('我的账户')
    expect(figures[0].querySelector('.sub2api-sidebar')).toHaveTextContent('API 文档')
    expect(figures[0].querySelector('.sub2api-sidebar')).not.toHaveTextContent('用户管理')
    expect(figures[0].querySelector('.sub2api-sidebar')).not.toHaveTextContent('系统设置')
    expect(figures[0].querySelector('.sub2api-brand strong')).toHaveTextContent('Sub2API')
    expect(figures[0].querySelector('.sub2api-topbar')).toHaveTextContent('用户')
    expect(figures[0].querySelector('.sub2api-topbar')).not.toHaveTextContent('DueGin')
    expect(figures[0].querySelector('.sub2api-dialog-backdrop')).toBeInTheDocument()
    expect(figures[1].querySelector('.sub2api-key-table')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-topbar')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-topbar')?.contains(figures[2].querySelector('.ccswitch-appbar'))).toBe(true)
    expect(figures[2].querySelector('.ccswitch-app-tabs')).toBeInTheDocument()
    expect([...figures[2].querySelectorAll('.ccswitch-app-tabs > span')].map(tab => tab.getAttribute('aria-label'))).toEqual(['Claude Code', 'Claude Desktop', 'Codex', 'Gemini', 'Grok Build', 'OpenCode', 'OpenClaw', 'Hermes', 'Pi', 'MiniMax Code'])
    expect(figures[2].querySelectorAll('.ccswitch-app-tabs .ccswitch-app-icon > img')).toHaveLength(10)
    expect(figures[2].querySelectorAll('.ccswitch-app-tabs .ccswitch-app-badge')).toHaveLength(2)
    expect(figures[2].querySelector('.ccswitch-brand strong')).toHaveTextContent('CC Switch')
    expect(figures[2].querySelector('.ccswitch-add')).toHaveAttribute('title', '添加供应商')
    expect(figures[2].querySelector('.ccswitch-toolbar')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-appbar')).toBeInTheDocument()
    expect([...figures[2].querySelectorAll('.ccswitch-provider-info strong')].map(provider => provider.textContent)).toEqual(['OpenAI Official', 'DeepSeek', '智谱 GLM'])
    expect(figures[2].querySelector('.ccswitch-provider-logo-deepseek img')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-provider-active')).toHaveTextContent('OpenAI Official')
    expect(figures[2].querySelector('.ccswitch-provider-logo-openai-official img')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-provider-actions'), 'hover actions only appear on the card the user must click').not.toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-tool-group')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-confirm-dialog')).toHaveTextContent('https://gateway.test')
    expect(figures[2].querySelector('.ccswitch-confirm-dialog .codex-number-callout')).toHaveTextContent('③')
    expect(figures[3]).toHaveTextContent('https://gateway.test')
    expect(figures[3].querySelector('.ccswitch-provider-actions')).toHaveTextContent('启用')
    expect(figures[3].querySelector('.ccswitch-provider-actions .codex-number-callout')).toHaveTextContent('④')
  })

  it('uses the configured Sub2API name and logo in the Codex setup sketch', () => {
    const { container } = render(<ClientSetupDiagram clientId="codex" method="cc-switch" baseURL="https://gateway.test" model="gpt-6-astra" systemName="示例网关" siteLogoUrl="/brand.svg" />)

    expect(container.querySelectorAll('.sub2api-brand strong')).toHaveLength(2)
    expect([...container.querySelectorAll('.sub2api-brand strong')].every(name => name.textContent === '示例网关')).toBe(true)
    expect([...container.querySelectorAll('.sub2api-brand img')].every(logo => logo.getAttribute('src')?.endsWith('/brand.svg'))).toBe(true)
    expect(container.querySelectorAll('.sub2api-brand img')).toHaveLength(2)
  })

  it('uses the configured system name for imported Codex provider labels', () => {
    const { container } = render(<ClientSetupDiagram clientId="codex" method="cc-switch" baseURL="https://gateway.test" model="gpt-6-astra" systemName="示例网关" />)

    expect(container).toHaveTextContent('示例网关')
    expect(container).not.toHaveTextContent('Codex Desktop')
  })

  it('draws the Pi CC Switch flow as provider-panel and form sketches with the chosen address and model', () => {
    const steps = ['打开 Pi 面板', '填写供应商', '添加模型', '启用供应商', '重新打开 Pi 并运行 /model']
    const { container } = render(<ClientSetupDiagram clientId="pi" method="cc-switch" baseURL="https://gateway.test" model="deepseek-v4" systemName="演示网关" steps={steps} />)
    const figures = screen.getAllByRole('figure')

    expect(figures.map(figure => figure.id)).toEqual(['pi-step-1', 'pi-step-2', 'pi-step-3', 'pi-step-4'])
    expect(figures[0].querySelector('.ccswitch-app-tabs .is-current')).toHaveAttribute('aria-label', 'Pi')
    expect(figures[0].querySelector('.ccswitch-add')).toHaveTextContent('①')
    expect(figures[1]).toHaveTextContent('供应商标识gateway')
    expect(figures[1]).toHaveTextContent('OpenAI Chat Completions')
    expect(figures[1]).toHaveTextContent('https://gateway.test/v1')
    expect(figures[1]).not.toHaveTextContent('sk-')
    expect(figures[1].querySelector('.ccswitch-field-marked')).toHaveTextContent('②')
    expect(figures[2].querySelector('.ccswitch-model-grid')).toHaveTextContent('deepseek-v4')
    expect(figures[2].querySelector('.ccswitch-outline-button:last-of-type')).toHaveTextContent('添加模型③')
    const enabled = figures[3].querySelector('.ccswitch-provider-new')
    expect(enabled).toHaveTextContent('演示网关')
    expect(enabled?.querySelector('.ccswitch-enable-additive')).toHaveTextContent('启用④')
    expect([...figures[3].querySelectorAll('.ccswitch-provider-info strong')].map(provider => provider.textContent)).toEqual(['演示网关', 'OpenAI', 'Anthropic', 'DeepSeek', '智谱 GLM'])
    expect(container.querySelector('#pi-step-5')).toHaveTextContent('/model')
    expect(container.querySelectorAll('.codex-number-callout')).toHaveLength(4)
  })

  it('lets readers switch the Pi sketch API format without leaving the illustration', async () => {
    Element.prototype.hasPointerCapture = vi.fn(() => false)
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
    const user = userEvent.setup()
    render(<ClientSetupDiagram clientId="pi" method="cc-switch" baseURL="https://gateway.test" model="m" steps={[]} />)
    const figure = screen.getByRole('figure', { name: 'Pi 操作示意：填写供应商信息' })
    const trigger = within(figure).getByRole('combobox', { name: '示意：Pi 接口格式（仅切换草图展示）' })
    expect(trigger).toHaveTextContent('OpenAI Chat Completions')
    expect(figure).toHaveTextContent('https://gateway.test/v1')

    await user.click(trigger)
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(['OpenAI Chat Completions', 'OpenAI Responses', 'Anthropic Messages', 'Google Generative AI', 'Amazon Bedrock'])
    await user.click(screen.getByRole('option', { name: 'Anthropic Messages' }))
    expect(trigger).toHaveTextContent('Anthropic Messages')
    expect(figure).not.toHaveTextContent('https://gateway.test/v1')
    expect(figure).toHaveTextContent('https://gateway.test')

    await user.click(trigger)
    await user.click(screen.getByRole('option', { name: 'Amazon Bedrock' }))
    expect(figure).toHaveTextContent('平台网关不提供此格式')
  })

  it('keeps the Paseo example independent of the gateway address', () => {
    render(<ClientSetupDiagram clientId="paseo" method="manual" baseURL={null} model="" />)
    expect(screen.getByRole('figure', { name: 'paseo 界面操作示意' })).toHaveTextContent('当前主机 → Providers')
    expect(screen.getByRole('figure')).toHaveTextContent('检查可用提供方')
  })

  it('draws the manual web UI address and hides invalid examples', () => {
    const { rerender } = render(<ClientSetupDiagram clientId="deepseek-harness" method="manual" baseURL="https://gateway.test" model="model-a" />)
    expect(within(screen.getByRole('figure')).getByText('https://gateway.test/v1')).toBeInTheDocument()
    rerender(<ClientSetupDiagram clientId="deepseek-harness" method="manual" baseURL={null} model="model-a" />)
    expect(screen.queryByRole('figure')).not.toBeInTheDocument()
  })
})
