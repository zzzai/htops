import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  normalizeHetangSemanticText,
  resolveHetangQuerySemanticContext,
} from "./query-semantics.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1002", storeName: "园中园店" },
      { orgId: "1003", storeName: "迎宾店" },
      { orgId: "1004", storeName: "华美店" },
      { orgId: "1005", storeName: "锦苑店" },
    ],
  });
}

describe("query semantics", () => {
  const config = buildConfig();

  it("expands business shorthand into stable semantic hints", () => {
    expect(normalizeHetangSemanticText("义乌店盘子稳不稳")).toContain("经营复盘");
    expect(normalizeHetangSemanticText("这周先抓复购还是储值")).toContain("充值");
    expect(normalizeHetangSemanticText("晚场有没有接住")).toContain("等待时长");
  });

  it("extracts route-relevant semantic signals and store context", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "义乌店近30天最值得先跟进的会员名单",
    });

    expect(context.explicitOrgIds).toEqual(["1001"]);
    expect(context.hasStoreContext).toBe(true);
    expect(context.mentionsCustomerSegmentKeyword).toBe(true);
    expect(context.mentionsCustomerSegmentListStyle).toBe(true);
    expect(context.metrics.supported).toEqual([]);
  });

  it("matches safe shortened store aliases into an explicit single-store context", () => {
    const brandedConfig = resolveHetangOpsConfig({
      api: {
        appKey: "demo-app-key",
        appSecret: "demo-app-secret",
      },
      database: {
        url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
      },
      stores: [
        { orgId: "1001", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
        { orgId: "1002", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
      ],
    });

    const context = resolveHetangQuerySemanticContext({
      config: brandedConfig,
      text: "园中园昨天客流量多少",
    });

    expect(context.explicitOrgIds).toEqual(["1002"]);
    expect(context.hasStoreContext).toBe(true);
  });

  it("keeps metric-style沉默会员 queries on the metric path instead of segment lists", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "义乌店近30天沉默会员率",
    });

    expect(context.metrics.supported.map((metric) => metric.key)).toContain("sleepingMemberRate");
    expect(context.customerSegmentShouldYieldToMetric).toBe(true);
  });

  it("extracts five-slot semantic hints for store, object, metric, and action routing", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "义乌店近30天最值得先跟进的会员名单",
    });

    expect(context.semanticSlots.store.scope).toBe("single");
    expect(context.semanticSlots.store.orgIds).toEqual(["1001"]);
    expect(context.semanticSlots.object).toBe("customer");
    expect(context.semanticSlots.action).toBe("followup");
    expect(context.semanticSlots.metricKeys).toEqual([]);
  });

  it("captures birthday follow-up hybrids without losing the birthday constraint", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "未来7天最值得先跟进的生日会员有哪些",
    });

    expect(context.mentionsBirthdayKeyword).toBe(true);
    expect(context.semanticSlots.object).toBe("customer");
    expect(context.semanticSlots.action).toBe("followup");
    expect(context.routeSignals.birthdayFollowupHybrid).toBe(true);
  });

  it("keeps recharge attribution as the primary object when customer wording is mixed in", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "哪个客服带来的会员储值更高",
    });

    expect(context.mentionsMemberMarketingKeyword).toBe(true);
    expect(context.mentionsRechargeAttributionKeyword).toBe(true);
    expect(context.semanticSlots.object).toBe("recharge");
    expect(context.semanticSlots.secondaryObject).toBe("customer");
    expect(context.routeSignals.rechargeCustomerHybrid).toBe(true);
  });

  it("promotes compare-plus-why asks into anomaly with compare as a secondary action", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "义乌店近7天比前7天下滑为什么",
    });

    expect(context.mentionsCompareKeyword).toBe(true);
    expect(context.mentionsAnomalyKeyword).toBe(true);
    expect(context.semanticSlots.action).toBe("anomaly");
    expect(context.semanticSlots.secondaryAction).toBe("compare");
    expect(context.routeSignals.compareNeedsAttribution).toBe(true);
  });

  it("keeps report-plus-advice asks on the report action with advice as a secondary action", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "义乌店近7天经营怎么样，先抓什么",
    });

    expect(context.mentionsReportKeyword).toBe(true);
    expect(context.mentionsAdviceKeyword).toBe(true);
    expect(context.semanticSlots.action).toBe("report");
    expect(context.semanticSlots.secondaryAction).toBe("advice");
    expect(context.routeSignals.reportAdviceHybrid).toBe(true);
  });

  it("marks mixed HQ and explicit-store asks for clarification instead of silent hard routing", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "哪家店最危险，华美店具体哪里有问题",
    });

    expect(context.mentionsHqPortfolioKeyword).toBe(true);
    expect(context.explicitOrgIds).toEqual(["1004"]);
    expect(context.semanticSlots.object).toBe("hq");
    expect(context.semanticSlots.secondaryObject).toBe("store");
    expect(context.routeSignals.hqStoreMixedScope).toBe(true);
  });
});
