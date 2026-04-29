import { describe, expect, it } from "vitest";
import { resolveHetangOpsConfig } from "./config.js";
import { buildRouteEvalFixturesFromInboundAudits } from "./route-eval-fixture-builder.js";

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
      { orgId: "1001", storeName: "义乌店", rawAliases: ["义乌"] },
      { orgId: "1002", storeName: "迎宾店", rawAliases: ["迎宾"] },
    ],
    sync: { enabled: false },
    reporting: { enabled: false },
  });
}

describe("buildRouteEvalFixturesFromInboundAudits", () => {
  it("deduplicates inbound audits by effective content and suggests semantic route expectations", () => {
    const fixtures = buildRouteEvalFixturesFromInboundAudits({
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
          senderName: "运营总",
          conversationId: "conv-2",
          isGroup: false,
          content: "什么是复盘",
          receivedAt: "2026-04-15T09:20:00+08:00",
        },
      ],
    });

    expect(fixtures).toHaveLength(2);
    expect(fixtures[0]).toMatchObject({
      id: "audit-001",
      rawText: "义乌店昨天营收多少",
      expectedLane: "query",
      expectedIntentKind: "query",
      expectedCapabilityId: "store_day_summary_v1",
      expectedOrgIds: ["1001"],
    });
    expect(fixtures[0]?.notes).toContain("channel=wecom");
    expect(fixtures[0]?.notes).toContain("sender=李店长");
    expect(fixtures[1]).toMatchObject({
      id: "audit-002",
      rawText: "什么是复盘",
      expectedLane: "meta",
      expectedIntentKind: "concept_explain",
    });
  });
});
