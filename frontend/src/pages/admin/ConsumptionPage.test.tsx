import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { apiClient } from "@/lib/api-client";
import ConsumptionPage from "@/pages/admin/ConsumptionPage";

vi.mock("@/lib/api-client", () => ({ apiClient: { get: vi.fn() } }));

const response = {
  code: 0,
  message: "success",
  data: {
    start_time: "2026-09-01T00:00:00Z",
    end_time: "2026-09-13T00:00:00Z",
    config: { oauth_account_cost: 12, api_cost_multiplier: 1, tax_rate: 6, currency: "CNY" },
    total_requests: 3,
    total_tokens: 300,
    total_revenue: 0,
    revenue_available: false,
    total_api_cost: 8,
    total_oauth_cost: 12,
    total_cost: 20,
    gross_profit: 0,
    gross_margin: 0,
    total_tax: 0,
    profit: 0,
    net_profit: 0,
    net_margin: 0,
    oauth_account_count: 1,
    api_account_count: 1,
    days: [{
      date: "2026-09-12",
      requests: 2,
      total_tokens: 200,
      api_requests: 2,
      api_tokens: 200,
      revenue: 0,
      api_revenue: 0,
      oauth_revenue: 0,
      api_cost: 8,
      oauth_cost: 0,
      total_cost: 8,
      gross_profit: 0,
      api_gross_profit: 0,
      tax_amount: 0,
      profit: 0,
      net_profit: 0,
      net_margin: 0,
      api_tax_amount: 0,
      api_net_profit: 0,
      api_net_margin: 0,
      oauth_account_count: 0,
      api_account_count: 1,
    }],
    daily_accounts: [
      {
        date: "2026-09-12",
        account_id: 7,
        account_type: "api",
        name: "API 账号一",
        platform: "openai",
        requests: 2,
        tokens: 200,
        revenue: 0,
        api_cost: 8,
        oauth_cost: 0,
        multiplier: 1,
        multiplier_source: "Sub2API sync",
      },
      {
        date: "2026-09-12",
        account_id: 9,
        account_type: "api",
        name: "API 账号二",
        platform: "openai",
        requests: 1,
        tokens: 50,
        revenue: 0,
        api_cost: 2,
        oauth_cost: 0,
        multiplier: 1,
        multiplier_source: "manual",
      },
      {
        date: "2026-09-11",
        account_id: 8,
        account_type: "oauth",
        name: "OAuth 账号一",
        platform: "anthropic",
        requests: 1,
        tokens: 100,
        revenue: 0,
        api_cost: 0,
        oauth_cost: 0,
        multiplier: 0,
        multiplier_source: "purchase cost",
      },
    ],
    accounts: [],
  },
};

const responseWithRevenue = {
  ...response,
  data: {
    ...response.data,
    revenue_available: true,
    revenue_source: "charged_amount",
    total_revenue: 27,
    daily_accounts: response.data.daily_accounts.map((row) => ({
      ...row,
      revenue: row.account_type === "oauth" ? 12 : row.account_id === 7 ? 10 : 5,
    })),
    accounts: [{
      account_id: 8,
      account_type: "oauth",
      account_types: ["oauth"],
      name: "OAuth 账号一",
      platform: "anthropic",
      requests: 1,
      revenue: 12,
      api_cost: 0,
      oauth_cost: 12,
      gross_profit: 0,
      tax_amount: 0,
      net_profit: 0,
      multiplier: 0,
      multiplier_source: "purchase cost",
    }],
  },
};

const responseWithAccountLists = {
  ...responseWithRevenue,
  data: {
    ...responseWithRevenue.data,
    accounts: Array.from({ length: 22 }, (_, index) => {
      const accountID = index + 1;
      const isOAuth = index % 2 === 0;
      const accountType = isOAuth ? "oauth" : "api";
      return {
        account_id: accountID,
        account_ids: [accountID],
        account_type: accountType,
        account_types: [accountType],
        name: `${isOAuth ? "OAuth" : "API"} 账号 ${accountID}`,
        platform: index % 3 === 0 ? "anthropic" : index % 3 === 1 ? "openai" : "gemini",
        billing_group: `计费组-${accountID}`,
        account_created_at: `2026-${index < 11 ? "09" : "08"}-${String((index % 11) + 1).padStart(2, "0")}T12:00:00Z`,
        account_expires_at: "2099-12-31T12:00:00Z",
        requests: accountID,
        revenue: isOAuth ? 12 : 5,
        api_cost: isOAuth ? 0 : 2,
        oauth_cost: isOAuth ? 12 : 0,
        gross_profit: isOAuth ? 0 : 3,
        tax_amount: isOAuth ? 0.72 : 0.3,
        net_profit: isOAuth ? 0 : 2.7,
        multiplier: isOAuth ? 0 : 1,
        multiplier_source: isOAuth ? "purchase cost" : "manual",
      };
    }),
  },
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(apiClient.get).mockResolvedValue(response);
});

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("消费核算", () => {
  it("按 tab 切换 API 和 OAuth 每日明细", async () => {
    render(<ConsumptionPage />);

    const dailyDetails = await screen.findByRole("region", { name: "每日明细" });
    expect(screen.queryByRole("region", { name: "核算口径" })).not.toBeInTheDocument();
    expect(screen.queryByText("API 账号成本走势")).not.toBeInTheDocument();
    const apiTable = within(within(dailyDetails).getByRole("table"));
    expect(apiTable.getByText("09/12")).toBeInTheDocument();
    expect(apiTable.getByText("3")).toBeInTheDocument();
    expect(apiTable.queryByRole("columnheader", { name: "账号" })).not.toBeInTheDocument();
    expect(apiTable.getByRole("columnheader", { name: "API 收入" })).toBeInTheDocument();
    expect(apiTable.queryByRole("columnheader", { name: "倍率 / 口径" })).not.toBeInTheDocument();
    expect(apiTable.getAllByText("—").length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole("tab", { name: /OAuth 账号/ }));

    const oauthTable = within(within(dailyDetails).getByRole("table"));
    expect(oauthTable.getByText("09/11")).toBeInTheDocument();
    expect(oauthTable.queryByText("区间总账")).not.toBeInTheDocument();
    expect(oauthTable.queryByRole("columnheader", { name: /OAuth 成本/ })).not.toBeInTheDocument();
    expect(oauthTable.getByRole("columnheader", { name: "当天利润（用户计费）" })).toBeInTheDocument();
    expect(oauthTable.queryByRole("columnheader", { name: "回本进度" })).not.toBeInTheDocument();
  });

  it("按账号类型显示 OAuth 用户计费和 API 利润列", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(responseWithRevenue);
    render(<ConsumptionPage />);

    const dailyDetails = await screen.findByRole("region", { name: "每日明细" });
    const apiTable = within(within(dailyDetails).getByRole("table"));
    expect(apiTable.getByRole("columnheader", { name: "API 收入" })).toBeInTheDocument();
    expect(apiTable.queryByRole("columnheader", { name: "倍率 / 口径" })).not.toBeInTheDocument();
    expect(apiTable.getByRole("columnheader", { name: "API 毛利" })).toBeInTheDocument();
    expect(apiTable.getByRole("columnheader", { name: "API 税后利润" })).toBeInTheDocument();
    for (const label of ["API 毛利", "API 税额", "API 税后利润", "API 税后利润率"]) {
      expect(apiTable.getByRole("button", { name: `${label}计算公式` })).toBeInTheDocument();
    }
    await userEvent.hover(apiTable.getByRole("button", { name: "API 毛利计算公式" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("API 毛利 = API 收入 − API 成本");
    expect(apiTable.getByText("¥5.00")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: /OAuth 账号/ }));
    const oauthTable = within(within(dailyDetails).getByRole("table"));
    expect(oauthTable.getByRole("columnheader", { name: "当天利润（用户计费）" })).toBeInTheDocument();
    expect(oauthTable.queryByRole("columnheader", { name: /OAuth 成本/ })).not.toBeInTheDocument();
    expect(oauthTable.getByText("¥12.00")).toBeInTheDocument();
    expect(oauthTable.queryByRole("columnheader", { name: "倍率 / 口径" })).not.toBeInTheDocument();
    const payback = screen.getByRole("region", { name: "OAuth 回本分析" });
    expect(within(payback).getByRole("heading", { name: "OAuth 回本分析" })).toBeInTheDocument();
    expect(within(payback).getByText("整体回本进度")).toBeInTheDocument();
    expect(within(payback).getAllByText("100.0%")).toHaveLength(2);
    expect(within(payback).getByText("已回本")).toBeInTheDocument();
    expect(within(payback).getByText("永不过期")).toBeInTheDocument();
  });

  it("支持 OAuth 回本和账号成本列表的搜索、创建时间筛选与分页", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(responseWithAccountLists);
    render(<ConsumptionPage />);

    const payback = await screen.findByRole("region", { name: "OAuth 回本分析" });
    const accountDetails = screen.getByRole("region", { name: "账号成本明细" });

    expect(within(payback).getByRole("button", { name: "创建时间" })).toBeInTheDocument();
    expect(within(payback).getByRole("columnheader", { name: "账号创建时间" })).toBeInTheDocument();
    expect(within(payback).getByRole("columnheader", { name: "过期时间" })).toBeInTheDocument();
    expect(within(payback).getAllByText(/剩余 \d+ 天/).length).toBeGreaterThan(0);
    expect(within(accountDetails).getByRole("button", { name: "创建时间" })).toBeInTheDocument();

    const paybackPageSize = within(payback).getByRole("combobox", { name: "OAuth 回本分析每页条数" });
    fireEvent.keyDown(paybackPageSize, { key: "ArrowDown" });
    await userEvent.click(await screen.findByRole("option", { name: "10 条" }));
    expect(within(payback).getByText("第 1 / 2 页")).toBeInTheDocument();
    await userEvent.click(within(payback).getByRole("button", { name: "下一页" }));
    expect(within(payback).getByText("第 2 / 2 页")).toBeInTheDocument();

    fireEvent.change(within(payback).getByLabelText("OAuth 回本分析搜索账号"), { target: { value: "计费组-21" } });
    expect(within(payback).getByText("计费组-21")).toBeInTheDocument();
    expect(within(payback).getByText("第 1 / 1 页")).toBeInTheDocument();

    const accountPageSize = within(accountDetails).getByRole("combobox", { name: "账号成本明细每页条数" });
    fireEvent.keyDown(accountPageSize, { key: "ArrowDown" });
    await userEvent.click(await screen.findByRole("option", { name: "10 条" }));
    await userEvent.click(within(accountDetails).getByRole("button", { name: "下一页" }));
    expect(within(accountDetails).getByText("第 2 / 3 页")).toBeInTheDocument();
    fireEvent.change(within(accountDetails).getByLabelText("账号成本明细搜索账号"), { target: { value: "计费组-22" } });
    expect(within(accountDetails).getByText("计费组-22")).toBeInTheDocument();

    await userEvent.click(within(accountDetails).getByRole("button", { name: "清除筛选" }));
    await userEvent.click(within(accountDetails).getByRole("button", { name: "创建时间" }));
    await userEvent.click((await screen.findAllByRole("button", { name: "2026-09-01" }))[0]);
    await userEvent.click((await screen.findAllByRole("button", { name: "2026-09-01" }))[0]);
    await userEvent.keyboard("{Escape}");
    expect(within(accountDetails).getByText("计费组-1")).toBeInTheDocument();
    expect(within(accountDetails).queryByText("计费组-2")).not.toBeInTheDocument();
  });

  it("账号成本明细展示毛利和利润，并支持账号类型与平台筛选", async () => {
    vi.mocked(apiClient.get).mockResolvedValue(responseWithAccountLists);
    render(<ConsumptionPage />);

    const accountDetails = await screen.findByRole("region", { name: "账号成本明细" });
    expect(within(accountDetails).getByRole("columnheader", { name: "毛利" })).toBeInTheDocument();
    expect(within(accountDetails).getByRole("columnheader", { name: "利润" })).toBeInTheDocument();
    expect(within(accountDetails).getAllByText("¥3.00").length).toBeGreaterThan(0);
    expect(within(accountDetails).getAllByText("¥2.70").length).toBeGreaterThan(0);

    const typeFilter = within(accountDetails).getByRole("combobox", { name: "账号成本明细账号类型" });
    fireEvent.keyDown(typeFilter, { key: "ArrowDown" });
    await userEvent.click(await screen.findByRole("option", { name: "API" }));
    expect(await within(accountDetails).findByText("计费组-2")).toBeInTheDocument();
    expect(within(accountDetails).queryByText("计费组-1")).not.toBeInTheDocument();

    const platformFilter = within(accountDetails).getByRole("combobox", { name: "账号成本明细平台" });
    await userEvent.click(platformFilter);
    await userEvent.click(await screen.findByRole("option", { name: "anthropic" }));
    expect(await within(accountDetails).findByText("计费组-4")).toBeInTheDocument();
    expect(within(accountDetails).queryByText("计费组-2")).not.toBeInTheDocument();

    await userEvent.click(within(accountDetails).getByRole("button", { name: "清除筛选" }));
    expect(within(accountDetails).getByText("计费组-1")).toBeInTheDocument();
  });
});
