import { describe, expect, it } from "vitest";

import { renderFiveStoreDailyOverview } from "./five-store-daily-overview.js";
import type { FiveStoreDailyOverviewInput } from "./types.js";

function buildInput(): FiveStoreDailyOverviewInput {
  return {
    bizDate: "2026-04-22",
    baselineBizDate: "2026-04-15",
    stores: [
      {
        orgId: "1001",
        storeName: "迎宾店",
        current: {
          serviceRevenue: 12800,
          customerCount: 88,
          serviceOrderCount: 92,
          averageTicket: 139.1,
          totalClockCount: 124,
          pointClockRate: 0.28,
          addClockRate: 0.24,
          clockEffect: 103.2,
          rechargeCash: 3800,
          storedConsumeAmount: 5100,
          memberPaymentAmount: 8600,
          effectiveMembers: 110,
          newMembers: 6,
          sleepingMembers: 14,
          sleepingMemberRate: 14 / 110,
          highBalanceSleepingMemberCount: 3,
          highBalanceSleepingMemberAmount: 9000,
          firstChargeUnconsumedMemberCount: 2,
          firstChargeUnconsumedMemberAmount: 3200,
          memberRepurchaseBaseCustomerCount7d: 30,
          memberRepurchaseReturnedCustomerCount7d: 12,
          memberRepurchaseRate7d: 12 / 30,
        } as any,
        previousWeekSameDay: {
          serviceRevenue: 11600,
          customerCount: 81,
          serviceOrderCount: 86,
          averageTicket: 134.9,
          totalClockCount: 116,
          pointClockRate: 0.24,
          addClockRate: 0.2,
          clockEffect: 100,
          rechargeCash: 3200,
          storedConsumeAmount: 4700,
          memberPaymentAmount: 7800,
          effectiveMembers: 108,
          newMembers: 5,
          sleepingMembers: 16,
          sleepingMemberRate: 16 / 108,
          highBalanceSleepingMemberCount: 4,
          highBalanceSleepingMemberAmount: 10500,
          firstChargeUnconsumedMemberCount: 3,
          firstChargeUnconsumedMemberAmount: 4100,
          memberRepurchaseBaseCustomerCount7d: 28,
          memberRepurchaseReturnedCustomerCount7d: 10,
          memberRepurchaseRate7d: 10 / 28,
        } as any,
      },
      {
        orgId: "1002",
        storeName: "滨江店",
        current: {
          serviceRevenue: 9800,
          customerCount: 74,
          serviceOrderCount: 79,
          averageTicket: 124.1,
          totalClockCount: 108,
          pointClockRate: 0.18,
          addClockRate: 0.11,
          clockEffect: 90.7,
          rechargeCash: 2100,
          storedConsumeAmount: 3600,
          memberPaymentAmount: 5900,
          effectiveMembers: 96,
          newMembers: 4,
          sleepingMembers: 19,
          sleepingMemberRate: 19 / 96,
          highBalanceSleepingMemberCount: 5,
          highBalanceSleepingMemberAmount: 12800,
          firstChargeUnconsumedMemberCount: 4,
          firstChargeUnconsumedMemberAmount: 3600,
          memberRepurchaseBaseCustomerCount7d: 24,
          memberRepurchaseReturnedCustomerCount7d: 8,
          memberRepurchaseRate7d: 8 / 24,
        } as any,
        previousWeekSameDay: {
          serviceRevenue: 10200,
          customerCount: 78,
          serviceOrderCount: 80,
          averageTicket: 127.5,
          totalClockCount: 111,
          pointClockRate: 0.2,
          addClockRate: 0.14,
          clockEffect: 91.9,
          rechargeCash: 2400,
          storedConsumeAmount: 3900,
          memberPaymentAmount: 6100,
          effectiveMembers: 97,
          newMembers: 5,
          sleepingMembers: 18,
          sleepingMemberRate: 18 / 97,
          highBalanceSleepingMemberCount: 5,
          highBalanceSleepingMemberAmount: 12200,
          firstChargeUnconsumedMemberCount: 4,
          firstChargeUnconsumedMemberAmount: 3800,
          memberRepurchaseBaseCustomerCount7d: 24,
          memberRepurchaseReturnedCustomerCount7d: 9,
          memberRepurchaseRate7d: 9 / 24,
        } as any,
      },
      {
        orgId: "1003",
        storeName: "华美店",
        current: {
          serviceRevenue: 10400,
          customerCount: 83,
          serviceOrderCount: 84,
          averageTicket: 123.8,
          totalClockCount: 121,
          pointClockRate: 0.31,
          addClockRate: 0.16,
          clockEffect: 86,
          rechargeCash: 1800,
          storedConsumeAmount: 4200,
          memberPaymentAmount: 6400,
          effectiveMembers: 102,
          newMembers: 5,
          sleepingMembers: 16,
          sleepingMemberRate: 16 / 102,
          highBalanceSleepingMemberCount: 2,
          highBalanceSleepingMemberAmount: 5400,
          firstChargeUnconsumedMemberCount: 2,
          firstChargeUnconsumedMemberAmount: 2500,
          memberRepurchaseBaseCustomerCount7d: 27,
          memberRepurchaseReturnedCustomerCount7d: 11,
          memberRepurchaseRate7d: 11 / 27,
        } as any,
        previousWeekSameDay: {
          serviceRevenue: 9900,
          customerCount: 80,
          serviceOrderCount: 82,
          averageTicket: 120.7,
          totalClockCount: 117,
          pointClockRate: 0.27,
          addClockRate: 0.15,
          clockEffect: 84.6,
          rechargeCash: 1600,
          storedConsumeAmount: 3900,
          memberPaymentAmount: 6100,
          effectiveMembers: 100,
          newMembers: 4,
          sleepingMembers: 17,
          sleepingMemberRate: 17 / 100,
          highBalanceSleepingMemberCount: 3,
          highBalanceSleepingMemberAmount: 6500,
          firstChargeUnconsumedMemberCount: 2,
          firstChargeUnconsumedMemberAmount: 2800,
          memberRepurchaseBaseCustomerCount7d: 27,
          memberRepurchaseReturnedCustomerCount7d: 10,
          memberRepurchaseRate7d: 10 / 27,
        } as any,
      },
      {
        orgId: "1004",
        storeName: "义乌店",
        current: {
          serviceRevenue: 9300,
          customerCount: 69,
          serviceOrderCount: 71,
          averageTicket: 131,
          totalClockCount: 98,
          pointClockRate: 0.22,
          addClockRate: 0.19,
          clockEffect: 94.9,
          rechargeCash: 2600,
          storedConsumeAmount: 3300,
          memberPaymentAmount: 5700,
          effectiveMembers: 89,
          newMembers: 7,
          sleepingMembers: 11,
          sleepingMemberRate: 11 / 89,
          highBalanceSleepingMemberCount: 2,
          highBalanceSleepingMemberAmount: 4600,
          firstChargeUnconsumedMemberCount: 1,
          firstChargeUnconsumedMemberAmount: 1800,
          memberRepurchaseBaseCustomerCount7d: 25,
          memberRepurchaseReturnedCustomerCount7d: 10,
          memberRepurchaseRate7d: 10 / 25,
        } as any,
        previousWeekSameDay: {
          serviceRevenue: 8800,
          customerCount: 65,
          serviceOrderCount: 68,
          averageTicket: 129.4,
          totalClockCount: 93,
          pointClockRate: 0.19,
          addClockRate: 0.16,
          clockEffect: 94.6,
          rechargeCash: 1900,
          storedConsumeAmount: 3000,
          memberPaymentAmount: 5300,
          effectiveMembers: 87,
          newMembers: 5,
          sleepingMembers: 13,
          sleepingMemberRate: 13 / 87,
          highBalanceSleepingMemberCount: 3,
          highBalanceSleepingMemberAmount: 5200,
          firstChargeUnconsumedMemberCount: 2,
          firstChargeUnconsumedMemberAmount: 2300,
          memberRepurchaseBaseCustomerCount7d: 24,
          memberRepurchaseReturnedCustomerCount7d: 9,
          memberRepurchaseRate7d: 9 / 24,
        } as any,
      },
      {
        orgId: "1005",
        storeName: "园中园店",
        current: {
          serviceRevenue: 8700,
          customerCount: 71,
          serviceOrderCount: 73,
          averageTicket: 119.2,
          totalClockCount: 104,
          pointClockRate: 0.2,
          addClockRate: 0.13,
          clockEffect: 83.7,
          rechargeCash: 2300,
          storedConsumeAmount: 3500,
          memberPaymentAmount: 5600,
          effectiveMembers: 84,
          newMembers: 3,
          sleepingMembers: 18,
          sleepingMemberRate: 18 / 84,
          highBalanceSleepingMemberCount: 4,
          highBalanceSleepingMemberAmount: 9800,
          firstChargeUnconsumedMemberCount: 3,
          firstChargeUnconsumedMemberAmount: 2900,
          memberRepurchaseBaseCustomerCount7d: 22,
          memberRepurchaseReturnedCustomerCount7d: 7,
          memberRepurchaseRate7d: 7 / 22,
        } as any,
        previousWeekSameDay: {
          serviceRevenue: 9100,
          customerCount: 73,
          serviceOrderCount: 75,
          averageTicket: 121.3,
          totalClockCount: 107,
          pointClockRate: 0.22,
          addClockRate: 0.15,
          clockEffect: 85,
          rechargeCash: 2500,
          storedConsumeAmount: 3700,
          memberPaymentAmount: 5800,
          effectiveMembers: 85,
          newMembers: 4,
          sleepingMembers: 16,
          sleepingMemberRate: 16 / 85,
          highBalanceSleepingMemberCount: 4,
          highBalanceSleepingMemberAmount: 9600,
          firstChargeUnconsumedMemberCount: 3,
          firstChargeUnconsumedMemberAmount: 3100,
          memberRepurchaseBaseCustomerCount7d: 22,
          memberRepurchaseReturnedCustomerCount7d: 8,
          memberRepurchaseRate7d: 8 / 22,
        } as any,
      },
    ],
  };
}

describe("renderFiveStoreDailyOverview", () => {
  it("renders the approved deep-diagnosis structure instead of the old result-broadcast layout", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("# 荷塘悦色5店昨日经营总览");
    expect(text).toContain("## 一、总判断");
    expect(text).toContain("## 二、证据链");
    expect(text).toContain("## 三、真正的核心问题");
    expect(text).toContain("## 四、最值得警惕的会员信号");
    expect(text).toContain("## 五、门店级判断");
    expect(text).toContain("## 六、如果今天只做一件事");
    expect(text).toContain("真正的核心问题不是“哪家店最差”");
    expect(text).toContain("进店 -> 指定 -> 加钟 -> 储值 -> 首耗 -> 复购");
    expect(text).toContain("这不是销售问题，这是激活问题。");
    expect(text).toContain("48小时首耗激活完成率");
    expect(text).not.toContain("客单");
    expect(text).not.toContain("现金与会员边界");
    expect(text).not.toContain("N/A");
  });

  it("keeps the diagnosis grounded in complete member metrics when the numbers are available", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("- 储值现金：");
    expect(text).toContain("- 首充未耗卡：12人 / 1.4万");
    expect(text).toContain("- 7日复购率：37.5%（48/128）");
    expect(text).toContain("问题不是客户不肯付钱，问题是付完钱之后，没有被足够快地带入下一次服务。");
    expect(text).not.toContain("客单");
    expect(text).not.toContain("现金与会员边界");
  });

  it("hides member lines when the required numbers are incomplete", () => {
    const input = buildInput();
    delete (input.stores[0]!.current as Record<string, unknown>).memberRepurchaseBaseCustomerCount7d;
    delete (input.stores[0]!.current as Record<string, unknown>).memberRepurchaseReturnedCustomerCount7d;
    delete (input.stores[0]!.previousWeekSameDay as Record<string, unknown>).memberRepurchaseBaseCustomerCount7d;
    delete (input.stores[0]!.previousWeekSameDay as Record<string, unknown>).memberRepurchaseReturnedCustomerCount7d;

    const text = renderFiveStoreDailyOverview(input);

    expect(text).not.toContain("- 7日复购率：");
    expect(text).not.toContain("这不是销售问题，这是激活问题。");
  });

  it("explains the system bottleneck and ends with one owner-level action", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("1. 前端");
    expect(text).toContain("2. 中段承接");
    expect(text).toContain("3. 后段");
    expect(text).toContain("如果今天只做一件事");
    expect(text).toContain("把昨天新增储值但尚未首耗的会员，全部拉出名单");
    expect(text).toContain("### 迎宾店");
    expect(text).toContain("- 角色：");
    expect(text).toContain("- 动作：");
  });

  it("renders a mobile-friendly layout with short summary lines and per-store blocks", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("日期：2026-04-22");
    expect(text).toContain("对比：2026-04-15");
    expect(text).toContain("- 判断：");
    expect(text).toContain("- 营收：");
    expect(text).toContain("- 客流：");
    expect(text).toContain("### 迎宾店");
    expect(text).toContain("- 角色：");
    expect(text).toContain("- 问题：");
    expect(text).toContain("- 动作：");
    expect(text).not.toContain("迎宾店：角色是");
  });
});
