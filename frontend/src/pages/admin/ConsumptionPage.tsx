import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  RefreshCw,
  Receipt,
  WalletCards,
} from "lucide-react";
import { apiClient, type AuxEnvelope } from "@/lib/api-client";

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
  revenue: number;
  api_cost: number;
  oauth_cost: number;
  total_cost: number;
  gross_profit: number;
  tax_amount: number;
  profit: number;
  net_profit: number;
  net_margin: number;
  oauth_account_count: number;
  api_account_count: number;
}

interface AccountConsumption {
  account_id: number;
  account_type: string;
  name: string;
  platform: string;
  requests: number;
  revenue: number;
  api_cost: number;
  oauth_cost: number;
  gross_profit: number;
  tax_amount: number;
  net_profit: number;
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
  days: DailyConsumption[];
  accounts: AccountConsumption[];
}

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

export default function ConsumptionPage() {
  const today = localDateValue();
  const [draft, setDraft] = useState({
    start: shiftDate(today, -13),
    end: today,
  });
  const [activeRange, setActiveRange] = useState(draft);
  const [view, setView] = useState<ViewState>({ status: "loading" });

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
  const days = data?.days ?? [];
  const maxChartValue = Math.max(
    1,
    ...days.flatMap((day) => [
      day.revenue,
      day.total_cost,
      Math.max(0, day.gross_profit),
      Math.max(0, day.net_profit),
    ]),
  );
  const chart = useMemo(
    () => buildChart(days, maxChartValue),
    [days, maxChartValue],
  );

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
            按天追踪收入、API 用量成本与 OAuth
            账号采购成本，并按可配置税点计算税前、税后利润。
          </p>
        </div>
        <button
          type="button"
          className="aux-cost-refresh"
          onClick={() => void loadData(activeRange)}
          aria-label="刷新消费数据"
        >
          <RefreshCw
            size={16}
            className={view.status === "loading" ? "aux-spin" : ""}
          />
          刷新
        </button>
      </header>

      <section className="aux-cost-filter" aria-label="日期范围筛选">
        <div className="aux-cost-filter-title">
          <CalendarDays size={17} aria-hidden="true" />
          <div>
            <strong>核算区间</strong>
            <span>按天聚合，最多支持 93 天</span>
          </div>
        </div>
        <label>
          开始日期
          <input
            type="date"
            value={draft.start}
            onChange={(event) =>
              setDraft({ ...draft, start: event.target.value })
            }
          />
        </label>
        <span className="aux-cost-range-arrow">→</span>
        <label>
          结束日期
          <input
            type="date"
            value={draft.end}
            onChange={(event) =>
              setDraft({ ...draft, end: event.target.value })
            }
          />
        </label>
        <button type="button" className="aux-cost-apply" onClick={submitRange}>
          应用筛选
        </button>
      </section>

      {view.status === "error" && (
        <div className="aux-cost-alert" role="alert">
          {view.message}。请确认 Sub2API 数据库连接与管理员会话。
        </div>
      )}

      {data && (
        <>
          <section className="aux-cost-kpis" aria-label="消费概览">
            <MetricCard
              label="总收入"
              value={formatMoney(data.total_revenue, currency)}
              detail={`${formatCompact(data.total_requests)} 次请求`}
              icon={<CircleDollarSign />}
              tone="accent"
            />
            <MetricCard
              label="总成本"
              value={formatMoney(data.total_cost, currency)}
              detail={`API ${formatMoney(data.total_api_cost, currency)} · OAuth ${formatMoney(data.total_oauth_cost, currency)}`}
              icon={<WalletCards />}
              tone="warm"
            />
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
          </section>

          <section className="aux-cost-grid">
            <div className="aux-cost-panel aux-cost-chart-panel">
              <div className="aux-cost-panel-head">
                <div>
                  <p className="aux-cost-panel-kicker">Daily economics</p>
                  <h2>收入与成本走势</h2>
                </div>
                <div className="aux-cost-legend">
                  <span>
                    <i className="is-revenue" />
                    收入
                  </span>
                  <span>
                    <i className="is-cost" />
                    成本
                  </span>
                  <span>
                    <i className="is-profit" />
                    税前利润
                  </span>
                  <span>
                    <i className="is-net-profit" />
                    税后利润
                  </span>
                </div>
              </div>
              <div className="aux-cost-chart-wrap">
                {days.length === 0 ? (
                  <div className="aux-cost-empty">
                    当前区间暂无 usage_logs 数据
                  </div>
                ) : (
                  <svg
                    className="aux-cost-chart"
                    viewBox="0 0 760 280"
                    role="img"
                    aria-label="按天收入、成本和毛利趋势图"
                  >
                    <defs>
                      <linearGradient
                        id="revenueFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="0%"
                          stopColor="var(--console-accent)"
                          stopOpacity=".26"
                        />
                        <stop
                          offset="100%"
                          stopColor="var(--console-accent)"
                          stopOpacity="0"
                        />
                      </linearGradient>
                    </defs>
                    {[0, 1, 2, 3].map((line) => (
                      <line
                        key={line}
                        x1="34"
                        x2="744"
                        y1={34 + line * 58}
                        y2={34 + line * 58}
                        className="aux-chart-grid-line"
                      />
                    ))}
                    <path d={chart.revenueArea} fill="url(#revenueFill)" />
                    <path
                      d={chart.revenueLine}
                      className="aux-chart-line aux-chart-line--revenue"
                    />
                    <path
                      d={chart.costLine}
                      className="aux-chart-line aux-chart-line--cost"
                    />
                    <path
                      d={chart.profitLine}
                      className="aux-chart-line aux-chart-line--profit"
                    />
                    <path
                      d={chart.netProfitLine}
                      className="aux-chart-line aux-chart-line--net-profit"
                    />
                    {chart.points.map((point) => (
                      <g key={point.key}>
                        <circle
                          cx={point.x}
                          cy={point.revenueY}
                          r="3.5"
                          className="aux-chart-point aux-chart-point--revenue"
                        >
                          <title>{`${point.label} 收入 ${formatMoney(point.revenue, currency)}`}</title>
                        </circle>
                        <circle
                          cx={point.x}
                          cy={point.costY}
                          r="2.8"
                          className="aux-chart-point aux-chart-point--cost"
                        />
                      </g>
                    ))}
                    {chart.labels.map((label) => (
                      <text
                        key={label.key}
                        x={label.x}
                        y="272"
                        className="aux-chart-label"
                      >
                        {label.text}
                      </text>
                    ))}
                  </svg>
                )}
              </div>
            </div>
            <aside className="aux-cost-panel aux-cost-formula-panel">
              <p className="aux-cost-panel-kicker">Cost model</p>
              <h2>核算口径</h2>
              <div className="aux-cost-formula">
                <span>OAuth 账号</span>
                <strong>
                  {formatMoney(data.config.oauth_account_cost, currency)} ×
                  独立账号数
                </strong>
              </div>
              <div className="aux-cost-formula">
                <span>API 账号</span>
                <strong>
                  原始成本 × {data.config.api_cost_multiplier.toFixed(2)}
                </strong>
              </div>
              <div className="aux-cost-formula">
                <span>毛利</span>
                <strong>收入 − API 成本 − OAuth 成本 = {formatMoney(data.gross_profit, currency)}</strong>
              </div>
              <div className="aux-cost-formula">
                <span>税前利润</span>
                <strong>毛利 − 其他运营费用（当前为 0）= {formatMoney(data.profit, currency)}</strong>
              </div>
              <div className="aux-cost-formula">
                <span>税后利润</span>
                <strong>
                  税前利润 − 收入 × {data.config.tax_rate.toFixed(2)}% = {formatMoney(data.net_profit, currency)}
                </strong>
              </div>
              <p className="aux-cost-note">
                成本配置可在“成本配置”页调整。OAuth
                账号按区间内独立账号计入，并归集到首次使用日；税点可在成本配置页动态调整。
              </p>
            </aside>
          </section>

          <section className="aux-cost-panel aux-cost-table-panel">
            <div className="aux-cost-panel-head">
              <div>
                <p className="aux-cost-panel-kicker">Breakdown</p>
                <h2>每日明细</h2>
              </div>
              <span className="aux-cost-range-caption">
                {activeRange.start} — {activeRange.end}
              </span>
            </div>
            <div className="aux-cost-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>请求数</th>
                    <th>Token</th>
                    <th>收入</th>
                    <th>API 成本</th>
                    <th>OAuth 成本</th>
                    <th>毛利 / 税前利润</th>
                    <th>税额</th>
                    <th>税后利润</th>
                    <th>税后利润率</th>
                  </tr>
                </thead>
                <tbody>
                  {days.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="aux-cost-empty-cell">
                        没有可展示的明细
                      </td>
                    </tr>
                  ) : (
                    days.map((day) => (
                      <tr key={day.date}>
                        <td>
                          <strong>{formatDay(day.date)}</strong>
                        </td>
                        <td>{day.requests.toLocaleString("zh-CN")}</td>
                        <td>{day.total_tokens.toLocaleString("zh-CN")}</td>
                        <td>{formatMoney(day.revenue, currency)}</td>
                        <td>{formatMoney(day.api_cost, currency)}</td>
                        <td>
                          {formatMoney(day.oauth_cost, currency)}{" "}
                          <small>
                            {day.oauth_account_count
                              ? `· ${day.oauth_account_count} 号`
                              : ""}
                          </small>
                        </td>
                        <td
                          className={
                            day.profit >= 0
                              ? "is-positive"
                              : "is-negative"
                          }
                        >
                          {formatMoney(day.profit, currency)}
                        </td>
                        <td>
                          {formatMoney(day.tax_amount, currency)}
                        </td>
                        <td
                          className={day.net_profit >= 0 ? "is-positive" : "is-negative"}
                        >
                          {formatMoney(day.net_profit, currency)}
                        </td>
                        <td>
                          {day.revenue > 0 ? `${(day.net_margin * 100).toFixed(1)}%` : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="aux-cost-panel aux-cost-table-panel">
            <div className="aux-cost-panel-head">
              <div>
                <p className="aux-cost-panel-kicker">By account</p>
                <h2>账号成本明细</h2>
              </div>
              <span className="aux-cost-range-caption">历史倍率优先使用 usage log 快照</span>
            </div>
            <div className="aux-cost-table-scroll">
              <table>
                <thead>
                  <tr><th>账号</th><th>类型</th><th>请求数</th><th>收入</th><th>成本</th><th>倍率 / 口径</th><th>毛利 / 税前利润</th><th>税额</th><th>税后利润</th></tr>
                </thead>
                <tbody>
                  {data.accounts.length === 0 ? <tr><td colSpan={9} className="aux-cost-empty-cell">当前区间暂无账号成本明细</td></tr> : data.accounts.map((account) => {
                    const cost = account.api_cost + account.oauth_cost;
                    return <tr key={account.account_id}>
                      <td><strong>{account.name || `账号 ${account.account_id}`}</strong><small>#{account.account_id} · {account.platform || "—"}</small></td>
                      <td>{account.account_type === "oauth" ? "OAuth" : "API"}</td>
                      <td>{account.requests.toLocaleString("zh-CN")}</td>
                      <td>{formatMoney(account.revenue, currency)}</td>
                      <td>{formatMoney(cost, currency)}</td>
                      <td><small>{account.account_type === "api" ? `×${account.multiplier.toFixed(4)} · ${account.multiplier_source}` : "采购单号成本"}</small></td>
                      <td className={account.gross_profit >= 0 ? "is-positive" : "is-negative"}>{formatMoney(account.gross_profit, currency)}</td>
                      <td>{formatMoney(account.tax_amount, currency)}</td>
                      <td className={account.net_profit >= 0 ? "is-positive" : "is-negative"}>{formatMoney(account.net_profit, currency)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
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
  icon: React.ReactNode;
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

function buildChart(days: DailyConsumption[], max: number) {
  const left = 34;
  const width = 710;
  const chartHeight = 214;
  const x = (index: number) =>
    left + (days.length <= 1 ? width / 2 : (index / (days.length - 1)) * width);
  const y = (value: number) =>
    34 + chartHeight - (Math.max(0, value) / max) * chartHeight;
  const line = (values: number[]) =>
    values
      .map(
        (value, index) =>
          `${index === 0 ? "M" : "L"} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`,
      )
      .join(" ");
  const revenueLine = line(days.map((day) => day.revenue));
  return {
    revenueLine,
    costLine: line(days.map((day) => day.total_cost)),
    profitLine: line(days.map((day) => Math.max(0, day.gross_profit))),
    netProfitLine: line(days.map((day) => Math.max(0, day.net_profit))),
    revenueArea: `${revenueLine} L ${x(days.length - 1).toFixed(1)} 248 L ${x(0).toFixed(1)} 248 Z`,
    points: days.map((day, index) => ({
      key: day.date,
      x: x(index),
      revenueY: y(day.revenue),
      costY: y(day.total_cost),
      revenue: day.revenue,
      label: formatDay(day.date),
    })),
    labels: days
      .filter(
        (_, index) =>
          days.length <= 7 ||
          index % Math.ceil(days.length / 7) === 0 ||
          index === days.length - 1,
      )
      .map((day) => ({
        key: day.date,
        x: x(days.indexOf(day)),
        text: formatDay(day.date),
      })),
  };
}
