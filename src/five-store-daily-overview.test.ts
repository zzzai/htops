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
  it("renders the headquarters radar structure instead of the long deep-diagnosis layout", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("# 荷塘悦色5店经营雷达");
    expect(text).toContain("## 一、5店总判断");
    expect(text).toContain("## 二、今日最该盯的3个痛点");
    expect(text).toContain("## 三、门店处理优先级");
    expect(text).toContain("## 四、今天只做一件事");
    expect(text).toContain("命中门店：");
    expect(text).toContain("储值压力");
    expect(text).not.toContain("## 二、证据链");
    expect(text).not.toContain("## 三、真正的核心问题");
    expect(text).not.toContain("## 四、最值得警惕的会员信号");
    expect(text).not.toContain("真正的核心问题不是“哪家店最差”");
    expect(text).not.toContain("进店 -> 指定 -> 加钟 -> 储值 -> 首耗 -> 复购");
    expect(text).not.toContain("客单");
    expect(text).not.toContain("现金与会员边界");
    expect(text).not.toContain("N/A");
  });

  it("aggregates proactive pain signals into group-level actions", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("1. 储值压力");
    expect(text).toContain("- 命中门店：");
    expect(text).toContain("- 证据：");
    expect(text).toContain("- 动作：");
    expect(text).toContain("总部/区域今天统一盯：");
  });

  it("surfaces data risk before business judgment when a store has incomplete data", () => {
    const input = buildInput();
    Object.assign(input.stores[0]!.current as Record<string, unknown>, {
      incompleteSync: true,
      unavailableMetrics: ["1.1", "1.7"],
      staleSyncEndpoints: ["1.3"],
    });

    const text = renderFiveStoreDailyOverview(input);

    expect(text).toContain("## 数据可信度");
    expect(text).toContain("数据风险");
    expect(text).toContain("迎宾店");
    expect(text).toContain("不可用指标 1.1,1.7");
  });

  it("keeps per-store detail compressed into one task label per store", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("- 迎宾店：");
    expect(text).toContain("- 滨江店：");
    expect(text).toContain("- 华美店：");
    expect(text).toContain("- 义乌店：");
    expect(text).toContain("- 园中园店：");
    expect(text).not.toContain("### 迎宾店");
    expect(text).not.toContain("- 角色：");
    expect(text).not.toContain("- 问题：");
  });

  it("renders a mobile-friendly layout with short summary lines and per-store blocks", () => {
    const text = renderFiveStoreDailyOverview(buildInput());

    expect(text).toContain("日期：2026-04-22");
    expect(text).toContain("对比：2026-04-15");
    expect(text).toContain("- 判断：");
    expect(text).toContain("- 营收：");
    expect(text).toContain("- 客流：");
    expect(text).toContain("## 三、门店处理优先级");
    expect(text).toContain("## 四、今天只做一件事");
    expect(text).not.toContain("迎宾店：角色是");
  });

  it("renders external environment context as an explanation layer before business judgment", () => {
    const input = {
      ...buildInput(),
      backgroundHint: "昨日存在天气扰动，跨店差异需结合天气影响一起看。",
      environmentContext: {
        headline: "天气扰动影响到店",
        explanationLines: [
          "天气扰动会影响即时到店和老客临时取消，客流波动需和预约承接一起看。",
          "晚饭后和夜场需求偏强，今天更适合把晚场技师、房态和熟客预约前置。",
        ],
        actionHint: "今天先补预约确认和临时改约，避免天气导致有效客流流失。",
      },
    };

    const text = renderFiveStoreDailyOverview(input);

    expect(text).toContain("## 外部环境解释");
    expect(text).toContain("- 判断：天气扰动影响到店");
    expect(text).toContain("天气扰动会影响即时到店");
    expect(text).toContain("今天先补预约确认和临时改约");
    expect(text.indexOf("## 外部环境解释")).toBeLessThan(
      text.indexOf("## 一、5店总判断"),
    );
  });
});
