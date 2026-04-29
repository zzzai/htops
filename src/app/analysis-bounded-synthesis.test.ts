import { describe, expect, it } from "vitest";
import { buildDeterministicBoundedAnalysisResult } from "./analysis-bounded-synthesis.js";
import type {
  HetangAnalysisDiagnosticBundle,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
} from "../types.js";

describe("buildDeterministicBoundedAnalysisResult", () => {
  it("turns portfolio diagnostic signals into store-specific HQ actions", () => {
    const job: HetangAnalysisJob = {
      jobId: "ANL-PORTFOLIO-1",
      jobType: "store_review",
      orgId: "scope:1001,1002,1003",
      storeName: "五店",
      rawText: "五店近15天整体哪里不对",
      timeFrameLabel: "近15天",
      startBizDate: "2026-04-01",
      endBizDate: "2026-04-15",
      channel: "wecom",
      target: "conversation-1",
      status: "running",
      attemptCount: 1,
      createdAt: "2026-04-17T01:00:00.000Z",
      updatedAt: "2026-04-17T01:00:00.000Z",
      queueDisposition: "created",
    };
    const evidencePack: HetangAnalysisEvidencePack = {
      packVersion: "v1",
      scopeType: "portfolio",
      orgIds: ["1001", "1002", "1003"],
      storeName: "五店",
      question: job.rawText,
      timeFrameLabel: job.timeFrameLabel,
      startBizDate: job.startBizDate,
      endBizDate: job.endBizDate,
      markdown: [
        "证据包",
        "- 范围: 五店",
        "- 周期: 2026-04-01 至 2026-04-15（近15天）",
      ].join("\n"),
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
          finding: "华美店沉默会员率最高且钟效最低，当前最需要总部优先盯。",
          evidence: ["华美店 沉默会员率 24.0%", "华美店 钟效 68.0"],
          recommendedFocus: "总部先盯华美店的会员回流和班次承接，先止住风险扩散。",
        },
        {
          signalId: "portfolio_revenue_gap",
          severity: "medium",
          title: "门店营收分化",
          finding: "义乌店与华美店营收差距过大，五店表现分层明显。",
          evidence: ["义乌店 营收 4200", "华美店 营收 2600"],
          recommendedFocus: "总部复盘华美店客流承接和点钟结构，同时复制义乌店有效做法。",
        },
      ],
    };

    const result = buildDeterministicBoundedAnalysisResult({
      job,
      evidencePack,
      diagnosticBundle,
    });

    expect(result.summary).toContain("五店近15天");
    expect(result.suggestions[0]).toContain("华美店");
    expect(result.actionItems?.[0]).toEqual(
      expect.objectContaining({
        category: "总部经营",
        priority: "high",
        title: expect.stringContaining("华美店"),
      }),
    );
    expect(result.markdown).toContain("重点门店风险");
    expect(result.markdown).toContain("华美店");
  });
});
