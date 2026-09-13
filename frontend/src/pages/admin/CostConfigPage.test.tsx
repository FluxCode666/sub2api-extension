import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { apiClient } from "@/lib/api-client";
import CostConfigPage from "@/pages/admin/CostConfigPage";

vi.mock("@/lib/api-client", () => ({ apiClient: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

const accounts = Array.from({ length: 25 }, (_, index) => ({
  account_id: index + 1,
  account_type: index % 2 === 0 ? "oauth" : "api",
  name: `测试账号 ${index + 1}`,
  platform: "openai",
  account_deleted_at: null as string | null,
  billing_group: index < 2 ? "主账号组" : "",
  account_created_at: new Date(2026, 8, index + 1, 12).toISOString(),
  oauth_account_cost: 10,
  api_multiplier_mode: "sync",
  synced_api_multiplier: 1,
}));

function response(items = accounts) {
  return { code: 0, message: "success", data: { global: { oauth_account_cost: 0, api_cost_multiplier: 1, tax_rate: 0, currency: "CNY" }, accounts: items } };
}

async function openPage() {
  render(<CostConfigPage />);
  await screen.findByRole("table");
}

function visibleRows() {
  return within(screen.getByRole("table")).getAllByRole("row").slice(1);
}

async function chooseOption(label: string, name: string) {
  fireEvent.keyDown(screen.getByRole("combobox", { name: label }), { key: "ArrowDown" });
  await userEvent.click(await screen.findByRole("option", { name }));
  await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
}

async function chooseRange(from: string, to: string) {
  await userEvent.click(screen.getByRole("button", { name: "创建时间" }));
  await userEvent.click((await screen.findAllByRole("button", { name: from }))[0]);
  await userEvent.click((await screen.findAllByRole("button", { name: to }))[0]);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 12, 12));
  vi.mocked(apiClient.get).mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("成本配置列表", () => {
  it("默认核算参数通过弹窗编辑，取消不会改动已保存摘要", async () => {
    await openPage();
    expect(screen.getByText("CNY 0.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "编辑默认核算参数" }));
    const dialog = screen.getByRole("dialog", { name: "默认核算参数" });
    expect(within(dialog).getByLabelText("OAuth 默认单号成本")).toHaveValue(0);
    fireEvent.change(within(dialog).getByLabelText("OAuth 默认单号成本"), { target: { value: "12.5" } });
    await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "默认核算参数" })).not.toBeInTheDocument();
    expect(screen.getByText("CNY 0.00")).toBeInTheDocument();

    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { oauth_account_cost: 12.5, api_cost_multiplier: 1, tax_rate: 0, currency: "CNY" } });
    await userEvent.click(screen.getByRole("button", { name: "编辑默认核算参数" }));
    const reopenedDialog = screen.getByRole("dialog", { name: "默认核算参数" });
    fireEvent.change(within(reopenedDialog).getByLabelText("OAuth 默认单号成本"), { target: { value: "12.5" } });
    await userEvent.click(within(reopenedDialog).getByRole("button", { name: "保存默认配置" }));
    await waitFor(() => expect(apiClient.put).toHaveBeenCalledWith("/admin/ops/cost-config", { oauth_account_cost: 12.5, api_cost_multiplier: 1, tax_rate: 0, currency: "CNY" }));
    expect(screen.getByText("CNY 12.50")).toBeInTheDocument();
  });

  it("分页显示账号，跨页和筛选保留编辑，并按账号 ID 保存", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { ...accounts[24], oauth_account_cost: 42 } });
    await openPage();
    expect(visibleRows()).toHaveLength(20);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.change(within(visibleRows()[0]).getByRole("spinbutton"), { target: { value: "42" } });
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(visibleRows()).toHaveLength(5);
    expect(screen.getByText("测试账号 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "上一页" }));
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "测试账号 25" } });
    expect(visibleRows()).toHaveLength(1);
    expect(within(visibleRows()[0]).getByRole("spinbutton")).toHaveValue(42);
    await userEvent.click(within(visibleRows()[0]).getByRole("button", { name: "保存" }));
    expect(apiClient.put).toHaveBeenCalledWith("/admin/ops/cost-config/accounts/25", expect.objectContaining({ account_id: 25, oauth_account_cost: 42 }));
    await screen.findByRole("button", { name: "重置筛选" });
  });

  it("改变类型、搜索和每页条数时回到第一页，正确处理无匹配结果", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await chooseOption("账号类型", "OAuth");
    expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
    expect(visibleRows()).toHaveLength(13);
    await chooseOption("每页条数", "10 条");
    expect(visibleRows()).toHaveLength(10);
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(visibleRows()).toHaveLength(3);
    await chooseOption("每页条数", "50 条");
    expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
    await chooseOption("账号类型", "API");
    expect(visibleRows()).toHaveLength(12);
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "不存在的账号" } });
    expect(screen.getByText("没有符合筛选条件的账号，请调整或重置筛选。")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("共 0 个账号");
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(visibleRows()).toHaveLength(25);
  });

  it("按成本配置状态筛选独立配置和默认配置账号", async () => {
    const configuredAPI = { ...accounts[1], api_multiplier_mode: "manual", api_multiplier_override: 1.25 };
    vi.mocked(apiClient.get).mockResolvedValue(response([accounts[0], configuredAPI, accounts[3]]));
    await openPage();

    await chooseOption("成本配置", "已配置");
    expect(visibleRows()).toHaveLength(2);
    expect(screen.getByText("测试账号 1")).toBeInTheDocument();
    expect(screen.getByText("测试账号 2")).toBeInTheDocument();

    await chooseOption("成本配置", "未配置");
    expect(visibleRows()).toHaveLength(1);
    expect(screen.getByText("测试账号 4")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByRole("combobox", { name: "成本配置" })).toHaveTextContent("全部配置");
    expect(visibleRows()).toHaveLength(3);
  });

  it("单个范围日历支持同日筛选、本地首尾边界、组合搜索和清除", async () => {
    const dated = [
      new Date(2026, 8, 12, 0).toISOString(),
      new Date(2026, 8, 12, 23, 59, 59, 999).toISOString(),
      new Date(2026, 8, 11, 23, 59, 59, 999).toISOString(),
      new Date(2026, 8, 13, 0).toISOString(),
      "",
      "invalid-date",
    ].map((date, index) => ({ ...accounts[index], account_created_at: date }));
    vi.mocked(apiClient.get).mockResolvedValue(response(dated));
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "创建时间" }));
    await userEvent.click(await screen.findByRole("button", { name: "2026-09-12" }));
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("选择结束日期");
    expect(screen.getByRole("dialog", { name: "创建日期范围" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "2026-09-12" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("2026-09-12 — 2026-09-12");
    expect(visibleRows()).toHaveLength(2);
    expect(screen.getByText("测试账号 1")).toBeInTheDocument();
    expect(screen.getByText("测试账号 2")).toBeInTheDocument();
    await chooseOption("账号类型", "API");
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "测试账号 2" } });
    expect(visibleRows()).toHaveLength(1);
    expect(screen.getByText("测试账号 2")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(visibleRows()).toHaveLength(6);
    await chooseRange("2026-09-13", "2026-09-11");
    expect(visibleRows()).toHaveLength(4);
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("2026-09-11 — 2026-09-13");
    await userEvent.click(screen.getByRole("button", { name: "创建时间" }));
    await userEvent.click(await screen.findByRole("button", { name: "清除日期范围" }));
    expect(visibleRows()).toHaveLength(6);
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("选择创建日期范围");
  });

  it("支持跨月范围，重新选择范围回到第一页", async () => {
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await chooseRange("2026-09-24", "2026-10-02");
    expect(visibleRows()).toHaveLength(2);
    expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("2026-09-24 — 2026-10-02");
    await chooseRange("2026-09-10", "2026-09-12");
    expect(visibleRows()).toHaveLength(3);
    expect(screen.getByText("测试账号 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建时间" })).toHaveTextContent("2026-09-10 — 2026-09-12");
  });

  it("同步后账号数量缩小时回落到有效页码", async () => {
    vi.mocked(apiClient.post).mockResolvedValue(response(accounts.slice(0, 3)));
    await openPage();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await userEvent.click(screen.getByRole("button", { name: "立即同步倍率" }));
    await screen.findByText("第 1 / 1 页");
    expect(visibleRows()).toHaveLength(3);
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });

  it("按创建时间倒序排序，同一时间按 ID 倒序，未知时间置后，ID 与名称共用一列", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response([
      { ...accounts[24], account_created_at: "" },
      accounts[1],
      { ...accounts[0], account_created_at: accounts[1].account_created_at },
      { ...accounts[2], account_created_at: "invalid-date" },
      accounts[4],
    ]));
    await openPage();
    expect(visibleRows().map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      "测试账号 5#5", "测试账号 2#2", "测试账号 1#1", "测试账号 25#25", "测试账号 3#3",
    ]);
    expect(screen.getByRole("columnheader", { name: "创建时间 ↓" })).toHaveAttribute("aria-sort", "descending");
    expect(within(visibleRows()[0]).getAllByRole("cell")[1]).toHaveTextContent("2026/09/05 12:00:00");
    expect(within(visibleRows()[4]).getAllByRole("cell")[1]).toHaveTextContent("—");
  });

  it("默认排除已删除账号，名称或 ID 搜索包含已删除账号，并组合平台、类型、日期筛选", async () => {
    const items = accounts.map((account, index) => ({ ...account,
      platform: index >= 23 ? "anthropic" : "openai",
      account_deleted_at: index === 23 ? "2026-09-26T00:00:00Z" : null,
    }));
    vi.mocked(apiClient.get).mockResolvedValue(response(items));
    await openPage();
    expect(screen.queryByText("测试账号 24")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("共 24 个账号");
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    await userEvent.click(screen.getByRole("combobox", { name: "平台" }));
    await userEvent.type(screen.getByRole("combobox", { name: "搜索平台" }), "anth");
    expect(screen.queryByRole("option", { name: "openai" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("option", { name: "anthropic" }));
    expect(screen.getByText("第 1 / 1 页")).toBeInTheDocument();
    expect(visibleRows()).toHaveLength(1);
    expect(screen.getByText("测试账号 25")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "  测试账号 24  " } });
    expect(screen.getByText("已删除")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "24" } });
    expect(screen.getByText("测试账号 24")).toBeInTheDocument();
    await chooseOption("账号类型", "API");
    await chooseRange("2026-09-24", "2026-09-24");
    expect(visibleRows()).toHaveLength(1);
    expect(screen.getByText("已删除")).toBeInTheDocument();
    await chooseOption("账号类型", "OAuth");
    expect(screen.getByRole("status")).toHaveTextContent("共 0 个账号");
    await userEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.getByRole("combobox", { name: "平台" })).toHaveTextContent("全部平台");
    expect(screen.getByRole("status")).toHaveTextContent("共 24 个账号");
    for (const search of ["   ", "anthropic", "主账号组"]) {
      fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: search } });
      expect(screen.queryByText("已删除")).not.toBeInTheDocument();
    }
  });

  it("只有已删除账号时显示搜索提示，清空搜索恢复隐藏", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response([{ ...accounts[0], account_deleted_at: "2026-09-26T00:00:00Z" }]));
    await openPage();
    expect(screen.getByText("暂无未删除账号，输入账号名或 ID 可查询已删除账号。")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "1" } });
    expect(screen.getByText("已删除")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "" } });
    expect(screen.queryByText("已删除")).not.toBeInTheDocument();
  });

  it("没有账号时显示同步引导", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response([]));
    await openPage();
    expect(screen.getByText("暂无账号。点击“立即同步倍率”读取 Sub2API accounts。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });
});
