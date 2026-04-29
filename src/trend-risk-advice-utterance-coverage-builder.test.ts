import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildTrendRiskAdviceUtteranceCoverageFromInboundAudits,
  filterTrendRiskAdviceUtteranceCoverage,
} from "./trend-risk-advice-utterance-coverage-builder.js";
import type { TrendRiskAdviceUtteranceSample } from "./trend-risk-advice-route-eval-fixture-builder.js";
import samples from "./trend-risk-advice-utterance-samples.json" with { type: "json" };

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "eval-app-key",
      appSecret: "eval-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      { orgId: "627149864218629", storeName: "荷塘悦色迎宾店", rawAliases: ["迎宾店"] },
      { orgId: "627150985244677", storeName: "荷塘悦色义乌店", rawAliases: ["义乌店"] },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("buildTrendRiskAdviceUtteranceCoverageFromInboundAudits", () => {
  it("groups duplicate inbound asks and flags uncovered paraphrases for trend/anomaly/risk/advice", () => {
    const coverage = buildTrendRiskAdviceUtteranceCoverageFromInboundAudits({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      audits: [
        {
          requestId: "req-1",
          channel: "wecom",
          senderId: "user-1",
          senderName: "李店长",
          conversationId: "conv-1",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店近30天营收趋势",
          effectiveContent: "义乌店近30天营收趋势",
          receivedAt: "2026-04-15T09:10:00+08:00",
        },
        {
          requestId: "req-2",
          channel: "wecom",
          senderId: "user-1",
          senderName: "李店长",
          conversationId: "conv-1",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店近30天营收趋势",
          effectiveContent: "义乌店近30天营收趋势",
          receivedAt: "2026-04-15T09:11:00+08:00",
        },
        {
          requestId: "req-3",
          channel: "wecom",
          senderId: "user-2",
          senderName: "王运营",
          conversationId: "conv-2",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店近30天营业额走势",
          effectiveContent: "义乌店近30天营业额走势",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
        {
          requestId: "req-4",
          channel: "wecom",
          senderId: "user-3",
          senderName: "老板",
          conversationId: "conv-3",
          isGroup: false,
          content: "义乌店近7天有没有风险",
          receivedAt: "2026-04-15T09:30:00+08:00",
        },
        {
          requestId: "req-5",
          channel: "wecom",
          senderId: "user-4",
          senderName: "产品",
          conversationId: "conv-4",
          isGroup: false,
          content: "义乌店近7天哪里异常",
          receivedAt: "2026-04-15T09:31:00+08:00",
        },
      ],
      samples: samples as TrendRiskAdviceUtteranceSample[],
    });

    expect(coverage).toEqual([
      {
        rawText: "义乌店近30天营收趋势",
        normalizedText: "义乌店近30天营收趋势",
        count: 2,
        action: "trend",
        sampleCoverage: "covered_exact",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_trend_v1",
      },
      {
        rawText: "义乌店近30天营业额走势",
        normalizedText: "义乌店近30天营业额走势",
        count: 1,
        action: "trend",
        sampleCoverage: "uncovered_paraphrase",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_trend_v1",
      },
      {
        rawText: "义乌店近7天有没有风险",
        normalizedText: "义乌店近7天有没有风险",
        count: 1,
        action: "risk",
        sampleCoverage: "covered_exact",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_risk_v1",
      },
    ]);
  });

  it("filters uncovered paraphrases for direct sample-library expansion", () => {
    const coverage = buildTrendRiskAdviceUtteranceCoverageFromInboundAudits({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      audits: [
        {
          requestId: "req-1",
          channel: "wecom",
          senderId: "user-1",
          senderName: "李店长",
          conversationId: "conv-1",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店近30天营业额走势",
          effectiveContent: "义乌店近30天营业额走势",
          receivedAt: "2026-04-15T09:10:00+08:00",
        },
      ],
      samples: samples as TrendRiskAdviceUtteranceSample[],
    });

    expect(filterTrendRiskAdviceUtteranceCoverage(coverage, "uncovered")).toEqual([
      expect.objectContaining({
        rawText: "义乌店近30天营业额走势",
        sampleCoverage: "uncovered_paraphrase",
      }),
    ]);
  });
});
