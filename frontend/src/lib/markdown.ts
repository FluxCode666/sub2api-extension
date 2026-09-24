import DOMPurify from 'dompurify'
import { marked } from 'marked'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

/** 将不可信 Markdown 转换为安全的 HTML，原始 HTML 始终按文本展示。 */
export function renderMarkdown(markdown: string): string {
  const renderer = new marked.Renderer()
  renderer.html = ({ text }) => escapeHtml(text)
  const html = marked.parse(markdown, {
    gfm: true,
    breaks: true,
    silent: true,
    async: false,
    renderer,
  })
  return DOMPurify.sanitize(typeof html === 'string' ? html : '', {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'svg', 'math'],
    FORBID_ATTR: ['style'],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|\/|#)/i,
  })
}
