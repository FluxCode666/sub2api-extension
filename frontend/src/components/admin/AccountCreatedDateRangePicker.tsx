import { useState } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { CalendarDays } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface AccountCreatedDateRangePickerProps {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

/** 通过同一日历选择账号创建日期范围，保留本地日期口径。 */
export function AccountCreatedDateRangePicker({ from, to, onChange }: AccountCreatedDateRangePickerProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected = from ? { from: new Date(`${from}T00:00:00`), to: to ? new Date(`${to}T00:00:00`) : undefined } : undefined;

  return (
    <div className="aux-account-filter-field aux-account-date-range-filter">
      <Label htmlFor="account-created-range" className="text-xs font-normal">创建时间</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id="account-created-range" type="button" variant="outline" className={`h-9 w-full justify-start gap-2 text-left text-xs font-normal ${from ? "" : "text-muted-foreground"}`} aria-describedby="account-date-hint">
            <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{from ? `${from} — ${to || "选择结束日期"}` : "选择创建日期范围"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="w-auto max-w-[calc(100vw-24px)] max-h-[var(--radix-popover-content-available-height)] overflow-y-auto p-0" aria-label="创建日期范围">
          <Calendar
            mode="range"
            selected={selected}
            defaultMonth={selected?.from}
            onSelect={(range) => onChange(range?.from ? format(range.from, "yyyy-MM-dd") : "", range?.to ? format(range.to, "yyyy-MM-dd") : "")}
            resetOnSelect
            numberOfMonths={isMobile ? 1 : 2}
            locale={zhCN}
            labels={{ labelDayButton: (date) => format(date, "yyyy-MM-dd") }}
            autoFocus
          />
          <div className="border-t p-2">
            <Button type="button" variant="ghost" size="sm" className="w-full" disabled={!from && !to} onClick={() => { onChange("", ""); setOpen(false); }}>清除日期范围</Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
