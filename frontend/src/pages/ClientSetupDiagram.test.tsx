import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClientSetupDiagram } from './ClientSetupDiagram'

describe('ClientSetupDiagram', () => {
  it.each([
    ['claude-code', 'https://gateway.test', 'Anthropic Messages'],
    ['claude-desktop', 'https://gateway.test', 'Anthropic Messages'],
    ['grok-build', 'https://gateway.test/v1', 'OpenAI Chat Completions'],
    ['pi', 'https://gateway.test/v1', 'OpenAI Chat Completions'],
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
    expect(figures[2].querySelectorAll('.ccswitch-app-tabs .ccswitch-app-icon')).toHaveLength(7)
    expect(figures[2].querySelectorAll('.ccswitch-app-tabs .ccswitch-app-icon img')).toHaveLength(4)
    expect(figures[2].querySelectorAll('.ccswitch-app-tabs .ccswitch-app-icon svg')).toHaveLength(3)
    expect(figures[2].querySelector('.ccswitch-toolbar')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-appbar')).toBeInTheDocument()
    expect([...figures[2].querySelectorAll('.ccswitch-provider-info strong')].map(provider => provider.textContent)).toEqual(['PackyCode', 'MiniMax', 'OpenRouter', 'OpenAI'])
    expect(figures[2].querySelector('.ccswitch-provider-logo-openai svg')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-provider-logo-minimax svg')).toBeInTheDocument()
    expect(figures[2].querySelector('.ccswitch-provider-logo-openrouter svg')).toBeInTheDocument()
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
