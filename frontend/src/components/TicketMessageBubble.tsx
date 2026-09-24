import TicketMarkdown from '@/components/TicketMarkdown'
import { formatTicketDate } from '@/lib/tickets'
import { cn } from '@/lib/utils'

interface TicketMessageBubbleProps {
  /** 展示用的发送者名称，同时用于头像首字。 */
  senderLabel: string
  createdAt: string
  body: string
  /** 当前视角自己发出的消息：靠右并使用主色底，便于区分对话双方。 */
  self: boolean
}

/** 工单对话气泡，管理端与用户端共用同一套间距、头像和时间排版。 */
export function TicketMessageBubble({ senderLabel, createdAt, body, self }: TicketMessageBubbleProps) {
  return (
    <article className={cn('flex min-w-0 max-w-full gap-3 sm:max-w-[88%]', self && 'ml-auto flex-row-reverse')}>
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border text-xs font-semibold',
          self ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-background text-muted-foreground',
        )}
      >
        {senderLabel.trim().slice(0, 1) || '·'}
      </span>
      <div
        className={cn(
          'min-w-0 flex-1 rounded-xl border px-4 py-3 shadow-sm',
          self ? 'border-primary/25 bg-primary/5' : 'border-border bg-card',
        )}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{senderLabel}</span>
          <time dateTime={createdAt} className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatTicketDate(createdAt)}
          </time>
        </div>
        <TicketMarkdown body={body} />
      </div>
    </article>
  )
}
