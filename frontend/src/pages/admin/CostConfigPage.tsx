import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Coins, RefreshCw, Search, SlidersHorizontal, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccountCreatedDateRangePicker } from "@/components/admin/AccountCreatedDateRangePicker";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient, type AuxEnvelope } from "@/lib/api-client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Pagination, PaginationContent, PaginationItem } from "@/components/ui/pagination";

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
  billing_group?: string;
  account_created_at?: string | null;
  account_deleted_at?: string | null;
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
  const [globalDraft, setGlobalDraft] = useState<CostConfig>({ oauth_account_cost: 0, api_cost_multiplier: 1, tax_rate: 0, currency: "CNY" });
  const [draftAccounts, setDraftAccounts] = useState<AccountCostConfig[]>([]);
  const [search, setSearch] = useState("");
  const [accountType, setAccountType] = useState("all");
  const [costConfigStatus, setCostConfigStatus] = useState("all");
  const [platform, setPlatform] = useState("");
  const [platformPickerOpen, setPlatformPickerOpen] = useState(false);
  const [createdFrom, setCreatedFrom] = useState("");
  const [createdTo, setCreatedTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingGlobal, setSavingGlobal] = useState(false);
  const [globalDialogOpen, setGlobalDialogOpen] = useState(false);
  const [savingAccount, setSavingAccount] = useState<number | null>(null);
  const [savingBillingGroup, setSavingBillingGroup] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [mergeAccountPickerOpen, setMergeAccountPickerOpen] = useState(false);
  const [mergeAccountIDs, setMergeAccountIDs] = useState<number[]>([]);
  const [mergeGroup, setMergeGroup] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [globalError, setGlobalError] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const envelope = await apiClient.get<AuxEnvelope<CostConfigResponse>>("/admin/ops/cost-config");
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "无法读取成本配置");
      setData(envelope.data);
      setGlobal(envelope.data.global);
      setGlobalDraft(envelope.data.global);
      setDraftAccounts(envelope.data.accounts.map((account) => ({ ...account })));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取成本配置");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const platformOptions = useMemo(() => [...new Set(draftAccounts.map((account) => account.platform).filter(Boolean))].sort(), [draftAccounts]);
  const hasFilters = Boolean(search.trim() || accountType !== "all" || costConfigStatus !== "all" || platform || createdFrom || createdTo);
  const filteredAccounts = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const start = createdFrom ? new Date(`${createdFrom}T00:00:00`).getTime() : null;
    const end = createdTo ? new Date(`${createdTo}T00:00:00`) : null;
    // 用本地日历的次日零点作为开区间，包含结束当天，也兼容夏令时切换。
    if (end) end.setDate(end.getDate() + 1);
    return draftAccounts.filter((account) => {
      if (!needle && account.account_deleted_at) return false;
      if (accountType !== "all" && account.account_type !== accountType) return false;
      if (costConfigStatus !== "all" && isCostConfigStatusConfigured(account) !== (costConfigStatus === "configured")) return false;
      if (platform && account.platform !== platform) return false;
      if (needle && !account.name.toLowerCase().includes(needle) && !String(account.account_id).includes(needle)) return false;
      if (start !== null || end !== null) {
        const createdAt = account.account_created_at ? new Date(account.account_created_at).getTime() : NaN;
        if (!Number.isFinite(createdAt) || (start !== null && createdAt < start) || (end !== null && createdAt >= end.getTime())) return false;
      }
      return true;
    }).sort((left, right) => accountCreatedTimestamp(right) - accountCreatedTimestamp(left) || right.account_id - left.account_id);
  }, [draftAccounts, search, accountType, costConfigStatus, platform, createdFrom, createdTo]);
  const pageCount = Math.max(1, Math.ceil(filteredAccounts.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageOffset = (currentPage - 1) * pageSize;
  const visibleAccounts = filteredAccounts.slice(pageOffset, pageOffset + pageSize);

  useEffect(() => { setPage((current) => Math.min(current, pageCount)); }, [pageCount]);

  const resetFilters = () => {
    setSearch("");
    setAccountType("all");
    setCostConfigStatus("all");
    setPlatform("");
    setCreatedFrom("");
    setCreatedTo("");
    setPage(1);
  };

  const selectedMergeAccounts = useMemo(() => draftAccounts.filter((account) => mergeAccountIDs.includes(account.account_id)), [draftAccounts, mergeAccountIDs]);
  const selectedMergeTypes = useMemo(() => new Set(selectedMergeAccounts.map((account) => account.account_type)), [selectedMergeAccounts]);
  const selectedMergeLabel = selectedMergeTypes.size === 2 ? "API / OAuth" : selectedMergeTypes.has("oauth") ? "OAuth" : "API";
  const mergeGroupOptions = useMemo(() => billingGroupOptions(draftAccounts), [draftAccounts]);

  const resetMergeForm = () => {
    setMergeAccountPickerOpen(false);
    setMergeAccountIDs([]);
    setMergeGroup("");
    setMergeError("");
  };

  const handleMergeDialogOpenChange = (open: boolean) => {
    setMergeDialogOpen(open);
    if (!open) resetMergeForm();
  };

  const saveGlobal = async () => {
    if (globalDraft.oauth_account_cost < 0 || globalDraft.api_cost_multiplier <= 0 || globalDraft.tax_rate < 0 || globalDraft.tax_rate > 100) {
      setGlobalError("OAuth 默认成本不能为负，API 默认倍率必须大于 0，税点必须在 0% 到 100% 之间。");
      return;
    }
    setSavingGlobal(true);
    setError("");
    setGlobalError("");
    try {
      const envelope = await apiClient.put<AuxEnvelope<CostConfig>>("/admin/ops/cost-config", globalDraft);
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "保存失败");
      setGlobal(envelope.data);
      setGlobalDraft(envelope.data);
      setGlobalDialogOpen(false);
      toast.success("默认成本配置已保存");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "保存失败";
      setGlobalError(message);
      setError(message);
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
      setGlobalDraft(envelope.data.global);
      setDraftAccounts(envelope.data.accounts.map((account) => ({ ...account })));
      resetMergeForm();
      setMergeDialogOpen(false);
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
        billing_group: account.billing_group?.trim() || "",
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

  const toggleMergeAccount = (account: AccountCostConfig) => {
    setMergeError("");
    setMergeAccountIDs((current) => current.includes(account.account_id)
      ? current.filter((id) => id !== account.account_id)
      : [...current, account.account_id]);
  };

  const saveBillingGroup = async () => {
    const group = mergeGroup.trim();
    if (mergeAccountIDs.length < 2) {
      setMergeError("请至少选择两个需要合并计费的账号。");
      return;
    }
    if (!group) {
      setMergeError("请填写或选择计费组名称。");
      return;
    }
    setSavingBillingGroup(true);
    setMergeError("");
    try {
      const envelope = await apiClient.put<AuxEnvelope<CostConfigResponse>>("/admin/ops/cost-config/billing-groups", { account_ids: mergeAccountIDs, billing_group: group });
      if (envelope.code !== 0 || !envelope.data) throw new Error(envelope.message || "保存失败");
      setData(envelope.data);
      setGlobal(envelope.data.global);
      setGlobalDraft(envelope.data.global);
      setDraftAccounts(envelope.data.accounts.map((account) => ({ ...account })));
      toast.success(`已将 ${mergeAccountIDs.length} 个账号合并到 ${group}`);
      resetMergeForm();
      setMergeDialogOpen(false);
    } catch (reason) {
      setMergeError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setSavingBillingGroup(false);
    }
  };

  const handleGlobalDialogOpenChange = (open: boolean) => {
    setGlobalDialogOpen(open);
    if (open) {
      setGlobalDraft(global);
      setGlobalError("");
    }
  };

  if (loading) return <div className="aux-cost-page aux-cost-state"><SlidersHorizontal className="aux-spin" aria-hidden="true" /><span>正在读取账号成本配置…</span></div>;

  return (
    <div className="aux-cost-page aux-cost-config-page">
      <header className="aux-cost-header">
        <div>
          <p className="aux-cost-eyebrow"><span />运营中心 / 成本配置</p>
          <h1>账号成本配置</h1>
          <p>OAuth 按单号采购成本核算，API 按账号倍率核算；同一计费组支持 API / OAuth 混合归集，但仍分别套用各自成本口径。</p>
        </div>
        <button type="button" className="aux-cost-refresh" onClick={() => void syncAccounts()} disabled={syncing}><RefreshCw size={16} className={syncing ? "aux-spin" : ""} />{syncing ? "同步中…" : "立即同步倍率"}</button>
      </header>

      {error && <div className="aux-cost-alert" role="alert">{error}</div>}

      <section className="aux-config-layout">
        <div className="aux-cost-panel aux-config-form-panel aux-config-summary-panel">
          <div className="aux-cost-panel-head"><div><p className="aux-cost-panel-kicker">Fallback policy</p><h2>默认核算参数</h2></div><span className="aux-config-lock"><Check size={14} />账号未单独配置时使用</span></div>
          <p className="aux-config-summary-copy">统一设置账号没有独立成本时的兜底口径，修改后会用于后续消费核算。</p>
          <div className="aux-config-summary-grid">
            <div><span>OAuth 单号成本</span><strong>{global.currency} {global.oauth_account_cost.toFixed(2)}</strong><small>每个账号</small></div>
            <div><span>API 成本倍率</span><strong>×{global.api_cost_multiplier.toFixed(2)}</strong><small>无同步或手工倍率时</small></div>
            <div><span>税点</span><strong>{global.tax_rate.toFixed(2)}%</strong><small>按收入计提</small></div>
            <div><span>货币单位</span><strong>{global.currency}</strong><small>成本与利润展示</small></div>
          </div>
          <Dialog open={globalDialogOpen} onOpenChange={handleGlobalDialogOpenChange}>
            <DialogTrigger asChild>
              <Button type="button" className="aux-config-edit-action"><SlidersHorizontal aria-hidden="true" />编辑默认核算参数</Button>
            </DialogTrigger>
            <DialogContent className="aux-default-config-dialog">
              <DialogHeader className="aux-default-config-dialog-header">
                <DialogTitle>默认核算参数</DialogTitle>
                <DialogDescription>账号未设置独立成本时，系统会使用以下参数进行成本、税额与利润核算。</DialogDescription>
              </DialogHeader>
              <form className="aux-default-config-form" onSubmit={(event) => { event.preventDefault(); void saveGlobal(); }}>
                <div className="aux-default-config-field">
                  <Label htmlFor="oauth-cost">OAuth 默认单号成本</Label>
                  <p>仅用于没有单独采购成本的 OAuth 账号；已单独配置的账号优先使用自己的金额。</p>
                  <div className="aux-config-input-wrap"><span>{globalDraft.currency}</span><Input id="oauth-cost" type="number" min="0" step="0.01" value={globalDraft.oauth_account_cost} onChange={(event) => setGlobalDraft({ ...globalDraft, oauth_account_cost: Number(event.target.value) })} /><em> / 号</em></div>
                </div>
                <div className="aux-default-config-field">
                  <Label htmlFor="api-multiplier">API 默认成本倍率</Label>
                  <p>仅用于账号没有同步倍率或手工倍率时的兜底值。</p>
                  <div className="aux-config-input-wrap"><span>×</span><Input id="api-multiplier" type="number" min="0.01" step="0.01" value={globalDraft.api_cost_multiplier} onChange={(event) => setGlobalDraft({ ...globalDraft, api_cost_multiplier: Number(event.target.value) })} /></div>
                </div>
                <div className="aux-default-config-field">
                  <Label htmlFor="tax-rate">税点</Label>
                  <p>按收入计提的税点，填写百分比。例如填写 6 表示 6%；税后利润 = 税前利润 − 收入 × 税点。</p>
                  <div className="aux-config-input-wrap"><span>%</span><Input id="tax-rate" type="number" min="0" max="100" step="0.01" value={globalDraft.tax_rate} onChange={(event) => setGlobalDraft({ ...globalDraft, tax_rate: Number(event.target.value) })} /><em> / 收入</em></div>
                </div>
                <div className="aux-default-config-field">
                  <Label htmlFor="currency">货币单位</Label>
                  <p>用于成本、收入、税额与利润展示。</p>
                  <Input id="currency" className="aux-default-config-currency-input" maxLength={8} value={globalDraft.currency} onChange={(event) => setGlobalDraft({ ...globalDraft, currency: event.target.value.toUpperCase() })} />
                </div>
                {globalError && <div className="aux-default-config-alert" role="alert">{globalError}</div>}
                <DialogFooter className="aux-default-config-footer">
                  <DialogClose asChild><Button type="button" variant="outline" disabled={savingGlobal}>取消</Button></DialogClose>
                  <Button type="submit" disabled={savingGlobal}>{savingGlobal ? "保存中…" : "保存默认配置"}<Check aria-hidden="true" /></Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <aside className="aux-cost-panel aux-config-preview-panel">
          <p className="aux-cost-panel-kicker">Sync status</p><h2>同步与历史口径</h2>
          <div className="aux-config-preview-card"><span className="aux-preview-label"><Coins size={15} />已同步账号</span><strong>{data?.accounts.length ?? 0} 个</strong><small>OAuth {data?.accounts.filter((item) => item.account_type === "oauth").length ?? 0} · API {data?.accounts.filter((item) => item.account_type === "api").length ?? 0}</small></div>
          <div className="aux-config-preview-card"><span className="aux-preview-label"><SlidersHorizontal size={15} />合并计费组</span><strong>{billingGroupCount(data?.accounts ?? [])} 组</strong><small>同组 API / OAuth 账号分别核算成本后汇总</small></div>
          <div className="aux-config-preview-card"><span className="aux-preview-label"><SlidersHorizontal size={15} />最近同步</span><strong>{data?.last_sync_at ? formatSyncTime(data.last_sync_at) : "尚未同步"}</strong></div>
          <div className="aux-config-help"><CircleHelp size={16} /><span>API 手工倍率只影响没有历史快照的记录；已有 usage_logs.account_rate_multiplier 的历史记录永远按发生时倍率核算。</span></div>
        </aside>
      </section>

      <section className="aux-cost-panel aux-account-config-panel">
        <div className="aux-cost-panel-head">
          <div><p className="aux-cost-panel-kicker">Per account</p><h2>账号独立成本与合并计费</h2></div>
          <div className="aux-account-panel-actions">
            <Dialog open={mergeDialogOpen} onOpenChange={handleMergeDialogOpenChange}>
              <DialogTrigger asChild>
                <Button type="button" className="aux-account-merge-action"><UsersRound aria-hidden="true" />账号合并计费</Button>
              </DialogTrigger>
              <DialogContent className="aux-account-merge-dialog">
                <DialogHeader className="aux-account-merge-dialog-header">
                  <span className="aux-account-merge-dialog-icon"><UsersRound aria-hidden="true" /></span>
                  <div>
                    <DialogTitle>账号合并计费</DialogTitle>
                    <DialogDescription>选择两个或更多 API / OAuth 账号，将它们归入同一个计费组。系统会按账号类型分别核算成本。</DialogDescription>
                  </div>
                </DialogHeader>
                <form className="aux-account-merge-form" onSubmit={(event) => { event.preventDefault(); void saveBillingGroup(); }}>
                  <div className="aux-account-merge-field">
                    <Label htmlFor="merge-account-picker">合并账号</Label>
                    <Popover open={mergeAccountPickerOpen} onOpenChange={setMergeAccountPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button id="merge-account-picker" type="button" variant="outline" role="combobox" aria-expanded={mergeAccountPickerOpen} className="aux-account-merge-trigger">
                          <span>{mergeAccountIDs.length ? `已选择 ${mergeAccountIDs.length} 个${selectedMergeLabel}账号` : "选择需要合并的账号"}</span>
                          <ChevronDown aria-hidden="true" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="start" sideOffset={6} className="aux-account-merge-popover">
                        <Command className="aux-account-merge-command">
                          <CommandInput placeholder="搜索账号名、平台、计费组或 ID" aria-label="搜索可合并账号" wrapperClassName="aux-account-merge-command-input" />
                          <CommandList className="aux-account-merge-command-list">
                            <CommandEmpty>没有匹配账号</CommandEmpty>
                            <CommandGroup>
                              {draftAccounts.map((account) => {
                                const selected = mergeAccountIDs.includes(account.account_id);
                                return (
                                  <CommandItem
                                    key={account.account_id}
                                    value={`${account.name} ${account.account_id} ${account.platform} ${account.account_type} ${account.billing_group ?? ""}`}
                                    className="aux-account-merge-option"
                                    onSelect={() => toggleMergeAccount(account)}
                                  >
                                    <span className={`aux-account-merge-check ${selected ? "is-selected" : ""}`}><Check aria-hidden="true" /></span>
                                    <span className="aux-account-merge-option-copy"><strong>{account.name || `账号 ${account.account_id}`}</strong><small>#{account.account_id} · {account.account_type === "oauth" ? "OAuth" : "API"} · {account.platform || "—"}</small></span>
                                  </CommandItem>
                                );
                              })}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="aux-account-merge-field-hint">支持 API 与 OAuth 混合合并；统计时仍按各自成本口径计算。同组 OAuth 账号需使用相同有效采购成本。</p>
                  </div>

                  <div className="aux-account-merge-field-grid">
                    <div className="aux-account-merge-field">
                      <Label htmlFor="merge-existing-group">已有计费组</Label>
                      <Select value={mergeGroupOptions.includes(mergeGroup) ? mergeGroup : ""} onValueChange={(value) => { setMergeGroup(value); setMergeError(""); }} disabled={!mergeGroupOptions.length}>
                        <SelectTrigger id="merge-existing-group" className="aux-account-merge-select"><SelectValue placeholder={mergeGroupOptions.length ? "选择已有组" : "暂无可用计费组"} /></SelectTrigger>
                        <SelectContent>{mergeGroupOptions.map((group) => <SelectItem key={group} value={group}>{group}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="aux-account-merge-field">
                      <Label htmlFor="merge-group-name">计费组名称</Label>
                      <Input id="merge-group-name" value={mergeGroup} maxLength={128} onChange={(event) => { setMergeGroup(event.target.value); setMergeError(""); }} placeholder="例如：主账号重新上号" className="aux-account-merge-input" />
                    </div>
                  </div>

                  {mergeError && <div className="aux-account-merge-alert" role="alert">{mergeError}</div>}

                  <DialogFooter className="aux-account-merge-footer gap-2 sm:space-x-0">
                    <DialogClose asChild><Button type="button" variant="outline" className="aux-account-merge-cancel" disabled={savingBillingGroup}>取消</Button></DialogClose>
                    <Button type="submit" className="aux-account-merge-submit" disabled={savingBillingGroup || mergeAccountIDs.length < 2 || !mergeGroup.trim()}>{savingBillingGroup ? "应用中…" : "应用合并"}</Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <div className="aux-account-filters" role="search" aria-label="账号筛选">
          <Label className="aux-account-search"><Search size={15} aria-hidden="true" /><Input className="px-0 shadow-none focus-visible:ring-0" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索账号名或 ID（含已删除）" aria-label="搜索账号" /></Label>
          <div className="aux-account-filter-field">
            <Label htmlFor="account-type-filter" className="text-xs font-normal">账号类型</Label>
            <Select value={accountType} onValueChange={(value) => { setAccountType(value); setPage(1); }}>
              <SelectTrigger id="account-type-filter" className="aux-account-filter-control"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部类型</SelectItem><SelectItem value="oauth">OAuth</SelectItem><SelectItem value="api">API</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="aux-account-filter-field">
            <Label htmlFor="account-cost-config-filter" className="text-xs font-normal">成本配置</Label>
            <Select value={costConfigStatus} onValueChange={(value) => { setCostConfigStatus(value); setPage(1); }}>
              <SelectTrigger id="account-cost-config-filter" className="aux-account-filter-control"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部配置</SelectItem><SelectItem value="configured">已配置</SelectItem><SelectItem value="unconfigured">未配置</SelectItem></SelectContent>
            </Select>
          </div>
          <div className="aux-account-filter-field">
            <Label htmlFor="account-platform-filter" className="text-xs font-normal">平台</Label>
            <Popover open={platformPickerOpen} onOpenChange={setPlatformPickerOpen}>
              <PopoverTrigger asChild>
                <Button id="account-platform-filter" type="button" variant="outline" role="combobox" aria-expanded={platformPickerOpen} className="aux-account-filter-control justify-between gap-2">
                  <span className="max-w-36 truncate">{platform || "全部平台"}</span><ChevronDown className="h-4 w-4 opacity-50" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-56 p-0">
                <Command label="搜索平台">
                  <CommandInput placeholder="搜索平台…" aria-label="搜索平台" />
                  <CommandList>
                    <CommandEmpty>没有匹配的平台</CommandEmpty>
                    <CommandGroup>
                      {["", ...platformOptions].map((option) => (
                        <CommandItem key={option} value={option || "全部平台"} onSelect={() => { setPlatform(option); setPage(1); setPlatformPickerOpen(false); }}>
                          <Check className={`mr-2 h-4 w-4 ${platform === option ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />{option || "全部平台"}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
          <AccountCreatedDateRangePicker from={createdFrom} to={createdTo} hintId="account-date-hint" onChange={(from, to) => { setCreatedFrom(from); setCreatedTo(to); setPage(1); }} />
          <Button type="button" variant="ghost" size="sm" onClick={resetFilters} disabled={!hasFilters}>重置筛选</Button>
        </div>
        <p id="account-date-hint" className="aux-account-filter-hint">默认仅显示未删除账号；搜索账号名或 ID 可查询已删除账号。按创建时间倒序排列，日期范围包含本地结束当天，未知创建时间排在最后且不参与日期筛选。</p>
        <div className="aux-account-table-scroll"><Table className="aux-account-table"><TableHeader><TableRow><TableHead className="aux-account-name-column">账号</TableHead><TableHead aria-sort="descending">创建时间 ↓</TableHead><TableHead>类型 / 平台</TableHead><TableHead className="aux-account-oauth-cost-column">OAuth 单号成本</TableHead><TableHead className="aux-account-api-multiplier-column">API 成本倍率</TableHead><TableHead>同步倍率</TableHead><TableHead>合并计费组</TableHead><TableHead>操作</TableHead></TableRow></TableHeader><TableBody>
          {visibleAccounts.length === 0 ? <TableRow><TableCell colSpan={8} className="aux-cost-empty-cell">{hasFilters ? "没有符合筛选条件的账号，请调整或重置筛选。" : draftAccounts.length ? "暂无未删除账号，输入账号名或 ID 可查询已删除账号。" : "暂无账号。点击“立即同步倍率”读取 Sub2API accounts。"}</TableCell></TableRow> : visibleAccounts.map((account) => <TableRow key={account.account_id}>
            <TableCell className="aux-account-name-column"><div className="aux-account-name"><strong>{account.name || "未命名账号"}</strong><span className="aux-account-id">#{account.account_id}</span></div>{account.account_deleted_at && <Badge variant="secondary" className="mt-1">已删除</Badge>}</TableCell>
            <TableCell className="aux-account-created-at">{account.account_created_at ? formatAccountCreatedAt(account.account_created_at) : "—"}</TableCell>
            <TableCell><span className={`aux-account-type aux-account-type--${account.account_type}`}>{account.account_type === "oauth" ? "OAuth" : "API"}</span><small>{account.platform || "—"}</small></TableCell>
            <TableCell className="aux-account-oauth-cost-column">{account.account_type === "oauth" ? <Input aria-label={`账号 ${account.account_id} 的 OAuth 单号成本`} className="aux-account-number" type="number" min="0" step="0.01" value={account.oauth_account_cost ?? ""} placeholder={`默认 ${global.oauth_account_cost}`} onChange={(event) => updateAccount(setDraftAccounts, account.account_id, { oauth_account_cost: event.target.value === "" ? null : Number(event.target.value) })} /> : <span className="aux-account-muted">不适用</span>}</TableCell>
            <TableCell className="aux-account-api-multiplier-column">{account.account_type === "api" ? <div className="aux-account-multiplier"><Input aria-label={`账号 ${account.account_id} 的 API 成本倍率`} className="aux-account-number" type="number" min="0.01" step="0.01" disabled={account.api_multiplier_mode !== "manual"} value={account.api_multiplier_override ?? ""} placeholder={account.synced_api_multiplier?.toFixed(2) ?? global.api_cost_multiplier.toFixed(2)} onChange={(event) => updateAccount(setDraftAccounts, account.account_id, { api_multiplier_override: event.target.value === "" ? null : Number(event.target.value), api_multiplier_mode: "manual" })} /><Button type="button" size="sm" className={`aux-account-mode ${account.api_multiplier_mode === "manual" ? "is-manual" : ""}`} onClick={() => updateAccount(setDraftAccounts, account.account_id, { api_multiplier_mode: account.api_multiplier_mode === "manual" ? "sync" : "manual", api_multiplier_override: account.api_multiplier_mode === "manual" ? null : account.api_multiplier_override })}>{account.api_multiplier_mode === "manual" ? "手工" : "跟随同步"}</Button></div> : <span className="aux-account-muted">不适用</span>}</TableCell>
            <TableCell>{account.account_type === "api" ? <><strong>{account.synced_api_multiplier?.toFixed(4) ?? "—"}</strong><small>{account.last_synced_at ? formatSyncTime(account.last_synced_at) : "未同步"}</small></> : <span className="aux-account-muted">采购价独立配置</span>}</TableCell>
            <TableCell><Select value={account.billing_group ? `group:${account.billing_group}` : "independent"} onValueChange={(value) => updateAccount(setDraftAccounts, account.account_id, { billing_group: value === "independent" ? "" : value.slice(6) })}>
              <SelectTrigger className="aux-account-group" aria-label={`账号 ${account.account_id} 的合并计费组`}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="independent">独立计费</SelectItem>{mergeGroupOptions.map((group) => <SelectItem key={group} value={`group:${group}`}>{group}</SelectItem>)}</SelectContent>
            </Select><small>选择已有组，保存后生效</small></TableCell>
            <TableCell><Button type="button" size="sm" className="aux-account-save" disabled={savingAccount === account.account_id} onClick={() => void saveAccount(account)}>{savingAccount === account.account_id ? "保存中…" : "保存"}</Button></TableCell>
          </TableRow>)}
        </TableBody></Table></div>
        <footer className="aux-account-pagination">
          <span role="status">共 {filteredAccounts.length} 个账号{filteredAccounts.length > 0 ? `，显示 ${pageOffset + 1}–${Math.min(pageOffset + pageSize, filteredAccounts.length)} 条` : ""}</span>
          <div className="aux-account-pagination-controls">
            <div className="aux-account-page-size">
              <Label htmlFor="account-page-size" className="shrink-0 text-xs font-normal">每页</Label>
              <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPage(1); }}>
                <SelectTrigger id="account-page-size" aria-label="每页条数" className="w-20 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{[10, 20, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size} 条</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <TooltipProvider>
              <Pagination aria-label="账号列表分页" className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem><Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="上一页" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>上一页</TooltipContent></Tooltip></PaginationItem>
                  <PaginationItem><span>第 {currentPage} / {pageCount} 页</span></PaginationItem>
                  <PaginationItem><Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="下一页" disabled={currentPage >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight aria-hidden="true" /></Button></TooltipTrigger><TooltipContent>下一页</TooltipContent></Tooltip></PaginationItem>
                </PaginationContent>
              </Pagination>
            </TooltipProvider>
          </div>
        </footer>
      </section>
    </div>
  );
}

function updateAccount(setter: React.Dispatch<React.SetStateAction<AccountCostConfig[]>>, accountID: number, patch: Partial<AccountCostConfig>) {
  setter((current) => current.map((account) => account.account_id === accountID ? { ...account, ...patch } : account));
}

function isCostConfigStatusConfigured(account: AccountCostConfig) {
  if (account.account_type === "oauth") return account.oauth_account_cost != null;
  return account.api_multiplier_mode === "manual" && account.api_multiplier_override != null;
}

function formatSyncTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function accountCreatedTimestamp(account: AccountCostConfig) {
  const timestamp = account.account_created_at ? new Date(account.account_created_at).getTime() : NaN;
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatAccountCreatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date);
}

function billingGroupCount(accounts: AccountCostConfig[]) {
  return new Set(accounts.flatMap((account) => {
    const group = account.billing_group?.trim().toLocaleLowerCase();
    return group ? [group] : [];
  })).size;
}

function billingGroupOptions(accounts: AccountCostConfig[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const account of accounts) {
    const group = account.billing_group?.trim();
    const key = group?.toLocaleLowerCase();
    if (!group || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(group);
  }
  return result.sort((left, right) => left.localeCompare(right, "zh-CN"));
}
