import DOMPurify from 'dompurify'
import { marked } from 'marked'

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
}

/** 将管理员填写的活动说明安全转换为可展示的 HTML。 */
export function renderPromotionMarkdown(markdown: string): string {
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
