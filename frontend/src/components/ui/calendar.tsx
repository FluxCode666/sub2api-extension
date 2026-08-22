import { DayPicker, type DayPickerProps } from "react-day-picker"

import { cn } from "@/lib/utils"

export type CalendarProps = DayPickerProps

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("aux-shadcn-calendar", className)}
      classNames={{
        root: "aux-shadcn-calendar-root",
        months: "aux-shadcn-calendar-months",
        month: "aux-shadcn-calendar-month",
        month_caption: "aux-shadcn-calendar-month-caption",
        caption_label: "aux-shadcn-calendar-caption-label",
        nav: "aux-shadcn-calendar-nav",
        button_previous: "aux-shadcn-calendar-nav-button aux-shadcn-calendar-nav-button--previous",
        button_next: "aux-shadcn-calendar-nav-button aux-shadcn-calendar-nav-button--next",
        chevron: "aux-shadcn-calendar-chevron",
        month_grid: "aux-shadcn-calendar-grid",
        weekdays: "aux-shadcn-calendar-weekdays",
        weekday: "aux-shadcn-calendar-weekday",
        weeks: "aux-shadcn-calendar-weeks",
        week: "aux-shadcn-calendar-week",
        day: "aux-shadcn-calendar-day",
        day_button: "aux-shadcn-calendar-day-button",
        range_start: "aux-shadcn-calendar-range-start",
        range_middle: "aux-shadcn-calendar-range-middle",
        range_end: "aux-shadcn-calendar-range-end",
        today: "aux-shadcn-calendar-today",
        outside: "aux-shadcn-calendar-outside",
        disabled: "aux-shadcn-calendar-disabled",
        hidden: "aux-shadcn-calendar-hidden",
        ...classNames,
      }}
      {...props}
    />
  )
}

Calendar.displayName = "Calendar"

export { Calendar }
