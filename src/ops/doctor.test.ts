import { describe, expect, it } from "vitest";
import * as doctorModule from "./doctor.js";
import {
  formatHermesCommandAuditLine,
  formatHermesGatewayHealthLine,
  formatAnalysisDeliveryHealthSummary,
  formatAnalysisDeadLetterSummary,
  formatAnalysisQueueLine,
  formatDailyReportAuditSummary,
  formatDoctorPollerState,
  formatIndustryContextReadinessSummary,
  formatQueryRouteCompareLine,
  formatQueryRouteCompareSlowLine,
  formatReportDeliveryUpgradeSummary,
  formatSemanticQualityLine,
  formatQueueLaneLine,
  formatSyncExecutionLine,
  formatSchedulerJobDoctorLine,
  summarizeHermesGatewayLog,
  renderHetangDoctorReport,
} from "./doctor.js";

describe("doctor formatting helpers", () => {
  it("renders poller, queue, scheduler, and store lines", async () => {
    const text = await renderHetangDoctorReport({
      dbUrl: "postgresql://demo:secret@127.0.0.1:5432/hetang_ops",
      poolRole: "query",
      poolMax: 10,
      timeZone: "Asia/Shanghai",
      storeCount: 1,
      apiCredentialsConfigured: true,
      middayBriefTime: "12:00",
      warningLines: [
        "Scheduler warning: legacy poller state present: scheduled | status=ok | lastRun=2026-04-10T02:59:00+08:00",
      ],
      schedulerLines: [
        formatDoctorPollerState("scheduled-sync", {
          status: "ok",
          lastRunAt: "2026-04-10T03:00:00+08:00",
          lastResultCount: 2,
        }),
        formatSchedulerJobDoctorLine({
          jobType: "run-customer-history-catchup",
          label: "顾客历史补齐",
          status: "completed",
          runKey: "2026-04-10",
          schedule: "03:00",
          orchestrator: "sync",
          surfaceRole: "conditional",
          surfaceNote: "仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常",
          enabled: true,
          due: true,
          completed: true,
          lastRanAt: "2026-04-10T03:30:00+08:00",
        }),
      ],
      telemetryLines: [
        formatReportDeliveryUpgradeSummary({
          windowStartAt: "2026-04-03T00:00:00.000Z",
          recentUpgradeCount: 1,
          recentUpgrades: [
            {
              orgId: "1001",
              storeName: "迎宾店",
              bizDate: "2026-04-10",
              alertSentAt: "2026-04-10T01:00:00+08:00",
              upgradedAt: "2026-04-10T03:30:00+08:00",
            },
          ],
        }),
      ],
      queueLines: [
        formatQueueLaneLine("Sync queue", {
          pendingCount: 0,
          waitingCount: 1,
          completedCount: 12,
        }),
        formatSyncExecutionLine({
          runningCount: 3,
          staleRunningCount: 2,
          dailyRunningCount: 2,
          staleDailyRunningCount: 1,
          backfillRunningCount: 1,
          staleBackfillRunningCount: 1,
          latestStartedAt: "2026-04-17T02:58:35.583Z",
          latestAgeHours: 8.1,
          staleCutoffAt: "2026-04-17T03:05:00.000Z",
        }),
        formatAnalysisQueueLine({
          pendingCount: 1,
          runningCount: 0,
          completedCount: 10,
          failedCount: 0,
          jobDeliveryPendingCount: 0,
          jobDeliveryRetryingCount: 0,
          jobDeliveryAbandonedCount: 0,
          subscriberDeliveryPendingCount: 0,
          subscriberDeliveryRetryingCount: 0,
          subscriberDeliveryAbandonedCount: 0,
          unresolvedDeadLetterCount: 0,
        }),
        formatAnalysisDeliveryHealthSummary({
          jobPendingCount: 1,
          jobRetryingCount: 0,
          jobAbandonedCount: 0,
          subscriberPendingCount: 0,
          subscriberRetryingCount: 0,
          subscriberAbandonedCount: 0,
        }),
        formatAnalysisDeadLetterSummary({
          unresolvedJobCount: 4,
          unresolvedSubscriberCount: 4,
          latestUnresolvedAt: "2026-04-13T07:57:31.354Z",
          latestUnresolvedAgeHours: 75,
          stale: true,
          latestReason: "invalid chatid",
          invalidChatidSubscriberCount: 4,
          subscriberFanoutExhaustedJobCount: 4,
          residualClass: "stale-invalid-chatid-subscriber",
        }, 8),
      ],
      storeWatermarks: [{ orgId: "1001", storeName: "迎宾店", summary: "1.1=ok" }],
    });

    expect(text).toContain("DB:");
    expect(text).toContain("DB pool role: query");
    expect(text).toContain("Scheduler: app service pollers authoritative");
    expect(text).toContain("Scheduler warning: legacy poller state present: scheduled");
    expect(text).toContain("Poller scheduled-sync: ok");
    expect(text).toContain("Report delivery upgrades (7d): 1");
    expect(text).toContain(
      "Scheduler job: 顾客历史补齐(run-customer-history-catchup) | status=completed | runKey=2026-04-10 | schedule=03:00 | role=conditional | note=仅在夜间原始事实完成后继续补顾客派生层；pending 不代表主链异常 | lastRan=2026-04-10T03:30:00+08:00",
    );
    expect(text).toContain("Sync queue:");
    expect(text).toContain(
      "Sync execution: running 3 | stale 2 | daily 2/1 | backfill 1/1 | latest=2026-04-17T02:58:35.583Z | age=8.1h | staleBefore=2026-04-17T03:05:00.000Z",
    );
    expect(text).toContain("Analysis delivery:");
    expect(text).toContain(
      "Analysis dead letters: unresolved 8 (job 4 / subscriber 4) | latest=2026-04-13T07:57:31.354Z | age=75.0h | stale=yes | reason=invalid chatid | residual=stale-invalid-chatid-subscriber",
    );
    expect(text).toContain("迎宾店 (1001) -> 1.1=ok");
  });

  it("summarizes Hermes command-bridge and WeCom transport log health", () => {
    const summary = summarizeHermesGatewayLog(`
2026-04-16 23:32:25 INFO sitecustomize: htops_hermes_command_bridge command=hetang result=handled chat_id=chat-1 user_id=user-1
2026-04-16 23:14:13 WARNING gateway.platforms.wecom: [Wecom] WebSocket error: WeCom websocket closed | ws_state=connected | reconnect_attempt=1 | retry_in=0
2026-04-16 23:14:13 WARNING gateway.platforms.wecom: [Wecom] Reconnect failed: TimeoutError | reconnect_attempt=1 | retry_in=0 | ws_state=none
2026-04-16 23:23:43 INFO gateway.platforms.wecom: [Wecom] Reconnected | reconnect_attempt=2 | ws_state=healthy
`);

    expect(summary.commandBridge).toMatchObject({
      handledCount: 1,
      fallbackCount: 0,
      latestCommand: "hetang",
      latestResult: "handled",
    });
    expect(summary.wecomTransport).toMatchObject({
      websocketErrorCount: 1,
      reconnectFailureCount: 1,
      reconnectSuccessCount: 1,
      latestWsState: "healthy",
    });
  });

  it("formats Hermes gateway health lines for doctor output", () => {
    expect(
      formatHermesGatewayHealthLine({
        commandBridge: {
          handledCount: 3,
          fallbackCount: 1,
          latestCommand: "hetang",
          latestResult: "handled",
          latestAt: "2026-04-16 23:32:25",
        },
        wecomTransport: {
          websocketErrorCount: 2,
          reconnectFailureCount: 1,
          reconnectSuccessCount: 2,
          latestWsState: "healthy",
          latestAt: "2026-04-16 23:23:43",
        },
      }),
    ).toEqual([
      "Hermes command bridge: handled 3 / fallback 1 | latest=2026-04-16 23:32:25 | command=hetang | result=handled",
      "Hermes WeCom transport: websocket_errors 2 / reconnect_failures 1 / reconnect_successes 2 | latest=2026-04-16 23:23:43 | ws_state=healthy",
    ]);
  });

  it("formats the five-store daily overview summary for doctor output", () => {
    expect(
      (doctorModule as unknown as {
        formatFiveStoreDailyOverviewSummary: (summary: {
          bizDate: string;
          status: string;
          totalStoreCount: number;
          readyCount: number;
          pendingStoreNames: string[];
          previewSentAt?: string;
          finalTarget?: { channel: string; target: string };
        }) => string;
      }).formatFiveStoreDailyOverviewSummary({
        bizDate: "2026-04-16",
        status: "pending-confirm",
        totalStoreCount: 5,
        readyCount: 5,
        pendingStoreNames: [],
        previewSentAt: "2026-04-17T09:08:00+08:00",
        finalTarget: {
          channel: "wecom",
          target: "hetang-managers",
        },
      }),
    ).toBe(
      "5店昨日经营总览: status=pending-confirm | bizDate=2026-04-16 | daily_reports=5/5 ready | preview=2026-04-17T09:08:00+08:00 | target=wecom:hetang-managers",
    );
  });

  it("formats the daily report audit summary for doctor output", () => {
    expect(
      formatDailyReportAuditSummary({
        status: "healthy",
        endBizDate: "2026-04-24",
        windowDays: 7,
        dates: [
          "2026-04-18",
          "2026-04-19",
          "2026-04-20",
          "2026-04-21",
          "2026-04-22",
          "2026-04-23",
          "2026-04-24",
        ],
        storeCount: 5,
        checkedReports: 35,
        reportsWithFreshMismatch: 0,
        reportsWithStoredMismatch: 0,
        reportsWithOnlyMissingStored: 0,
        maxUnauditedMetricCount: 0,
        unauditedKeys: [],
        sampleIssues: [],
      }),
    ).toBe(
      "Daily report audit (7d): healthy | end=2026-04-24 | checked=35 | fresh_diff=0 | stored_diff=0 | missing=0 | unaudited=0",
    );

    expect(
      formatDailyReportAuditSummary({
        status: "warn",
        endBizDate: "2026-04-24",
        windowDays: 7,
        dates: [
          "2026-04-18",
          "2026-04-19",
          "2026-04-20",
          "2026-04-21",
          "2026-04-22",
          "2026-04-23",
          "2026-04-24",
        ],
        storeCount: 5,
        checkedReports: 35,
        reportsWithFreshMismatch: 0,
        reportsWithStoredMismatch: 2,
        reportsWithOnlyMissingStored: 0,
        maxUnauditedMetricCount: 1,
        unauditedKeys: ["groupbuy7dCardOpenedRate"],
        sampleIssues: [
          {
            orgId: "1001",
            storeName: "迎宾店",
            bizDate: "2026-04-24",
            topDiffs: [{ metricKey: "groupbuy7dCardOpenedRate", status: "stored_mismatch" }],
          },
        ],
      }),
    ).toBe(
      "Daily report audit (7d): warn | end=2026-04-24 | checked=35 | fresh_diff=0 | stored_diff_reports=2 | missing=0 | unaudited=1 | sample=迎宾店@2026-04-24:groupbuy7dCardOpenedRate",
    );

    expect(formatDailyReportAuditSummary(null)).toBe("Daily report audit (7d): no runs recorded");
  });

  it("formats environment memory readiness and disturbance summaries for doctor output", () => {
    expect(
      (doctorModule as unknown as {
        formatEnvironmentMemoryReadinessSummary: (summary: {
          bizDate: string;
          totalStoreCount: number;
          readyCount: number;
          missingCount: number;
          missingHolidayCount: number;
          missingWeatherCount: number;
          fallbackOnlyCount: number;
          highDisturbanceCount: number;
          stores: Array<{ storeName: string; status: string }>;
        }) => string;
      }).formatEnvironmentMemoryReadinessSummary({
        bizDate: "2026-04-23",
        totalStoreCount: 4,
        readyCount: 1,
        missingCount: 0,
        missingHolidayCount: 1,
        missingWeatherCount: 1,
        fallbackOnlyCount: 1,
        highDisturbanceCount: 1,
        stores: [
          { storeName: "迎宾店", status: "ready" },
          { storeName: "义乌店", status: "missing-weather" },
          { storeName: "华美店", status: "missing-holiday" },
          { storeName: "锦苑店", status: "fallback-only" },
        ],
      }),
    ).toBe(
      "Environment memory: 1/4 ready | bizDate=2026-04-23 | missing_holiday 1 | missing_weather 1 | fallback_only 1 | high_disturbance 1 | pending=义乌店:missing-weather,华美店:missing-holiday,锦苑店:fallback-only",
    );
    expect(
      (doctorModule as unknown as {
        formatEnvironmentMemoryDisturbanceSummary: (summary: {
          windowDays: number;
          mediumOrHigherCount: number;
          highDisturbanceCount: number;
          hintCount: number;
          mentionCount: number;
          highlights: Array<{
            storeName: string;
            bizDate: string;
            disturbanceLevel: string;
            reasons: string[];
          }>;
        }) => string;
      }).formatEnvironmentMemoryDisturbanceSummary({
        windowDays: 7,
        mediumOrHigherCount: 3,
        highDisturbanceCount: 1,
        hintCount: 2,
        mentionCount: 1,
        highlights: [
          {
            storeName: "迎宾店",
            bizDate: "2026-04-23",
            disturbanceLevel: "high",
            reasons: ["holiday:清明节", "weather:storm"],
          },
        ],
      }),
    ).toBe(
      "Environment memory recent disturbance (7d): medium/high 3 | high 1 | hint 2 | mention 1 | latest=迎宾店 2026-04-23 high holiday:清明节,weather:storm",
    );
  });

  it("formats industry context readiness for doctor output", () => {
    expect(
      formatIndustryContextReadinessSummary({
        bizDate: "2026-04-24",
        status: "refresh-needed",
        snapshotDate: "2026-04-23",
        itemCount: 3,
        freshnessDays: 1,
        moduleCoverage: [
          { module: "hq_narrative", itemCount: 2 },
          { module: "world_model", itemCount: 2 },
          { module: "store_diagnosis", itemCount: 1 },
        ],
      }),
    ).toBe(
      "Industry context: status=refresh-needed | bizDate=2026-04-24 | snapshot=2026-04-23 | freshness_days=1 | items=3 | modules=hq_narrative:2,world_model:2,store_diagnosis:1",
    );
  });

  it("formats Hermes command audit summary for doctor output", () => {
    expect(
      formatHermesCommandAuditLine({
        recentAllowedCount: 4,
        windowHours: 24,
        latestOccurredAt: "2026-04-16T23:46:55+08:00",
        latestCommandBody: "/hetang status",
        latestAction: "status",
        latestSenderId: "ZhangZhen",
      }),
    ).toBe(
      "Hermes command bridge: recent allowed audits 4 (24h) | latest=2026-04-16T23:46:55+08:00 | body=/hetang status | action=status | sender=ZhangZhen",
    );
  });

  it("formats query entry telemetry inside the Hermes command audit summary when available", () => {
    expect(
      formatHermesCommandAuditLine({
        recentAllowedCount: 7,
        windowHours: 24,
        latestOccurredAt: "2026-04-16T23:46:55+08:00",
        latestCommandBody: "/hetang status",
        latestAction: "status",
        latestSenderId: "ZhangZhen",
        recentQueryCount: 4,
        recentQueryRuleCount: 1,
        recentQueryClarifyCount: 1,
        recentQueryAiFallbackCount: 1,
        recentQueryUnresolvedCount: 1,
        latestQueryOccurredAt: "2026-04-16T23:40:00+08:00",
        latestQueryEntrySource: "rule_clarifier",
        latestQueryEntryReason: "missing-time",
      }),
    ).toBe(
      "Hermes command bridge: recent allowed audits 7 (24h) | latest=2026-04-16T23:46:55+08:00 | body=/hetang status | action=status | sender=ZhangZhen | query=4 rule=1 clarify=1 ai=1 unresolved=1 | latest_query=2026-04-16T23:40:00+08:00 rule_clarifier/missing-time",
    );
  });

  it("formats route-compare observability into compact doctor lines", () => {
    expect(
      formatQueryRouteCompareLine({
        total: 12,
        routeMatchCount: 11,
        routeDiffCount: 1,
        routeAccuracyPercent: 91.7,
        capabilityDiffCount: 2,
        capabilityAccuracyPercent: 83.3,
        clarificationNeededCount: 3,
        replyGuardInterventionCount: 0,
        driftTagCounts: [],
        latencyP50Ms: 180,
        latencyP95Ms: 620,
        selectedLanes: [
          { key: "query", count: 9 },
          { key: "analysis", count: 2 },
          { key: "meta", count: 1 },
        ],
        selectedCapabilities: [
          { key: "store_day_summary_v1", count: 4 },
          { key: "store_review_async_v1", count: 2 },
        ],
        topRouteDiffs: [],
        frontDoorDecisions: [],
        slowSamples: [
          {
            rawText: "一号店上周问题在哪",
            selectedLane: "analysis",
            selectedCapabilityId: "store_review_async_v1",
            latencyMs: 980,
          },
        ],
        diffSamples: [],
      }),
    ).toBe(
      "Query route compare: samples=12 | route_acc=91.7% | capability_acc=83.3% | clarify=3 | p50=180ms | p95=620ms | lanes=query:9,analysis:2,meta:1 | top_capability=store_day_summary_v1:4",
    );
    expect(
      formatQueryRouteCompareSlowLine({
        total: 12,
        routeMatchCount: 11,
        routeDiffCount: 1,
        routeAccuracyPercent: 91.7,
        capabilityDiffCount: 2,
        capabilityAccuracyPercent: 83.3,
        clarificationNeededCount: 3,
        replyGuardInterventionCount: 0,
        driftTagCounts: [],
        latencyP50Ms: 180,
        latencyP95Ms: 620,
        selectedLanes: [],
        selectedCapabilities: [],
        topRouteDiffs: [],
        frontDoorDecisions: [],
        slowSamples: [
          {
            rawText: "一号店上周问题在哪",
            selectedLane: "analysis",
            selectedCapabilityId: "store_review_async_v1",
            latencyMs: 980,
          },
        ],
        diffSamples: [],
      }),
    ).toBe(
      "Query slow sample: lane=analysis | capability=store_review_async_v1 | latency=980ms | text=一号店上周问题在哪",
    );
  });

  it("formats AI lane observability into compact doctor lines", () => {
    const formatAiLaneObservabilityLines = (
      doctorModule as unknown as {
        formatAiLaneObservabilityLines?: (
          summaries: Array<Record<string, unknown>>,
        ) => string[];
      }
    ).formatAiLaneObservabilityLines;

    expect(formatAiLaneObservabilityLines).toBeTypeOf("function");
    expect(
      formatAiLaneObservabilityLines?.([
        {
          laneId: "cheap-summary",
          taskClass: "summary",
          executionMode: "sync",
          ownerModule: "src/external-intelligence/llm.ts",
          observabilityLabel: "cheap-summary",
          model: "doubao-seed-2.0-lite",
          reasoningMode: "off",
          timeoutMs: 5000,
          responseMode: "text",
          fallbackBehavior: "deterministic",
          overrideKeys: [],
        },
        {
          laneId: "analysis-premium",
          taskClass: "analysis",
          executionMode: "async",
          ownerModule: "src/app/analysis-service.ts",
          observabilityLabel: "analysis-premium",
          model: "gpt-5.4",
          reasoningMode: "high",
          timeoutMs: 90000,
          responseMode: "json",
          fallbackBehavior: "deterministic",
          overrideKeys: ["model"],
        },
        {
          laneId: "offline-review",
          taskClass: "review",
          executionMode: "batch",
          ownerModule: "src/ops/doctor.ts",
          observabilityLabel: "offline-review",
          model: "gpt-5.4",
          reasoningMode: "high",
          timeoutMs: 120000,
          responseMode: "json",
          fallbackBehavior: "deterministic",
          overrideKeys: [],
        },
      ]),
    ).toEqual([
      "AI lane cheap-summary: model=doubao-seed-2.0-lite | reasoning=off | timeout=5000ms | response=text | mode=sync | task=summary | fallback=deterministic",
      "AI lane analysis-premium: model=gpt-5.4 | reasoning=high | timeout=90000ms | response=json | mode=async | task=analysis | fallback=deterministic | overrides=model",
      "AI lane offline-review: model=gpt-5.4 | reasoning=high | timeout=120000ms | response=json | mode=batch | task=review | fallback=deterministic",
    ]);
  });

  it("renders a compact semantic quality summary line for doctor output", () => {
    expect(
      formatSemanticQualityLine({
        windowHours: 24,
        totalCount: 12,
        successCount: 7,
        successRate: 0.5833,
        clarifyCount: 3,
        clarifyRate: 0.25,
        fallbackUsedCount: 2,
        fallbackRate: 0.1667,
        latestOccurredAt: "2026-04-17T15:30:00.000Z",
        topFailureClasses: [
          { failureClass: "clarify_missing_time", count: 2 },
          { failureClass: "generic_unmatched", count: 1 },
        ],
        topAnalysisFrameworks: [
          { frameworkId: "store_profit_diagnosis_v1", count: 2 },
          { frameworkId: "store_operations_diagnosis_v1", count: 1 },
        ],
        topRouteUpgrades: [{ upgradeKind: "metric_to_advice", count: 3 }],
        optimizationBacklog: [
          {
            failureClass: "generic_unmatched",
            count: 4,
            ownerModule: "src/semantic-intent.ts",
            recommendedAction: "补老板式开放问法和经营口语入口。",
            priority: "high",
          },
          {
            failureClass: "entry_unresolved",
            count: 3,
            ownerModule: "src/semantic-intent.ts",
            recommendedAction: "补 semantic front door 兜底分类。",
            priority: "high",
          },
        ],
        sampleCandidates: [
          {
            failureClass: "generic_unmatched",
            count: 4,
            ownerModule: "src/semantic-intent.ts",
            sampleTag: "boss_open_guidance",
            prompt: "哪个门店须重点关注",
          },
          {
            failureClass: "entry_unresolved",
            count: 3,
            ownerModule: "src/semantic-intent.ts",
            sampleTag: "entry_unresolved",
            prompt: "五店近15天整体哪里不对",
          },
        ],
        reviewBacklog: [
          {
            source: "conversation_review",
            failureClass: "review:scope_gap",
            count: 2,
            ownerModule: "src/query-intent.ts",
            recommendedAction: "把“这几天/近几天”这类口语时间窗补进默认窗口规则。",
            priority: "high",
          },
        ],
        reviewSampleCandidates: [
          {
            source: "conversation_review",
            failureClass: "review:scope_gap",
            count: 2,
            ownerModule: "src/query-intent.ts",
            sampleTag: "review_scope_gap",
            prompt: "这几天义乌店加钟率多少",
          },
        ],
        reviewDeployFollowupCount: 1,
        fallbackConfig: {
          state: "off",
          enabled: false,
          configured: false,
          timeoutMs: 5_000,
          autoAcceptConfidence: 0.85,
          clarifyConfidence: 0.7,
        },
      }),
    ).toBe(
      "Semantic quality (24h): total=12 | success=58.3% | clarify=25% | fallback=16.7% | fallback_config=off | top_failures=clarify_missing_time:2,generic_unmatched:1 | lenses=store_profit_diagnosis_v1:2,store_operations_diagnosis_v1:1 | upgrades=metric_to_advice:3 | backlog=generic_unmatched@src/semantic-intent.ts(high),entry_unresolved@src/semantic-intent.ts(high) | samples=哪个门店须重点关注 ; 五店近15天整体哪里不对 | review_backlog=review:scope_gap@src/query-intent.ts(high) | review_samples=这几天义乌店加钟率多少 | review_deploy_followups=1 | latest=2026-04-17T15:30:00.000Z",
    );
  });

  it("includes carry success rate and topic switch count in semantic quality line when present", () => {
    const line = formatSemanticQualityLine({
      windowHours: 24,
      totalCount: 20,
      successCount: 14,
      successRate: 0.7,
      clarifyCount: 3,
      clarifyRate: 0.15,
      fallbackUsedCount: 1,
      fallbackRate: 0.05,
      latestOccurredAt: "2026-04-29T10:00:00.000Z",
      topFailureClasses: [],
      topAnalysisFrameworks: [],
      topRouteUpgrades: [],
      optimizationBacklog: [],
      sampleCandidates: [],
      carrySuccessCount: 5,
      carrySuccessRate: 0.833,
      topicSwitchCount: 3,
    });

    expect(line).toContain("carry_success=83.3%");
    expect(line).toContain("topic_switches=3");
  });

  it("includes carry risk buckets when scope inheritance and topic-switch failures are present", () => {
    const line = formatSemanticQualityLine({
      windowHours: 24,
      totalCount: 20,
      successCount: 14,
      successRate: 0.7,
      clarifyCount: 3,
      clarifyRate: 0.15,
      fallbackUsedCount: 1,
      fallbackRate: 0.05,
      latestOccurredAt: "2026-04-29T10:00:00.000Z",
      topFailureClasses: [
        { failureClass: "scope_inheritance_miss", count: 4 },
        { failureClass: "topic_switch_false_positive", count: 2 },
      ],
      topAnalysisFrameworks: [],
      topRouteUpgrades: [],
      optimizationBacklog: [],
      sampleCandidates: [],
      carrySuccessCount: 5,
      carrySuccessRate: 0.833,
      topicSwitchCount: 3,
    });

    expect(line).toContain("carry_risks=scope_inheritance_miss:4,topic_switch_false_positive:2");
  });
});
