import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronDown, RotateCcw } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { zhCN } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface PromotionDateTimeRangePickerProps {
  startAt: string
  endAt: string
  onChange: (value: { startAt: string; endAt: string }) => void
}

const hourOptions = Array.from({ length: 24 }, (_, value) => String(value).padStart(2, '0'))
const minuteOptions = Array.from({ length: 60 }, (_, value) => String(value).padStart(2, '0'))

function datePart(value: string): string {
  return value.slice(0, 10)
}

function timePart(value: string, fallback: string): string {
  const time = value.slice(11, 16)
  return /^\d{2}:\d{2}$/.test(time) ? time : fallback
}

function parseLocalDate(value: string): Date | undefined {
  const [year, month, day] = value.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const result = new Date(year, month - 1, day)
  return Number.isNaN(result.getTime()) ? undefined : result
}

function localDateString(value: Date): string {
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatDate(value: string): string {
  const date = parseLocalDate(value)
  return date ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date) : '未选择'
}

export function PromotionDateTimeRangePicker({ startAt, endAt, onChange }: PromotionDateTimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [compactCalendar, setCompactCalendar] = useState(false)
  const startDate = datePart(startAt)
  const endDate = datePart(endAt)
  const startTime = timePart(startAt, '00:00')
  const endTime = timePart(endAt, '23:59')
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(() => ({
    from: parseLocalDate(startDate),
    to: parseLocalDate(endDate),
  }))

  useEffect(() => {
    if (!open) setCalendarRange({ from: parseLocalDate(startDate), to: parseLocalDate(endDate) })
  }, [open, startDate, endDate])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 640px)')
    const update = () => setCompactCalendar(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const summary = useMemo(() => {
    if (startDate && endDate) return `${formatDate(startDate)} ${startTime} → ${formatDate(endDate)} ${endTime}`
    if (startDate) return `${formatDate(startDate)} ${startTime} 起`
    if (endDate) return `截至 ${formatDate(endDate)} ${endTime}`
    return '选择活动日期时间范围'
  }, [startDate, endDate, startTime, endTime])

  const handleCalendarSelect = (next: DateRange | undefined) => {
    setCalendarRange(next)
    if (!next?.from) {
      onChange({ startAt: '', endAt: '' })
      return
    }
    const from = next.from
    const to = next.to
    const start = to && from > to ? to : from
    const end = to && from > to ? from : to
    onChange({
      startAt: `${localDateString(start)}T${startTime}`,
      endAt: end ? `${localDateString(end)}T${endTime}` : '',
    })
  }

  const handleTimeChange = (key: 'startAt' | 'endAt', part: 'hour' | 'minute', value: string) => {
    if (key === 'startAt' && startDate) {
      const nextTime = part === 'hour' ? `${value}:${startTime.slice(3)}` : `${startTime.slice(0, 2)}:${value}`
      onChange({ startAt: `${startDate}T${nextTime}`, endAt })
    }
    if (key === 'endAt' && endDate) {
      const nextTime = part === 'hour' ? `${value}:${endTime.slice(3)}` : `${endTime.slice(0, 2)}:${value}`
      onChange({ startAt, endAt: `${endDate}T${nextTime}` })
    }
  }

  const clear = () => {
    setCalendarRange(undefined)
    onChange({ startAt: '', endAt: '' })
  }

  return (
    <div className="grid gap-1 sm:col-span-2">
      <Label htmlFor="promotion-date-range">活动日期时间范围</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id="promotion-date-range" type="button" variant="outline" aria-expanded={open} className="w-full justify-start gap-2 font-normal">
            <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-left">{summary}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} collisionPadding={12} className="w-auto max-w-[calc(100vw-1.5rem)] p-0">
          <Calendar mode="range" selected={calendarRange} onSelect={handleCalendarSelect} numberOfMonths={compactCalendar ? 1 : 2} locale={zhCN} autoFocus />
          <div className="grid gap-3 border-t p-3 sm:grid-cols-2">
            <div>
              <Label className="text-xs">开始时间</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Select value={startTime.slice(0, 2)} onValueChange={(value) => handleTimeChange('startAt', 'hour', value)} disabled={!startDate}>
                  <SelectTrigger aria-label="开始时间（时）"><SelectValue placeholder="时" /></SelectTrigger>
                  <SelectContent>{hourOptions.map((hour) => <SelectItem key={`start-hour-${hour}`} value={hour}>{hour} 时</SelectItem>)}</SelectContent>
                </Select>
                <Select value={startTime.slice(3)} onValueChange={(value) => handleTimeChange('startAt', 'minute', value)} disabled={!startDate}>
                  <SelectTrigger aria-label="开始时间（分）"><SelectValue placeholder="分" /></SelectTrigger>
                  <SelectContent>{minuteOptions.map((minute) => <SelectItem key={`start-minute-${minute}`} value={minute}>{minute} 分</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">结束时间</Label>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <Select value={endTime.slice(0, 2)} onValueChange={(value) => handleTimeChange('endAt', 'hour', value)} disabled={!endDate}>
                  <SelectTrigger aria-label="结束时间（时）"><SelectValue placeholder="时" /></SelectTrigger>
                  <SelectContent>{hourOptions.map((hour) => <SelectItem key={`end-hour-${hour}`} value={hour}>{hour} 时</SelectItem>)}</SelectContent>
                </Select>
                <Select value={endTime.slice(3)} onValueChange={(value) => handleTimeChange('endAt', 'minute', value)} disabled={!endDate}>
                  <SelectTrigger aria-label="结束时间（分）"><SelectValue placeholder="分" /></SelectTrigger>
                  <SelectContent>{minuteOptions.map((minute) => <SelectItem key={`end-minute-${minute}`} value={minute}>{minute} 分</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="flex justify-end border-t p-2">
            <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={!startAt && !endAt}>
              <RotateCcw className="mr-2 h-3.5 w-3.5" aria-hidden="true" />清除
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
