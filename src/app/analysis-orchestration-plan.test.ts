import { describe, expect, it } from "vitest";
import { buildHetangAnalysisOrchestrationPlan } from "./analysis-orchestration-plan.js";
import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

function buildJob(overrides: Partial<HetangAnalysisJob> = {}): HetangAnalysisJob {
  return {
    jobId: overrides.jobId ?? "ANL-1",
    jobType: overrides.jobType ?? "store_review",
    orgId: overrides.orgId ?? "1001",
    storeName: overrides.storeName ?? "迎宾店",
    rawText: overrides.rawText ?? "迎宾店近7天经营复盘",
    timeFrameLabel: overrides.timeFrameLabel ?? "近7天",
    startBizDate: overrides.startBizDate ?? "2026-04-05",
    endBizDate: overrides.endBizDate ?? "2026-04-11",
    channel: overrides.channel ?? "wecom",
    target: overrides.target ?? "conversation-1",
    status: overrides.status ?? "running",
    attemptCount: overrides.attemptCount ?? 1,
    createdAt: overrides.createdAt ?? "2026-04-12T01:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-04-12T01:00:00.000Z",
  };
}

describe("buildHetangAnalysisOrchestrationPlan", () => {
  it("builds portfolio-specific decision steps and HQ output contract", () => {
    const job = buildJob({
      orgId: "scope:1001,1002,1003",
      storeName: "五店",
      rawText: "五店近15天整体哪里不对",
      timeFrameLabel: "近15天",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-15",
    });
    const evidencePack: HetangAnalysisEvidencePack = {
      packVersion: "v1",
      scopeType: "portfolio",
      orgIds: ["1001", "1002", "1003"],
      storeName: "五店",
      question: job.rawText,
      timeFrameLabel: job.timeFrameLabel,
      startBizDate: job.startBizDate,
      endBizDate: job.endBizDate,
      markdown: "证据包",
      facts: {},
    };
    const diagnosticBundle: HetangAnalysisDiagnosticBundle = {
      version: "v1",
      scopeType: "portfolio",
      storeName: "五店",
      orgIds: ["1001", "1002", "1003"],
      question: job.rawText,
      signals: [
        {
          signalId: "portfolio_store_risk",
          severity: "high",
          title: "重点门店风险",
          finding: "华美店沉默会员率最高且续费压力最大。",
          evidence: ["华美店 沉默会员率 24.0%"],
          recommendedFocus: "总部先盯华美店的会员回流和班次承接。",
        },
      ],
    };

    const plan = buildHetangAnalysisOrchestrationPlan({
      job,
      evidencePack,
      diagnosticBundle,
    });

    expect(plan.focusAreas).toContain("重点门店风险");
    expect(plan.priorityActions[0]).toContain("华美店");
    expect(plan.decisionSteps.join("\n")).toContain("最危险门店");
    expect(plan.outputContract).toContain("总部动作建议");
  });

  it("builds single-store fallback decision steps when signals are absent", () => {
    const job = buildJob();
    const evidencePack: HetangAnalysisEvidencePack = {
      packVersion: "v1",
      scopeType: "single_store",
      orgIds: ["1001"],
      storeName: "迎宾店",
      question: job.rawText,
      timeFrameLabel: job.timeFrameLabel,
      startBizDate: job.startBizDate,
      endBizDate: job.endBizDate,
      markdown: "证据包",
      facts: {},
    };

    const plan = buildHetangAnalysisOrchestrationPlan({
      job,
      evidencePack,
      diagnosticBundle: null,
    });

    expect(plan.focusAreas[0]).toContain("迎宾店近7天");
    expect(plan.priorityActions[0]).toContain("营收、钟效和会员留存");
    expect(plan.decisionSteps.join("\n")).toContain("营收、客数、钟数、钟效");
    expect(plan.outputContract).toContain("店长动作建议");
  });
});
