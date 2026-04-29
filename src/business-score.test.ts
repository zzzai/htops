import { describe, expect, it } from "vitest";
import {
  evaluateCustomerBusinessScore,
  evaluateStoreBusinessScore,
  evaluateTechBusinessScore,
} from "./business-score.js";

describe("business-score", () => {
  it("classifies high-value silent customers into a reactivation-first operating tier", () => {
    const signal = evaluateCustomerBusinessScore({
      primarySegment: "important-reactivation-member",
      paymentSegment: "member-only",
      techLoyaltySegment: "single-tech-loyal",
      payAmount90d: 1680,
      visitCount90d: 5,
      silentDays: 44,
    });

    expect(signal.tierLabel).toBe("高价值待唤回");
    expect(signal.riskLabel).toBe("高");
    expect(signal.tags).toEqual(["高价值待唤回", "沉默风险高", "技师偏好稳定"]);
    expect(signal.actionPriority).toBe("先人工唤回，再围绕熟悉技师和主项目重建联系。");
  });

  it("marks strong technicians with clear operating tags and a scale-up priority", () => {
    const signal = evaluateTechBusinessScore({
      customerBindingState: "ready",
      uniqueCustomerCount: 5,
      pointClockRate: 0.62,
      addClockRate: 0.26,
      marketRevenue: 88,
      importantValueCustomerCount: 2,
    });

    expect(signal.levelLabel).toBe("强势型");
    expect(signal.tags).toEqual(["点钟强", "加钟在线", "高价值会员承接好", "副项承接在线"]);
    expect(signal.actionPriority).toBe("继续放大高峰班承接，把强项稳定复制给更多顾客。");
  });

  it("flags stores under conversion pressure instead of calling them stable", () => {
    const signal = evaluateStoreBusinessScore({
      revenueChange: 0.02,
      clockEffectChange: -0.03,
      groupbuy7dRevisitRate: 0.91,
      groupbuy7dStoredValueConversionRate: 0,
      groupbuyFirstOrderHighValueMemberRate: 0,
      sleepingMemberRate: 0.03,
      pointClockRate: 0.33,
      addClockRate: 0.07,
    });

    expect(signal.levelLabel).toBe("承压");
    expect(signal.tags).toEqual(["储值承接弱", "点钟偏弱", "加钟偏弱", "高价值沉淀慢"]);
    expect(signal.actionPriority).toBe("先补前台和技师的开卡储值收口，再看高价值沉淀。");
  });
});
