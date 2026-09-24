import { Badge } from '@/components/ui/badge'
import { ticketStatusLabel, type TicketStatus } from '@/lib/tickets'
import { cn } from '@/lib/utils'

/**
 * 工单状态色板：待处理使用控制台的暖橙提示需要介入，处理中使用靛蓝主色，
 * 已关闭收敛为中性，避免列表里出现三种同等强度的彩色标签。
 */
const statusTone: Record<TicketStatus, string> = {
  OPEN: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  IN_PROGRESS: 'border-primary/30 bg-primary/10 text-primary dark:border-primary/40',
  CLOSED: 'border-border bg-muted text-muted-foreground',
}

export function TicketStatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <Badge variant="outline" className={cn('gap-1.5 font-medium', statusTone[status], className)}>
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full bg-current', status === 'CLOSED' && 'opacity-50')} />
      {ticketStatusLabel(status)}
    </Badge>
  )
}
