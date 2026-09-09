import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/lib/api-client'
import ApiDocsPage from './ApiDocsPage'

function renderPage(entry = '/api-docs') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ApiDocsPage />
    </MemoryRouter>,
  )
}

afterEach(() => {
  window.localStorage.removeItem('aux-client-docs-theme')
})

describe('ApiDocsPage', () => {
  it('renders the public API reference and endpoint cards', () => {
    renderPage()

    expect(screen.getByRole('heading', { name: /把模型能力.*接入你的产品/ })).toBeInTheDocument()
    const openAiHeading = screen.getByRole('heading', { name: 'OpenAI 兼容' })
    expect(openAiHeading).toBeInTheDocument()
    expect(openAiHeading.closest('.aux-api-endpoint-group')).toHaveClass('aux-api-endpoint-group--openai')
    expect(screen.getByText('多模态', { selector: '.aux-api-sidebar-group-label' })).toHaveClass('aux-api-sidebar-group-label')
    expect(screen.getAllByText('/v1/chat/completions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('/v1beta/models/{model}:generateContent').length).toBeGreaterThan(0)
  })

  it('lists every endpoint in the fixed elevator navigation', () => {
    renderPage()

    expect(screen.getByRole('complementary', { name: '文档与接口端点目录' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'POST /v1/chat/completions' })).toHaveAttribute('href', '#endpoint-chat-completions')
    expect(screen.getByRole('link', { name: 'GET /v1/models' })).toHaveAttribute('href', '#endpoint-models')
    expect(screen.getByRole('link', { name: 'POST /v1/messages' })).toHaveAttribute('href', '#endpoint-messages')
    expect(screen.getByRole('link', { name: 'POST /v1beta/models/{model}:generateContent' })).toHaveAttribute('href', '#endpoint-gemini-generate-content')
  })

  it('links back to the public homepage from the top navigation', () => {
    renderPage()

    expect(screen.getByRole('link', { name: '官网' })).toHaveAttribute('href', '/sub2api-home')
  })

  it.each(['light', 'dark'] as const)('supports an explicit %s appearance theme', (preference) => {
    const { container } = renderPage(`/api-docs?theme=${preference}`)

    expect(screen.getByRole('combobox', { name: '外观主题' })).toHaveValue(preference)
    expect(container.querySelector('.aux-api-docs')).toHaveAttribute('data-theme', preference)
    fireEvent.change(screen.getByRole('combobox', { name: '外观主题' }), { target: { value: preference === 'light' ? 'dark' : 'light' } })
    expect(container.querySelector('.aux-api-docs')).toHaveAttribute('data-theme', preference === 'light' ? 'dark' : 'light')
  })

  it('removes the standalone endpoint directory, search box, and group tabs', () => {
    renderPage()

    expect(screen.queryByRole('heading', { name: '接口目录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: '搜索接口' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: '接口分组' })).not.toBeInTheDocument()
  })

  it('accepts an API base URL and marks embedded mode from the query string', () => {
    const { container } = renderPage('/api-docs?embed=1&api_base=https%3A%2F%2Fapi.example.com')

    expect(screen.getByDisplayValue('https://api.example.com')).toBeInTheDocument()
    expect(container.querySelector('.aux-api-docs')).toHaveClass('aux-api-docs--embedded')
  })

  it('uses the current page origin as the API address placeholder by default', () => {
    renderPage()

    const input = screen.getByRole('textbox', { name: 'API 基础地址' })
    expect(input).toHaveValue(window.location.origin)
    expect(input).toHaveAttribute('placeholder', window.location.origin)
    expect(document.querySelectorAll('.aux-api-base-url > div > span')).toHaveLength(0)
  })

  it('uses the configured system name in the document chrome', async () => {
    const getConfig = vi.spyOn(apiClient, 'get').mockResolvedValue({
      code: 0,
      message: 'ok',
      data: {
        model: 'gpt-6-astra',
        siteName: 'TERALEMO',
        siteLogoUrl: 'https://cdn.example.com/logo.svg',
        systemDomain: 'https://gateway.example.com/',
        documentationUrl: 'https://docs.example.com',
        termsUrl: 'https://example.com/terms',
        privacyUrl: '/privacy',
      },
    } as never)

    renderPage()

    const footer = screen.getByRole('contentinfo')
    await waitFor(() => expect(footer).toHaveTextContent('TERALEMO · API 文档'))
    expect(footer.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.com/logo.svg')
    expect(footer).toHaveTextContent('gateway.example.com')
    expect(within(footer).getByRole('link', { name: /客户端接入/ })).toHaveAttribute('href', expect.stringContaining('/client-docs'))
    expect(within(footer).getByRole('link', { name: /官网/ })).toHaveAttribute('href', '/sub2api-home')
    expect(within(footer).getByRole('link', { name: /使用文档/ })).toHaveAttribute('target', '_blank')
    expect(within(footer).getByRole('link', { name: /服务条款/ })).toHaveAttribute('target', '_blank')
    expect(within(footer).getByRole('link', { name: /隐私协议/ })).toHaveAttribute('href', '/privacy')
    getConfig.mockRestore()
  })

  it('keeps deployment instructions out of the user-facing document', () => {
    renderPage()

    expect(screen.queryByRole('link', { name: '嵌入与挂载' })).not.toBeInTheDocument()
    expect(screen.queryByText('管理员 / 集成方说明')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Sub2API custom_menu_items')
  })

  it('does not link to a fixed homepage route', () => {
    renderPage()

    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /\/p\/home/ })).not.toBeInTheDocument()
  })

  it('shows parameter contracts and switches example languages inside an endpoint card', () => {
    renderPage()

    expect(screen.getByText('model', { selector: 'code' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /响应参数/ }))
    expect(screen.getByText('choices[].message', { selector: 'code' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '调用示例' }))
    expect(screen.getAllByText(/gpt-6-astra/).length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('tab', { name: 'Python' }))
    expect(screen.getByText(/import requests/)).toBeInTheDocument()
  })

  it('keeps request examples provider-neutral', () => {
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: '调用示例' }))
    expect(document.body.textContent).not.toContain('$SUB2API_API_KEY')
    expect(document.body.textContent).not.toContain('sk-sub2api')
    expect(document.body.textContent).not.toContain('your-sub2api-host')
    expect(document.body.textContent).toContain('$API_KEY')

    fireEvent.click(screen.getByRole('tab', { name: 'Python' }))
    expect(document.body.textContent).not.toContain('SUB2API_API_KEY')
  })

  it('copies code using the browser clipboard API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderPage()

    fireEvent.click(screen.getByRole('tab', { name: '调用示例' }))
    fireEvent.click(screen.getAllByRole('button', { name: '复制代码' })[0])

    await waitFor(() => expect(writeText).toHaveBeenCalled())
  })

  it('provides a Markdown copy action for every endpoint', () => {
    renderPage()

    const markdownButtons = screen.getAllByRole('button', { name: /复制 .* Markdown 文档/ })
    expect(markdownButtons).toHaveLength(7)
    expect(document.querySelectorAll('.aux-api-endpoint-card .aux-api-markdown-button')).toHaveLength(7)
  })

  it('copies a complete Markdown document for an endpoint', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderPage()

    const card = document.querySelector('#endpoint-chat-completions')
    expect(card).not.toBeNull()
    const copyButton = within(card as HTMLElement).getByRole('button', { name: /复制 .* Markdown 文档/ })
    fireEvent.click(copyButton)

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    const markdown = writeText.mock.calls[0][0] as string
    expect(markdown).toContain('# Chat Completions')
    expect(markdown).toContain('> OpenAI 兼容 · `POST` `/v1/chat/completions`')
    expect(markdown).toContain('## 请求参数')
    expect(markdown).toContain('| `model` | `string` | 否 | `-` |')
    expect(markdown).toContain('## 请求体示例')
    expect(markdown).toContain('"model": "gpt-6-astra"')
    expect(markdown).toContain('## 响应参数')
    expect(markdown).toContain('## 响应示例')
    expect(markdown).toContain('## 调用示例')
    expect(markdown).toContain('```curl')
    expect(markdown).toContain('```python')
    expect(markdown).toContain('```go')
    expect(markdown).toContain('```java')
    expect(markdown).toContain('$API_KEY')
    expect(markdown).toContain(window.location.origin)
    expect(markdown).not.toContain('SUB2API_API_KEY')

    await waitFor(() => expect(copyButton).toHaveTextContent('已复制 Markdown'))
  })
})
