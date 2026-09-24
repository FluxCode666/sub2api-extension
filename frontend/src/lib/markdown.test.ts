import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  it('renders GFM formatting and line breaks', () => {
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown('**重点**\n下一行\n\n- 步骤一\n\n```sh\necho ok\n```\n\n| 字段 | 值 |\n| --- | --- |\n| a | b |')

    expect(container.querySelector('strong')?.textContent).toBe('重点')
    expect(container.querySelector('br')).not.toBeNull()
    expect(container.querySelector('li')?.textContent).toBe('步骤一')
    expect(container.querySelector('pre code')?.textContent).toContain('echo ok')
    expect(container.querySelector('td')?.textContent).toBe('a')
  })

  it('escapes raw HTML and rejects dangerous link protocols', () => {
    const container = document.createElement('div')
    container.innerHTML = renderMarkdown('<img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1)) [安全](https://example.com)')

    expect(container.querySelector('img, script, [onerror]')).toBeNull()
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>')
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    expect(container.querySelector('a[href="https://example.com"]')?.textContent).toBe('安全')
  })
})
