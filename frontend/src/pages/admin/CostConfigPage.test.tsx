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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 12, 12));
  vi.mocked(apiClient.get).mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("成本配置列表", () => {
  it("分页显示账号，跨页和筛选保留编辑，并按账号 ID 保存", async () => {
    vi.mocked(apiClient.put).mockResolvedValue({ code: 0, data: { ...accounts[0], oauth_account_cost: 42 } });
    await openPage();
    expect(visibleRows()).toHaveLength(20);
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    fireEvent.change(within(visibleRows()[0]).getByRole("spinbutton"), { target: { value: "42" } });
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(visibleRows()).toHaveLength(5);
    expect(screen.getByText("测试账号 21")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "上一页" }));
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "主账号组" } });
    expect(visibleRows()).toHaveLength(2);
    expect(within(visibleRows()[0]).getByRole("spinbutton")).toHaveValue(42);
    await userEvent.click(within(visibleRows()[0]).getByRole("button", { name: "保存" }));
    expect(apiClient.put).toHaveBeenCalledWith("/admin/ops/cost-config/accounts/1", expect.objectContaining({ account_id: 1, oauth_account_cost: 42 }));
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
    fireEvent.change(screen.getByLabelText("搜索账号"), { target: { value: "主账号组" } });
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

  it("没有账号时显示同步引导", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(response([]));
    await openPage();
    expect(screen.getByText("暂无账号。点击“立即同步倍率”读取 Sub2API accounts。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  });
});
