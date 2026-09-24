import { Button } from '@/components/ui/button'
import { TicketStatusBadge } from '@/components/TicketStatusBadge'
import { formatTicketDate, formatTicketRelative, type TicketStatus } from '@/lib/tickets'
import { cn } from '@/lib/utils'

interface TicketListItemProps {
  subject: string
  status: TicketStatus
  /** 工单编号，例如 "#41"。 */
  reference: string
  /** 管理端用于展示提交人；用户端不传。 */
  secondary?: string
  updatedAt: string
  selected: boolean
  onSelect: () => void
}

/** 工单列表行，管理端与用户端共用选中态、状态标签和时间排版。 */
export function TicketListItem({ subject, status, reference, secondary, updatedAt, selected, onSelect }: TicketListItemProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'relative h-auto w-full justify-start rounded-none px-4 py-3 text-left transition-colors',
        selected ? 'bg-muted hover:bg-muted' : 'hover:bg-muted/50',
      )}
    >
      {selected && <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] rounded-r bg-primary" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{subject}</span>
          <TicketStatusBadge status={status} className="shrink-0 px-2 py-0 text-[11px]" />
        </span>
        <span className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 font-mono text-[11px]">{reference}</span>
          {secondary && (
            <>
              <span aria-hidden="true" className="text-border">|</span>
              <span className="min-w-0 truncate">{secondary}</span>
            </>
          )}
        </span>
        <span className="mt-1 block text-[11px] text-muted-foreground" title={formatTicketDate(updatedAt)}>
          更新于 {formatTicketRelative(updatedAt)}
        </span>
      </span>
    </Button>
  )
}
