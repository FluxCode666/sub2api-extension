import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, Clock3, RotateCcw } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import { zhCN } from 'date-fns/locale'

import { Calendar } from '@/components/ui/calendar'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export interface TTFTDateTimeRangeValue {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

interface TTFTDateTimeRangePickerProps {
  value: TTFTDateTimeRangeValue
  onChange: (value: TTFTDateTimeRangeValue) => void
}

interface TTFTTimeSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
}

const timeOptions = Array.from({ length: 24 * 60 }, (_, minuteOfDay) => {
  const hour = String(Math.floor(minuteOfDay / 60)).padStart(2, '0')
  const minute = String(minuteOfDay % 60).padStart(2, '0')
  return `${hour}:${minute}`
})

function TTFTTimeSelect({ label, value, onChange }: TTFTTimeSelectProps) {
  return (
    <div className="aux-ttft-date-range-time-field">
      <span className="aux-ttft-date-range-time-label">
        <Clock3 aria-hidden="true" />
        {label}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="aux-ttft-time-select-trigger" aria-label={`${label}选择`}>
          <SelectValue placeholder={value} />
        </SelectTrigger>
        <SelectContent
          align="start"
          position="popper"
          className="aux-ttft-time-select-content"
        >
          {timeOptions.map((time) => (
            <SelectItem key={time} value={time} className="aux-ttft-time-select-item">
              {time}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
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

function displayDate(value: string): string {
  const date = parseLocalDate(value)
  if (!date) return value || '未选择'
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(date)
}

function displayRange(value: TTFTDateTimeRangeValue): string {
  return `${displayDate(value.startDate)} ${value.startTime} — ${displayDate(value.endDate)} ${value.endTime}`
}

export function TTFTDateTimeRangePicker({ value, onChange }: TTFTDateTimeRangePickerProps) {
  const [open, setOpen] = useState(false)
  const [compactCalendar, setCompactCalendar] = useState(false)
  const [calendarRange, setCalendarRange] = useState<DateRange | undefined>(() => ({
    from: parseLocalDate(value.startDate),
    to: parseLocalDate(value.endDate),
  }))
  const [calendarMonth, setCalendarMonth] = useState(() => parseLocalDate(value.startDate) ?? new Date())

  useEffect(() => {
    if (!open) {
      setCalendarRange({ from: parseLocalDate(value.startDate), to: parseLocalDate(value.endDate) })
      setCalendarMonth(parseLocalDate(value.startDate) ?? new Date())
    }
  }, [open, value.startDate, value.endDate])

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const media = window.matchMedia('(max-width: 640px)')
    const update = () => setCompactCalendar(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  const summary = useMemo(() => displayRange(value), [value])

  const updateTime = (key: 'startTime' | 'endTime', next: string) => {
    onChange({ ...value, [key]: next })
  }

  const handleCalendarSelect = (next: DateRange | undefined) => {
    setCalendarRange(next)
    if (!next?.from || !next.to) return
    const start = next.from <= next.to ? next.from : next.to
    const end = next.from <= next.to ? next.to : next.from
    onChange({ ...value, startDate: localDateString(start), endDate: localDateString(end) })
  }

  const chooseToday = () => {
    const today = localDateString(new Date())
    const next = { ...value, startDate: today, endDate: today }
    setCalendarRange({ from: parseLocalDate(today), to: parseLocalDate(today) })
    setCalendarMonth(parseLocalDate(today) ?? new Date())
    onChange(next)
  }

  return (
    <div className="aux-ttft-date-range-picker">
      <span className="aux-ttft-time-range-label">日期与时间范围</span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="aux-ttft-date-range-trigger"
            aria-label="选择首字延迟日期和时间范围"
          >
            <CalendarDays aria-hidden="true" />
            <span className="aux-ttft-date-range-trigger-copy">
              <span className="aux-ttft-date-range-trigger-value">
                <small>开始</small>
                <strong>{displayDate(value.startDate)}</strong>
                <em>{value.startTime}</em>
              </span>
              <i aria-hidden="true">→</i>
              <span className="aux-ttft-date-range-trigger-value">
                <small>结束</small>
                <strong>{displayDate(value.endDate)}</strong>
                <em>{value.endTime}</em>
              </span>
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} collisionPadding={16} className="aux-ttft-date-range-popover">
          <div className="aux-ttft-date-range-popover-heading">
            <div>
              <span>查询时间窗口</span>
              <strong>选择起止日期与时间</strong>
            </div>
            <Button type="button" variant="ghost" className="aux-ttft-date-range-today" onClick={chooseToday}>
              <RotateCcw aria-hidden="true" />今天
            </Button>
          </div>
          <Calendar
            mode="range"
            selected={calendarRange}
            onSelect={handleCalendarSelect}
            resetOnSelect
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            numberOfMonths={compactCalendar ? 1 : 2}
            pagedNavigation
            defaultMonth={parseLocalDate(value.startDate)}
            locale={zhCN}
            autoFocus
          />
          <div className="aux-ttft-date-range-times">
            <TTFTTimeSelect
              label="开始时间"
              value={value.startTime}
              onChange={(next) => updateTime('startTime', next)}
            />
            <span className="aux-ttft-date-range-arrow" aria-hidden="true">→</span>
            <TTFTTimeSelect
              label="结束时间"
              value={value.endTime}
              onChange={(next) => updateTime('endTime', next)}
            />
          </div>
          <div className="aux-ttft-date-range-popover-footer">
            <span><Check aria-hidden="true" />{summary}</span>
            <Button type="button" variant="default" className="aux-ttft-date-range-done" onClick={() => setOpen(false)}>完成</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
