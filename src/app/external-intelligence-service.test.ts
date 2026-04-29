import { describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { HetangExternalIntelligenceService } from "./external-intelligence-service.js";

function buildConfig() {
  return resolveHetangOpsConfig({
    api: {
      appKey: "demo-app-key",
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    reporting: {
      buildAtLocalTime: "08:50",
      sendAtLocalTime: "09:00",
    },
    externalIntelligence: {
      enabled: true,
      hqDelivery: {
        channel: "wecom",
        target: "hetang-hq-intel",
      },
      sources: [
        { sourceId: "luckin-ir", displayName: "瑞幸官方", tier: "s" },
        { sourceId: "jiemian", displayName: "界面新闻", tier: "a" },
        { sourceId: "platform-official", displayName: "平台公告", tier: "s" },
      ],
    },
    stores: [{ orgId: "1001", storeName: "一号店" }],
  });
}

function buildLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe("HetangExternalIntelligenceService", () => {
  it("builds one HQ brief issue and delivers it through the notify contract", async () => {
    const originalSendBinary = process.env.HETANG_MESSAGE_SEND_BIN;
    process.env.HETANG_MESSAGE_SEND_BIN = "openclaw";
    const insertedDocuments: Array<Record<string, unknown>> = [];
    const persistedCandidates: Array<Record<string, unknown>> = [];
    const persistedCards: Array<Record<string, unknown>> = [];
    const createdIssues: Array<Record<string, unknown>> = [];
    const runCommandWithTimeout = vi.fn().mockResolvedValue({
      code: 0,
      stdout: "sent",
      stderr: "",
    });
    const store = {
      insertExternalSourceDocument: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => {
          insertedDocuments.push(row);
        }),
      listExternalSourceDocuments: vi.fn().mockImplementation(async () => [...insertedDocuments]),
      upsertExternalEventCandidate: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => {
          persistedCandidates.push(row);
        }),
      upsertExternalEventCard: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
        persistedCards.push(row);
      }),
      createExternalBriefIssue: vi.fn().mockImplementation(async (row: Record<string, unknown>) => {
        createdIssues.push(row);
      }),
      getLatestExternalBriefIssue: vi.fn().mockResolvedValue(null),
    };
    const service = new HetangExternalIntelligenceService({
      config: buildConfig(),
      getStore: async () => store as never,
      runCommandWithTimeout,
      loadExternalSourceDocuments: vi.fn().mockResolvedValue([
        {
          documentId: "doc-luckin-official",
          sourceId: "luckin-ir",
          sourceTier: "s",
          sourceUrl: "https://example.com/luckin-ir",
          title: "瑞幸价格带调整进入执行期",
          summary: "瑞幸确认部分饮品价格进入新价格带。",
          entity: "瑞幸",
          action: "调价",
          object: "部分饮品",
          publishedAt: "2026-04-03T09:10:00+08:00",
          eventAt: "2026-04-03T08:30:00+08:00",
        },
        {
          documentId: "doc-luckin-media",
          sourceId: "jiemian",
          sourceTier: "a",
          sourceUrl: "https://example.com/jiemian-luckin",
          title: "界面：瑞幸部分饮品进入新价格带",
          summary: "媒体跟进瑞幸价格带变化。",
          entity: "瑞幸",
          action: "调价",
          object: "部分饮品",
          publishedAt: "2026-04-03T09:25:00+08:00",
          eventAt: "2026-04-03T08:30:00+08:00",
        },
        {
          documentId: "doc-platform-rule",
          sourceId: "platform-official",
          sourceTier: "s",
          sourceUrl: "https://example.com/platform-rule",
          title: "平台补贴口径出现新变化",
          summary: "平台更新部分补贴与履约说明。",
          entity: "平台",
          action: "调整补贴口径",
          publishedAt: "2026-04-03T08:20:00+08:00",
          eventAt: "2026-04-03T08:00:00+08:00",
        },
        {
          documentId: "doc-course",
          sourceId: "soft-article",
          sourceTier: "a",
          sourceUrl: "https://example.com/course",
          title: "战略赋能大课开班",
          summary: "明显软文，不应入选。",
          publishedAt: "2026-04-03T07:30:00+08:00",
          eventAt: "2026-04-03T07:00:00+08:00",
        },
        {
          documentId: "doc-stale",
          sourceId: "old-feed",
          sourceTier: "a",
          sourceUrl: "https://example.com/stale",
          title: "老活动重新发稿",
          summary: "事件已经过期，没有实质进展。",
          entity: "旧活动",
          action: "重发",
          publishedAt: "2026-03-20T09:00:00+08:00",
          eventAt: "2026-03-20T08:00:00+08:00",
        },
      ]),
      externalBriefLlm: undefined,
      logger: buildLogger(),
    });

    try {
      const issue = await service.buildExternalBriefIssue({
        now: new Date("2026-04-03T09:30:00+08:00"),
        deliver: true,
      });

      expect(insertedDocuments).toHaveLength(5);
      expect(
        persistedCandidates
          .filter((entry) => entry.blockedReason === undefined)
          .map((entry) => entry.documentId),
      ).toEqual(["doc-luckin-official", "doc-luckin-media", "doc-platform-rule"]);
      expect(
        persistedCandidates
          .filter((entry) => entry.blockedReason !== undefined)
          .map((entry) => entry.blockedReason),
      ).toEqual(expect.arrayContaining(["blocked-course-promo", "blocked-stale"]));
      expect(persistedCards).toHaveLength(2);
      expect(createdIssues[0]).toMatchObject({
        issueId: "ext-brief-2026-04-03",
        issueDate: "2026-04-03",
        items: [
          expect.objectContaining({ rank: 1, title: "瑞幸价格带调整进入执行期" }),
          expect.objectContaining({ rank: 2, title: "平台补贴口径出现新变化" }),
        ],
      });
      expect(issue).toMatchObject({
        issueId: "ext-brief-2026-04-03",
        delivered: true,
        itemCount: 2,
      });
      expect(runCommandWithTimeout).toHaveBeenCalledTimes(1);
      expect(runCommandWithTimeout.mock.calls[0]?.[0]).toContain("hetang-hq-intel");
      expect(
        String(
          runCommandWithTimeout.mock.calls[0]?.[0][
            runCommandWithTimeout.mock.calls[0]?.[0].length - 1
          ],
        ),
      ).toContain("瑞幸价格带调整进入执行期");
    } finally {
      if (originalSendBinary == null) {
        delete process.env.HETANG_MESSAGE_SEND_BIN;
      } else {
        process.env.HETANG_MESSAGE_SEND_BIN = originalSendBinary;
      }
    }
  });
});
