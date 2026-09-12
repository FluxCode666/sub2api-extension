import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Gift, Loader2, Plus, BarChart3, RotateCcw, Pencil } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { zhCN } from "date-fns/locale";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { apiClient, type AuxEnvelope } from "@/lib/api-client";
import {
  formatPromotionMoney,
  promotionRewardLabel,
  type Promotion,
} from "@/lib/promotions";
import { renderPromotionMarkdown } from "@/lib/promotion-markdown";
import { PromotionDateTimeRangePicker } from "@/components/admin/PromotionDateTimeRangePicker";
import "../PromotionMarkdown.css";

interface PromotionForm {
  title: string;
  description: string;
  reward_type: "FIXED" | "PERCENTAGE";
  reward_value: string;
  starts_at: string;
  ends_at: string;
  enabled: boolean;
}
const emptyForm: PromotionForm = {
  title: "",
  description: "",
  reward_type: "FIXED",
  reward_value: "",
  starts_at: "",
  ends_at: "",
  enabled: true,
};
const toISO = (value: string) => (value ? new Date(value).toISOString() : null);

function startOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(value: Date): Date {
  const result = new Date(value);
  result.setHours(23, 59, 59, 999);
  return result;
}

function formatFilterDate(value: Date): string {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function toFormDateTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function PromotionManagementPage() {
  const [items, setItems] = useState<Promotion[]>([]);
  const [menuPublished, setMenuPublished] = useState(false);
  const [menuSaving, setMenuSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PromotionForm>(emptyForm);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingID, setEditingID] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [titleQuery, setTitleQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [dateFilterOpen, setDateFilterOpen] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const [result, config] = await Promise.all([
        apiClient.get<AuxEnvelope<{ items: Promotion[] }>>("/admin/promotions"),
        apiClient.get<AuxEnvelope<{ enabled: boolean }>>(
          "/admin/promotions/config",
        ),
      ]);
      setItems(result.data?.items ?? []);
      setMenuPublished(config.data?.enabled ?? false);
      setError("");
    } catch {
      setError("促销活动加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const filteredItems = useMemo(() => {
    const query = titleQuery.trim().toLocaleLowerCase();
    const from = dateRange?.from ? startOfDay(dateRange.from).getTime() : undefined;
    const to = dateRange?.to ? endOfDay(dateRange.to).getTime() : undefined;
    return items.filter((item) => {
      if (query && !item.title.toLocaleLowerCase().includes(query)) return false;
      if (from === undefined && to === undefined) return true;
      const startsAt = item.starts_at ? new Date(item.starts_at).getTime() : Number.NEGATIVE_INFINITY;
      const endsAt = item.ends_at ? new Date(item.ends_at).getTime() : Number.POSITIVE_INFINITY;
      return (from === undefined || endsAt >= from) && (to === undefined || startsAt <= to);
    });
  }, [dateRange, items, titleQuery]);
  const hasFilters = titleQuery.trim().length > 0 || Boolean(dateRange?.from);
  const dateFilterLabel = dateRange?.from
    ? dateRange.to
      ? `${formatFilterDate(dateRange.from)} 至 ${formatFilterDate(dateRange.to)}`
      : `${formatFilterDate(dateRange.from)} 至今`
    : "活动日期范围";
  const clearFilters = () => {
    setTitleQuery("");
    setDateRange(undefined);
  };
  const openCreate = () => {
    setEditingID(null);
    setForm(emptyForm);
    setDialogOpen(true);
  };
  const openEdit = (item: Promotion) => {
    setEditingID(item.id);
    setForm({
      title: item.title,
      description: item.description,
      reward_type: item.reward_type,
      reward_value: String(item.reward_value),
      starts_at: toFormDateTime(item.starts_at),
      ends_at: toFormDateTime(item.ends_at),
      enabled: item.enabled,
    });
    setDialogOpen(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = Number(form.reward_value);
    if (!form.title.trim() || !Number.isFinite(value) || value <= 0) {
      toast.error("请填写活动名称和有效的返利额度");
      return;
    }
    if (form.starts_at && form.ends_at && new Date(form.starts_at) >= new Date(form.ends_at)) {
      toast.error("结束时间必须晚于开始时间");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        title: form.title,
        description: form.description,
        reward_type: form.reward_type,
        reward_value: value,
        starts_at: toISO(form.starts_at),
        ends_at: toISO(form.ends_at),
        enabled: form.enabled,
      };
      if (editingID === null) {
        await apiClient.post("/admin/promotions", payload);
      } else {
        await apiClient.put(`/admin/promotions/${editingID}`, payload);
      }
      toast.success(editingID === null ? "促销活动已创建" : "促销活动已更新");
      setDialogOpen(false);
      setEditingID(null);
      setForm(emptyForm);
      await load();
    } catch {
      toast.error(editingID === null ? "创建失败，请检查配置" : "更新失败，请检查配置");
    } finally {
      setSaving(false);
    }
  };
  const publish = async (item: Promotion, published: boolean) => {
    try {
      const result = await apiClient.put<AuxEnvelope<{ promotion: Promotion }>>(
        `/admin/promotions/${item.id}/publish`,
        { published },
      );
      const updated = result.data?.promotion;
      if (updated)
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id ? { ...entry, ...updated } : entry,
          ),
        );
      toast.success(published ? "活动已上架" : "活动已下架");
    } catch {
      toast.error("活动状态保存失败");
    }
  };
  const toggleMenu = async (enabled: boolean) => {
    setMenuSaving(true);
    try {
      const result = await apiClient.put<AuxEnvelope<{ enabled: boolean }>>(
        "/admin/promotions/config",
        { enabled },
      );
      setMenuPublished(result.data?.enabled ?? enabled);
      toast.success(enabled ? "用户端页面已上架" : "用户端页面已下架");
    } catch {
      toast.error("用户端上架设置保存失败");
    } finally {
      setMenuSaving(false);
    }
  };
  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">促销活动</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            配置充值返利规则，查看领取数据并控制用户端上架。
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
            <Badge variant={menuPublished ? "default" : "secondary"}>
              {menuPublished ? "用户端已上架" : "用户端未上架"}
            </Badge>
            <Switch
              checked={menuPublished}
              disabled={menuSaving}
              onCheckedChange={(checked) => void toggleMenu(checked)}
              aria-label="上架促销活动用户端"
            />
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            新建活动
          </Button>
        </div>
      </div>
      {error && (
        <Alert className="border-destructive/30 bg-destructive/5 text-destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="promotion-search" className="block text-xs text-muted-foreground">活动名称</Label>
          <Input
            id="promotion-search"
            value={titleQuery}
            onChange={(event) => setTitleQuery(event.target.value)}
            placeholder="搜索活动名称"
            className="mt-1"
          />
        </div>
        <div className="min-w-0 sm:w-[270px]">
          <Label className="block text-xs text-muted-foreground">活动日期</Label>
          <Popover open={dateFilterOpen} onOpenChange={setDateFilterOpen}>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" className="mt-1 w-full justify-start gap-2 font-normal sm:w-[270px]">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{dateFilterLabel}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
                locale={zhCN}
                autoFocus
              />
              <div className="flex items-center justify-between border-t px-3 py-2">
                <span className="text-xs text-muted-foreground">按活动时间段筛选</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setDateRange(undefined)} disabled={!dateRange?.from}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />清除
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        {hasFilters && (
          <Button type="button" variant="ghost" onClick={clearFilters} className="shrink-0">
            清除筛选
          </Button>
        )}
      </div>
      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          正在加载…
        </div>
      ) : filteredItems.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-sm text-muted-foreground">
            <Gift className="mx-auto mb-3 h-8 w-8" />
            {items.length === 0 ? "还没有促销活动，先创建一个返利活动吧。" : "没有符合当前筛选条件的活动。"}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredItems.map((item) => (
            <Card key={item.id}>
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Gift className="h-4 w-4 text-primary" />
                    {item.title}
                  </CardTitle>
                  <CardDescription className="mt-2">
                    {item.description ? (
                      <div className="promotion-markdown max-h-48 overflow-y-auto pr-1" dangerouslySetInnerHTML={{ __html: renderPromotionMarkdown(item.description) }} />
                    ) : (
                      "暂无活动说明"
                    )}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => openEdit(item)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />编辑
                  </Button>
                  <Switch
                    checked={item.published}
                    onCheckedChange={(checked) => void publish(item, checked)}
                    aria-label={`上架${item.title}`}
                  />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-md bg-muted/50 p-3 text-sm">
                  <p className="font-medium">
                    返利规则：{promotionRewardLabel(item)}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-muted-foreground">
                    <Badge variant={item.enabled ? "outline" : "secondary"}>
                      {item.enabled ? "活动已启用" : "活动已停用"}
                    </Badge>
                    {item.starts_at
                      ? ` · ${new Date(item.starts_at).toLocaleString("zh-CN")}`
                      : ""}
                    {item.ends_at
                      ? ` 至 ${new Date(item.ends_at).toLocaleString("zh-CN")}`
                      : ""}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Metric
                    label="参与用户"
                    value={String(item.stats?.participant_count ?? 0)}
                  />
                  <Metric
                    label="领取订单"
                    value={String(item.stats?.claim_count ?? 0)}
                  />
                  <Metric
                    label="支付金额"
                    value={formatPromotionMoney(
                      item.stats?.order_amount_total ?? 0,
                    )}
                  />
                  <Metric
                    label="返利总额"
                    value={formatPromotionMoney(item.stats?.rebate_total ?? 0)}
                  />
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <BarChart3 className="h-3.5 w-3.5" />
                  {item.published
                    ? menuPublished
                      ? "活动已上架到 Sub2API 用户菜单"
                      : "活动已上架，但用户端页面尚未上架"
                    : "活动未上架到用户端"}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
          <DialogTitle>{editingID === null ? "新建促销活动" : "编辑促销活动"}</DialogTitle>
            <DialogDescription>
              固定金额按每笔订单计算，百分比按订单支付金额计算。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div>
              <Label htmlFor="promotion-title">活动名称</Label>
              <Input
                id="promotion-title"
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                required
              />
            </div>
            <div>
              <Label htmlFor="promotion-description">活动说明（支持 Markdown）</Label>
              <Tabs defaultValue="edit" className="mt-2">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="edit">编辑</TabsTrigger>
                  <TabsTrigger value="preview">预览</TabsTrigger>
                </TabsList>
                <TabsContent value="edit" className="mt-2">
                  <Textarea
                    id="promotion-description"
                    value={form.description}
                    onChange={(event) =>
                      setForm({ ...form, description: event.target.value })
                    }
                    rows={6}
                    placeholder={'例如：\n## 活动规则\n- 充值满 100 元可领取返利'}
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-2 min-h-36 rounded-md border bg-muted/20 p-4 text-sm">
                  {form.description.trim() ? (
                    <div
                      className="promotion-markdown"
                      dangerouslySetInnerHTML={{ __html: renderPromotionMarkdown(form.description) }}
                    />
                  ) : (
                    <p className="text-muted-foreground">暂无说明内容。</p>
                  )}
                </TabsContent>
              </Tabs>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>返利类型</Label>
                <Select
                  value={form.reward_type}
                  onValueChange={(value: "FIXED" | "PERCENTAGE") =>
                    setForm({ ...form, reward_type: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FIXED">固定金额</SelectItem>
                    <SelectItem value="PERCENTAGE">支付金额百分比</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="promotion-value">
                  {form.reward_type === "FIXED"
                    ? "返利金额（元）"
                    : "返利比例（%）"}
                </Label>
                <Input
                  id="promotion-value"
                  type="number"
                  min="0.01"
                  max={form.reward_type === "PERCENTAGE" ? 100 : undefined}
                  step="0.01"
                  value={form.reward_value}
                  onChange={(event) =>
                    setForm({ ...form, reward_value: event.target.value })
                  }
                  required
                />
              </div>
            </div>
            <PromotionDateTimeRangePicker
              startAt={form.starts_at}
              endAt={form.ends_at}
              onChange={({ startAt, endAt }) => setForm({ ...form, starts_at: startAt, ends_at: endAt })}
            />
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                  <Label htmlFor="promotion-enabled">活动启用状态</Label>
                  <p className="text-xs text-muted-foreground">
                  {editingID === null ? "关闭后活动会以停用状态创建，之后可单独上架。" : "停用后不能继续上架到用户端。"}
                </p>
              </div>
              <Switch
                id="promotion-enabled"
                checked={form.enabled}
                onCheckedChange={(enabled) => setForm({ ...form, enabled })}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingID === null ? "创建活动" : "保存修改"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
