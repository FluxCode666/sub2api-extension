import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CircleHelp,
  RefreshCw,
  Receipt,
  Search,
  WalletCards,
} from "lucide-react";
import { apiClient, type AuxEnvelope } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { AccountCreatedDateRangePicker } from "@/components/admin/AccountCreatedDateRangePicker";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useIsMobile } from "@/hooks/use-mobile";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface CostConfig {
  oauth_account_cost: number;
  api_cost_multiplier: number;
  tax_rate: number;
  currency: string;
}

interface DailyConsumption {
  date: string;
  requests: number;
  total_tokens: number;
  api_requests: number;
  api_tokens: number;
  revenue: number;
  api_revenue: number;
  oauth_revenue: number;
  api_cost: number;
  oauth_cost: number;
  total_cost: number;
  gross_profit: number;
  api_gross_profit: number;
  tax_amount: number;
  profit: number;
  net_profit: number;
  net_margin: number;
  api_tax_amount: number;
  api_net_profit: number;
  api_net_margin: number;
  oauth_account_count: number;
  api_account_count: number;
}

interface AccountConsumption {
  account_id: number;
  account_ids?: number[];
  account_type: string;
  account_types?: string[];
  name: string;
  platform: string;
  billing_group?: string;
  account_created_at?: string | null;
  account_expires_at?: string | null;
  requests: number;
  revenue: number;
  api_revenue?: number;
  oauth_revenue?: number;
  api_cost: number;
  oauth_cost: number;
  gross_profit: number;
  tax_amount: number;
  net_profit: number;
  multiplier: number;
  multiplier_source: string;
  multipliers?: Array<{ account_id: number; multiplier: number; source: string }>;
}

interface DailyAccountConsumption {
  date: string;
  account_id: number;
  account_type: "api" | "oauth" | string;
  name: string;
  platform: string;
  requests: number;
  tokens: number;
  revenue: number;
  api_cost: number;
  oauth_cost: number;
  multiplier: number;
  multiplier_source: string;
}

interface ConsumptionResponse {
  start_time: string;
  end_time: string;
  config: CostConfig;
  total_requests: number;
  total_tokens: number;
  total_revenue: number;
  revenue_available: boolean;
  revenue_source?: string;
  total_api_cost: number;
  total_oauth_cost: number;
  total_cost: number;
  gross_profit: number;
  gross_margin: number;
  total_tax: number;
  profit: number;
  net_profit: number;
  net_margin: number;
  oauth_account_count: number;
  api_account_count: number;
  days: DailyConsumption[];
  daily_accounts?: DailyAccountConsumption[];
  accounts: AccountConsumption[];
}

type DailyAccountType = "api" | "oauth";

const ACCOUNT_PAGE_SIZES = [10, 20, 50, 100] as const;

type ViewState =
  | { status: "loading"; data?: ConsumptionResponse }
  | { status: "ready"; data: ConsumptionResponse }
  | { status: "error"; message: string; data?: ConsumptionResponse };

function localDateValue(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return localDateValue(value);
}

function queryParams(start: string, end: string): string {
  return new URLSearchParams({
    start: `${start}T00:00`,
    end: `${shiftDate(end, 1)}T00:00`,
  }).toString();
}

function formatMoney(value: number, currency = "CNY"): string {
  const code = /^[A-Z]{3}$/.test(currency) ? currency : "CNY";
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(value || 0);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function formatCompact(value: number): string {
  if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString("zh-CN");
}

function formatDay(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      }).format(date);
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

function formatExpiryDateTime(value?: string | null): string {
  if (!value) return "永不过期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const remainingDays = Math.ceil((date.getTime() - Date.now()) / 86400000);
  return `${formatDateTime(value)}（${remainingDays > 0 ? `剩余 ${remainingDays} 天` : "已过期"}）`;
}

function dateStartTimestamp(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

function dateEndExclusiveTimestamp(value: string): number {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.getTime();
}

function matchesAccountFilters(
  account: AccountConsumption,
  search: string,
  createdFrom: string,
  createdTo: string,
  accountType = "all",
  platform = "",
): boolean {
  const needle = search.trim().toLocaleLowerCase();
  if (needle && ![account.name, account.billing_group].some((value) => value?.toLocaleLowerCase().includes(needle))) return false;

  const accountTypes = account.account_types?.length
    ? account.account_types
    : account.account_type === "mixed" ? ["api", "oauth"] : [account.account_type];
  if (accountType !== "all" && !accountTypes.includes(accountType)) return false;
  if (platform && account.platform !== platform) return false;

  const createdAt = account.account_created_at ? new Date(account.account_created_at).getTime() : NaN;
  const from = createdFrom ? dateStartTimestamp(createdFrom) : null;
  const to = createdTo ? dateEndExclusiveTimestamp(createdTo) : null;
  if (from !== null && (!Number.isFinite(createdAt) || createdAt < from)) return false;
  if (to !== null && (!Number.isFinite(createdAt) || createdAt >= to)) return false;
  return true;
}

function AccountListFilters({
  label,
  search,
  onSearchChange,
  createdFrom,
  createdTo,
  onCreatedRangeChange,
  onReset,
  searchId,
  dateRangeId,
  accountType,
  onAccountTypeChange,
  platform,
  platformOptions = [],
  onPlatformChange,
}: {
  label: string;
  search: string;
  onSearchChange: (value: string) => void;
  createdFrom: string;
  createdTo: string;
  onCreatedRangeChange: (from: string, to: string) => void;
  onReset: () => void;
  searchId: string;
  dateRangeId: string;
  accountType?: string;
  onAccountTypeChange?: (value: string) => void;
  platform?: string;
  platformOptions?: string[];
  onPlatformChange?: (value: string) => void;
}) {
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const hasFilters = Boolean(search.trim() || createdFrom || createdTo || (accountType && accountType !== "all") || platform);
  return (
    <div className="aux-cost-list-filters" aria-label={`${label}筛选`}>
      <div className="aux-cost-list-search">
        <Search size={15} aria-hidden="true" />
        <Input
          id={searchId}
          type="search"
          value={search}
          aria-label={`${label}搜索账号`}
          placeholder="搜索账号名称或计费组"
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>
      <AccountCreatedDateRangePicker
        inputId={dateRangeId}
        from={createdFrom}
        to={createdTo}
        onChange={onCreatedRangeChange}
      />
      {onAccountTypeChange && (
        <div className="aux-account-filter-field">
          <Label htmlFor={`${searchId}-type`} className="text-xs font-normal">账号类型</Label>
          <Select value={accountType ?? "all"} onValueChange={onAccountTypeChange}>
            <SelectTrigger id={`${searchId}-type`} aria-label={`${label}账号类型`} className="aux-account-filter-control">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="oauth">OAuth</SelectItem>
              <SelectItem value="api">API</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {onPlatformChange && (
        <div className="aux-account-filter-field">
          <Label htmlFor={`${searchId}-platform`} className="text-xs font-normal">平台</Label>
          <Popover open={platformPickerOpen} onOpenChange={setPlatformPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                id={`${searchId}-platform`}
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={platformPickerOpen}
                aria-label={`${label}平台`}
                className="aux-account-filter-control justify-between gap-2"
              >
                <span className="max-w-36 truncate">{platform || "全部平台"}</span>
                <ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-56 p-0">
              <Command label={`${label}平台`}>
                <CommandInput placeholder="搜索平台…" aria-label={`${label}搜索平台`} />
                <CommandList>
                  <CommandEmpty>没有匹配的平台</CommandEmpty>
                  <CommandGroup>
                    {["", ...platformOptions].map((option) => (
                      <CommandItem
                        key={option || "all"}
                        value={option || "全部平台"}
                        onSelect={() => {
                          onPlatformChange(option);
                          setPlatformPickerOpen(false);
                        }}
                      >
                        <Check className={`mr-2 h-4 w-4 ${platform === option ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                        {option || "全部平台"}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
      <Button type="button" variant="outline" className="aux-cost-list-reset" disabled={!hasFilters} onClick={onReset}>
        清除筛选
      </Button>
    </div>
  );
}

function AccountListPagination({
  label,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  label: string;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const firstItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, total);
  return (
    <footer className="aux-cost-list-pagination aux-account-pagination">
      <span role="status">共 {total} 条{total > 0 ? `，显示 ${firstItem}–${lastItem} 条` : ""}</span>
      <div className="aux-cost-list-pagination-controls aux-account-pagination-controls">
        <div className="aux-account-page-size">
          <span>每页</span>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger aria-label={`${label}每页条数`} className="aux-cost-list-page-size"><SelectValue /></SelectTrigger>
            <SelectContent>{ACCOUNT_PAGE_SIZES.map((size) => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Pagination aria-label={`${label}分页`} className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <Button type="button" variant="outline" size="icon" aria-label="上一页" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
                <ChevronLeft aria-hidden="true" />
              </Button>
            </PaginationItem>
            <PaginationItem><span>第 {currentPage} / {pageCount} 页</span></PaginationItem>
            <PaginationItem>
              <Button type="button" variant="outline" size="icon" aria-label="下一页" disabled={currentPage >= pageCount} onClick={() => onPageChange(currentPage + 1)}>
                <ChevronRight aria-hidden="true" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
    </footer>
  );
}

export default function ConsumptionPage() {
  const today = localDateValue();
  const [draft, setDraft] = useState({
    start: shiftDate(today, -13),
    end: today,
  });
  const [activeRange, setActiveRange] = useState(draft);
  const [view, setView] = useState<ViewState>({ status: "loading" });
  const [dailyAccountType, setDailyAccountType] = useState<DailyAccountType>("api");

  const loadData = useCallback(async (range: typeof activeRange) => {
    setView((current) => ({
      status: "loading",
      data: current.status === "error" ? current.data : undefined,
    }));
    try {
      const envelope = await apiClient.get<AuxEnvelope<ConsumptionResponse>>(
        `/admin/ops/consumption?${queryParams(range.start, range.end)}`,
      );
      if (envelope.code !== 0 || !envelope.data)
        throw new Error(envelope.message || "数据格式异常");
      setView({ status: "ready", data: envelope.data });
    } catch (error) {
      setView({
        status: "error",
        message:
          error instanceof Error ? error.message : "无法读取消费核算数据",
      });
    }
  }, []);

  useEffect(() => {
    void loadData(activeRange);
  }, [activeRange, loadData]);

  const data = view.data;
  const currency = data?.config.currency ?? "CNY";
  const dailyDetailsByType = useMemo(() => {
    const rows = data?.daily_accounts ?? [];
    const aggregateByDate = (items: DailyAccountConsumption[]) => {
      const grouped = new Map<string, DailyAccountConsumption>();
      for (const row of items) {
        const existing = grouped.get(row.date);
        if (!existing) {
          grouped.set(row.date, {
            ...row,
            account_id: 0,
            name: `${row.account_type === "oauth" ? "OAuth" : "API"} 账号汇总`,
            platform: "",
            multiplier: 0,
            multiplier_source: "按日汇总",
          });
          continue;
        }
        existing.requests += row.requests;
        existing.tokens += row.tokens;
        existing.revenue += row.revenue;
        existing.api_cost += row.api_cost;
        existing.oauth_cost += row.oauth_cost;
      }
      return [...grouped.values()].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
    };
    if (rows.length > 0) {
      return {
        api: aggregateByDate(rows.filter((row) => row.account_type === "api")),
        oauth: aggregateByDate(rows.filter((row) => row.account_type === "oauth")),
      };
    }
    const api = aggregateByDate([...(data?.days ?? [])]
      .filter((day) => day.api_requests > 0 || day.api_revenue !== 0 || day.api_cost !== 0)
      .map((day) => ({
        date: day.date,
        account_id: 0,
        account_type: "api",
        name: "API 账号汇总",
        platform: "",
        requests: day.api_requests,
        tokens: day.api_tokens,
        revenue: day.api_revenue,
        api_cost: day.api_cost,
        oauth_cost: 0,
        multiplier: 0,
        multiplier_source: "按日汇总",
      })));
    return { api, oauth: [] };
  }, [data?.daily_accounts, data?.days]);
  const dailyCounts = {
    api: dailyDetailsByType.api.length,
    oauth: dailyDetailsByType.oauth.length,
  };

  const submitRange = () => {
    if (draft.start > draft.end) return;
    setActiveRange(draft);
  };

  if (view.status === "loading" && !data)
    return (
      <div className="aux-cost-page aux-cost-state">
        <RefreshCw className="aux-spin" aria-hidden="true" />
        <span>正在汇总 usage_logs 消费数据…</span>
      </div>
    );

  return (
    <div className="aux-cost-page">
      <header className="aux-cost-header">
        <div>
          <p className="aux-cost-eyebrow">
            <span />
            运营中心 / 消费核算
          </p>
          <h1>消费核算</h1>
          <p>
            {data?.revenue_available
              ? "按天追踪 API 账号收入与用量成本；OAuth 账号采购成本按账号一次性核算。"
              : "按天追踪 API 账号用量与成本；OAuth 账号采购成本按账号一次性核算，不虚构收入和利润。"}
          </p>
        </div>
        <Button
          type="button"
          className="aux-cost-refresh"
          variant="outline"
          onClick={() => void loadData(activeRange)}
          aria-label="刷新消费数据"
        >
          <RefreshCw
            size={16}
            className={view.status === "loading" ? "aux-spin" : ""}
          />
          刷新
        </Button>
      </header>

      <section className="aux-cost-filter" aria-label="日期范围筛选">
        <div className="aux-cost-filter-title">
          <CalendarDays size={17} aria-hidden="true" />
          <div>
            <strong>核算区间</strong>
            <span>按天聚合，最多支持 93 天</span>
          </div>
        </div>
        <DateRangePicker value={draft} onChange={setDraft} />
        <Button type="button" className="aux-cost-apply" onClick={submitRange}>
          应用筛选
        </Button>
      </section>

      {view.status === "error" && (
        <div className="aux-cost-alert" role="alert">
          {view.message}。请确认 Sub2API 数据库连接与管理员会话。
        </div>
      )}

      {data && (
        <>
          <section className="aux-cost-kpis" aria-label="消费概览">
            {data.revenue_available ? <MetricCard
              label="总收入"
              value={formatMoney(data.total_revenue, currency)}
              detail={`${formatCompact(data.total_requests)} 次请求 · 来源 ${data.revenue_source}`}
              icon={<CircleDollarSign />}
              tone="accent"
            /> : <MetricCard
              label="API 请求"
              value={formatCompact(data.total_requests)}
              detail="当前区间全部请求量"
              icon={<BarChart3 />}
              tone="accent"
            />}
            <MetricCard
              label="API Token"
              value={formatCompact(data.total_tokens)}
              detail="当前区间 Token 用量"
              icon={<CircleDollarSign />}
              tone="neutral"
            />
            <MetricCard
              label="API 成本"
              value={formatMoney(data.total_api_cost, currency)}
              detail="按 usage_logs 成本与账号倍率"
              icon={<WalletCards />}
              tone="warm"
            />
            <MetricCard
              label="OAuth 采购成本"
              value={formatMoney(data.total_oauth_cost, currency)}
              detail={`${data.oauth_account_count} 个账号 · 区间内计一次`}
              icon={<WalletCards />}
              tone="warm"
            />
            <MetricCard
              label="总成本"
              value={formatMoney(data.total_cost, currency)}
              detail="API 成本 + OAuth 采购成本"
              icon={<Receipt />}
              tone="neutral"
            />
            {!data.revenue_available ? <MetricCard
              label="API 账号"
              value={formatCompact(data.api_account_count)}
              detail="区间内有用量的 API 账号"
              icon={<BarChart3 />}
              tone="neutral"
            /> : null}
            {data.revenue_available ? <>
            <MetricCard
              label="区间总毛利"
              value={formatMoney(data.gross_profit, currency)}
              detail={
                data.gross_profit >= 0
                  ? `毛利率 ${(data.gross_margin * 100).toFixed(1)}%`
                  : "当前区间需要关注成本"
              }
              icon={
                data.gross_profit >= 0 ? <ArrowUpRight /> : <ArrowDownRight />
              }
              tone={data.gross_profit >= 0 ? "positive" : "negative"}
            />
            <MetricCard
              label="税前利润"
              value={formatMoney(data.profit, currency)}
              detail="当前未配置其他运营费用，因此等于毛利"
              icon={data.profit >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
              tone={data.profit >= 0 ? "positive" : "negative"}
            />
            <MetricCard
              label="税额"
              value={formatMoney(data.total_tax, currency)}
              detail={`税点 ${data.config.tax_rate.toFixed(2)}% · 按收入计提`}
              icon={<Receipt />}
              tone="warm"
            />
            <MetricCard
              label="税后利润"
              value={formatMoney(data.net_profit, currency)}
              detail={
                data.net_profit >= 0
                  ? `税后利润率 ${(data.net_margin * 100).toFixed(1)}%`
                  : "扣税后当前区间为亏损"
              }
              icon={data.net_profit >= 0 ? <ArrowUpRight /> : <ArrowDownRight />}
              tone={data.net_profit >= 0 ? "positive" : "negative"}
            />
            <MetricCard
              label="税后利润率"
              value={`${(data.net_margin * 100).toFixed(1)}%`}
              detail={`${data.oauth_account_count} 个 OAuth 账号参与核算`}
              icon={<BarChart3 />}
              tone="neutral"
            />
            </> : null}
          </section>

          <section className="aux-cost-panel aux-cost-table-panel" aria-label="每日明细">
            <div className="aux-cost-panel-head">
              <div>
                <p className="aux-cost-panel-kicker">Breakdown</p>
                <h2>每日明细</h2>
              </div>
              <span className="aux-cost-range-caption">
                {activeRange.start} — {activeRange.end}
              </span>
            </div>
            <Tabs
              value={dailyAccountType}
              onValueChange={(value) => setDailyAccountType(value as DailyAccountType)}
              className="aux-cost-daily-tabs"
            >
              <TabsList aria-label="每日明细账号类型">
                <TabsTrigger value="api">API 账号 <span>{dailyCounts.api}</span></TabsTrigger>
                <TabsTrigger value="oauth">OAuth 账号 <span>{dailyCounts.oauth}</span></TabsTrigger>
              </TabsList>
              <TabsContent value="api" className="mt-0">
                <DailyDetailsTable rows={dailyDetailsByType.api} type="api" data={data} currency={currency} />
              </TabsContent>
              <TabsContent value="oauth" className="mt-0">
                <DailyDetailsTable rows={dailyDetailsByType.oauth} type="oauth" data={data} currency={currency} />
              </TabsContent>
            </Tabs>
          </section>

          <OAuthPaybackPanel
            accounts={data.accounts}
            currency={currency}
            revenueAvailable={data.revenue_available}
          />

          <AccountCostDetailsPanel accounts={data.accounts} currency={currency} revenueAvailable={data.revenue_available} />
        </>
      )}
    </div>
  );
}

function DateRangePicker({
  value,
  onChange,
}: {
  value: { start: string; end: string };
  onChange: (value: { start: string; end: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const selected = value.start
    ? {
        from: new Date(`${value.start}T00:00:00`),
        to: value.end ? new Date(`${value.end}T00:00:00`) : undefined,
      }
    : undefined;

  return (
    <div className="aux-cost-date-range">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="aux-cost-date-trigger">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{value.start ? `${value.start} — ${value.end}` : "选择日期范围"}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" collisionPadding={12} className="w-auto p-0">
          <Calendar
            mode="range"
            selected={selected}
            defaultMonth={selected?.from}
            numberOfMonths={isMobile ? 1 : 2}
            locale={zhCN}
            resetOnSelect
            labels={{ labelDayButton: (date) => format(date, "yyyy-MM-dd") }}
            onSelect={(range) => {
              onChange({
                start: range?.from ? format(range.from, "yyyy-MM-dd") : "",
                end: range?.to ? format(range.to, "yyyy-MM-dd") : "",
              });
            }}
            autoFocus
          />
          <div className="border-t p-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              disabled={!value.start && !value.end}
              onClick={() => {
                onChange({ start: "", end: "" });
                setOpen(false);
              }}
            >
              清除日期范围
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function DailyDetailsTable({
  rows,
  type,
  data,
  currency,
}: {
  rows: DailyAccountConsumption[];
  type: DailyAccountType;
  data: ConsumptionResponse;
  currency: string;
}) {
  const isApi = type === "api";
  const columnCount = isApi ? 9 : 4;

  return (
    <div className="aux-cost-table-scroll">
      <TooltipProvider>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort="descending">日期</TableHead>
              <TableHead>{isApi ? "API 请求数" : "OAuth 请求数"}</TableHead>
              <TableHead>Token</TableHead>
              {!isApi && <TableHead>当天利润（用户计费）</TableHead>}
              {isApi && <TableHead>API 收入</TableHead>}
              {isApi && <TableHead>API 成本</TableHead>}
              {isApi && <FormulaTableHead label="API 毛利" formula="API 毛利 = API 收入 − API 成本" />}
              {isApi && <FormulaTableHead label="API 税额" formula="API 税额 = API 收入 × 税率" />}
              {isApi && <FormulaTableHead label="API 税后利润" formula="API 税后利润 = API 毛利 − API 税额" />}
              {isApi && <FormulaTableHead label="API 税后利润率" formula="API 税后利润率 = API 税后利润 ÷ API 收入（收入为 0 时不计算）" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columnCount} className="aux-cost-empty-cell">
                  当前区间暂无 {isApi ? "API" : "OAuth"} 账号每日明细
                </TableCell>
              </TableRow>
            ) : rows.map((row) => {
              const grossProfit = row.revenue - row.api_cost;
              const tax = row.revenue * data.config.tax_rate / 100;
              const netProfit = grossProfit - tax;
              return (
                <TableRow key={`${row.date}-${row.account_type}-${row.account_id}`}>
                  <TableCell><strong>{formatDay(row.date)}</strong></TableCell>
                  <TableCell>{row.requests.toLocaleString("zh-CN")}</TableCell>
                  <TableCell>{row.tokens.toLocaleString("zh-CN")}</TableCell>
                  {!isApi && <TableCell>{data.revenue_available ? formatMoney(row.revenue, currency) : "—"}</TableCell>}
                  {isApi && <TableCell>{data.revenue_available ? formatMoney(row.revenue, currency) : "—"}</TableCell>}
                  {isApi && <TableCell>{formatMoney(row.api_cost, currency)}</TableCell>}
                  {isApi && <>
                    <TableCell className={data.revenue_available && grossProfit >= 0 ? "is-positive" : undefined}>
                      {data.revenue_available ? formatMoney(grossProfit, currency) : "—"}
                    </TableCell>
                    <TableCell>{data.revenue_available ? formatMoney(tax, currency) : "—"}</TableCell>
                    <TableCell className={data.revenue_available && netProfit >= 0 ? "is-positive" : undefined}>
                      {data.revenue_available ? formatMoney(netProfit, currency) : "—"}
                    </TableCell>
                    <TableCell>{data.revenue_available && row.revenue > 0 ? `${(netProfit / row.revenue * 100).toFixed(1)}%` : "—"}</TableCell>
                  </>}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TooltipProvider>
    </div>
  );
}

function FormulaTableHead({ label, formula }: { label: string; formula: string }) {
  return (
    <TableHead>
      <span className="aux-cost-table-head-with-help">
        <span>{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="aux-cost-formula-help" aria-label={`${label}计算公式`}>
              <CircleHelp aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{formula}</TooltipContent>
        </Tooltip>
      </span>
    </TableHead>
  );
}

function OAuthPaybackPanel({
  accounts,
  currency,
  revenueAvailable,
}: {
  accounts: AccountConsumption[];
  currency: string;
  revenueAvailable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const oauthAccounts = accounts.filter((account) =>
    account.account_type === "oauth" ||
    account.account_type === "mixed" ||
    account.account_types?.includes("oauth") ||
    account.oauth_cost > 0,
  );
  const filteredAccounts = useMemo(
    () => oauthAccounts.filter((account) => matchesAccountFilters(account, search, createdFrom, createdTo)),
    [oauthAccounts, search, createdFrom, createdTo],
  );
  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleAccounts = filteredAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const totalRevenue = oauthAccounts.reduce((sum, account) => sum + (account.oauth_revenue ?? (account.account_type === "oauth" ? account.revenue : 0)), 0);
  const totalCost = oauthAccounts.reduce((sum, account) => sum + account.oauth_cost, 0);
  const overallProgress = revenueAvailable && totalCost > 0
    ? Math.min(100, Math.max(0, totalRevenue / totalCost * 100))
    : null;

  useEffect(() => {
    setPage(1);
  }, [search, createdFrom, createdTo, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const resetFilters = () => {
    setSearch("");
    setCreatedFrom("");
    setCreatedTo("");
  };

  return (
    <section className="aux-cost-panel aux-cost-table-panel aux-cost-payback-panel" aria-label="OAuth 回本分析">
      <div className="aux-cost-panel-head">
        <div>
          <p className="aux-cost-panel-kicker">OAuth payback</p>
          <h2>OAuth 回本分析</h2>
        </div>
        <span className="aux-cost-range-caption">按账号累计用户计费与采购成本</span>
      </div>
      <div className="aux-cost-payback-summary">
        <div>
          <span>整体用户计费</span>
          <strong>{revenueAvailable ? formatMoney(totalRevenue, currency) : "待收费数据"}</strong>
        </div>
        <div>
          <span>OAuth 采购成本</span>
          <strong>{formatMoney(totalCost, currency)}</strong>
        </div>
        <div>
          <span>整体回本进度</span>
          <strong>
            {overallProgress === null
              ? revenueAvailable ? "待配置成本" : "待收费数据"
              : `${overallProgress.toFixed(1)}%`}
          </strong>
        </div>
      </div>
      <AccountListFilters
        label="OAuth 回本分析"
        search={search}
        onSearchChange={setSearch}
        createdFrom={createdFrom}
        createdTo={createdTo}
        onCreatedRangeChange={(from, to) => { setCreatedFrom(from); setCreatedTo(to); }}
        onReset={resetFilters}
        searchId="oauth-payback-search"
        dateRangeId="oauth-payback-created-range"
      />
      <div className="aux-cost-table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号 / 计费组</TableHead>
              <TableHead>账号创建时间</TableHead>
              <TableHead>过期时间</TableHead>
              <TableHead>用户计费</TableHead>
              <TableHead>OAuth 采购成本</TableHead>
              <TableHead>回本进度</TableHead>
              <TableHead>待回本金额</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="aux-cost-empty-cell">
                  {oauthAccounts.length === 0 ? "当前区间暂无 OAuth 账号回本数据" : "没有符合筛选条件的 OAuth 回本数据"}
                </TableCell>
              </TableRow>
            ) : visibleAccounts.map((account) => {
              const oauthRevenue = account.oauth_revenue ?? (account.account_type === "oauth" ? account.revenue : 0);
              const progress = revenueAvailable && account.oauth_cost > 0
                ? Math.min(100, Math.max(0, oauthRevenue / account.oauth_cost * 100))
                : null;
              const outstanding = progress === null
                ? null
                : Math.max(0, account.oauth_cost - oauthRevenue);
              const status = !revenueAvailable
                ? "待收费数据"
                : account.oauth_cost <= 0
                  ? "待配置成本"
                  : oauthRevenue >= account.oauth_cost
                    ? "已回本"
                    : "未回本";
              const accountIDs = account.account_ids?.length ? account.account_ids : [account.account_id];
              return (
                <TableRow key={`oauth-payback-${account.billing_group || account.account_id}`}>
                  <TableCell className="aux-cost-account-cell">
                    <strong>{account.billing_group || account.name || `账号 ${account.account_id}`}</strong>
                    <small>{account.billing_group ? `合并 ${accountIDs.map((id) => `#${id}`).join(", ")}` : `#${account.account_id}`}</small>
                  </TableCell>
                  <TableCell><small>{formatDateTime(account.account_created_at)}</small></TableCell>
                  <TableCell><small>{formatExpiryDateTime(account.account_expires_at)}</small></TableCell>
                  <TableCell>{revenueAvailable ? formatMoney(oauthRevenue, currency) : "—"}</TableCell>
                  <TableCell>{formatMoney(account.oauth_cost, currency)}</TableCell>
                  <TableCell>{progress === null ? "—" : `${progress.toFixed(1)}%`}</TableCell>
                  <TableCell>{outstanding === null ? "—" : formatMoney(outstanding, currency)}</TableCell>
                  <TableCell>
                    <span className={`aux-cost-payback-status aux-cost-payback-status--${status === "已回本" ? "settled" : status === "未回本" ? "pending" : "unknown"}`}>
                      {status}
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AccountListPagination
        label="OAuth 回本分析"
        total={filteredAccounts.length}
        page={currentPage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </section>
  );
}

function AccountCostDetailsPanel({
  accounts,
  currency,
  revenueAvailable,
}: {
  accounts: AccountConsumption[];
  currency: string;
  revenueAvailable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("all");
  const [platform, setPlatform] = useState("");
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const platformOptions = useMemo(
    () => [...new Set(accounts.map((account) => account.platform).filter(Boolean))].sort(),
    [accounts],
  );
  const filteredAccounts = useMemo(
    () => accounts.filter((account) => matchesAccountFilters(account, search, createdFrom, createdTo, accountType, platform)),
    [accounts, search, createdFrom, createdTo, accountType, platform],
  );
  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleAccounts = filteredAccounts.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [search, accountType, platform, createdFrom, createdTo, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount));
  }, [pageCount]);

  const resetFilters = () => {
    setSearch("");
    setAccountType("all");
    setPlatform("");
    setCreatedFrom("");
    setCreatedTo("");
  };

  return (
    <section className="aux-cost-panel aux-cost-table-panel" aria-label="账号成本明细">
      <div className="aux-cost-panel-head">
        <div>
          <p className="aux-cost-panel-kicker">By account</p>
          <h2>账号成本明细</h2>
        </div>
        <span className="aux-cost-range-caption">OAuth 采购成本按账号一次性计入</span>
      </div>
      <AccountListFilters
        label="账号成本明细"
        search={search}
        onSearchChange={setSearch}
        createdFrom={createdFrom}
        createdTo={createdTo}
        onCreatedRangeChange={(from, to) => { setCreatedFrom(from); setCreatedTo(to); }}
        onReset={resetFilters}
        searchId="account-cost-search"
        dateRangeId="account-cost-created-range"
        accountType={accountType}
        onAccountTypeChange={setAccountType}
        platform={platform}
        platformOptions={platformOptions}
        onPlatformChange={setPlatform}
      />
      <div className="aux-cost-table-scroll">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>账号 / 计费组</TableHead>
              <TableHead>账号创建时间</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>请求数</TableHead>
              <TableHead>收入</TableHead>
              <TableHead>API 成本</TableHead>
              <TableHead>OAuth 成本</TableHead>
              <TableHead>毛利</TableHead>
              <TableHead>税额</TableHead>
              <TableHead>利润</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAccounts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="aux-cost-empty-cell">
                  {accounts.length === 0 ? "当前区间暂无账号成本明细" : "没有符合筛选条件的账号成本明细"}
                </TableCell>
              </TableRow>
            ) : visibleAccounts.map((account) => {
              const accountIDs = account.account_ids?.length ? account.account_ids : [account.account_id];
              return (
                <TableRow key={`${account.account_type}-${account.billing_group || account.account_id}`}>
                  <TableCell className="aux-cost-account-cell">
                    <strong>{account.billing_group || account.name || `账号 ${account.account_id}`}</strong>
                    <small>{account.billing_group ? `合并 ${accountIDs.map((id) => `#${id}`).join(", ")}` : `#${account.account_id}`} · {account.platform || "—"}</small>
                  </TableCell>
                  <TableCell><small>{formatDateTime(account.account_created_at)}</small></TableCell>
                  <TableCell>{account.account_type === "mixed" ? "API + OAuth" : account.account_type === "oauth" ? "OAuth" : "API"}</TableCell>
                  <TableCell>{account.requests.toLocaleString("zh-CN")}</TableCell>
                  <TableCell>{revenueAvailable ? formatMoney(account.revenue, currency) : "—"}</TableCell>
                  <TableCell>{formatMoney(account.api_cost, currency)}</TableCell>
                  <TableCell>{formatMoney(account.oauth_cost, currency)}</TableCell>
                  <TableCell className={revenueAvailable ? account.gross_profit >= 0 ? "is-positive" : "is-negative" : undefined}>
                    {revenueAvailable ? formatMoney(account.gross_profit, currency) : "—"}
                  </TableCell>
                  <TableCell>{revenueAvailable ? formatMoney(account.tax_amount, currency) : "—"}</TableCell>
                  <TableCell className={revenueAvailable ? account.net_profit >= 0 ? "is-positive" : "is-negative" : undefined}>
                    {revenueAvailable ? formatMoney(account.net_profit, currency) : "—"}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <AccountListPagination
        label="账号成本明细"
        total={filteredAccounts.length}
        page={currentPage}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />
    </section>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: ReactNode;
  tone: string;
}) {
  return (
    <article className={`aux-cost-metric aux-cost-metric--${tone}`}>
      <span className="aux-cost-metric-icon">{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
