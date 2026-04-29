import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryEntry } from "./query-entry-adapter.js";
import type { HetangEmployeeBinding } from "./types.js";

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
      { orgId: "1002", storeName: "迎宾店" },
      { orgId: "1003", storeName: "华美店" },
      { orgId: "1004", storeName: "锦苑店" },
      { orgId: "1005", storeName: "园中园店" },
    ],
  });
}

const HQ_BINDING: HetangEmployeeBinding = {
  channel: "wecom",
  senderId: "hq-1",
  employeeName: "总部甲",
  role: "hq",
  isActive: true,
};

describe("resolveHetangQueryEntry", () => {
  it("returns a deterministic clarification before invoking AI fallback for missing store scope", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "昨天营收多少",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result).toEqual({
      kind: "clarify",
      text: "你是看哪家店？比如：义乌店昨天营收多少。",
      source: "rule_clarifier",
      reason: "missing-store",
    });
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a high-confidence rule intent without invoking AI fallback", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: {
        ...HQ_BINDING,
        role: "manager",
        scopeOrgIds: ["1001"],
      },
      text: "义乌店昨天营收多少",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("metric");
    expect(result.intent.explicitOrgIds).toEqual(["1001"]);
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a rule intent for scoped window focus asks without invoking AI fallback", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店近7天重点看什么",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("advice");
    expect(result.intent.explicitOrgIds).toEqual(["1001"]);
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a rule intent for colloquial single-store window health asks", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "这几天义乌店怎么样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("report");
    expect(result.intent.explicitOrgIds).toEqual(["1001"]);
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a rule intent for colloquial HQ window health asks without invoking AI fallback", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "这几天五店怎么样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("hq_portfolio");
    expect(result.intent.allStoresRequested).toBe(true);
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a rule intent for colloquial HQ window focus asks without invoking AI fallback", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "五店近7天重点看什么",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("hq_portfolio");
    expect(result.intent.allStoresRequested).toBe(true);
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a deterministic clarification for colloquial amount asks with missing business metric", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店昨天盘里收了多少",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result).toEqual({
      kind: "clarify",
      text: "这句话里的经营指标还不够清楚，请补一句想看营收、复购、储值、点钟率还是加钟率。",
      source: "rule_clarifier",
      reason: "missing-metric",
    });
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a rule metric intent for scoped bare stored-value asks without clarifying", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店近三天储值",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result.kind).toBe("intent");
    expect(result.source).toBe("rule");
    if (result.kind !== "intent") {
      throw new Error("expected rule intent");
    }
    expect(result.intent.kind).toBe("metric");
    expect(result.intent.explicitOrgIds).toEqual(["1001"]);
    expect(result.intent.metrics.map((entry) => entry.key)).toContain("rechargeStoredValue");
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("invokes AI fallback for unresolved but supported business asks", async () => {
    const fallbackIntent = {
      rawText: "义乌店昨天盘收咋样",
      kind: "metric" as const,
      explicitOrgIds: ["1001"],
      allStoresRequested: false,
      timeFrame: {
        kind: "single" as const,
        bizDate: "2026-04-16",
        label: "昨天",
        days: 1 as const,
      },
      metrics: [{ key: "serviceRevenue" as const, label: "服务营收" }],
      unsupportedMetrics: [],
      mentionsCompareKeyword: false,
      mentionsRankingKeyword: false,
      mentionsTrendKeyword: false,
      mentionsAnomalyKeyword: false,
      mentionsRiskKeyword: false,
      mentionsAdviceKeyword: false,
      mentionsReportKeyword: false,
      routeConfidence: "medium" as const,
      semanticSlots: {
        store: {
          scope: "single" as const,
          orgIds: ["1001"],
        },
        object: "store" as const,
        action: "metric" as const,
        metricKeys: ["serviceRevenue"],
        time: {
          kind: "single" as const,
          startBizDate: "2026-04-16",
          endBizDate: "2026-04-16",
          label: "昨天",
          days: 1,
        },
      },
    };
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn().mockResolvedValue({
        intent: fallbackIntent,
      }),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店昨天盘收咋样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result).toEqual({
      kind: "intent",
      intent: fallbackIntent,
      source: "ai_fallback",
      reason: "supported-unresolved-query",
    });
    expect(runtime.resolveSemanticFallbackIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "义乌店昨天盘收咋样",
      }),
    );
  });

  it("does not invoke AI fallback for non-business chatter", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "今天天气怎么样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result).toEqual({
      kind: "unresolved",
      source: "none",
      reason: "non-business-or-unsupported",
    });
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("returns a deterministic boundary clarification for realtime queue and pending-settlement asks", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn(),
    };

    const queueResult = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: {
        ...HQ_BINDING,
        role: "manager",
        scopeOrgIds: ["1001"],
      },
      text: "义乌店现在有客人在等位吗",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });
    const settlementResult = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: {
        ...HQ_BINDING,
        role: "manager",
        scopeOrgIds: ["1001"],
      },
      text: "义乌店后台有几张待结账的单",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(queueResult).toEqual({
      kind: "clarify",
      text: "当前还没接入义乌店等位 / 候钟实时状态，暂时不能严肃回答有没有客人在等位。现在已支持：上钟中技师人数、空闲技师名单。",
      source: "rule_clarifier",
      reason: "unsupported-realtime-queue",
    });
    expect(settlementResult).toEqual({
      kind: "clarify",
      text: "当前还没接入义乌店待结账 / 待结算实时单据状态，暂时不能严肃回答后台还有几张待结账的单。现在已支持：当前上钟中人数、空闲技师名单。",
      source: "rule_clarifier",
      reason: "unsupported-pending-settlement",
    });
    expect(runtime.resolveSemanticFallbackIntent).not.toHaveBeenCalled();
  });

  it("preserves ai fallback clarification reasons for downstream telemetry", async () => {
    const runtime = {
      resolveSemanticFallbackIntent: vi.fn().mockResolvedValue({
        clarificationText:
          "这句话里的经营指标还不够清楚，请补一句想看营收、复购、储值、点钟率还是加钟率。",
        clarificationReason: "missing-metric",
      }),
    };

    const result = await resolveHetangQueryEntry({
      runtime,
      config: buildConfig(),
      binding: HQ_BINDING,
      text: "义乌店昨天盘收咋样",
      now: new Date("2026-04-17T10:00:00+08:00"),
    });

    expect(result).toEqual({
      kind: "clarify",
      text: "这句话里的经营指标还不够清楚，请补一句想看营收、复购、储值、点钟率还是加钟率。",
      source: "ai_fallback",
      reason: "missing-metric",
    });
  });
});
