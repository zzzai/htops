import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangIntentRoute } from "./query-route-registry.js";
import { resolveHetangQuerySemanticContext } from "./query-semantics.js";

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

describe("query route registry", () => {
  const config = buildConfig();

  it("routes HQ panoramic questions to hq_portfolio first", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "五店整体怎么样，哪家店最危险，下周先抓什么",
      }),
    );

    expect(route).toMatchObject({
      kind: "hq_portfolio",
      mentionsRiskKeyword: true,
      mentionsAdviceKeyword: true,
    });
  });

  it("keeps single-store summary and advice wording on store routes", () => {
    const summaryRoute = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店整体怎么样",
      }),
    );
    const adviceRoute = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店下周先抓什么",
      }),
    );

    expect(summaryRoute).toMatchObject({
      kind: "report",
    });
    expect(adviceRoute).toMatchObject({
      kind: "advice",
    });
  });

  it("routes customer segment list asks through the registry", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店近30天最值得先跟进的会员名单",
      }),
    );

    expect(route).toMatchObject({
      kind: "customer_segment",
    });
  });

  it("keeps metric-style沉默会员 asks on the metric route", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店近30天沉默会员率",
      }),
    );

    expect(route).toMatchObject({
      kind: "metric",
    });
  });

  it("uses semantic slots to keep customer follow-up asks on customer-segment routes", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "迎宾店最值得先跟进的会员是谁",
    });
    const route = resolveHetangIntentRoute(context);

    expect(context.semanticSlots.object).toBe("customer");
    expect(context.semanticSlots.action).toBe("followup");
    expect(route).toMatchObject({
      kind: "customer_segment",
    });
  });

  it("keeps birthday follow-up asks on birthday routes while preserving the follow-up semantics", () => {
    const context = resolveHetangQuerySemanticContext({
      config,
      text: "未来7天最值得先跟进的生日会员有哪些",
    });
    const route = resolveHetangIntentRoute(context);

    expect(context.routeSignals.birthdayFollowupHybrid).toBe(true);
    expect(route).toMatchObject({
      kind: "birthday_members",
      confidence: "high",
    });
  });

  it("prefers recharge attribution over member-marketing when客服/储值归因 is explicit", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "哪个客服带来的会员储值更高",
      }),
    );

    expect(route).toMatchObject({
      kind: "recharge_attribution",
      confidence: "high",
    });
  });

  it("prefers anomaly over compare when the ask is compare plus why", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店近7天比前7天下滑为什么",
      }),
    );

    expect(route).toMatchObject({
      kind: "anomaly",
      confidence: "high",
    });
  });

  it("keeps report-plus-advice asks on report routes", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "义乌店近7天经营怎么样，先抓什么",
      }),
    );

    expect(route).toMatchObject({
      kind: "report",
      confidence: "high",
    });
  });

  it("downgrades mixed HQ portfolio and explicit-store asks to low-confidence clarification", () => {
    const route = resolveHetangIntentRoute(
      resolveHetangQuerySemanticContext({
        config,
        text: "哪家店最危险，华美店具体哪里有问题",
      }),
    );

    expect(route).toMatchObject({
      kind: "hq_portfolio",
      confidence: "low",
      requiresClarification: true,
    });
  });
});
