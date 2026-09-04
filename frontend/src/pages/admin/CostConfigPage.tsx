import { useEffect, useMemo, useState } from "react";
import { Check, CircleHelp, Coins, RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { apiClient, type AuxEnvelope } from "@/lib/api-client";

interface CostConfig {
  oauth_account_cost: number;
  api_cost_multiplier: number;
  tax_rate: number;
  currency: string;
}

interface AccountCostConfig {
  account_id: number;
  account_type: "oauth" | "api";
  name: string;
  platform: string;
  oauth_account_cost?: number | null;
  api_multiplier_override?: number | null;
  synced_api_multiplier?: number | null;
  api_multiplier_mode: "sync" | "manual";
  last_synced_at?: string | null;
}

interface CostConfigResponse {
  global: CostConfig;
  accounts: AccountCostConfig[];
  last_sync_at?: string | null;
}

export default function CostConfigPage() {
  const [data, setData] = useState<CostConfigResponse | null>(null);
  const [global, setGlobal] = useState<CostConfig>({ oauth_account_cost: 0, api_cost_multiplier: 1, tax_rate: 0, currency: "CNY" });
  const [draftAccounts, setDraftAccounts] = useState<AccountCostConfig[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [savingAccount, setSavingAccount] = useState<number | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const envelope = await apiClient.get<AuxEnvelope<CostConfigResponse>>("/admin/ops/cost-config");
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "无法读取成本配置");
      setData(envelope.data);
      setGlobal(envelope.data.global);
      setDraftAccounts(envelope.data.accounts.map((account) => ({ ...account })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取成本配置");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return draftAccounts;
    return draftAccounts.filter((account) => [String(account.account_id), account.name, account.platform, account.account_type].join(" ").toLowerCase().includes(needle));
  }, [draftAccounts, search]);

  const saveGlobal = async () => {
    if (global.oauth_account_cost < 0 || global.api_cost_multiplier <= 0 || global.tax_rate < 0 || global.tax_rate > 100) {
      setError("OAuth 默认成本不能为负，API 默认倍率必须大于 0，税点必须在 0% 到 100% 之间。");
      return;
    }
    setSavingGlobal(true);
    setError("");
    try {
      const envelope = await apiClient.put<AuxEnvelope<CostConfig>>("/admin/ops/cost-config", global);
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "保存失败");
      setGlobal(envelope.data);
      toast.success("默认成本配置已保存");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSavingGlobal(false);
    }
  };

  const syncAccounts = async () => {
    setSyncing(true);
    setError("");
    try {
      const envelope = await apiClient.post<AuxEnvelope<CostConfigResponse>>("/admin/ops/cost-config/sync");
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "同步失败");
      setData(envelope.data);
      setGlobal(envelope.data.global);
      setDraftAccounts(envelope.data.accounts.map((account) => ({ ...account })));
      toast.success("已从 Sub2API 同步账号倍率", { description: envelope.data.last_sync_at ? `同步时间 ${formatSyncTime(envelope.data.last_sync_at)}` : undefined });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  };

  const saveAccount = async (account: AccountCostConfig) => {
    if (account.account_type === "oauth" && account.oauth_account_cost != null && account.oauth_account_cost < 0) {
      setError("OAuth 单号成本不能为负。");
      return;
    }
    if (account.account_type === "api" && account.api_multiplier_mode === "manual" && (!account.api_multiplier_override || account.api_multiplier_override <= 0)) {
      setError("手工 API 倍率必须大于 0。");
      return;
    }
    setSavingAccount(account.account_id);
    setError("");
    try {
      const payload = {
        ...account,
        oauth_account_cost: account.oauth_account_cost == null ? null : Number(account.oauth_account_cost),
        api_multiplier_override: account.api_multiplier_mode === "manual" ? Number(account.api_multiplier_override) : null,
      };
      const envelope = await apiClient.put<AuxEnvelope<AccountCostConfig>>(`/admin/ops/cost-config/accounts/${account.account_id}`, payload);
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "保存失败");
      setDraftAccounts((current) => current.map((item) => item.account_id === account.account_id ? envelope.data! : item));
      toast.success(`账号 ${account.account_id} 配置已保存`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSavingAccount(null);
    }
  };

  if (loading) return <div className="aux-cost-page aux-cost-state"><SlidersHorizontal className="aux-spin" aria-hidden="true" /><span>正在读取账号成本配置…</span></div>;

  return (
    <div className="aux-cost-page aux-cost-config-page">
      <header className="aux-cost-header">
        <div>
          <p className="aux-cost-eyebrow"><span />运营中心 / 成本配置</p>
          <h1>账号成本配置</h1>
          <p>OAuth 按单号采购成本核算，API 按账号倍率核算。历史日志优先使用发生时的倍率快照，避免上游调价后改写历史利润。</p>
        </div>
        <button type="button" className="aux-cost-refresh" onClick={() => void syncAccounts()} disabled={syncing}><RefreshCw size={16} className={syncing ? "aux-spin" : ""} />{syncing ? "同步中…" : "立即同步倍率"}</button>
      </header>

      {error && <div className="aux-cost-alert" role="alert">{error}</div>}

      <section className="aux-config-layout">
        <div className="aux-cost-panel aux-config-form-panel">
          <div className="aux-cost-panel-head"><div><p className="aux-cost-panel-kicker">Fallback policy</p><h2>默认核算参数</h2></div><span className="aux-config-lock"><Check size={14} />账号未单独配置时使用</span></div>
          <div className="aux-config-field"><label htmlFor="oauth-cost">OAuth 默认单号成本</label><p>仅用于没有单独采购成本的 OAuth 账号；已单独配置的账号优先使用自己的金额。</p><div className="aux-config-input-wrap"><span>{global.currency}</span><input id="oauth-cost" type="number" min="0" step="0.01" value={global.oauth_account_cost} onChange={(event) => setGlobal({ ...global, oauth_account_cost: Number(event.target.value) })} /><em> / 号</em></div></div>
          <div className="aux-config-field"><label htmlFor="api-multiplier">API 默认成本倍率</label><p>仅用于账号没有同步倍率或手工倍率时的兜底值。</p><div className="aux-config-input-wrap"><span>×</span><input id="api-multiplier" type="number" min="0.01" step="0.01" value={global.api_cost_multiplier} onChange={(event) => setGlobal({ ...global, api_cost_multiplier: Number(event.target.value) })} /></div></div>
          <div className="aux-config-field"><label htmlFor="tax-rate">税点</label><p>按收入计提的税点，填写百分比。例如填写 6 表示 6%；税后利润 = 税前利润 − 收入 × 税点。</p><div className="aux-config-input-wrap"><span>%</span><input id="tax-rate" type="number" min="0" max="100" step="0.01" value={global.tax_rate} onChange={(event) => setGlobal({ ...global, tax_rate: Number(event.target.value) })} /><em> / 收入</em></div></div>
          <div className="aux-config-field"><label htmlFor="currency">货币单位</label><p>用于成本、收入、税额与利润展示。</p><input id="currency" className="aux-config-currency-input" maxLength={8} value={global.currency} onChange={(event) => setGlobal({ ...global, currency: event.target.value.toUpperCase() })} /></div>
          <button type="button" className="aux-config-save" disabled={savingGlobal} onClick={() => void saveGlobal()}>{savingGlobal ? "保存中…" : "保存默认配置"}<Check size={17} /></button>
        </div>
        <aside className="aux-cost-panel aux-config-preview-panel">
          <p className="aux-cost-panel-kicker">Sync status</p><h2>同步与历史口径</h2>
          <div className="aux-config-preview-card"><span className="aux-preview-label"><Coins size={15} />当前账号</span><strong>{data?.accounts.length ?? 0} 个</strong><small>OAuth {data?.accounts.filter((item) => item.account_type === "oauth").length ?? 0} · API {data?.accounts.filter((item) => item.account_type === "api").length ?? 0}</small></div>
          <div className="aux-config-preview-card"><span className="aux-preview-label"><SlidersHorizontal size={15} />最近同步</span><strong>{data?.last_sync_at ? formatSyncTime(data.last_sync_at) : "尚未同步"}</strong></div>
          <div className="aux-config-help"><CircleHelp size={16} /><span>API 手工倍率只影响没有历史快照的记录；已有 usage_logs.account_rate_multiplier 的历史记录永远按发生时倍率核算。</span></div>
        </aside>
      </section>

      <section className="aux-cost-panel aux-account-config-panel">
        <div className="aux-cost-panel-head"><div><p className="aux-cost-panel-kicker">Per account</p><h2>账号独立成本</h2></div><label className="aux-account-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账号名、平台或 ID" aria-label="搜索账号" /></label></div>
        <div className="aux-account-table-scroll"><table className="aux-account-table"><thead><tr><th>账号</th><th>类型 / 平台</th><th>OAuth 单号成本</th><th>API 成本倍率</th><th>同步倍率</th><th>操作</th></tr></thead><tbody>
          {filteredAccounts.length === 0 ? <tr><td colSpan={6} className="aux-cost-empty-cell">暂无账号。点击“立即同步倍率”读取 Sub2API accounts。</td></tr> : filteredAccounts.map((account) => <tr key={account.account_id}>
            <td><strong>{account.name || `账号 ${account.account_id}`}</strong><small>#{account.account_id}</small></td>
            <td><span className={`aux-account-type aux-account-type--${account.account_type}`}>{account.account_type === "oauth" ? "OAuth" : "API"}</span><small>{account.platform || "—"}</small></td>
            <td>{account.account_type === "oauth" ? <input className="aux-account-number" type="number" min="0" step="0.01" value={account.oauth_account_cost ?? ""} placeholder={`默认 ${global.oauth_account_cost}`} onChange={(event) => updateAccount(setDraftAccounts, account.account_id, { oauth_account_cost: event.target.value === "" ? null : Number(event.target.value) })} /> : <span className="aux-account-muted">不适用</span>}</td>
            <td>{account.account_type === "api" ? <div className="aux-account-multiplier"><input className="aux-account-number" type="number" min="0.01" step="0.01" disabled={account.api_multiplier_mode !== "manual"} value={account.api_multiplier_override ?? ""} placeholder={account.synced_api_multiplier?.toFixed(2) ?? global.api_cost_multiplier.toFixed(2)} onChange={(event) => updateAccount(setDraftAccounts, account.account_id, { api_multiplier_override: event.target.value === "" ? null : Number(event.target.value), api_multiplier_mode: "manual" })} /><button type="button" className={`aux-account-mode ${account.api_multiplier_mode === "manual" ? "is-manual" : ""}`} onClick={() => updateAccount(setDraftAccounts, account.account_id, { api_multiplier_mode: account.api_multiplier_mode === "manual" ? "sync" : "manual", api_multiplier_override: account.api_multiplier_mode === "manual" ? null : account.api_multiplier_override })}>{account.api_multiplier_mode === "manual" ? "手工" : "跟随同步"}</button></div> : <span className="aux-account-muted">不适用</span>}</td>
            <td>{account.account_type === "api" ? <><strong>{account.synced_api_multiplier?.toFixed(4) ?? "—"}</strong><small>{account.last_synced_at ? formatSyncTime(account.last_synced_at) : "未同步"}</small></> : <span className="aux-account-muted">采购价独立配置</span>}</td>
            <td><button type="button" className="aux-account-save" disabled={savingAccount === account.account_id} onClick={() => void saveAccount(account)}>{savingAccount === account.account_id ? "保存中…" : "保存"}</button></td>
          </tr>)}
        </tbody></table></div>
      </section>
    </div>
  );
}

function updateAccount(setter: React.Dispatch<React.SetStateAction<AccountCostConfig[]>>, accountID: number, patch: Partial<AccountCostConfig>) {
  setter((current) => current.map((account) => account.account_id === accountID ? { ...account, ...patch } : account));
}

function formatSyncTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}
