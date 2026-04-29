import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import {
  buildMetricUtteranceCoverageFromInboundAudits,
  filterMetricUtteranceCoverage,
} from "./metric-utterance-coverage-builder.js";
import samples from "./metric-user-utterance-samples.json" with { type: "json" };

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

describe("buildMetricUtteranceCoverageFromInboundAudits", () => {
  it("groups duplicate inbound asks and distinguishes covered asks from new paraphrases", () => {
    const coverage = buildMetricUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店昨天营收多少",
          effectiveContent: "义乌店昨天营收多少",
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
          content: "@bot 义乌店昨天营收多少",
          effectiveContent: "义乌店昨天营收多少",
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
          content: "@bot 义乌店昨日营业额咋样",
          effectiveContent: "义乌店昨日营业额咋样",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
        {
          requestId: "req-4",
          channel: "wecom",
          senderId: "user-3",
          senderName: "运营总",
          conversationId: "conv-3",
          isGroup: false,
          content: "什么是复盘",
          receivedAt: "2026-04-15T09:21:00+08:00",
        },
        {
          requestId: "req-5",
          channel: "wecom",
          senderId: "user-4",
          senderName: "产品",
          conversationId: "conv-4",
          isGroup: false,
          content: "2026年4月13日 迎宾店经营数据报告 营收23946元，点钟率19.5%，把以上内容做成h5发给我",
          receivedAt: "2026-04-15T09:22:00+08:00",
        },
        {
          requestId: "req-6",
          channel: "wecom",
          senderId: "user-5",
          senderName: "老板",
          conversationId: "conv-5",
          isGroup: false,
          content: "义乌店和迎宾店昨天营收对比",
          receivedAt: "2026-04-15T09:23:00+08:00",
        },
      ],
      samples,
    });

    expect(coverage).toEqual([
      {
        rawText: "义乌店昨天营收多少",
        normalizedText: "义乌店昨天营收多少",
        count: 2,
        metricKeys: ["serviceRevenue"],
        sampleCoverage: "covered_exact",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_day_summary_v1",
      },
      {
        rawText: "义乌店昨日营业额咋样",
        normalizedText: "义乌店昨日营业额咋样",
        count: 1,
        metricKeys: ["serviceRevenue"],
        sampleCoverage: "uncovered_paraphrase",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_day_summary_v1",
      },
    ]);
  });

  it("filters uncovered paraphrases for direct sample-library expansion", () => {
    const coverage = buildMetricUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店昨天营收多少",
          effectiveContent: "义乌店昨天营收多少",
          receivedAt: "2026-04-15T09:10:00+08:00",
        },
        {
          requestId: "req-2",
          channel: "wecom",
          senderId: "user-2",
          senderName: "王运营",
          conversationId: "conv-2",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店昨日营业额咋样",
          effectiveContent: "义乌店昨日营业额咋样",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
      ],
      samples,
    });

    expect(filterMetricUtteranceCoverage(coverage, "uncovered")).toEqual([
      expect.objectContaining({
        rawText: "义乌店昨日营业额咋样",
        sampleCoverage: "uncovered_paraphrase",
      }),
    ]);
  });

  it("marks newly absorbed real-world summary asks as covered once they exist in the sample library", () => {
    const coverage = buildMetricUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店昨日客流量多少",
          effectiveContent: "义乌店昨日客流量多少",
          receivedAt: "2026-04-15T09:10:00+08:00",
        },
        {
          requestId: "req-2",
          channel: "wecom",
          senderId: "user-2",
          senderName: "王运营",
          conversationId: "conv-2",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店昨日总钟数",
          effectiveContent: "义乌店昨日总钟数",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
        {
          requestId: "req-3",
          channel: "wecom",
          senderId: "user-3",
          senderName: "老板",
          conversationId: "conv-3",
          isGroup: true,
          wasMentioned: true,
          content: "@bot 义乌店昨日的加钟率",
          effectiveContent: "义乌店昨日的加钟率",
          receivedAt: "2026-04-15T09:30:00+08:00",
        },
      ],
      samples,
    });

    expect(coverage).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawText: "义乌店昨日客流量多少",
          sampleCoverage: "covered_exact",
        }),
        expect.objectContaining({
          rawText: "义乌店昨日总钟数",
          sampleCoverage: "covered_exact",
        }),
        expect.objectContaining({
          rawText: "义乌店昨日的加钟率",
          sampleCoverage: "covered_exact",
        }),
      ]),
    );
  });
});
