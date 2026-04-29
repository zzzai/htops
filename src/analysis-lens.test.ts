import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import { resolveQueryAnalysisLens } from "./analysis-lens.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "1001", storeName: "义乌店" },
      { orgId: "1002", storeName: "园中园店" },
      { orgId: "1003", storeName: "华美店" },
      { orgId: "1004", storeName: "锦苑店" },
      { orgId: "1005", storeName: "迎宾店" },
    ],
  });
}

describe("resolveQueryAnalysisLens", () => {
  const config = buildConfig();
  const now = new Date("2026-04-17T19:00:00+08:00");

  it("assigns the CGO/CMO executive lens to HQ portfolio analysis asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "五店近7天重点看什么",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001", "1002", "1003", "1004", "1005"],
      accessScopeKind: "hq",
    });

    expect(lens).toMatchObject({
      mode: "executive_analysis",
      persona_id: "growth_exec_cgo_cmo_v1",
      persona_label: "CGO/CMO 增长经营视角",
      framework_id: "hq_growth_priority_v1",
      audience: "hq",
      output_contract_id: "hq_growth_brief_v2",
    });
    expect(lens?.priority_dimensions).toEqual([
      "retention",
      "member_asset_health",
      "unit_economics",
      "conversion",
    ]);
    expect(lens?.reasoning_principles).toContain("先保留存，再判断拉新质量");
    expect(lens?.forbidden_claims).toContain("没有新客或渠道证据时，不下拉新质量结论");
    expect(lens?.section_labels.signals).toBe("总部先盯的增长信号");
  });

  it("keeps fact-only metric asks out of the executive analysis lens", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店昨天营收多少",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
    });

    expect(lens).toBeUndefined();
  });

  it("assigns a store diagnosis contract to single-store advice asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
      entity: "store",
      action: "advice",
    });

    expect(lens).toMatchObject({
      mode: "executive_analysis",
      framework_id: "store_growth_diagnosis_v1",
      output_contract_id: "store_growth_brief_v2",
      audience: "store",
    });
    expect(lens?.section_labels.actions).toBe("店长今天先做什么");
  });

  it("assigns the COO operations lens to single-store execution asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，点钟率、加钟率还是翻房率",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
      entity: "store",
      action: "advice",
    });

    expect(lens).toMatchObject({
      mode: "executive_analysis",
      persona_id: "operations_exec_coo_v1",
      framework_id: "store_operations_diagnosis_v1",
      output_contract_id: "store_operations_brief_v1",
      audience: "store",
    });
    expect(lens?.section_labels.signals).toBe("这家店先盯的履约信号");
  });

  it("assigns the CFO profit lens to single-store margin asks", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "manager",
      entity: "store",
      action: "advice",
    });

    expect(lens).toMatchObject({
      mode: "executive_analysis",
      persona_id: "profit_exec_cfo_v1",
      framework_id: "store_profit_diagnosis_v1",
      output_contract_id: "store_profit_brief_v1",
      audience: "store",
    });
    expect(lens?.section_labels.actions).toBe("店长今天先收哪一口利润");
  });

  it("keeps single-store open analysis on the store lens even for HQ users", () => {
    const intent = resolveHetangQueryIntent({
      config,
      text: "义乌店近7天重点看什么，毛利率、净利率还是保本营收",
      now,
    });

    const lens = resolveQueryAnalysisLens({
      intent: intent!,
      effectiveOrgIds: ["1001"],
      accessScopeKind: "hq",
      entity: "store",
      action: "advice",
    });

    expect(lens).toMatchObject({
      mode: "executive_analysis",
      persona_id: "profit_exec_cfo_v1",
      framework_id: "store_profit_diagnosis_v1",
      audience: "store",
    });
  });
});
