import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildCompareRankingUtteranceCoverageFromInboundAudits,
  filterCompareRankingUtteranceCoverage,
} from "./compare-ranking-utterance-coverage-builder.js";
import type { CompareRankingUtteranceSample } from "./compare-ranking-route-eval-fixture-builder.js";
import samples from "./compare-ranking-utterance-samples.json" with { type: "json" };

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
      { orgId: "627153074147333", storeName: "荷塘悦色园中园店", rawAliases: ["园中园店"] },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("buildCompareRankingUtteranceCoverageFromInboundAudits", () => {
  it("aggregates compare/ranking asks and separates covered asks from uncovered paraphrases", () => {
    const coverage = buildCompareRankingUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店和园中园店昨天营收对比",
          effectiveContent: "义乌店和园中园店昨天营收对比",
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
          content: "@bot 义乌店和园中园店昨天营收对比",
          effectiveContent: "义乌店和园中园店昨天营收对比",
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
          content: "@bot 昨天各店营业额排名",
          effectiveContent: "昨天各店营业额排名",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
        {
          requestId: "req-4",
          channel: "wecom",
          senderId: "user-3",
          senderName: "运营总",
          conversationId: "conv-3",
          isGroup: false,
          content: "义乌店昨天营收多少",
          receivedAt: "2026-04-15T09:21:00+08:00",
        },
      ],
      samples: samples as CompareRankingUtteranceSample[],
    });

    expect(coverage).toEqual([
      {
        rawText: "义乌店和园中园店昨天营收对比",
        normalizedText: "义乌店和园中园店昨天营收对比",
        count: 2,
        action: "compare",
        sampleCoverage: "covered_exact",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_compare_lookup_v1",
      },
      {
        rawText: "昨天各店营业额排名",
        normalizedText: "昨天各店营业额排名",
        count: 1,
        action: "ranking",
        sampleCoverage: "uncovered_paraphrase",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_day_ranking_v1",
      },
    ]);
  });

  it("filters uncovered compare/ranking paraphrases for sample-library expansion", () => {
    const coverage = buildCompareRankingUtteranceCoverageFromInboundAudits({
      config: buildConfig(),
      now: new Date("2026-04-15T10:00:00+08:00"),
      audits: [
        {
          requestId: "req-1",
          channel: "wecom",
          senderId: "user-2",
          senderName: "王运营",
          conversationId: "conv-2",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 昨天各店营业额排名",
          effectiveContent: "昨天各店营业额排名",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
      ],
      samples: samples as CompareRankingUtteranceSample[],
    });

    expect(filterCompareRankingUtteranceCoverage(coverage, "uncovered")).toEqual([
      expect.objectContaining({
        rawText: "昨天各店营业额排名",
        sampleCoverage: "uncovered_paraphrase",
      }),
    ]);
  });
});
