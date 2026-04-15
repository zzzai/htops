import { resolveStoreOrgId } from "../config.js";
import { executePhoneSuffixCustomerProfileQuery } from "../customer-profile.js";
import {
  findSupportedMetricDefinition,
  type HetangSupportedMetricKey,
} from "../metric-query.js";
import type { HetangQueryIntent } from "../query-intent.js";
import { resolveLocalDate, shiftBizDate } from "../time.js";
import type {
  ConsumeBillRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  HetangLogger,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechMarketRecord,
  TechUpClockRecord,
} from "../types.js";
import type {
  HetangToolCallRequest,
  HetangToolDescriptor,
  HetangToolName,
  HetangToolsCapabilities,
} from "./contracts.js";

type HetangToolsRuntime = {
  listStoreManagerDailyKpiByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreManagerDailyKpiRow[]>;
  listStoreReview7dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreReview7dRow[]>;
  listStoreSummary30dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<StoreSummary30dRow[]>;
  listMemberReactivationQueue: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationQueueRecord[]>;
  listMemberReactivationFeatures: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationFeatureRecord[]>;
  listMemberReactivationStrategies: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationStrategyRecord[]>;
  findCurrentMembersByPhoneSuffix: (params: {
    orgId: string;
    phoneSuffix: string;
  }) => Promise<MemberCurrentRecord[]>;
  listCurrentMembers: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listCurrentMemberCards?: (params: { orgId: string }) => Promise<MemberCardCurrentRecord[]>;
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listCustomerProfile90dByDateRange: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
};

const TOOL_DESCRIPTORS: HetangToolDescriptor[] = [
  {
    name: "get_store_daily_summary",
    description: "Return one store's daily KPI snapshot for a single business date.",
  },
  {
    name: "get_store_risk_scan",
    description: "Return rule-based 7d/30d operating risk signals for a store.",
  },
  {
    name: "get_member_recall_candidates",
    description: "Return ranked member recall candidates with feature and strategy hints.",
  },
  {
    name: "get_customer_profile",
    description: "Return a deterministic customer/member profile lookup for one store.",
  },
  {
    name: "explain_metric_definition",
    description: "Return the canonical metric definition and aliases for one KPI.",
  },
];

type RiskSeverity = "high" | "medium";

const RISK_THRESHOLDS = {
  storedConsumeRate: 0.35,
  addClockRate: 0.1,
  pointClockRate: 0.38,
  sleepingMemberRate: 0.4,
  renewalPressureIndex: 0.6,
} as const;

export class HetangToolError extends Error {
  statusCode: number;
  errorCode: string;

  constructor(statusCode: number, errorCode: string, message?: string) {
    super(message ?? errorCode);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return undefined;
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function lastPhoneDigits(phone: string | undefined, size = 4): string | undefined {
  if (!phone) {
    return undefined;
  }
  const digits = phone.replace(/\D/gu, "");
  if (!digits) {
    return undefined;
  }
  return digits.slice(-size);
}

function buildPhoneSuffixProfileIntent(params: {
  orgId: string;
  storeName: string;
  phoneSuffix: string;
  bizDate: string;
}): HetangQueryIntent {
  const startBizDate = shiftBizDate(params.bizDate, -89);
  return {
    rawText: `${params.storeName}尾号${params.phoneSuffix}客户画像`,
    kind: "customer_profile",
    explicitOrgIds: [params.orgId],
    allStoresRequested: false,
    timeFrame: {
      kind: "range",
      startBizDate,
      endBizDate: params.bizDate,
      label: "近90天",
      days: 90,
    },
    phoneSuffix: params.phoneSuffix,
    metrics: [],
    unsupportedMetrics: [],
    mentionsCompareKeyword: false,
    mentionsRankingKeyword: false,
    mentionsTrendKeyword: false,
    mentionsAnomalyKeyword: false,
    mentionsRiskKeyword: false,
    mentionsAdviceKeyword: false,
    mentionsReportKeyword: false,
    routeConfidence: "high",
    semanticSlots: {
      store: {
        scope: "single",
        orgIds: [params.orgId],
      },
      object: "customer",
      action: "profile",
      metricKeys: [],
      time: {
        kind: "range",
        startBizDate,
        endBizDate: params.bizDate,
        label: "近90天",
        days: 90,
      },
    },
  };
}

async function buildLegacyProfileText(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  store: { orgId: string; storeName: string };
  phoneSuffix?: string;
  bizDate: string;
  now: () => Date;
}): Promise<string | undefined> {
  if (!params.phoneSuffix) {
    return undefined;
  }
  const text = await executePhoneSuffixCustomerProfileQuery({
    runtime: params.runtime,
    config: params.config,
    intent: buildPhoneSuffixProfileIntent({
      orgId: params.store.orgId,
      storeName: params.store.storeName,
      phoneSuffix: params.phoneSuffix,
      bizDate: params.bizDate,
    }),
    effectiveOrgIds: [params.store.orgId],
    now: params.now(),
  });
  return text.trim().length > 0 ? text : undefined;
}

function resolveBizDate(
  config: HetangOpsConfig,
  args: Record<string, unknown>,
  now: () => Date,
): string {
  return readString(args.biz_date) ?? resolveLocalDate(now(), config.timeZone);
}

function resolveStoreContext(config: HetangOpsConfig, args: Record<string, unknown>) {
  const explicitOrgId = readString(args.org_id);
  const orgId = explicitOrgId ?? resolveStoreOrgId(config, readString(args.store) ?? "");
  if (!orgId) {
    throw new HetangToolError(400, "store_required", "Missing store/org selector.");
  }
  const store = config.stores.find((entry) => entry.orgId === orgId);
  if (!store) {
    throw new HetangToolError(404, "store_not_found", `Unknown store org_id: ${orgId}`);
  }
  return {
    orgId,
    storeName: store.storeName,
  };
}

function requireToolName(value: string): HetangToolName {
  if (TOOL_DESCRIPTORS.some((entry) => entry.name === value)) {
    return value as HetangToolName;
  }
  throw new HetangToolError(404, "unknown_tool", `Unknown tool: ${value}`);
}

function resolveRiskSignals(params: {
  review?: StoreReview7dRow;
  summary?: StoreSummary30dRow;
}): Array<{
  key: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
  metric_value: number;
  threshold: number;
}> {
  const signals: Array<{
    key: string;
    severity: RiskSeverity;
    title: string;
    detail: string;
    metric_value: number;
    threshold: number;
  }> = [];
  const review = params.review;
  const summary = params.summary;

  const pushSignal = (
    key: string,
    severity: RiskSeverity,
    title: string,
    detail: string,
    metricValue: number | null | undefined,
    threshold: number,
  ) => {
    if (metricValue === null || metricValue === undefined) {
      return;
    }
    signals.push({
      key,
      severity,
      title,
      detail,
      metric_value: Number(metricValue),
      threshold,
    });
  };

  if ((summary?.storedConsumeRate30d ?? review?.storedConsumeRate7d ?? 1) < RISK_THRESHOLDS.storedConsumeRate) {
    pushSignal(
      "low_member_store_consume_rate",
      "high",
      "会员消耗占比偏低",
      "门店当前更依赖非会员支付，储值沉淀和后续复购承压。",
      summary?.storedConsumeRate30d ?? review?.storedConsumeRate7d,
      RISK_THRESHOLDS.storedConsumeRate,
    );
  }

  if ((summary?.addClockRate30d ?? review?.addClockRate7d ?? 1) < RISK_THRESHOLDS.addClockRate) {
    pushSignal(
      "weak_addon_rate",
      "high",
      "加钟/副项承接偏弱",
      "到店后延长消费与附加销售不足，容易损失高客单空间。",
      summary?.addClockRate30d ?? review?.addClockRate7d,
      RISK_THRESHOLDS.addClockRate,
    );
  }

  if ((summary?.pointClockRate30d ?? review?.pointClockRate7d ?? 1) < RISK_THRESHOLDS.pointClockRate) {
    pushSignal(
      "weak_point_clock_rate",
      "medium",
      "指定率偏弱",
      "熟客绑定与技师偏好还没充分放大，复购粘性存在空间。",
      summary?.pointClockRate30d ?? review?.pointClockRate7d,
      RISK_THRESHOLDS.pointClockRate,
    );
  }

  if ((summary?.sleepingMemberRate ?? review?.sleepingMemberRate ?? 0) > RISK_THRESHOLDS.sleepingMemberRate) {
    pushSignal(
      "high_sleeping_member_rate",
      "high",
      "沉睡会员占比较高",
      "需要尽快把高价值沉默会员转入主动唤回和生日窗口运营。",
      summary?.sleepingMemberRate ?? review?.sleepingMemberRate,
      RISK_THRESHOLDS.sleepingMemberRate,
    );
  }

  if ((summary?.renewalPressureIndex30d ?? review?.renewalPressureIndex30d ?? 0) > RISK_THRESHOLDS.renewalPressureIndex) {
    pushSignal(
      "high_renewal_pressure",
      "medium",
      "续充压力偏高",
      "余额消耗和沉默节奏叠加，近期要重点盯高价值会员续充。",
      summary?.renewalPressureIndex30d ?? review?.renewalPressureIndex30d,
      RISK_THRESHOLDS.renewalPressureIndex,
    );
  }

  return signals;
}

function toDailySummaryResult(row: StoreManagerDailyKpiRow) {
  return {
    org_id: row.orgId,
    store_name: row.storeName,
    biz_date: row.bizDate,
    metrics: {
      revenue: row.dailyActualRevenue,
      card_consume: row.dailyCardConsume,
      order_count: row.dailyOrderCount,
      total_clocks: row.totalClocks,
      assign_clocks: row.assignClocks,
      queue_clocks: row.queueClocks,
      point_clock_rate: row.pointClockRate,
      average_ticket: row.averageTicket,
      clock_effect: row.clockEffect,
    },
  };
}

function toReviewSnapshot(row: StoreReview7dRow | undefined) {
  if (!row) {
    return null;
  }
  return {
    revenue_7d: row.revenue7d,
    order_count_7d: row.orderCount7d,
    point_clock_rate_7d: row.pointClockRate7d,
    add_clock_rate_7d: row.addClockRate7d,
    stored_consume_rate_7d: row.storedConsumeRate7d,
    sleeping_member_rate: row.sleepingMemberRate,
    renewal_pressure_index_30d: row.renewalPressureIndex30d ?? null,
  };
}

function toSummarySnapshot(row: StoreSummary30dRow | undefined) {
  if (!row) {
    return null;
  }
  return {
    revenue_30d: row.revenue30d,
    order_count_30d: row.orderCount30d,
    point_clock_rate_30d: row.pointClockRate30d,
    add_clock_rate_30d: row.addClockRate30d,
    stored_consume_rate_30d: row.storedConsumeRate30d,
    sleeping_member_rate: row.sleepingMemberRate,
    renewal_pressure_index_30d: row.renewalPressureIndex30d ?? null,
  };
}

function pickProfileRow(rows: CustomerProfile90dRow[], memberId: string, bizDate: string) {
  const exact = rows.find((row) => row.memberId === memberId && row.windowEndBizDate === bizDate);
  if (exact) {
    return exact;
  }
  return rows
    .filter((row) => row.memberId === memberId)
    .sort((left, right) => right.windowEndBizDate.localeCompare(left.windowEndBizDate))[0];
}

function mapCustomerProfile(params: {
  member: MemberCurrentRecord & Record<string, unknown>;
  profile?: CustomerProfile90dRow;
}) {
  const { member, profile } = params;
  return {
    member_id: member.memberId,
    customer_name: member.name,
    phone_suffix: lastPhoneDigits(member.phone),
    member_level_name: readString(member.memberLevelName),
    birthday: readString(member.birthday),
    current_member_state: {
      stored_amount: member.storedAmount,
      consume_amount: member.consumeAmount,
      last_consume_time: member.lastConsumeTime,
      silent_days: member.silentDays,
    },
    current_profile: profile
      ? {
          primary_segment: profile.primarySegment,
          recency_segment: profile.recencySegment,
          frequency_segment: profile.frequencySegment,
          monetary_segment: profile.monetarySegment,
          payment_segment: profile.paymentSegment,
          tech_loyalty_segment: profile.techLoyaltySegment,
          pay_amount_90d: profile.payAmount90d,
          visit_count_90d: profile.visitCount90d,
          current_stored_amount: profile.currentStoredAmount,
          current_silent_days: profile.currentSilentDays,
          top_tech_name: profile.topTechName,
          tags: profile.tagKeys,
        }
      : null,
  };
}

function mapRecallCandidate(params: {
  queue: MemberReactivationQueueRecord;
  feature?: MemberReactivationFeatureRecord;
  strategy?: MemberReactivationStrategyRecord;
}) {
  const { queue, feature, strategy } = params;
  return {
    member_id: queue.memberId,
    customer_name: queue.customerDisplayName,
    priority_band: queue.priorityBand,
    priority_rank: queue.priorityRank,
    followup_bucket: queue.followupBucket,
    primary_segment: queue.primarySegment,
    scores: {
      reactivation_priority: queue.reactivationPriorityScore,
      strategy_priority: queue.strategyPriorityScore,
      execution_priority: queue.executionPriorityScore,
      churn_risk: queue.churnRiskScore,
      birthday_boost: queue.birthdayBoostScore,
    },
    days_since_last_visit: queue.daysSinceLastVisit,
    visit_count_90d: queue.visitCount90d,
    pay_amount_90d: queue.payAmount90d,
    current_stored_balance_inferred: queue.currentStoredBalanceInferred,
    projected_balance_days_left: queue.projectedBalanceDaysLeft,
    recommended_action: queue.recommendedActionLabel,
    recommended_touch: {
      weekday: queue.recommendedTouchWeekday,
      daypart: queue.recommendedTouchDaypart,
      label: queue.touchWindowLabel,
    },
    reasons: {
      summary: queue.reasonSummary,
      touch_advice: queue.touchAdviceSummary,
    },
    time_pattern: feature
      ? {
          dominant_daypart: feature.dominantVisitDaypart,
          preferred_daypart_share_90d: feature.preferredDaypartShare90d,
          dominant_weekday: feature.dominantVisitWeekday,
          preferred_weekday_share_90d: feature.preferredWeekdayShare90d,
          late_night_visit_share_90d: feature.lateNightVisitShare90d,
          overnight_visit_share_90d: feature.overnightVisitShare90d,
        }
      : null,
    strategy: strategy
      ? {
          churn_risk_label: strategy.churnRiskLabel,
          revisit_probability_7d: strategy.revisitProbability7d,
          revisit_window_label: strategy.revisitWindowLabel,
          lifecycle_momentum_label: strategy.lifecycleMomentumLabel,
        }
      : null,
    birthday: {
      next_birthday_biz_date: queue.nextBirthdayBizDate,
      birthday_window_days: queue.birthdayWindowDays,
    },
    top_tech_name: queue.topTechName,
  };
}

async function getStoreDailySummary(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const rows = await params.runtime.listStoreManagerDailyKpiByDateRange({
    orgId: store.orgId,
    startBizDate: bizDate,
    endBizDate: bizDate,
  });
  const row = rows[0];
  if (!row) {
    throw new HetangToolError(404, "store_daily_summary_not_found");
  }
  return toDailySummaryResult(row);
}

async function getStoreRiskScan(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const [reviewRows, summaryRows] = await Promise.all([
    params.runtime.listStoreReview7dByDateRange({
      orgId: store.orgId,
      startBizDate: bizDate,
      endBizDate: bizDate,
    }),
    params.runtime.listStoreSummary30dByDateRange({
      orgId: store.orgId,
      startBizDate: bizDate,
      endBizDate: bizDate,
    }),
  ]);
  const review = reviewRows[0];
  const summary = summaryRows[0];
  if (!review && !summary) {
    throw new HetangToolError(404, "store_risk_scan_not_found");
  }
  return {
    org_id: store.orgId,
    store_name: store.storeName,
    window_end_biz_date: bizDate,
    review_7d: toReviewSnapshot(review),
    summary_30d: toSummarySnapshot(summary),
    signals: resolveRiskSignals({ review, summary }),
  };
}

async function getMemberRecallCandidates(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const limit = clampInteger(readNumber(params.args.limit) ?? 10, 1, 50);
  const [queueRows, featureRows, strategyRows] = await Promise.all([
    params.runtime.listMemberReactivationQueue({
      orgId: store.orgId,
      bizDate,
    }),
    params.runtime.listMemberReactivationFeatures({
      orgId: store.orgId,
      bizDate,
    }),
    params.runtime.listMemberReactivationStrategies({
      orgId: store.orgId,
      bizDate,
    }),
  ]);

  const featureByMemberId = new Map(featureRows.map((row) => [row.memberId, row]));
  const strategyByMemberId = new Map(strategyRows.map((row) => [row.memberId, row]));
  return {
    org_id: store.orgId,
    store_name: store.storeName,
    snapshot_biz_date: bizDate,
    total_candidates: queueRows.length,
    candidates: queueRows.slice(0, limit).map((queue) =>
      mapRecallCandidate({
        queue,
        feature: featureByMemberId.get(queue.memberId),
        strategy: strategyByMemberId.get(queue.memberId),
      }),
    ),
  };
}

async function getCustomerProfile(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  args: Record<string, unknown>;
  now: () => Date;
}) {
  const store = resolveStoreContext(params.config, params.args);
  const bizDate = resolveBizDate(params.config, params.args, params.now);
  const phoneSuffix = readString(params.args.phone_suffix);
  const memberId = readString(params.args.member_id);
  if (!phoneSuffix && !memberId) {
    throw new HetangToolError(
      400,
      "customer_selector_required",
      "Provide phone_suffix or member_id.",
    );
  }

  const members = phoneSuffix
    ? ((await params.runtime.findCurrentMembersByPhoneSuffix({
        orgId: store.orgId,
        phoneSuffix,
      })) as Array<MemberCurrentRecord & Record<string, unknown>>)
    : (((await params.runtime.listCurrentMembers({
        orgId: store.orgId,
      })) as Array<MemberCurrentRecord & Record<string, unknown>>).filter(
        (entry) => entry.memberId === memberId,
      ));

  if (members.length === 0) {
    throw new HetangToolError(404, "customer_not_found");
  }

  const profileRows = await params.runtime.listCustomerProfile90dByDateRange({
    orgId: store.orgId,
    startBizDate: shiftBizDate(bizDate, -89),
    endBizDate: bizDate,
  });

  const matchedMembers = members.map((member) =>
    mapCustomerProfile({
      member,
      profile: pickProfileRow(profileRows, member.memberId, bizDate),
    }),
  );
  const legacyProfileText =
    matchedMembers.some((member) => member.current_profile === null) && phoneSuffix
      ? await buildLegacyProfileText({
          config: params.config,
          runtime: params.runtime,
          store,
          phoneSuffix,
          bizDate,
          now: params.now,
        })
      : undefined;

  return {
    org_id: store.orgId,
    store_name: store.storeName,
    snapshot_biz_date: bizDate,
    matched_members: matchedMembers,
    legacy_profile_text: legacyProfileText,
  };
}

function explainMetricDefinition(args: Record<string, unknown>) {
  const metric =
    readString(args.metric) ??
    readString(args.metric_key) ??
    readString(args.metric_label) ??
    readString(args.text);
  if (!metric) {
    throw new HetangToolError(400, "metric_required", "Missing metric selector.");
  }
  const definition = findSupportedMetricDefinition(metric);
  if (!definition) {
    throw new HetangToolError(404, "metric_not_found");
  }
  return {
    key: definition.key satisfies HetangSupportedMetricKey,
    label: definition.label,
    aliases: definition.aliases,
  };
}

export function createHetangToolsService(params: {
  config: HetangOpsConfig;
  runtime: HetangToolsRuntime;
  logger: HetangLogger;
  now?: () => Date;
}) {
  const now = params.now ?? (() => new Date());

  return {
    describeCapabilities(): HetangToolsCapabilities {
      return {
        version: "v1",
        tools: TOOL_DESCRIPTORS,
      };
    },

    async handleToolCall(request: HetangToolCallRequest): Promise<{
      ok: true;
      tool: HetangToolName;
      result: Record<string, unknown>;
    }> {
      const tool = requireToolName(request.tool);
      const args = asRecord(request.arguments);

      params.logger.debug?.(`htops-tools: call tool=${tool}`);

      switch (tool) {
        case "get_store_daily_summary":
          return {
            ok: true,
            tool,
            result: await getStoreDailySummary({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_store_risk_scan":
          return {
            ok: true,
            tool,
            result: await getStoreRiskScan({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_member_recall_candidates":
          return {
            ok: true,
            tool,
            result: await getMemberRecallCandidates({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "get_customer_profile":
          return {
            ok: true,
            tool,
            result: await getCustomerProfile({
              config: params.config,
              runtime: params.runtime,
              args,
              now,
            }),
          };
        case "explain_metric_definition":
          return {
            ok: true,
            tool,
            result: explainMetricDefinition(args),
          };
      }
    },
  };
}
