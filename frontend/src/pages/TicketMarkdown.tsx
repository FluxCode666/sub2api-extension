import { renderMarkdown } from '@/lib/markdown'
import './TicketMarkdown.css'

/** 安全展示用户与管理员的工单消息。 */
export default function TicketMarkdown({ body }: { body: string }) {
  return <div className="ticket-markdown mt-2 text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
}
