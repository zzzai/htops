import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import type { SpecializedQueryUtteranceSample } from "./specialized-query-route-eval-fixture-builder.js";
import {
  buildSpecializedQueryUtteranceCoverageFromInboundAudits,
  filterSpecializedQueryUtteranceCoverage,
} from "./specialized-query-utterance-coverage-builder.js";
import samples from "./specialized-query-utterance-samples.json" with { type: "json" };

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

describe("buildSpecializedQueryUtteranceCoverageFromInboundAudits", () => {
  it("groups duplicate inbound asks and flags uncovered paraphrases for specialized capabilities", () => {
    const coverage = buildSpecializedQueryUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店昨天日报",
          effectiveContent: "义乌店昨天日报",
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
          content: "@bot 义乌店昨天日报",
          effectiveContent: "义乌店昨天日报",
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
          content: "@bot 义乌店白慧慧的技师画像",
          effectiveContent: "义乌店白慧慧的技师画像",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
        {
          requestId: "req-4",
          channel: "wecom",
          senderId: "user-3",
          senderName: "老板",
          conversationId: "conv-3",
          isGroup: false,
          content: "义乌店尾号9799客户画像",
          receivedAt: "2026-04-15T09:30:00+08:00",
        },
      ],
      samples: samples as SpecializedQueryUtteranceSample[],
    });

    expect(coverage).toEqual([
      {
        rawText: "义乌店昨天日报",
        normalizedText: "义乌店昨天日报",
        count: 2,
        action: "report",
        sampleCoverage: "covered_exact",
        lane: "query",
        intentKind: "query",
        capabilityId: "store_report_v1",
      },
      {
        rawText: "义乌店白慧慧的技师画像",
        normalizedText: "义乌店白慧慧的技师画像",
        count: 1,
        action: "profile",
        sampleCoverage: "uncovered_paraphrase",
        lane: "query",
        intentKind: "query",
        capabilityId: "tech_profile_lookup_v1",
      },
    ]);
  });

  it("filters uncovered paraphrases for direct sample-library expansion", () => {
    const coverage = buildSpecializedQueryUtteranceCoverageFromInboundAudits({
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
          content: "@bot 义乌店白慧慧的技师画像",
          effectiveContent: "义乌店白慧慧的技师画像",
          receivedAt: "2026-04-15T09:10:00+08:00",
        },
      ],
      samples: samples as SpecializedQueryUtteranceSample[],
    });

    expect(filterSpecializedQueryUtteranceCoverage(coverage, "uncovered")).toEqual([
      expect.objectContaining({
        rawText: "义乌店白慧慧的技师画像",
        sampleCoverage: "uncovered_paraphrase",
      }),
    ]);
  });
});
