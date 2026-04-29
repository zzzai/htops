import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveHetangOpsConfig } from "../config.js";
import { HetangReactivationExecutionService } from "./reactivation-execution-service.js";

function buildConfig(overrides: Record<string, unknown> = {}) {
  return resolveHetangOpsConfig({
    api: {
      appSecret: "demo-app-secret",
    },
    database: {
      url: "postgresql://hetang:secret@127.0.0.1:5432/hetang_ops",
    },
    stores: [
      {
        orgId: "1005",
        storeName: "迎宾店",
        rawAliases: ["迎宾"],
      },
    ],
    ...overrides,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("HetangReactivationExecutionService", () => {
  it("merges queue rows with feedback rows into execution tasks and summary", async () => {
    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          reactivationPriorityScore: 760,
          strategyPriorityScore: 980,
          executionPriorityScore: 1040,
          priorityBand: "P0",
          priorityRank: 1,
          churnRiskLabel: "critical",
          churnRiskScore: 0.88,
          revisitWindowLabel: "due-now",
          recommendedActionLabel: "immediate-1to1",
          recommendedTouchWeekday: "friday",
          recommendedTouchDaypart: "after-work",
          touchWindowLabel: "best-today",
          reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
          touchAdviceSummary: "建议周五 after-work 联系。",
          daysSinceLastVisit: 36,
          visitCount90d: 5,
          payAmount90d: 4680,
          currentStoredBalanceInferred: 680,
          projectedBalanceDaysLeft: 34,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-002",
          customerIdentityKey: "member:M-002",
          customerDisplayName: "李女士",
          primarySegment: "potential-growth-customer",
          followupBucket: "potential-growth",
          reactivationPriorityScore: 620,
          strategyPriorityScore: 710,
          executionPriorityScore: 710,
          priorityBand: "P1",
          priorityRank: 2,
          churnRiskLabel: "medium",
          churnRiskScore: 0.52,
          revisitWindowLabel: "due-this-week",
          recommendedActionLabel: "growth-nurture",
          recommendedTouchWeekday: "saturday",
          recommendedTouchDaypart: "afternoon",
          touchWindowLabel: "best-this-week",
          reasonSummary: "近90天已来店4次，当前适合推动第二次转化。",
          touchAdviceSummary: "建议周六 afternoon 联系。",
          daysSinceLastVisit: 18,
          visitCount90d: 4,
          payAmount90d: 2880,
          currentStoredBalanceInferred: 320,
          projectedBalanceDaysLeft: 26,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
      ]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-001",
          feedbackStatus: "booked",
          followedBy: "店长A",
          followedAt: "2026-04-18T15:20:00+08:00",
          contacted: true,
          replied: true,
          booked: true,
          arrived: false,
          note: "已约周六下午",
          updatedAt: "2026-04-18T15:21:00+08:00",
        },
      ]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HetangReactivationExecutionService({
      getStore: async () => store as never,
    });

    const tasks = await service.listExecutionTasks({
      orgId: "1005",
      bizDate: "2026-04-18",
    });
    const summary = await service.getExecutionSummary({
      orgId: "1005",
      bizDate: "2026-04-18",
    });

    expect(tasks).toEqual([
      expect.objectContaining({
        memberId: "M-001",
        feedbackStatus: "booked",
        followedBy: "店长A",
      }),
      expect.objectContaining({
        memberId: "M-002",
        feedbackStatus: "pending",
        followedBy: undefined,
      }),
    ]);
    expect(summary).toEqual(
      expect.objectContaining({
        totalTaskCount: 2,
        pendingCount: 1,
        bookedCount: 1,
        arrivedCount: 0,
        bookingRate: 0.5,
      }),
    );
    expect(summary.priorityBandCounts).toEqual([
      { priorityBand: "P0", count: 1 },
      { priorityBand: "P1", count: 1 },
    ]);
    expect(summary.followupBucketCounts).toEqual([
      { followupBucket: "high-value-reactivation", count: 1 },
      { followupBucket: "potential-growth", count: 1 },
    ]);
    expect(summary.topPendingTasks).toEqual([
      expect.objectContaining({
        memberId: "M-002",
        feedbackStatus: "pending",
      }),
    ]);
  });

  it("writes feedback updates through the execution layer owner", async () => {
    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
      upsertMemberReactivationOutcomeSnapshot: vi.fn().mockResolvedValue(undefined),
    };
    const service = new HetangReactivationExecutionService({
      getStore: async () => store as never,
    });

    await service.upsertExecutionFeedback({
      orgId: "1005",
      bizDate: "2026-04-18",
      memberId: "M-009",
      feedbackStatus: "contacted",
      followedBy: "客服B",
      followedAt: "2026-04-18T16:00:00+08:00",
      contacted: true,
      replied: false,
      booked: false,
      arrived: false,
      note: "已发第一条消息",
      updatedAt: "2026-04-18T16:01:00+08:00",
    });

    expect(store.upsertMemberReactivationFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: "M-009",
        feedbackStatus: "contacted",
        followedBy: "客服B",
      }),
    );
    expect(store.upsertMemberReactivationOutcomeSnapshot).not.toHaveBeenCalled();
  });

  it("materializes a bounded learning snapshot when feedback is written for an execution task", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  outcomeSummary: "客户已约周六下午到店，但仍需中午前再确认一次。",
                  objectionLabels: ["需二次确认最终时间"],
                  nextBestAction: "周六中午前轻提醒确认。",
                  followupDraft: "姐，周六下午档期先给您留着，中午我再和您确认一下。",
                }),
              },
            },
          ],
        }),
      }),
    );

    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          reactivationPriorityScore: 760,
          strategyPriorityScore: 980,
          executionPriorityScore: 1040,
          priorityBand: "P0",
          priorityRank: 1,
          churnRiskLabel: "critical",
          churnRiskScore: 0.88,
          revisitWindowLabel: "due-now",
          recommendedActionLabel: "immediate-1to1",
          recommendedTouchWeekday: "friday",
          recommendedTouchDaypart: "after-work",
          touchWindowLabel: "best-today",
          reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
          touchAdviceSummary: "建议周五 after-work 联系。",
          daysSinceLastVisit: 36,
          visitCount90d: 5,
          payAmount90d: 4680,
          currentStoredBalanceInferred: 680,
          projectedBalanceDaysLeft: 34,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
      ]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
      upsertMemberReactivationOutcomeSnapshot: vi.fn().mockResolvedValue(undefined),
    };

    const service = new HetangReactivationExecutionService({
      config: buildConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 3200,
          profileInsight: { enabled: false },
          tagAdvisor: { enabled: false },
          strategyAdvisor: { enabled: false },
          followupSummarizer: { enabled: true },
        },
      }),
      getStore: async () => store as never,
    });

    await service.upsertExecutionFeedback({
      orgId: "1005",
      bizDate: "2026-04-18",
      memberId: "M-001",
      feedbackStatus: "booked",
      followedBy: "店长A",
      followedAt: "2026-04-18T15:20:00+08:00",
      contacted: true,
      replied: true,
      booked: true,
      arrived: false,
      note: "客户说周六下午可以来，中午前再确认一下。",
      updatedAt: "2026-04-18T15:21:00+08:00",
    });

    expect(store.upsertMemberReactivationOutcomeSnapshot).toHaveBeenCalledTimes(1);
    const snapshot = store.upsertMemberReactivationOutcomeSnapshot.mock.calls[0]?.[0];
    expect(snapshot).toMatchObject({
      orgId: "1005",
      bizDate: "2026-04-18",
      memberId: "M-001",
      primarySegment: "important-reactivation-member",
      followupBucket: "high-value-reactivation",
      priorityBand: "P0",
      recommendedActionLabel: "immediate-1to1",
      feedbackStatus: "booked",
      booked: true,
      arrived: false,
      closed: false,
      outcomeLabel: "booked",
    });
    expect(snapshot?.outcomeScore).toBeGreaterThan(0.7);
    expect(snapshot?.outcomeScore).toBeLessThan(1);
    expect(JSON.parse(String(snapshot?.learningJson))).toMatchObject({
      noteSignalLabels: ["appointment-window"],
      aiSummary: {
        outcomeSummary: "客户已约周六下午到店，但仍需中午前再确认一次。",
        objectionLabels: ["需二次确认最终时间"],
      },
    });
  });

  it("adds bounded ai followup summary for feedback notes without changing execution status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  outcomeSummary: "客户已确认周六下午到店，当前处于已预约待到店状态。",
                  objectionLabels: ["需确认最终到店时间"],
                  nextBestAction: "周六中午前做一次轻提醒确认。",
                  followupDraft: "姐，周六下午给您把档期留好了，中午我再跟您确认一下时间。",
                }),
              },
            },
          ],
        }),
      }),
    );

    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-001",
          customerIdentityKey: "member:M-001",
          customerDisplayName: "王女士",
          primarySegment: "important-reactivation-member",
          followupBucket: "high-value-reactivation",
          reactivationPriorityScore: 760,
          strategyPriorityScore: 980,
          executionPriorityScore: 1040,
          priorityBand: "P0",
          priorityRank: 1,
          churnRiskLabel: "critical",
          churnRiskScore: 0.88,
          revisitWindowLabel: "due-now",
          recommendedActionLabel: "immediate-1to1",
          recommendedTouchWeekday: "friday",
          recommendedTouchDaypart: "after-work",
          touchWindowLabel: "best-today",
          reasonSummary: "已沉默36天，近90天消费4680.00元，优先一对一召回。",
          touchAdviceSummary: "建议周五 after-work 联系。",
          daysSinceLastVisit: 36,
          visitCount90d: 5,
          payAmount90d: 4680,
          currentStoredBalanceInferred: 680,
          projectedBalanceDaysLeft: 34,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
      ]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-001",
          feedbackStatus: "booked",
          followedBy: "店长A",
          followedAt: "2026-04-18T15:20:00+08:00",
          contacted: true,
          replied: true,
          booked: true,
          arrived: false,
          note: "客户说周六下午可以来，等我中午再确认一下。",
          updatedAt: "2026-04-18T15:21:00+08:00",
        },
      ]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
    };

    const service = new HetangReactivationExecutionService({
      config: buildConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 3200,
          profileInsight: { enabled: false },
          tagAdvisor: { enabled: false },
          strategyAdvisor: { enabled: false },
          followupSummarizer: { enabled: true },
        },
      }),
      getStore: async () => store as never,
    });

    const tasks = await service.listExecutionTasks({
      orgId: "1005",
      bizDate: "2026-04-18",
    });

    expect(tasks[0]).toMatchObject({
      memberId: "M-001",
      feedbackStatus: "booked",
      aiAdvisory: {
        followupSummary: {
          outcomeSummary: "客户已确认周六下午到店，当前处于已预约待到店状态。",
          objectionLabels: ["需确认最终到店时间"],
          nextBestAction: "周六中午前做一次轻提醒确认。",
          followupDraft: "姐，周六下午给您把档期留好了，中午我再跟您确认一下时间。",
        },
      },
    });
    expect(tasks[0]?.feedbackStatus).toBe("booked");
    expect(tasks[0]?.priorityBand).toBe("P0");
  });

  it("does not invoke ai followup summarizer when building execution summary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                outcomeSummary: "客户愿意继续沟通。",
                objectionLabels: [],
                nextBestAction: "明天再跟进。",
                followupDraft: "姐，我明天再和您确认一下。",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-003",
          customerIdentityKey: "member:M-003",
          customerDisplayName: "周女士",
          primarySegment: "potential-growth-customer",
          followupBucket: "potential-growth",
          reactivationPriorityScore: 620,
          strategyPriorityScore: 710,
          executionPriorityScore: 710,
          priorityBand: "P1",
          priorityRank: 2,
          churnRiskLabel: "medium",
          churnRiskScore: 0.52,
          revisitWindowLabel: "due-this-week",
          recommendedActionLabel: "growth-nurture",
          recommendedTouchWeekday: "saturday",
          recommendedTouchDaypart: "afternoon",
          touchWindowLabel: "best-this-week",
          reasonSummary: "近90天已来店4次，当前适合推动第二次转化。",
          touchAdviceSummary: "建议周六 afternoon 联系。",
          daysSinceLastVisit: 18,
          visitCount90d: 4,
          payAmount90d: 2880,
          currentStoredBalanceInferred: 320,
          projectedBalanceDaysLeft: 26,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
      ]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-003",
          feedbackStatus: "contacted",
          followedBy: "店长A",
          followedAt: "2026-04-18T15:20:00+08:00",
          contacted: true,
          replied: false,
          booked: false,
          arrived: false,
          note: "客户说这两天有点忙，明天再看。",
          updatedAt: "2026-04-18T15:21:00+08:00",
        },
      ]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
    };

    const service = new HetangReactivationExecutionService({
      config: buildConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 3200,
          profileInsight: { enabled: false },
          tagAdvisor: { enabled: false },
          strategyAdvisor: { enabled: false },
          followupSummarizer: { enabled: true },
        },
      }),
      getStore: async () => store as never,
    });

    const summary = await service.getExecutionSummary({
      orgId: "1005",
      bizDate: "2026-04-18",
    });

    expect(summary).toMatchObject({
      totalTaskCount: 1,
      contactedCount: 1,
      pendingCount: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("can disable ai advisory enrichment for execution task reads", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                outcomeSummary: "客户愿意继续沟通。",
                objectionLabels: [],
                nextBestAction: "明天再跟进。",
                followupDraft: "姐，我明天再和您确认一下。",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const store = {
      listMemberReactivationQueue: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-003",
          customerIdentityKey: "member:M-003",
          customerDisplayName: "周女士",
          primarySegment: "potential-growth-customer",
          followupBucket: "potential-growth",
          reactivationPriorityScore: 620,
          strategyPriorityScore: 710,
          executionPriorityScore: 710,
          priorityBand: "P1",
          priorityRank: 2,
          churnRiskLabel: "medium",
          churnRiskScore: 0.52,
          revisitWindowLabel: "due-this-week",
          recommendedActionLabel: "growth-nurture",
          recommendedTouchWeekday: "saturday",
          recommendedTouchDaypart: "afternoon",
          touchWindowLabel: "best-this-week",
          reasonSummary: "近90天已来店4次，当前适合推动第二次转化。",
          touchAdviceSummary: "建议周六 afternoon 联系。",
          daysSinceLastVisit: 18,
          visitCount90d: 4,
          payAmount90d: 2880,
          currentStoredBalanceInferred: 320,
          projectedBalanceDaysLeft: 26,
          birthdayBoostScore: 0,
          queueJson: "{}",
          updatedAt: "2026-04-18T09:00:00+08:00",
        },
      ]),
      listMemberReactivationFeedback: vi.fn().mockResolvedValue([
        {
          orgId: "1005",
          bizDate: "2026-04-18",
          memberId: "M-003",
          feedbackStatus: "contacted",
          followedBy: "店长A",
          followedAt: "2026-04-18T15:20:00+08:00",
          contacted: true,
          replied: false,
          booked: false,
          arrived: false,
          note: "客户说这两天有点忙，明天再看。",
          updatedAt: "2026-04-18T15:21:00+08:00",
        },
      ]),
      upsertMemberReactivationFeedback: vi.fn().mockResolvedValue(undefined),
    };

    const service = new HetangReactivationExecutionService({
      config: buildConfig({
        customerGrowthAi: {
          enabled: true,
          baseUrl: "https://customer-growth.example.com/v1",
          apiKey: "growth-secret",
          model: "gpt-5-mini",
          timeoutMs: 3200,
          profileInsight: { enabled: false },
          tagAdvisor: { enabled: false },
          strategyAdvisor: { enabled: false },
          followupSummarizer: { enabled: true },
        },
      }),
      getStore: async () => store as never,
    });

    const tasks = await service.listExecutionTasks({
      orgId: "1005",
      bizDate: "2026-04-18",
      includeAiAdvisory: false,
    });

    expect(tasks[0]?.aiAdvisory).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
