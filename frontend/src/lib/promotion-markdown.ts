import { renderMarkdown } from '@/lib/markdown'

/** 将管理员填写的活动说明安全转换为可展示的 HTML。 */
export function renderPromotionMarkdown(markdown: string): string {
  return renderMarkdown(markdown)
}
