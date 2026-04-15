import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type {
  HetangAnalysisDeliveryHealthSummary,
  HetangAnalysisDeadLetter,
  HetangAnalysisJob,
  HetangAnalysisQueueSummary,
  HetangAnalysisJobStatus,
  HetangAnalysisSubscriber,
  HetangExternalBriefIssue,
  HetangExternalBriefItem,
  HetangExternalEventCard,
  HetangExternalEventCandidate,
  HetangExternalSourceConfig,
  HetangExternalSourceTier,
  ConsumeBillRecord,
  CustomerConversionCohortRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  DailyStoreAlert,
  DailyStoreMetrics,
  DailyStoreReport,
  HetangActionItem,
  HetangHistoricalCoverageSnapshot,
  HetangHistoricalCoverageSpan,
  HetangCommandAuditRecord,
  HetangInboundMessageAuditRecord,
  HetangControlTowerScopeType,
  HetangControlTowerSettingRecord,
  HetangControlTowerSettingValue,
  HetangEmployeeBinding,
  MemberCardDailySnapshotRecord,
  MemberCardCurrentRecord,
  MemberDailySnapshotRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  RechargeBillRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechProfile30dRow,
  TechCommissionSnapshotRecord,
  TechCurrentRecord,
  TechMarketRecord,
  TechUpClockRecord,
  UserTradeRecord,
  ScheduledJobType,
} from "./types.js";
import { normalizeMemberCardRows, normalizeMemberRow } from "./normalize.js";
import {
  HetangServingPublicationStore,
  type PublishAnalyticsViewsParams,
  resolveGeneratedServingVersion,
} from "./store/serving-publication-store.js";
import { HetangRawIngestionStore } from "./store/raw-ingestion-store.js";
import { HetangMartDerivedStore } from "./store/mart-derived-store.js";
import { HetangQueueAccessControlStore } from "./store/queue-access-control-store.js";
import { resolveOperationalBizDateFromTimestamp, shiftBizDate } from "./time.js";

type StoreSeed = {
  orgId: string;
  storeName: string;
  rawAliases: string[];
};

type AnalyticsWriteOptions = {
  refreshViews?: boolean;
};

const REQUIRED_ANALYTICS_VIEWS = [
  "mv_store_manager_daily_kpi",
  "mv_tech_profile_30d",
  "mv_customer_profile_90d",
  "mv_store_review_7d",
  "mv_store_summary_30d",
  "serving_store_day",
  "serving_store_day_breakdown",
  "serving_store_window",
  "serving_customer_profile_asof",
  "serving_customer_ranked_list_asof",
  "serving_tech_profile_window",
  "serving_hq_portfolio_window",
] as const;
const ANALYTICS_REBUILD_DROP_ORDER = [
  "serving_hq_portfolio_window",
  "serving_tech_profile_window",
  "serving_customer_ranked_list_asof",
  "serving_customer_profile_asof",
  "serving_store_window",
  "serving_store_day_breakdown",
  "serving_store_day",
  "mv_store_review_7d",
  "mv_store_summary_30d",
  "mv_customer_profile_90d",
  "mv_tech_profile_30d",
  "mv_store_manager_daily_kpi",
] as const;
const STORE_INITIALIZATION_ADVISORY_LOCK_KEY = 42_060_406;
const ANALYSIS_DELIVERY_MAX_ATTEMPTS = 3;
const HISTORICAL_COVERAGE_TIME_ZONE = "Asia/Shanghai";
const HISTORICAL_COVERAGE_CUTOFF_LOCAL_TIME = "03:00";
const ZERO_ROW_BATCH_COVERAGE_CONFIRMATION_THRESHOLD = 2;

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function buildAnalysisSubscriberKey(params: {
  jobId: string;
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
}): string {
  return md5(
    [
      params.jobId,
      params.channel,
      params.target,
      params.accountId ?? "",
      params.threadId ?? "",
    ].join("|"),
  );
}

function rowValue(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return value === undefined || value === null ? "" : String(value);
}

function mapHistoricalCoverageSpan(row?: Record<string, unknown>): HetangHistoricalCoverageSpan {
  if (!row) {
    return {
      rowCount: 0,
      dayCount: 0,
    };
  }
  const rowCount = Number(row.row_count ?? 0);
  const dayCount = Number(row.day_count ?? 0);
  return {
    rowCount: Number.isFinite(rowCount) ? rowCount : 0,
    dayCount: Number.isFinite(dayCount) ? dayCount : 0,
    minBizDate: typeof row.min_biz_date === "string" ? row.min_biz_date : undefined,
    maxBizDate: typeof row.max_biz_date === "string" ? row.max_biz_date : undefined,
    firstMissingBizDate:
      typeof row.first_missing_biz_date === "string" ? row.first_missing_biz_date : undefined,
  };
}

function parseCoverageRequestWindow(requestJson: string): { startBizDate: string; endBizDate: string } | null {
  try {
    const parsed = JSON.parse(requestJson) as Record<string, unknown>;
    const startTime = typeof parsed.Stime === "string" ? parsed.Stime : undefined;
    const endTime = typeof parsed.Etime === "string" ? parsed.Etime : undefined;
    if (!startTime || !endTime) {
      return null;
    }
    return {
      startBizDate: resolveOperationalBizDateFromTimestamp(
        startTime,
        HISTORICAL_COVERAGE_TIME_ZONE,
        HISTORICAL_COVERAGE_CUTOFF_LOCAL_TIME,
      ),
      endBizDate: resolveOperationalBizDateFromTimestamp(
        endTime,
        HISTORICAL_COVERAGE_TIME_ZONE,
        HISTORICAL_COVERAGE_CUTOFF_LOCAL_TIME,
      ),
    };
  } catch {
    return null;
  }
}

function clampCoverageRange(params: {
  startBizDate: string;
  endBizDate: string;
  rangeStartBizDate: string;
  rangeEndBizDate: string;
}): { startBizDate: string; endBizDate: string } | null {
  const startBizDate =
    params.startBizDate < params.rangeStartBizDate ? params.rangeStartBizDate : params.startBizDate;
  const endBizDate =
    params.endBizDate > params.rangeEndBizDate ? params.rangeEndBizDate : params.endBizDate;
  return startBizDate <= endBizDate ? { startBizDate, endBizDate } : null;
}

function addBizDateRangeToCoverage(
  coverageDays: Set<string>,
  startBizDate: string,
  endBizDate: string,
): void {
  for (
    let bizDate = startBizDate;
    bizDate <= endBizDate;
    bizDate = shiftBizDate(bizDate, 1)
  ) {
    coverageDays.add(bizDate);
  }
}

function buildHistoricalCoverageSpanFromDays(params: {
  coverageDays: Set<string>;
  startBizDate: string;
  endBizDate: string;
}): HetangHistoricalCoverageSpan {
  const orderedDays = Array.from(params.coverageDays).sort((left, right) => left.localeCompare(right));
  const dayCount = orderedDays.length;
  let firstMissingBizDate: string | undefined;
  if (dayCount > 0) {
    for (
      let bizDate = params.startBizDate;
      bizDate <= params.endBizDate;
      bizDate = shiftBizDate(bizDate, 1)
    ) {
      if (!params.coverageDays.has(bizDate)) {
        firstMissingBizDate = bizDate;
        break;
      }
    }
  }
  return {
    rowCount: dayCount,
    dayCount,
    minBizDate: orderedDays[0],
    maxBizDate: orderedDays[dayCount - 1],
    firstMissingBizDate,
  };
}

function isAdvisoryLockUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const message =
    error instanceof Error ? error.message : String((error as { message?: unknown }).message ?? "");
  const code =
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : undefined;
  return (
    (code === undefined || code === "42883") &&
    /pg_(?:try_)?advisory_lock|pg_advisory_unlock/iu.test(message)
  );
}

function resolveRawRowKey(endpoint: string, row: Record<string, unknown>, orgId: string): string {
  switch (endpoint) {
    case "1.1":
      return rowValue(row, "Id") || md5(`${orgId}|${JSON.stringify(row)}`);
    case "1.2":
      return rowValue(row, "SettleId") || md5(`${orgId}|${JSON.stringify(row)}`);
    case "1.3":
      return rowValue(row, "Id") || md5(`${orgId}|${JSON.stringify(row)}`);
    case "1.4":
      return md5(
        [
          orgId,
          rowValue(row, "TradeNo"),
          rowValue(row, "OptTime"),
          rowValue(row, "CardOptType"),
          rowValue(row, "ChangeBalance"),
          rowValue(row, "ChangeReality"),
          rowValue(row, "ChangeDonate"),
          rowValue(row, "ChangeIntegral"),
          rowValue(row, "PaymentType"),
        ].join("|"),
      );
    case "1.5":
      return rowValue(row, "Code") || md5(`${orgId}|${JSON.stringify(row)}`);
    case "1.6":
      return md5(
        [
          orgId,
          rowValue(row, "PersonCode"),
          rowValue(row, "SettleNo"),
          rowValue(row, "HandCardCode"),
          rowValue(row, "ItemName"),
          rowValue(row, "CTime"),
          rowValue(row, "ClockType"),
          rowValue(row, "Count"),
          rowValue(row, "Turnover"),
          rowValue(row, "Comm"),
        ].join("|"),
      );
    case "1.7":
      return (
        rowValue(row, "Id") ||
        md5(
          [
            orgId,
            rowValue(row, "PersonCode"),
            rowValue(row, "ItemId"),
            rowValue(row, "SettleTime"),
            rowValue(row, "AfterDisc"),
            rowValue(row, "Commission"),
          ].join("|"),
        )
      );
    case "1.8":
      return md5([orgId, rowValue(row, "ItemId"), JSON.stringify(row.PCBaseList ?? [])].join("|"));
    default:
      return md5(`${orgId}|${JSON.stringify(row)}`);
  }
}

function normalizeNumeric(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseJsonRecord(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeSortableTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const localMatch = trimmed.match(
    /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/u,
  );
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4] ?? "00"}:${localMatch[5] ?? "00"}:${localMatch[6] ?? "00"}`;
  }
  const parsed = new Date(trimmed);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function extractBizDateFromTimestamp(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function isBizDateWithinRange(bizDate: string | null, startBizDate: string, endBizDate: string): boolean {
  return bizDate !== null && bizDate >= startBizDate && bizDate <= endBizDate;
}

function collectStringTokens(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectStringTokens(entry));
  }
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[,\s;|]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function rememberCandidateActivity(
  activityAtByCardId: Map<string, string>,
  cardId: string | undefined,
  activityAt: string | null,
): void {
  if (!cardId || !activityAt) {
    return;
  }
  const current = activityAtByCardId.get(cardId);
  if (!current || activityAt.localeCompare(current) > 0) {
    activityAtByCardId.set(cardId, activityAt);
  }
}

function normalizeRateFromCounts(params: {
  rate: unknown;
  numerator: unknown;
  denominator: unknown;
}): number | null {
  const denominator = Number(params.denominator ?? 0);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  const numerator = Number(params.numerator ?? 0);
  if (!Number.isFinite(numerator) || numerator < 0) {
    return null;
  }
  const rate = Number(params.rate);
  if (Number.isFinite(rate) && rate > 0) {
    return rate;
  }
  return numerator / denominator;
}

function parseControlTowerValue(rawValue: string): HetangControlTowerSettingValue {
  const trimmed = rawValue.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed === "boolean" || typeof parsed === "number" || typeof parsed === "string") {
      return parsed;
    }
  } catch {}
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  const numeric = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(numeric)) {
    return numeric;
  }
  return trimmed;
}

function assertSafeTableName(tableName: string): void {
  if (!/^[a-z_][a-z0-9_]*$/u.test(tableName)) {
    throw new Error(`Unsafe table name: ${tableName}`);
  }
}

function isMaterializedViewUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();
  if (normalizedMessage.includes("cannot drop materialized view")) {
    return false;
  }
  return (
    normalizedMessage.includes("materialized views are not supported") ||
    normalizedMessage.includes("syntax error at or near \"materialized\"") ||
    normalizedMessage.includes('unexpected word token: "view"')
  );
}

function isWrongDropRelationTypeError(
  error: unknown,
  relationType: "view" | "materialized view",
): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return (
    code === "42809" ||
    normalizedMessage.includes(
      relationType === "view" ? "is not a view" : "is not a materialized view",
    )
  );
}

function isMissingRelationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  return code === "42P01" || normalizedMessage.includes("does not exist");
}

function isDropRelationSyntaxUnsupportedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalizedMessage = message.toLowerCase();
  return (
    normalizedMessage.includes("your query failed to parse") &&
    normalizedMessage.includes("unexpected word token")
  );
}

function mapAnalysisJobRow(row: Record<string, unknown>): HetangAnalysisJob {
  return {
    jobId: String(row.job_id),
    jobType: String(row.job_type) as HetangAnalysisJob["jobType"],
    capabilityId: (row.capability_id as string | null) ?? undefined,
    orgId: String(row.org_id),
    rawText: String(row.raw_text),
    timeFrameLabel: String(row.time_frame_label),
    startBizDate: String(row.start_biz_date),
    endBizDate: String(row.end_biz_date),
    channel: String(row.channel),
    target: String(row.target),
    accountId: (row.account_id as string | null) ?? undefined,
    threadId: (row.thread_id as string | null) ?? undefined,
    senderId: (row.sender_id as string | null) ?? undefined,
    status: String(row.status) as HetangAnalysisJobStatus,
    attemptCount: normalizeNumeric(row.attempt_count),
    resultText: (row.result_text as string | null) ?? undefined,
    errorMessage: (row.error_message as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    startedAt: (row.started_at as string | null) ?? undefined,
    finishedAt: (row.finished_at as string | null) ?? undefined,
    deliveredAt: (row.delivered_at as string | null) ?? undefined,
    deliveryAttemptCount:
      row.delivery_attempt_count === null || row.delivery_attempt_count === undefined
        ? undefined
        : normalizeNumeric(row.delivery_attempt_count),
    lastDeliveryAttemptAt: (row.last_delivery_attempt_at as string | null) ?? undefined,
    lastDeliveryError: (row.last_delivery_error as string | null) ?? undefined,
    nextDeliveryAfter: (row.next_delivery_after as string | null) ?? undefined,
    deliveryAbandonedAt: (row.delivery_abandoned_at as string | null) ?? undefined,
  };
}

function mapAnalysisSubscriberRow(row: Record<string, unknown>): HetangAnalysisSubscriber {
  return {
    subscriberKey: String(row.subscriber_key),
    jobId: String(row.job_id),
    channel: String(row.channel),
    target: String(row.target),
    accountId: (row.account_id as string | null) ?? undefined,
    threadId: (row.thread_id as string | null) ?? undefined,
    senderId: (row.sender_id as string | null) ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    deliveredAt: (row.delivered_at as string | null) ?? undefined,
    deliveryAttemptCount:
      row.delivery_attempt_count === null || row.delivery_attempt_count === undefined
        ? undefined
        : normalizeNumeric(row.delivery_attempt_count),
    lastDeliveryAttemptAt: (row.last_delivery_attempt_at as string | null) ?? undefined,
    lastDeliveryError: (row.last_delivery_error as string | null) ?? undefined,
    nextDeliveryAfter: (row.next_delivery_after as string | null) ?? undefined,
    deliveryAbandonedAt: (row.delivery_abandoned_at as string | null) ?? undefined,
  };
}

function mapAnalysisDeadLetterRow(row: Record<string, unknown>): HetangAnalysisDeadLetter {
  return {
    deadLetterKey: String(row.dead_letter_key),
    jobId: String(row.job_id),
    subscriberKey: (row.subscriber_key as string | null) ?? undefined,
    orgId: String(row.org_id),
    deadLetterScope: String(row.dead_letter_scope) as HetangAnalysisDeadLetter["deadLetterScope"],
    reason: String(row.reason),
    payloadJson: (row.payload_json as string | null) ?? undefined,
    createdAt: String(row.created_at),
    resolvedAt: (row.resolved_at as string | null) ?? undefined,
  };
}

function parseStringArray(rawValue: unknown): string[] {
  if (typeof rawValue !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((entry) => String(entry));
  } catch {
    return [];
  }
}

function parseTagKeys(rawValue: unknown): string[] {
  return parseStringArray(rawValue);
}

function mapCustomerTechLinkRow(
  orgId: string,
  row: Record<string, unknown>,
): CustomerTechLinkRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    settleId: String(row.settle_id),
    settleNo: (row.settle_no as string | null) ?? undefined,
    customerIdentityKey: String(row.customer_identity_key),
    customerIdentityType: String(
      row.customer_identity_type,
    ) as CustomerTechLinkRecord["customerIdentityType"],
    customerDisplayName: String(row.customer_display_name),
    memberId: (row.member_id as string | null) ?? undefined,
    memberCardNo: (row.member_card_no as string | null) ?? undefined,
    referenceCode: (row.reference_code as string | null) ?? undefined,
    memberLabel: (row.member_label as string | null) ?? undefined,
    identityStable: Boolean(row.identity_stable),
    techCode: String(row.tech_code),
    techName: String(row.tech_name),
    customerCountInSettle: normalizeNumeric(row.customer_count_in_settle),
    techCountInSettle: normalizeNumeric(row.tech_count_in_settle),
    techTurnover: normalizeNumeric(row.tech_turnover),
    techCommission: normalizeNumeric(row.tech_commission),
    orderPayAmount: normalizeNumeric(row.order_pay_amount),
    orderConsumeAmount: normalizeNumeric(row.order_consume_amount),
    itemNames: parseStringArray(row.item_names_json),
    linkConfidence: String(row.link_confidence) as CustomerTechLinkRecord["linkConfidence"],
    rawJson: String(row.link_json),
  };
}

function mapCustomerConversionCohortRow(
  orgId: string,
  row: Record<string, unknown>,
): CustomerConversionCohortRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    customerIdentityKey: String(row.customer_identity_key),
    customerIdentityType: String(
      row.customer_identity_type,
    ) as CustomerConversionCohortRecord["customerIdentityType"],
    customerDisplayName: String(row.customer_display_name),
    memberId: (row.member_id as string | null) ?? undefined,
    memberCardNo: (row.member_card_no as string | null) ?? undefined,
    referenceCode: (row.reference_code as string | null) ?? undefined,
    identityStable: Boolean(row.identity_stable),
    firstGroupbuyBizDate: (row.first_groupbuy_biz_date as string | null) ?? undefined,
    firstGroupbuyOptTime: (row.first_groupbuy_opt_time as string | null) ?? undefined,
    firstGroupbuySettleId: (row.first_groupbuy_settle_id as string | null) ?? undefined,
    firstGroupbuySettleNo: (row.first_groupbuy_settle_no as string | null) ?? undefined,
    firstGroupbuyAmount: normalizeNumeric(row.first_groupbuy_amount),
    firstObservedBizDate: (row.first_observed_biz_date as string | null) ?? undefined,
    lastObservedBizDate: (row.last_observed_biz_date as string | null) ?? undefined,
    firstObservedIsGroupbuy: Boolean(row.first_observed_is_groupbuy),
    revisitWithin7d: Boolean(row.revisit_within_7d),
    revisitWithin30d: Boolean(row.revisit_within_30d),
    cardOpenedWithin7d: Boolean(row.card_opened_within_7d),
    storedValueConvertedWithin7d: Boolean(row.stored_value_converted_within_7d),
    memberPayConvertedWithin30d: Boolean(row.member_pay_converted_within_30d),
    visitCount30dAfterGroupbuy: normalizeNumeric(row.visit_count_30d_after_groupbuy),
    payAmount30dAfterGroupbuy: normalizeNumeric(row.pay_amount_30d_after_groupbuy),
    memberPayAmount30dAfterGroupbuy: normalizeNumeric(
      row.member_pay_amount_30d_after_groupbuy,
    ),
    highValueMemberWithin30d: Boolean(row.high_value_member_within_30d),
    rawJson: String(row.cohort_json),
  };
}

function mapMemberReactivationFeatureRow(
  orgId: string,
  row: Record<string, unknown>,
): MemberReactivationFeatureRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    memberId: String(row.member_id),
    customerIdentityKey: String(row.customer_identity_key),
    customerDisplayName: String(row.customer_display_name),
    memberCardNo: (row.member_card_no as string | null) ?? undefined,
    referenceCode: (row.reference_code as string | null) ?? undefined,
    primarySegment: String(row.primary_segment) as MemberReactivationFeatureRecord["primarySegment"],
    daysSinceLastVisit: normalizeNumeric(row.days_since_last_visit),
    visitCount30d: normalizeNumeric(row.visit_count_30d),
    visitCount90d: normalizeNumeric(row.visit_count_90d),
    payAmount30d: normalizeNumeric(row.pay_amount_30d),
    payAmount90d: normalizeNumeric(row.pay_amount_90d),
    memberPayAmount30d: normalizeNumeric(row.member_pay_amount_30d),
    memberPayAmount90d: normalizeNumeric(row.member_pay_amount_90d),
    rechargeTotal30d: normalizeNumeric(row.recharge_total_30d),
    rechargeTotal90d: normalizeNumeric(row.recharge_total_90d),
    rechargeCount30d: normalizeNumeric(row.recharge_count_30d),
    rechargeCount90d: normalizeNumeric(row.recharge_count_90d),
    daysSinceLastRecharge:
      row.days_since_last_recharge === null || row.days_since_last_recharge === undefined
        ? null
        : normalizeNumeric(row.days_since_last_recharge),
    currentStoredBalanceInferred: normalizeNumeric(row.current_stored_balance_inferred),
    storedBalance7dAgo:
      row.stored_balance_7d_ago === null || row.stored_balance_7d_ago === undefined
        ? null
        : normalizeNumeric(row.stored_balance_7d_ago),
    storedBalance30dAgo:
      row.stored_balance_30d_ago === null || row.stored_balance_30d_ago === undefined
        ? null
        : normalizeNumeric(row.stored_balance_30d_ago),
    storedBalance90dAgo:
      row.stored_balance_90d_ago === null || row.stored_balance_90d_ago === undefined
        ? null
        : normalizeNumeric(row.stored_balance_90d_ago),
    storedBalanceDelta7d:
      row.stored_balance_delta_7d === null || row.stored_balance_delta_7d === undefined
        ? null
        : normalizeNumeric(row.stored_balance_delta_7d),
    storedBalanceDelta30d:
      row.stored_balance_delta_30d === null || row.stored_balance_delta_30d === undefined
        ? null
        : normalizeNumeric(row.stored_balance_delta_30d),
    storedBalanceDelta90d:
      row.stored_balance_delta_90d === null || row.stored_balance_delta_90d === undefined
        ? null
        : normalizeNumeric(row.stored_balance_delta_90d),
    depletionVelocity30d:
      row.depletion_velocity_30d === null || row.depletion_velocity_30d === undefined
        ? null
        : normalizeNumeric(row.depletion_velocity_30d),
    projectedBalanceDaysLeft:
      row.projected_balance_days_left === null || row.projected_balance_days_left === undefined
        ? null
        : normalizeNumeric(row.projected_balance_days_left),
    rechargeToMemberPayRatio90d:
      row.recharge_to_member_pay_ratio_90d === null ||
      row.recharge_to_member_pay_ratio_90d === undefined
        ? null
        : normalizeNumeric(row.recharge_to_member_pay_ratio_90d),
    dominantVisitDaypart:
      (row.dominant_visit_daypart as string | null) ?? null,
    preferredDaypartShare90d:
      row.preferred_daypart_share_90d === null || row.preferred_daypart_share_90d === undefined
        ? null
        : normalizeNumeric(row.preferred_daypart_share_90d),
    dominantVisitWeekday:
      (row.dominant_visit_weekday as string | null) ?? null,
    preferredWeekdayShare90d:
      row.preferred_weekday_share_90d === null || row.preferred_weekday_share_90d === undefined
        ? null
        : normalizeNumeric(row.preferred_weekday_share_90d),
    dominantVisitMonthPhase:
      (row.dominant_visit_month_phase as string | null) ?? null,
    preferredMonthPhaseShare90d:
      row.preferred_month_phase_share_90d === null ||
      row.preferred_month_phase_share_90d === undefined
        ? null
        : normalizeNumeric(row.preferred_month_phase_share_90d),
    weekendVisitShare90d:
      row.weekend_visit_share_90d === null || row.weekend_visit_share_90d === undefined
        ? null
        : normalizeNumeric(row.weekend_visit_share_90d),
    lateNightVisitShare90d:
      row.late_night_visit_share_90d === null || row.late_night_visit_share_90d === undefined
        ? null
        : normalizeNumeric(row.late_night_visit_share_90d),
    overnightVisitShare90d:
      row.overnight_visit_share_90d === null || row.overnight_visit_share_90d === undefined
        ? null
        : normalizeNumeric(row.overnight_visit_share_90d),
    averageVisitGapDays90d:
      row.average_visit_gap_days_90d === null || row.average_visit_gap_days_90d === undefined
        ? null
        : normalizeNumeric(row.average_visit_gap_days_90d),
    visitGapStddevDays90d:
      row.visit_gap_stddev_days_90d === null || row.visit_gap_stddev_days_90d === undefined
        ? null
        : normalizeNumeric(row.visit_gap_stddev_days_90d),
    cycleDeviationScore:
      row.cycle_deviation_score === null || row.cycle_deviation_score === undefined
        ? null
        : normalizeNumeric(row.cycle_deviation_score),
    timePreferenceConfidenceScore: normalizeNumeric(row.time_preference_confidence_score ?? 0),
    trajectoryConfidenceScore: normalizeNumeric(row.trajectory_confidence_score),
    reactivationPriorityScore: normalizeNumeric(row.reactivation_priority_score),
    featureJson: String(row.feature_json),
  };
}

function mapMemberReactivationStrategyRow(
  orgId: string,
  row: Record<string, unknown>,
): MemberReactivationStrategyRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    memberId: String(row.member_id),
    customerIdentityKey: String(row.customer_identity_key),
    customerDisplayName: String(row.customer_display_name),
    primarySegment: String(
      row.primary_segment,
    ) as MemberReactivationStrategyRecord["primarySegment"],
    reactivationPriorityScore: normalizeNumeric(row.reactivation_priority_score),
    churnRiskScore: normalizeNumeric(row.churn_risk_score),
    churnRiskLabel: String(
      row.churn_risk_label,
    ) as MemberReactivationStrategyRecord["churnRiskLabel"],
    revisitProbability7d: normalizeNumeric(row.revisit_probability_7d),
    revisitWindowLabel: String(
      row.revisit_window_label,
    ) as MemberReactivationStrategyRecord["revisitWindowLabel"],
    recommendedTouchWeekday:
      (row.recommended_touch_weekday as string | null) ?? null,
    recommendedTouchDaypart:
      (row.recommended_touch_daypart as string | null) ?? null,
    touchWindowMatchScore: normalizeNumeric(row.touch_window_match_score),
    touchWindowLabel: String(
      row.touch_window_label,
    ) as MemberReactivationStrategyRecord["touchWindowLabel"],
    lifecycleMomentumScore: normalizeNumeric(row.lifecycle_momentum_score),
    lifecycleMomentumLabel: String(
      row.lifecycle_momentum_label,
    ) as MemberReactivationStrategyRecord["lifecycleMomentumLabel"],
    recommendedActionLabel: String(
      row.recommended_action_label,
    ) as MemberReactivationStrategyRecord["recommendedActionLabel"],
    strategyPriorityScore: normalizeNumeric(row.strategy_priority_score),
    strategyJson: String(row.strategy_json),
  };
}

function mapMemberReactivationQueueRow(
  orgId: string,
  row: Record<string, unknown>,
): MemberReactivationQueueRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    memberId: String(row.member_id),
    customerIdentityKey: String(row.customer_identity_key),
    customerDisplayName: String(row.customer_display_name),
    memberCardNo: (row.member_card_no as string | null) ?? undefined,
    referenceCode: (row.reference_code as string | null) ?? undefined,
    primarySegment: String(
      row.primary_segment,
    ) as MemberReactivationQueueRecord["primarySegment"],
    followupBucket: String(
      row.followup_bucket,
    ) as MemberReactivationQueueRecord["followupBucket"],
    reactivationPriorityScore: normalizeNumeric(row.reactivation_priority_score),
    strategyPriorityScore: normalizeNumeric(row.strategy_priority_score),
    executionPriorityScore:
      row.execution_priority_score === null || row.execution_priority_score === undefined
        ? normalizeNumeric(row.strategy_priority_score)
        : normalizeNumeric(row.execution_priority_score),
    priorityBand: String(row.priority_band) as MemberReactivationQueueRecord["priorityBand"],
    priorityRank: normalizeNumeric(row.priority_rank),
    churnRiskLabel: String(
      row.churn_risk_label,
    ) as MemberReactivationQueueRecord["churnRiskLabel"],
    churnRiskScore: normalizeNumeric(row.churn_risk_score),
    revisitWindowLabel: String(
      row.revisit_window_label,
    ) as MemberReactivationQueueRecord["revisitWindowLabel"],
    recommendedActionLabel: String(
      row.recommended_action_label,
    ) as MemberReactivationQueueRecord["recommendedActionLabel"],
    recommendedTouchWeekday: (row.recommended_touch_weekday as string | null) ?? null,
    recommendedTouchDaypart: (row.recommended_touch_daypart as string | null) ?? null,
    touchWindowLabel: String(
      row.touch_window_label,
    ) as MemberReactivationQueueRecord["touchWindowLabel"],
    reasonSummary: String(row.reason_summary),
    touchAdviceSummary: String(row.touch_advice_summary),
    daysSinceLastVisit: normalizeNumeric(row.days_since_last_visit),
    visitCount90d: normalizeNumeric(row.visit_count_90d),
    payAmount90d: normalizeNumeric(row.pay_amount_90d),
    currentStoredBalanceInferred: normalizeNumeric(row.current_stored_balance_inferred),
    projectedBalanceDaysLeft:
      row.projected_balance_days_left === null || row.projected_balance_days_left === undefined
        ? null
        : normalizeNumeric(row.projected_balance_days_left),
    birthdayMonthDay: (row.birthday_month_day as string | null) ?? null,
    nextBirthdayBizDate: (row.next_birthday_biz_date as string | null) ?? null,
    birthdayWindowDays:
      row.birthday_window_days === null || row.birthday_window_days === undefined
        ? null
        : normalizeNumeric(row.birthday_window_days),
    birthdayBoostScore:
      row.birthday_boost_score === null || row.birthday_boost_score === undefined
        ? 0
        : normalizeNumeric(row.birthday_boost_score),
    topTechName: (row.top_tech_name as string | null) ?? null,
    queueJson: String(row.queue_json),
    updatedAt: String(row.updated_at),
  };
}

function mapMemberReactivationFeedbackRow(
  orgId: string,
  row: Record<string, unknown>,
): MemberReactivationFeedbackRecord {
  return {
    orgId,
    bizDate: String(row.biz_date),
    memberId: String(row.member_id),
    feedbackStatus: String(
      row.feedback_status,
    ) as MemberReactivationFeedbackRecord["feedbackStatus"],
    followedBy: (row.followed_by as string | null) ?? undefined,
    followedAt: (row.followed_at as string | null) ?? undefined,
    contacted: Boolean(row.contacted),
    replied: Boolean(row.replied),
    booked: Boolean(row.booked),
    arrived: Boolean(row.arrived),
    note: (row.note as string | null) ?? undefined,
    updatedAt: String(row.updated_at),
  };
}

function parseSourceConfigs(rawValue: unknown): HetangExternalSourceConfig[] {
  if (typeof rawValue !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
      .map((entry, index) => ({
        sourceId: typeof entry.sourceId === "string" ? entry.sourceId : `source-${index + 1}`,
        displayName: typeof entry.displayName === "string" ? entry.displayName : undefined,
        tier:
          entry.tier === "s" || entry.tier === "a" || entry.tier === "b" || entry.tier === "blocked"
            ? entry.tier
            : "b",
        url: typeof entry.url === "string" ? entry.url : undefined,
        notes: typeof entry.notes === "string" ? entry.notes : undefined,
      }));
  } catch {
    return [];
  }
}

function resolveStrongestSourceTier(
  sources: HetangExternalSourceConfig[],
  fallback?: HetangExternalSourceTier,
): HetangExternalSourceTier {
  const tierRank: Record<HetangExternalSourceTier, number> = {
    s: 0,
    a: 1,
    b: 2,
    blocked: 3,
  };
  if (sources.length === 0) {
    return fallback ?? "b";
  }
  return sources.reduce(
    (best, current) => (tierRank[current.tier] < tierRank[best] ? current.tier : best),
    fallback ?? sources[0]!.tier,
  );
}

export class HetangOpsStore {
  private initialized = false;
  private initializingPromise: Promise<void> | null = null;
  private analyticsViewMode: "materialized" | "plain" = "materialized";
  private analyticsPublicationDirty = false;
  private readonly advisoryLockClients = new Map<number, { client: PoolClient; refCount: number }>();
  private readonly rawIngestionStore: HetangRawIngestionStore;
  private readonly martDerivedStore: HetangMartDerivedStore;
  private readonly queueAccessControlStore: HetangQueueAccessControlStore;
  private readonly servingPublicationStore: HetangServingPublicationStore;

  constructor(
    private readonly params: {
      pool: Pool;
      stores: StoreSeed[];
      deadLetterEnabled?: boolean;
    },
  ) {
    this.rawIngestionStore = new HetangRawIngestionStore(this as unknown as any);
    this.martDerivedStore = new HetangMartDerivedStore(this as unknown as any);
    this.queueAccessControlStore = new HetangQueueAccessControlStore(this as unknown as any);
    this.servingPublicationStore = new HetangServingPublicationStore({
      queryable: this.params.pool,
      requiredRelations: REQUIRED_ANALYTICS_VIEWS,
      isInitialized: () => this.initialized,
      isMaterialized: () => this.analyticsViewMode === "materialized",
      isDirty: () => this.analyticsPublicationDirty,
      markClean: () => {
        this.analyticsPublicationDirty = false;
      },
      rebuildAnalyticsViews: async () => {
        await this.rebuildAnalyticsViews();
      },
    });
  }

  getRawIngestionStore(): HetangRawIngestionStore {
    return this.rawIngestionStore;
  }

  getMartDerivedStore(): HetangMartDerivedStore {
    return this.martDerivedStore;
  }

  getQueueAccessControlStore(): HetangQueueAccessControlStore {
    return this.queueAccessControlStore;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initializingPromise) {
      await this.initializingPromise;
      return;
    }

    this.initializingPromise = this.initializeOnce();
    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = null;
    }
  }

  private async initializeOnce(): Promise<void> {
    await this.withInitializationLock(async () => {
      if (this.initialized) {
        return;
      }
      await this.params.pool.query(`
      CREATE TABLE IF NOT EXISTS dim_store (
        org_id TEXT PRIMARY KEY,
        store_name TEXT NOT NULL,
        raw_store_aliases_json TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE
      );

      CREATE TABLE IF NOT EXISTS sync_runs (
        sync_run_id TEXT PRIMARY KEY,
        org_id TEXT,
        mode TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        details_json TEXT
      );

      CREATE TABLE IF NOT EXISTS endpoint_watermarks (
        org_id TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        last_success_at TEXT NOT NULL,
        PRIMARY KEY (org_id, endpoint)
      );

      CREATE TABLE IF NOT EXISTS sync_errors (
        id SERIAL PRIMARY KEY,
        sync_run_id TEXT,
        org_id TEXT,
        endpoint TEXT,
        error_at TEXT NOT NULL,
        error_message TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_job_runs (
        job_type TEXT NOT NULL,
        run_key TEXT NOT NULL,
        ran_at TEXT NOT NULL,
        PRIMARY KEY (job_type, run_key)
      );

      CREATE TABLE IF NOT EXISTS scheduled_job_state (
        job_type TEXT NOT NULL,
        state_key TEXT NOT NULL,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (job_type, state_key)
      );

      CREATE TABLE IF NOT EXISTS employee_bindings (
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        employee_name TEXT,
        role TEXT NOT NULL,
        org_id TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        hourly_quota INTEGER,
        daily_quota INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, sender_id)
      );

      CREATE TABLE IF NOT EXISTS employee_binding_scopes (
        channel TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        org_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel, sender_id, org_id)
      );

      CREATE TABLE IF NOT EXISTS command_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        occurred_at TEXT NOT NULL,
        channel TEXT NOT NULL,
        sender_id TEXT,
        command_name TEXT NOT NULL,
        action TEXT NOT NULL,
        requested_org_id TEXT,
        effective_org_id TEXT,
        decision TEXT NOT NULL,
        consume_quota BOOLEAN NOT NULL DEFAULT TRUE,
        reason TEXT NOT NULL,
        command_body TEXT NOT NULL,
        response_excerpt TEXT
      );

      CREATE TABLE IF NOT EXISTS inbound_message_audit_logs (
        id BIGSERIAL PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        channel TEXT NOT NULL,
        account_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        conversation_id TEXT,
        thread_id TEXT,
        is_group BOOLEAN NOT NULL DEFAULT FALSE,
        was_mentioned BOOLEAN,
        platform_message_id TEXT,
        content TEXT NOT NULL,
        effective_content TEXT,
        received_at TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS action_center_items (
        action_id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        biz_date TEXT,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        priority TEXT NOT NULL,
        status TEXT NOT NULL,
        source_kind TEXT NOT NULL,
        source_ref TEXT,
        owner_name TEXT,
        due_date TEXT,
        result_note TEXT,
        effect_score DOUBLE PRECISION,
        created_by_channel TEXT,
        created_by_sender_id TEXT,
        created_by_name TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS control_tower_settings (
        scope_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        updated_by TEXT,
        PRIMARY KEY (scope_type, scope_key, setting_key)
      );

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        job_id TEXT PRIMARY KEY,
        job_type TEXT NOT NULL,
        capability_id TEXT,
        org_id TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        time_frame_label TEXT NOT NULL,
        start_biz_date TEXT NOT NULL,
        end_biz_date TEXT NOT NULL,
        channel TEXT NOT NULL,
        target TEXT NOT NULL,
        account_id TEXT,
        thread_id TEXT,
        sender_id TEXT,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        result_text TEXT,
        error_message TEXT,
        delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
        last_delivery_attempt_at TEXT,
        last_delivery_error TEXT,
        next_delivery_after TEXT,
        delivery_abandoned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        delivered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS analysis_job_subscribers (
        subscriber_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        channel TEXT NOT NULL,
        target TEXT NOT NULL,
        account_id TEXT,
        thread_id TEXT,
        sender_id TEXT,
        delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
        last_delivery_attempt_at TEXT,
        last_delivery_error TEXT,
        next_delivery_after TEXT,
        delivery_abandoned_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        delivered_at TEXT
      );

      CREATE TABLE IF NOT EXISTS analysis_dead_letters (
        dead_letter_key TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        subscriber_key TEXT,
        org_id TEXT NOT NULL,
        dead_letter_scope TEXT NOT NULL,
        reason TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS raw_api_batches (
        batch_id TEXT PRIMARY KEY,
        sync_run_id TEXT,
        endpoint TEXT NOT NULL,
        org_id TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        request_json TEXT,
        response_json TEXT
      );

      CREATE TABLE IF NOT EXISTS raw_api_rows (
        endpoint TEXT NOT NULL,
        org_id TEXT NOT NULL,
        row_key TEXT NOT NULL,
        row_fingerprint TEXT NOT NULL,
        batch_id TEXT NOT NULL,
        raw_store_name TEXT,
        source_time TEXT,
        row_json TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (endpoint, org_id, row_key)
      );

      CREATE TABLE IF NOT EXISTS fact_member_current (
        org_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        stored_amount DOUBLE PRECISION NOT NULL,
        consume_amount DOUBLE PRECISION NOT NULL,
        created_time TEXT,
        last_consume_time TEXT,
        silent_days INTEGER NOT NULL,
        raw_store_name TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS fact_member_daily_snapshot (
        biz_date TEXT NOT NULL,
        org_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        name TEXT NOT NULL,
        stored_amount DOUBLE PRECISION NOT NULL,
        consume_amount DOUBLE PRECISION NOT NULL,
        last_consume_time TEXT,
        silent_days INTEGER NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (biz_date, org_id, member_id)
      );

      CREATE TABLE IF NOT EXISTS fact_member_cards_current (
        org_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        card_no TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, card_id)
      );

      CREATE TABLE IF NOT EXISTS fact_member_cards_daily_snapshot (
        biz_date TEXT NOT NULL,
        org_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        card_no TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (biz_date, org_id, card_id)
      );

      CREATE TABLE IF NOT EXISTS fact_consume_bills (
        org_id TEXT NOT NULL,
        settle_id TEXT NOT NULL,
        settle_no TEXT,
        pay_amount DOUBLE PRECISION NOT NULL,
        consume_amount DOUBLE PRECISION NOT NULL,
        discount_amount DOUBLE PRECISION NOT NULL,
        anti_flag BOOLEAN NOT NULL,
        opt_time TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, settle_id)
      );

      CREATE TABLE IF NOT EXISTS fact_recharge_bills (
        org_id TEXT NOT NULL,
        recharge_id TEXT NOT NULL,
        reality_amount DOUBLE PRECISION NOT NULL,
        total_amount DOUBLE PRECISION NOT NULL,
        donate_amount DOUBLE PRECISION NOT NULL,
        anti_flag BOOLEAN NOT NULL,
        opt_time TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, recharge_id)
      );

      CREATE TABLE IF NOT EXISTS fact_user_trades (
        org_id TEXT NOT NULL,
        row_fingerprint TEXT NOT NULL,
        trade_no TEXT,
        opt_time TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        card_opt_type TEXT,
        change_balance DOUBLE PRECISION NOT NULL,
        change_reality DOUBLE PRECISION NOT NULL,
        change_donate DOUBLE PRECISION NOT NULL,
        change_integral DOUBLE PRECISION NOT NULL,
        payment_type TEXT,
        anti_flag BOOLEAN NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, row_fingerprint)
      );

      CREATE TABLE IF NOT EXISTS dim_tech_current (
        org_id TEXT NOT NULL,
        tech_code TEXT NOT NULL,
        tech_name TEXT NOT NULL,
        is_work BOOLEAN NOT NULL,
        is_job BOOLEAN NOT NULL,
        point_clock_num DOUBLE PRECISION NOT NULL,
        wheel_clock_num DOUBLE PRECISION NOT NULL,
        base_wages DOUBLE PRECISION NOT NULL,
        raw_store_name TEXT,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, tech_code)
      );

      CREATE TABLE IF NOT EXISTS fact_tech_daily_snapshot (
        biz_date TEXT NOT NULL,
        org_id TEXT NOT NULL,
        tech_code TEXT NOT NULL,
        tech_name TEXT NOT NULL,
        is_work BOOLEAN NOT NULL,
        is_job BOOLEAN NOT NULL,
        point_clock_num DOUBLE PRECISION NOT NULL,
        wheel_clock_num DOUBLE PRECISION NOT NULL,
        base_wages DOUBLE PRECISION NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (biz_date, org_id, tech_code)
      );

      CREATE TABLE IF NOT EXISTS fact_tech_up_clock (
        org_id TEXT NOT NULL,
        row_fingerprint TEXT NOT NULL,
        person_code TEXT NOT NULL,
        person_name TEXT NOT NULL,
        settle_no TEXT,
        hand_card_code TEXT,
        item_name TEXT,
        clock_type TEXT,
        count DOUBLE PRECISION NOT NULL,
        turnover DOUBLE PRECISION NOT NULL,
        comm DOUBLE PRECISION NOT NULL,
        ctime TEXT,
        settle_time TEXT,
        biz_date TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, row_fingerprint)
      );

      CREATE TABLE IF NOT EXISTS fact_tech_market (
        org_id TEXT NOT NULL,
        record_key TEXT NOT NULL,
        market_id TEXT,
        settle_no TEXT,
        hand_card_code TEXT,
        room_code TEXT,
        person_code TEXT,
        person_name TEXT,
        item_id TEXT,
        item_name TEXT,
        item_type_name TEXT,
        item_category DOUBLE PRECISION,
        sales_code TEXT,
        sales_name TEXT,
        count DOUBLE PRECISION NOT NULL,
        after_disc DOUBLE PRECISION NOT NULL,
        commission DOUBLE PRECISION NOT NULL,
        settle_time TEXT,
        biz_date TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (org_id, record_key)
      );

      CREATE TABLE IF NOT EXISTS fact_tech_commission_snapshot (
        biz_date TEXT NOT NULL,
        org_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        item_name TEXT,
        rule_hash TEXT NOT NULL,
        raw_json TEXT NOT NULL,
        PRIMARY KEY (biz_date, org_id, item_id, rule_hash)
      );

      CREATE TABLE IF NOT EXISTS mart_daily_store_metrics (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        metrics_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date)
      );

      CREATE TABLE IF NOT EXISTS mart_daily_store_alerts (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        alert_code TEXT NOT NULL,
        severity TEXT NOT NULL,
        message TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, alert_code)
      );

      CREATE TABLE IF NOT EXISTS mart_daily_store_reports (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        store_name TEXT NOT NULL,
        complete BOOLEAN NOT NULL,
        markdown TEXT NOT NULL,
        report_json TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        sent_at TEXT,
        send_status TEXT,
        PRIMARY KEY (org_id, biz_date)
      );

      CREATE TABLE IF NOT EXISTS serving_manifest (
        serving_version TEXT PRIMARY KEY,
        published_at TEXT NOT NULL,
        notes TEXT
      );

      CREATE TABLE IF NOT EXISTS mart_customer_tech_links (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        settle_id TEXT NOT NULL,
        settle_no TEXT,
        customer_identity_key TEXT NOT NULL,
        customer_identity_type TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        member_id TEXT,
        member_card_no TEXT,
        reference_code TEXT,
        member_label TEXT,
        identity_stable BOOLEAN NOT NULL,
        tech_code TEXT NOT NULL,
        tech_name TEXT NOT NULL,
        customer_count_in_settle INTEGER NOT NULL,
        tech_count_in_settle INTEGER NOT NULL,
        tech_turnover DOUBLE PRECISION NOT NULL,
        tech_commission DOUBLE PRECISION NOT NULL,
        order_pay_amount DOUBLE PRECISION NOT NULL,
        order_consume_amount DOUBLE PRECISION NOT NULL,
        item_names_json TEXT NOT NULL,
        link_confidence TEXT NOT NULL,
        link_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, settle_id, customer_identity_key, tech_code)
      );

      CREATE TABLE IF NOT EXISTS mart_customer_segments (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        customer_identity_key TEXT NOT NULL,
        customer_identity_type TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        member_id TEXT,
        member_card_no TEXT,
        reference_code TEXT,
        member_label TEXT,
        identity_stable BOOLEAN NOT NULL,
        segment_eligible BOOLEAN NOT NULL,
        first_biz_date TEXT,
        last_biz_date TEXT,
        days_since_last_visit INTEGER NOT NULL,
        visit_count_30d INTEGER NOT NULL,
        visit_count_90d INTEGER NOT NULL,
        pay_amount_30d DOUBLE PRECISION NOT NULL,
        pay_amount_90d DOUBLE PRECISION NOT NULL,
        member_pay_amount_90d DOUBLE PRECISION NOT NULL,
        groupbuy_amount_90d DOUBLE PRECISION NOT NULL,
        direct_pay_amount_90d DOUBLE PRECISION NOT NULL,
        distinct_tech_count_90d INTEGER NOT NULL,
        top_tech_code TEXT,
        top_tech_name TEXT,
        top_tech_visit_count_90d INTEGER NOT NULL,
        top_tech_visit_share_90d DOUBLE PRECISION,
        recency_segment TEXT NOT NULL,
        frequency_segment TEXT NOT NULL,
        monetary_segment TEXT NOT NULL,
        payment_segment TEXT NOT NULL,
        tech_loyalty_segment TEXT NOT NULL,
        primary_segment TEXT NOT NULL,
        tag_keys_json TEXT NOT NULL,
        segment_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, customer_identity_key)
      );

      CREATE TABLE IF NOT EXISTS mart_customer_conversion_cohorts (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        customer_identity_key TEXT NOT NULL,
        customer_identity_type TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        member_id TEXT,
        member_card_no TEXT,
        reference_code TEXT,
        identity_stable BOOLEAN NOT NULL,
        first_groupbuy_biz_date TEXT,
        first_groupbuy_opt_time TEXT,
        first_groupbuy_settle_id TEXT,
        first_groupbuy_settle_no TEXT,
        first_groupbuy_amount DOUBLE PRECISION NOT NULL,
        first_observed_biz_date TEXT,
        last_observed_biz_date TEXT,
        first_observed_is_groupbuy BOOLEAN NOT NULL,
        revisit_within_7d BOOLEAN NOT NULL,
        revisit_within_30d BOOLEAN NOT NULL,
        card_opened_within_7d BOOLEAN NOT NULL,
        stored_value_converted_within_7d BOOLEAN NOT NULL,
        member_pay_converted_within_30d BOOLEAN NOT NULL,
        visit_count_30d_after_groupbuy INTEGER NOT NULL,
        pay_amount_30d_after_groupbuy DOUBLE PRECISION NOT NULL,
        member_pay_amount_30d_after_groupbuy DOUBLE PRECISION NOT NULL,
        high_value_member_within_30d BOOLEAN NOT NULL,
        cohort_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, customer_identity_key)
      );

      CREATE TABLE IF NOT EXISTS mart_member_reactivation_features_daily (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        member_id TEXT NOT NULL,
        customer_identity_key TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        member_card_no TEXT,
        reference_code TEXT,
        primary_segment TEXT NOT NULL,
        days_since_last_visit INTEGER NOT NULL,
        visit_count_30d INTEGER NOT NULL,
        visit_count_90d INTEGER NOT NULL,
        pay_amount_30d DOUBLE PRECISION NOT NULL,
        pay_amount_90d DOUBLE PRECISION NOT NULL,
        member_pay_amount_30d DOUBLE PRECISION NOT NULL,
        member_pay_amount_90d DOUBLE PRECISION NOT NULL,
        recharge_total_30d DOUBLE PRECISION NOT NULL,
        recharge_total_90d DOUBLE PRECISION NOT NULL,
        recharge_count_30d INTEGER NOT NULL,
        recharge_count_90d INTEGER NOT NULL,
        days_since_last_recharge INTEGER,
        current_stored_balance_inferred DOUBLE PRECISION NOT NULL,
        stored_balance_7d_ago DOUBLE PRECISION,
        stored_balance_30d_ago DOUBLE PRECISION,
        stored_balance_90d_ago DOUBLE PRECISION,
        stored_balance_delta_7d DOUBLE PRECISION,
        stored_balance_delta_30d DOUBLE PRECISION,
        stored_balance_delta_90d DOUBLE PRECISION,
        depletion_velocity_30d DOUBLE PRECISION,
        projected_balance_days_left DOUBLE PRECISION,
        recharge_to_member_pay_ratio_90d DOUBLE PRECISION,
        dominant_visit_daypart TEXT,
        preferred_daypart_share_90d DOUBLE PRECISION,
        dominant_visit_weekday TEXT,
        preferred_weekday_share_90d DOUBLE PRECISION,
        dominant_visit_month_phase TEXT,
        preferred_month_phase_share_90d DOUBLE PRECISION,
        weekend_visit_share_90d DOUBLE PRECISION,
        late_night_visit_share_90d DOUBLE PRECISION,
        overnight_visit_share_90d DOUBLE PRECISION,
        average_visit_gap_days_90d DOUBLE PRECISION,
        visit_gap_stddev_days_90d DOUBLE PRECISION,
        cycle_deviation_score DOUBLE PRECISION,
        time_preference_confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        trajectory_confidence_score DOUBLE PRECISION NOT NULL,
        reactivation_priority_score DOUBLE PRECISION NOT NULL,
        feature_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, member_id)
      );

      CREATE TABLE IF NOT EXISTS mart_member_reactivation_strategies_daily (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        member_id TEXT NOT NULL,
        customer_identity_key TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        primary_segment TEXT NOT NULL,
        reactivation_priority_score DOUBLE PRECISION NOT NULL,
        churn_risk_score DOUBLE PRECISION NOT NULL,
        churn_risk_label TEXT NOT NULL,
        revisit_probability_7d DOUBLE PRECISION NOT NULL,
        revisit_window_label TEXT NOT NULL,
        recommended_touch_weekday TEXT,
        recommended_touch_daypart TEXT,
        touch_window_match_score DOUBLE PRECISION NOT NULL,
        touch_window_label TEXT NOT NULL,
        lifecycle_momentum_score DOUBLE PRECISION NOT NULL,
        lifecycle_momentum_label TEXT NOT NULL,
        recommended_action_label TEXT NOT NULL,
        strategy_priority_score DOUBLE PRECISION NOT NULL,
        strategy_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, member_id)
      );

      CREATE TABLE IF NOT EXISTS mart_member_reactivation_queue_daily (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        member_id TEXT NOT NULL,
        customer_identity_key TEXT NOT NULL,
        customer_display_name TEXT NOT NULL,
        member_card_no TEXT,
        reference_code TEXT,
        primary_segment TEXT NOT NULL,
        followup_bucket TEXT NOT NULL,
        reactivation_priority_score DOUBLE PRECISION NOT NULL,
        strategy_priority_score DOUBLE PRECISION NOT NULL,
        execution_priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        priority_band TEXT NOT NULL,
        priority_rank INTEGER NOT NULL,
        churn_risk_label TEXT NOT NULL,
        churn_risk_score DOUBLE PRECISION NOT NULL,
        revisit_window_label TEXT NOT NULL,
        recommended_action_label TEXT NOT NULL,
        recommended_touch_weekday TEXT,
        recommended_touch_daypart TEXT,
        touch_window_label TEXT NOT NULL,
        reason_summary TEXT NOT NULL,
        touch_advice_summary TEXT NOT NULL,
        days_since_last_visit INTEGER NOT NULL,
        visit_count_90d INTEGER NOT NULL,
        pay_amount_90d DOUBLE PRECISION NOT NULL,
        current_stored_balance_inferred DOUBLE PRECISION NOT NULL,
        projected_balance_days_left DOUBLE PRECISION,
        birthday_month_day TEXT,
        next_birthday_biz_date TEXT,
        birthday_window_days INTEGER,
        birthday_boost_score DOUBLE PRECISION NOT NULL DEFAULT 0,
        top_tech_name TEXT,
        queue_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, member_id)
      );

      CREATE TABLE IF NOT EXISTS ops_member_reactivation_feedback (
        org_id TEXT NOT NULL,
        biz_date TEXT NOT NULL,
        member_id TEXT NOT NULL,
        feedback_status TEXT NOT NULL,
        followed_by TEXT,
        followed_at TEXT,
        contacted BOOLEAN NOT NULL DEFAULT FALSE,
        replied BOOLEAN NOT NULL DEFAULT FALSE,
        booked BOOLEAN NOT NULL DEFAULT FALSE,
        arrived BOOLEAN NOT NULL DEFAULT FALSE,
        note TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (org_id, biz_date, member_id)
      );

      CREATE TABLE IF NOT EXISTS external_source_documents (
        document_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_tier TEXT NOT NULL,
        source_url TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content_text TEXT,
        entity TEXT,
        action TEXT,
        object_text TEXT,
        score DOUBLE PRECISION,
        published_at TEXT NOT NULL,
        event_at TEXT,
        fetched_at TEXT NOT NULL,
        theme TEXT,
        blocked_reason TEXT,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_event_candidates (
        candidate_id TEXT PRIMARY KEY,
        source_document_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_tier TEXT NOT NULL,
        source_url TEXT,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        object_text TEXT,
        theme TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        published_at TEXT NOT NULL,
        event_at TEXT,
        score DOUBLE PRECISION NOT NULL,
        blocked_reason TEXT,
        raw_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_event_cards (
        card_id TEXT PRIMARY KEY,
        issue_date TEXT NOT NULL,
        theme TEXT NOT NULL,
        entity TEXT NOT NULL,
        action TEXT NOT NULL,
        object_text TEXT,
        summary TEXT NOT NULL,
        published_at TEXT NOT NULL,
        event_at TEXT,
        score DOUBLE PRECISION NOT NULL,
        source_tier TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        source_urls_json TEXT NOT NULL,
        source_document_ids_json TEXT NOT NULL,
        candidate_ids_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_brief_issues (
        issue_id TEXT PRIMARY KEY,
        issue_date TEXT NOT NULL,
        topic TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS external_brief_items (
        issue_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        title TEXT NOT NULL,
        theme TEXT NOT NULL,
        summary TEXT NOT NULL,
        why_it_matters TEXT NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        rank_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (issue_id, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_api_rows_fingerprint
        ON raw_api_rows (row_fingerprint);
      CREATE INDEX IF NOT EXISTS idx_fact_consume_bills_biz_date
        ON fact_consume_bills (org_id, biz_date);
      CREATE INDEX IF NOT EXISTS idx_fact_recharge_bills_biz_date
        ON fact_recharge_bills (org_id, biz_date);
      CREATE INDEX IF NOT EXISTS idx_fact_user_trades_biz_date
        ON fact_user_trades (org_id, biz_date);
      CREATE INDEX IF NOT EXISTS idx_fact_tech_up_clock_biz_date
        ON fact_tech_up_clock (org_id, biz_date);
      CREATE INDEX IF NOT EXISTS idx_fact_tech_market_biz_date
        ON fact_tech_market (org_id, biz_date);
      CREATE INDEX IF NOT EXISTS idx_employee_bindings_role
        ON employee_bindings (channel, role, is_active);
      CREATE INDEX IF NOT EXISTS idx_employee_binding_scopes_sender
        ON employee_binding_scopes (channel, sender_id);
      CREATE INDEX IF NOT EXISTS idx_command_audit_logs_sender_time
        ON command_audit_logs (channel, sender_id, occurred_at);
      CREATE INDEX IF NOT EXISTS idx_inbound_message_audit_logs_sender_time
        ON inbound_message_audit_logs (channel, sender_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_inbound_message_audit_logs_conversation_time
        ON inbound_message_audit_logs (channel, conversation_id, received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_action_center_items_org_time
        ON action_center_items (org_id, updated_at DESC, action_id);
      CREATE INDEX IF NOT EXISTS idx_action_center_items_status
        ON action_center_items (org_id, status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_analysis_jobs_status_delivery
        ON analysis_jobs (status, delivered_at, updated_at DESC, job_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_job_subscribers_delivery
        ON analysis_job_subscribers (job_id, delivered_at, updated_at DESC, subscriber_key);
      CREATE INDEX IF NOT EXISTS idx_analysis_dead_letters_scope
        ON analysis_dead_letters (org_id, dead_letter_scope, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_mart_customer_tech_links_customer
        ON mart_customer_tech_links (org_id, biz_date, customer_identity_key);
      CREATE INDEX IF NOT EXISTS idx_mart_customer_tech_links_tech
        ON mart_customer_tech_links (org_id, biz_date, tech_code);
      CREATE INDEX IF NOT EXISTS idx_mart_customer_segments_primary
        ON mart_customer_segments (org_id, biz_date, primary_segment);
      CREATE INDEX IF NOT EXISTS idx_mart_customer_conversion_cohorts_groupbuy
        ON mart_customer_conversion_cohorts (org_id, biz_date, first_groupbuy_biz_date);
      CREATE INDEX IF NOT EXISTS idx_mart_member_reactivation_queue_priority
        ON mart_member_reactivation_queue_daily (org_id, biz_date, priority_rank, strategy_priority_score DESC);
      CREATE INDEX IF NOT EXISTS idx_mart_member_reactivation_queue_execution
        ON mart_member_reactivation_queue_daily (org_id, biz_date, execution_priority_score DESC, priority_rank);
      CREATE INDEX IF NOT EXISTS idx_mart_member_reactivation_queue_bucket
        ON mart_member_reactivation_queue_daily (org_id, biz_date, followup_bucket, priority_rank);
      CREATE INDEX IF NOT EXISTS idx_ops_member_reactivation_feedback_status
        ON ops_member_reactivation_feedback (org_id, biz_date, feedback_status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_external_source_documents_published
        ON external_source_documents (published_at DESC, source_tier, source_id);
      CREATE INDEX IF NOT EXISTS idx_external_source_documents_theme
        ON external_source_documents (theme, published_at DESC, document_id);
      CREATE INDEX IF NOT EXISTS idx_external_event_candidates_normalized
        ON external_event_candidates (normalized_key, theme, published_at DESC, candidate_id);
      CREATE INDEX IF NOT EXISTS idx_external_event_cards_issue_theme
        ON external_event_cards (issue_date, theme, published_at DESC, card_id);
      CREATE INDEX IF NOT EXISTS idx_external_brief_issues_date
        ON external_brief_issues (issue_date DESC, issue_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_external_brief_items_issue_rank
        ON external_brief_items (issue_id, rank_order);
    `);

    await this.params.pool.query(`
      ALTER TABLE mart_member_reactivation_queue_daily
        ADD COLUMN IF NOT EXISTS execution_priority_score DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE mart_member_reactivation_queue_daily
        ADD COLUMN IF NOT EXISTS birthday_month_day TEXT;
      ALTER TABLE mart_member_reactivation_queue_daily
        ADD COLUMN IF NOT EXISTS next_birthday_biz_date TEXT;
      ALTER TABLE mart_member_reactivation_queue_daily
        ADD COLUMN IF NOT EXISTS birthday_window_days INTEGER;
      ALTER TABLE mart_member_reactivation_queue_daily
        ADD COLUMN IF NOT EXISTS birthday_boost_score DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE command_audit_logs ADD COLUMN IF NOT EXISTS consume_quota BOOLEAN NOT NULL DEFAULT TRUE;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS capability_id TEXT;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS last_delivery_attempt_at TEXT;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS next_delivery_after TEXT;
      ALTER TABLE analysis_jobs ADD COLUMN IF NOT EXISTS delivery_abandoned_at TEXT;
      ALTER TABLE analysis_job_subscribers ADD COLUMN IF NOT EXISTS delivery_attempt_count INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE analysis_job_subscribers ADD COLUMN IF NOT EXISTS last_delivery_attempt_at TEXT;
      ALTER TABLE analysis_job_subscribers ADD COLUMN IF NOT EXISTS last_delivery_error TEXT;
      ALTER TABLE analysis_job_subscribers ADD COLUMN IF NOT EXISTS next_delivery_after TEXT;
      ALTER TABLE analysis_job_subscribers ADD COLUMN IF NOT EXISTS delivery_abandoned_at TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS settle_no TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS hand_card_code TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS room_code TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS item_type_name TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS item_category DOUBLE PRECISION;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS sales_code TEXT;
      ALTER TABLE fact_tech_market ADD COLUMN IF NOT EXISTS sales_name TEXT;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS dominant_visit_daypart TEXT;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS preferred_daypart_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS dominant_visit_weekday TEXT;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS preferred_weekday_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS dominant_visit_month_phase TEXT;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS preferred_month_phase_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS weekend_visit_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS late_night_visit_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS overnight_visit_share_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS average_visit_gap_days_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS visit_gap_stddev_days_90d DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS cycle_deviation_score DOUBLE PRECISION;
      ALTER TABLE mart_member_reactivation_features_daily ADD COLUMN IF NOT EXISTS time_preference_confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0;
      ALTER TABLE external_source_documents ADD COLUMN IF NOT EXISTS entity TEXT;
      ALTER TABLE external_source_documents ADD COLUMN IF NOT EXISTS action TEXT;
      ALTER TABLE external_source_documents ADD COLUMN IF NOT EXISTS object_text TEXT;
      ALTER TABLE external_source_documents ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION;
      ALTER TABLE external_event_cards ADD COLUMN IF NOT EXISTS sources_json TEXT;
    `);

    for (const store of this.params.stores) {
      await this.params.pool.query(
        `
          INSERT INTO dim_store (org_id, store_name, raw_store_aliases_json, is_active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT (org_id) DO UPDATE SET
            store_name = EXCLUDED.store_name,
            raw_store_aliases_json = EXCLUDED.raw_store_aliases_json,
            is_active = EXCLUDED.is_active
        `,
        [store.orgId, store.storeName, JSON.stringify(store.rawAliases ?? [])],
      );
    }
      await this.rebuildAnalyticsViews();
      this.initialized = true;
    });
  }

  private async withInitializationLock<T>(work: () => Promise<T>): Promise<T> {
    const locked = await this.acquireAdvisoryLock(STORE_INITIALIZATION_ADVISORY_LOCK_KEY);

    try {
      return await work();
    } finally {
      if (locked) {
        await this.releaseAdvisoryLock(STORE_INITIALIZATION_ADVISORY_LOCK_KEY);
      }
    }
  }

  async acquireAdvisoryLock(lockKey: number): Promise<boolean> {
    const existing = this.advisoryLockClients.get(lockKey);
    if (existing) {
      existing.refCount += 1;
      return true;
    }

    let client: PoolClient | null = null;
    try {
      client = await this.params.pool.connect();
      await client.query(`SELECT pg_advisory_lock($1::bigint)`, [lockKey]);
      this.advisoryLockClients.set(lockKey, {
        client,
        refCount: 1,
      });
      return true;
    } catch (error) {
      if (client) {
        client.release();
      }
      if (!isAdvisoryLockUnsupportedError(error)) {
        throw error;
      }
      return false;
    }
  }

  async tryAdvisoryLock(lockKey: number): Promise<boolean> {
    const existing = this.advisoryLockClients.get(lockKey);
    if (existing) {
      existing.refCount += 1;
      return true;
    }

    let client: PoolClient | null = null;
    try {
      client = await this.params.pool.connect();
      const result = await client.query(`SELECT pg_try_advisory_lock($1::bigint) AS locked`, [
        lockKey,
      ]);
      const locked = result.rows[0]?.locked !== false;
      if (!locked) {
        client.release();
        return false;
      }
      this.advisoryLockClients.set(lockKey, {
        client,
        refCount: 1,
      });
      return true;
    } catch (error) {
      if (client) {
        client.release();
      }
      if (!isAdvisoryLockUnsupportedError(error)) {
        throw error;
      }
      return true;
    }
  }

  async releaseAdvisoryLock(lockKey: number): Promise<void> {
    const existing = this.advisoryLockClients.get(lockKey);
    if (existing) {
      if (existing.refCount > 1) {
        existing.refCount -= 1;
        return;
      }
      this.advisoryLockClients.delete(lockKey);
      try {
        await existing.client.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey]);
      } catch (error) {
        if (!isAdvisoryLockUnsupportedError(error)) {
          throw error;
        }
      } finally {
        existing.client.release();
      }
      return;
    }

    try {
      await this.params.pool.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey]);
    } catch (error) {
      if (!isAdvisoryLockUnsupportedError(error)) {
        throw error;
      }
    }
  }

  private async rebuildAnalyticsViews(): Promise<void> {
    try {
      await this.rebuildAnalyticsViewsForMode("materialized");
      this.analyticsViewMode = "materialized";
    } catch (error) {
      if (isDropRelationSyntaxUnsupportedError(error) && (this.initialized || this.analyticsViewMode === "materialized")) {
        await this.refreshAnalyticsViews();
        this.analyticsViewMode = "materialized";
        return;
      }
      if (!isMaterializedViewUnsupportedError(error)) {
        throw error;
      }
      await this.rebuildAnalyticsViewsForMode("plain");
      this.analyticsViewMode = "plain";
    }
  }

  private async dropAnalyticsRelationIfExists(name: string): Promise<void> {
    assertSafeTableName(name);
    if (!(await this.relationExists(name))) {
      return;
    }
    try {
      await this.params.pool.query(`DROP VIEW ${name}`);
      return;
    } catch (error) {
      if (isMissingRelationError(error)) {
        return;
      }
      if (!isWrongDropRelationTypeError(error, "view")) {
        throw error;
      }
    }

    try {
      await this.params.pool.query(`DROP MATERIALIZED VIEW ${name}`);
    } catch (error) {
      if (isMissingRelationError(error)) {
        return;
      }
      if (!isWrongDropRelationTypeError(error, "materialized view")) {
        throw error;
      }
    }
  }

  private async rebuildAnalyticsViewsForMode(mode: "materialized" | "plain"): Promise<void> {
    const relationKeyword = mode === "materialized" ? "MATERIALIZED VIEW" : "OR REPLACE VIEW";

    for (const relation of ANALYTICS_REBUILD_DROP_ORDER) {
      await this.dropAnalyticsRelationIfExists(relation);
    }

    await this.params.pool.query(`
      CREATE ${relationKeyword} mv_store_manager_daily_kpi AS
      WITH consume_daily AS (
        SELECT
          org_id,
          biz_date,
          SUM(CASE WHEN anti_flag IS FALSE THEN pay_amount ELSE 0 END) AS daily_actual_revenue,
          SUM(CASE WHEN anti_flag IS FALSE THEN consume_amount - pay_amount ELSE 0 END) AS daily_card_consume,
          COUNT(DISTINCT CASE WHEN anti_flag IS FALSE THEN settle_no END) AS daily_order_count
        FROM fact_consume_bills
        GROUP BY org_id, biz_date
      ),
      tech_daily AS (
        SELECT
          org_id,
          biz_date,
          SUM(count) AS total_clocks,
          SUM(CASE WHEN clock_type = '点钟' THEN count ELSE 0 END) AS assign_clocks,
          SUM(CASE WHEN clock_type = '排钟' THEN count ELSE 0 END) AS queue_clocks
        FROM fact_tech_up_clock
        GROUP BY org_id, biz_date
      ),
      daily_keys AS (
        SELECT org_id, biz_date FROM consume_daily
        UNION
        SELECT org_id, biz_date FROM tech_daily
      )
      SELECT
        daily_keys.biz_date AS biz_date,
        daily_keys.org_id AS org_id,
        COALESCE(dim_store.store_name, daily_keys.org_id) AS store_name,
        COALESCE(consume_daily.daily_actual_revenue, 0) AS daily_actual_revenue,
        COALESCE(consume_daily.daily_card_consume, 0) AS daily_card_consume,
        COALESCE(consume_daily.daily_order_count, 0) AS daily_order_count,
        COALESCE(tech_daily.total_clocks, 0) AS total_clocks,
        COALESCE(tech_daily.assign_clocks, 0) AS assign_clocks,
        COALESCE(tech_daily.queue_clocks, 0) AS queue_clocks,
        CASE
          WHEN COALESCE(tech_daily.total_clocks, 0) > 0
            THEN COALESCE(tech_daily.assign_clocks, 0) / tech_daily.total_clocks
          ELSE NULL
        END AS point_clock_rate,
        CASE
          WHEN COALESCE(consume_daily.daily_order_count, 0) > 0
            THEN COALESCE(consume_daily.daily_actual_revenue, 0) / consume_daily.daily_order_count
          ELSE NULL
        END AS average_ticket,
        CASE
          WHEN COALESCE(tech_daily.total_clocks, 0) > 0
            THEN COALESCE(consume_daily.daily_actual_revenue, 0) / tech_daily.total_clocks
          ELSE NULL
        END AS clock_effect
      FROM daily_keys
      LEFT JOIN consume_daily
        ON consume_daily.org_id = daily_keys.org_id
       AND consume_daily.biz_date = daily_keys.biz_date
      LEFT JOIN tech_daily
        ON tech_daily.org_id = daily_keys.org_id
       AND tech_daily.biz_date = daily_keys.biz_date
      LEFT JOIN dim_store
        ON dim_store.org_id = daily_keys.org_id;
    `);

    await this.params.pool.query(`
      CREATE ${relationKeyword} mv_tech_profile_30d AS
      WITH window_dates AS (
        SELECT DISTINCT
          source_dates.org_id,
          source_dates.biz_date AS window_end_biz_date,
          CAST(source_dates.biz_date AS DATE) AS window_end_date
        FROM (
          SELECT org_id, biz_date FROM fact_tech_up_clock
          UNION
          SELECT org_id, biz_date FROM fact_tech_market
          UNION
          SELECT org_id, biz_date FROM mart_customer_tech_links
        ) AS source_dates
      ),
      clock_window AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          fact_tech_up_clock.person_code AS tech_code,
          MAX(fact_tech_up_clock.person_name) AS tech_name,
          COUNT(DISTINCT fact_tech_up_clock.biz_date) AS service_day_count_30d,
          COUNT(*) AS up_clock_record_count_30d,
          SUM(fact_tech_up_clock.count) AS total_clock_count_30d,
          SUM(CASE WHEN fact_tech_up_clock.clock_type = '点钟' THEN fact_tech_up_clock.count ELSE 0 END) AS point_clock_count_30d,
          SUM(CASE WHEN fact_tech_up_clock.clock_type = '排钟' THEN fact_tech_up_clock.count ELSE 0 END) AS queue_clock_count_30d,
          SUM(
            CASE
              WHEN COALESCE(fact_tech_up_clock.raw_json, '') LIKE '%"AddClockType":"1"%'
                OR COALESCE(fact_tech_up_clock.raw_json, '') LIKE '%"AddClockType":1%'
                OR COALESCE(fact_tech_up_clock.raw_json, '') LIKE '%"AddClockType":"true"%'
                OR COALESCE(fact_tech_up_clock.raw_json, '') LIKE '%"AddClockType":true%'
                THEN 1
              ELSE 0
            END
          ) AS add_clock_record_count_30d,
          SUM(fact_tech_up_clock.turnover) AS turnover_30d,
          SUM(fact_tech_up_clock.comm) AS commission_30d,
          COUNT(DISTINCT CASE WHEN fact_tech_up_clock.count > 0 THEN fact_tech_up_clock.biz_date END) AS active_days_30d
        FROM window_dates
        INNER JOIN fact_tech_up_clock
          ON fact_tech_up_clock.org_id = window_dates.org_id
         AND CAST(fact_tech_up_clock.biz_date AS DATE)
           BETWEEN (window_dates.window_end_date - 29)
               AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date, fact_tech_up_clock.person_code
      ),
      market_window AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          fact_tech_market.person_code AS tech_code,
          MAX(COALESCE(fact_tech_market.person_name, fact_tech_market.person_code)) AS tech_name,
          SUM(fact_tech_market.after_disc) AS market_revenue_30d
        FROM window_dates
        INNER JOIN fact_tech_market
          ON fact_tech_market.org_id = window_dates.org_id
         AND fact_tech_market.person_code IS NOT NULL
         AND CAST(fact_tech_market.biz_date AS DATE)
           BETWEEN (window_dates.window_end_date - 29)
               AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date, fact_tech_market.person_code
      ),
      customer_window AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          mart_customer_tech_links.tech_code,
          MAX(mart_customer_tech_links.tech_name) AS tech_name,
          COUNT(DISTINCT mart_customer_tech_links.customer_identity_key) AS served_customer_count_30d,
          COUNT(DISTINCT mart_customer_tech_links.settle_id) AS served_order_count_30d
        FROM window_dates
        INNER JOIN mart_customer_tech_links
          ON mart_customer_tech_links.org_id = window_dates.org_id
         AND mart_customer_tech_links.identity_stable IS TRUE
         AND CAST(mart_customer_tech_links.biz_date AS DATE)
           BETWEEN (window_dates.window_end_date - 29)
               AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date, mart_customer_tech_links.tech_code
      ),
      profile_keys AS (
        SELECT org_id, window_end_biz_date, tech_code FROM clock_window
        UNION
        SELECT org_id, window_end_biz_date, tech_code FROM market_window
        UNION
        SELECT org_id, window_end_biz_date, tech_code FROM customer_window
      )
      SELECT
        profile_keys.org_id AS org_id,
        profile_keys.window_end_biz_date AS window_end_biz_date,
        profile_keys.tech_code AS tech_code,
        COALESCE(clock_window.tech_name, market_window.tech_name, customer_window.tech_name, profile_keys.tech_code) AS tech_name,
        COALESCE(customer_window.served_customer_count_30d, 0) AS served_customer_count_30d,
        COALESCE(customer_window.served_order_count_30d, 0) AS served_order_count_30d,
        COALESCE(clock_window.service_day_count_30d, 0) AS service_day_count_30d,
        COALESCE(clock_window.total_clock_count_30d, 0) AS total_clock_count_30d,
        COALESCE(clock_window.point_clock_count_30d, 0) AS point_clock_count_30d,
        COALESCE(clock_window.queue_clock_count_30d, 0) AS queue_clock_count_30d,
        CASE
          WHEN COALESCE(clock_window.total_clock_count_30d, 0) > 0
            THEN COALESCE(clock_window.point_clock_count_30d, 0) / clock_window.total_clock_count_30d
          ELSE NULL
        END AS point_clock_rate_30d,
        CASE
          WHEN COALESCE(clock_window.up_clock_record_count_30d, 0) > 0
            THEN COALESCE(clock_window.add_clock_record_count_30d, 0) / clock_window.up_clock_record_count_30d
          ELSE NULL
        END AS add_clock_rate_30d,
        COALESCE(clock_window.turnover_30d, 0) AS turnover_30d,
        COALESCE(clock_window.commission_30d, 0) AS commission_30d,
        COALESCE(market_window.market_revenue_30d, 0) AS market_revenue_30d,
        COALESCE(clock_window.active_days_30d, 0) AS active_days_30d
      FROM profile_keys
      LEFT JOIN clock_window
        ON clock_window.org_id = profile_keys.org_id
       AND clock_window.window_end_biz_date = profile_keys.window_end_biz_date
       AND clock_window.tech_code = profile_keys.tech_code
      LEFT JOIN market_window
        ON market_window.org_id = profile_keys.org_id
       AND market_window.window_end_biz_date = profile_keys.window_end_biz_date
       AND market_window.tech_code = profile_keys.tech_code
      LEFT JOIN customer_window
        ON customer_window.org_id = profile_keys.org_id
       AND customer_window.window_end_biz_date = profile_keys.window_end_biz_date
       AND customer_window.tech_code = profile_keys.tech_code;
    `);

    await this.params.pool.query(`
      CREATE ${relationKeyword} mv_customer_profile_90d AS
      SELECT
        segments.org_id AS org_id,
        segments.biz_date AS window_end_biz_date,
        segments.customer_identity_key AS customer_identity_key,
        segments.customer_identity_type AS customer_identity_type,
        segments.customer_display_name AS customer_display_name,
        segments.member_id AS member_id,
        segments.member_card_no AS member_card_no,
        segments.reference_code AS reference_code,
        segments.member_label AS member_label,
        CASE
          WHEN (members.raw_json::jsonb ->> 'Phone') = '' THEN NULL
          ELSE members.raw_json::jsonb ->> 'Phone'
        END AS phone,
        segments.identity_stable AS identity_stable,
        segments.segment_eligible AS segment_eligible,
        segments.first_biz_date AS first_biz_date,
        segments.last_biz_date AS last_biz_date,
        segments.days_since_last_visit AS days_since_last_visit,
        segments.visit_count_30d AS visit_count_30d,
        segments.visit_count_90d AS visit_count_90d,
        segments.pay_amount_30d AS pay_amount_30d,
        segments.pay_amount_90d AS pay_amount_90d,
        segments.member_pay_amount_90d AS member_pay_amount_90d,
        segments.groupbuy_amount_90d AS groupbuy_amount_90d,
        segments.direct_pay_amount_90d AS direct_pay_amount_90d,
        segments.distinct_tech_count_90d AS distinct_tech_count_90d,
        segments.top_tech_code AS top_tech_code,
        segments.top_tech_name AS top_tech_name,
        segments.top_tech_visit_count_90d AS top_tech_visit_count_90d,
        segments.top_tech_visit_share_90d AS top_tech_visit_share_90d,
        segments.recency_segment AS recency_segment,
        segments.frequency_segment AS frequency_segment,
        segments.monetary_segment AS monetary_segment,
        segments.payment_segment AS payment_segment,
        segments.tech_loyalty_segment AS tech_loyalty_segment,
        segments.primary_segment AS primary_segment,
        segments.tag_keys_json AS tag_keys_json,
        COALESCE(members.stored_amount, 0) AS current_stored_amount,
        COALESCE(members.consume_amount, 0) AS current_consume_amount,
        CASE
          WHEN (members.raw_json::jsonb ->> 'CTime') = '' THEN NULL
          ELSE members.raw_json::jsonb ->> 'CTime'
        END AS current_created_time,
        members.last_consume_time AS current_last_consume_time,
        COALESCE(members.silent_days, segments.days_since_last_visit) AS current_silent_days,
        cohorts.first_groupbuy_biz_date AS first_groupbuy_biz_date,
        COALESCE(cohorts.revisit_within_7d, FALSE) AS revisit_within_7d,
        COALESCE(cohorts.revisit_within_30d, FALSE) AS revisit_within_30d,
        COALESCE(cohorts.card_opened_within_7d, FALSE) AS card_opened_within_7d,
        COALESCE(cohorts.stored_value_converted_within_7d, FALSE) AS stored_value_converted_within_7d,
        COALESCE(cohorts.member_pay_converted_within_30d, FALSE) AS member_pay_converted_within_30d,
        COALESCE(cohorts.high_value_member_within_30d, FALSE) AS high_value_member_within_30d
      FROM mart_customer_segments AS segments
      LEFT JOIN fact_member_daily_snapshot AS members
        ON members.org_id = segments.org_id
       AND members.biz_date = segments.biz_date
       AND members.member_id = segments.member_id
      LEFT JOIN mart_customer_conversion_cohorts AS cohorts
        ON cohorts.org_id = segments.org_id
       AND cohorts.biz_date = segments.biz_date
       AND cohorts.customer_identity_key = segments.customer_identity_key;
    `);

    await this.params.pool.query(`
      CREATE ${relationKeyword} mv_store_review_7d AS
      WITH window_dates AS (
        SELECT DISTINCT
          source_dates.org_id,
          source_dates.biz_date AS window_end_biz_date,
          CAST(source_dates.biz_date AS DATE) AS window_end_date
        FROM (
          SELECT org_id, biz_date FROM mv_store_manager_daily_kpi
          UNION
          SELECT org_id, biz_date FROM mart_daily_store_metrics
        ) AS source_dates
      ),
      metrics_daily AS (
        SELECT
          org_id,
          biz_date,
          CAST(biz_date AS DATE) AS biz_day,
          metrics_json::jsonb AS metrics
        FROM mart_daily_store_metrics
      ),
      kpi_window AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          SUM(kpi.daily_actual_revenue) AS revenue_7d,
          SUM(kpi.daily_order_count) AS order_count_7d,
          SUM(kpi.total_clocks) AS total_clocks_7d,
          CASE
            WHEN SUM(kpi.daily_order_count) > 0
              THEN SUM(kpi.daily_actual_revenue) / SUM(kpi.daily_order_count)
            ELSE NULL
          END AS average_ticket_7d,
          CASE
            WHEN SUM(kpi.total_clocks) > 0
              THEN SUM(kpi.daily_actual_revenue) / SUM(kpi.total_clocks)
            ELSE NULL
          END AS clock_effect_7d,
          CASE
            WHEN SUM(kpi.total_clocks) > 0
              THEN SUM(kpi.assign_clocks) / SUM(kpi.total_clocks)
            ELSE NULL
          END AS point_clock_rate_from_kpi_7d
        FROM window_dates
        INNER JOIN mv_store_manager_daily_kpi AS kpi
          ON kpi.org_id = window_dates.org_id
         AND CAST(kpi.biz_date AS DATE)
           BETWEEN (window_dates.window_end_date - 6)
               AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date
      ),
      metrics_window_7d AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          SUM(COALESCE((metrics_daily.metrics ->> 'serviceOrderCount')::DOUBLE PRECISION, 0)) AS service_order_count_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'groupbuyOrderCount')::DOUBLE PRECISION, 0)) AS groupbuy_order_count_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'upClockRecordCount')::DOUBLE PRECISION, 0)) AS up_clock_record_count_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'pointClockRecordCount')::DOUBLE PRECISION, 0)) AS point_clock_record_count_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'addClockRecordCount')::DOUBLE PRECISION, 0)) AS add_clock_record_count_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'newMembers')::DOUBLE PRECISION, 0)) AS new_members_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'rechargeCash')::DOUBLE PRECISION, 0)) AS recharge_cash_7d,
          SUM(COALESCE((metrics_daily.metrics ->> 'storedConsumeAmount')::DOUBLE PRECISION, 0)) AS stored_consume_amount_7d,
          AVG(COALESCE((metrics_daily.metrics ->> 'activeTechCount')::DOUBLE PRECISION, 0)) AS active_tech_count_7d,
          AVG(COALESCE((metrics_daily.metrics ->> 'onDutyTechCount')::DOUBLE PRECISION, 0)) AS on_duty_tech_count_7d
        FROM window_dates
        INNER JOIN metrics_daily
          ON metrics_daily.org_id = window_dates.org_id
         AND metrics_daily.biz_day BETWEEN (window_dates.window_end_date - 6)
                                      AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date
      ),
      metrics_window_30d AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          SUM(
            CASE
              WHEN metrics_daily.biz_day BETWEEN (window_dates.window_end_date - 27)
                                           AND window_dates.window_end_date
                THEN COALESCE((metrics_daily.metrics ->> 'storedConsumeAmount')::DOUBLE PRECISION, 0)
              ELSE 0
            END
          ) AS stored_consume_amount_28d,
          SUM(COALESCE((metrics_daily.metrics ->> 'storedConsumeAmount')::DOUBLE PRECISION, 0)) AS stored_consume_amount_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'rechargeCash')::DOUBLE PRECISION, 0)) AS recharge_cash_30d
        FROM window_dates
        INNER JOIN metrics_daily
          ON metrics_daily.org_id = window_dates.org_id
         AND metrics_daily.biz_day BETWEEN (window_dates.window_end_date - 29)
                                      AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date
      ),
      member_visits AS (
        SELECT DISTINCT
          org_id,
          CAST(biz_date AS DATE) AS biz_day,
          customer_identity_key
        FROM mart_customer_tech_links
        WHERE identity_stable IS TRUE
          AND customer_identity_type = 'member'
      ),
      member_repurchase_base AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          member_visits.customer_identity_key
        FROM window_dates
        INNER JOIN member_visits
          ON member_visits.org_id = window_dates.org_id
         AND member_visits.biz_day BETWEEN (window_dates.window_end_date - 13)
                                      AND (window_dates.window_end_date - 7)
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date, member_visits.customer_identity_key
      ),
      member_repurchase_returned AS (
        SELECT
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          member_repurchase_base.customer_identity_key
        FROM member_repurchase_base
        INNER JOIN member_visits
          ON member_visits.org_id = member_repurchase_base.org_id
         AND member_visits.customer_identity_key = member_repurchase_base.customer_identity_key
         AND member_visits.biz_day BETWEEN (CAST(member_repurchase_base.window_end_biz_date AS DATE) - 6)
                                      AND CAST(member_repurchase_base.window_end_biz_date AS DATE)
        GROUP BY
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          member_repurchase_base.customer_identity_key
      ),
      member_repurchase_window AS (
        SELECT
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          COUNT(*) AS member_repurchase_base_customer_count_7d,
          COUNT(member_repurchase_returned.customer_identity_key) AS member_repurchase_returned_customer_count_7d
        FROM member_repurchase_base
        LEFT JOIN member_repurchase_returned
          ON member_repurchase_returned.org_id = member_repurchase_base.org_id
         AND member_repurchase_returned.window_end_biz_date = member_repurchase_base.window_end_biz_date
         AND member_repurchase_returned.customer_identity_key = member_repurchase_base.customer_identity_key
        GROUP BY member_repurchase_base.org_id, member_repurchase_base.window_end_biz_date
      ),
      last_metrics AS (
        SELECT
          org_id,
          biz_date AS window_end_biz_date,
          metrics_json::jsonb AS metrics
        FROM mart_daily_store_metrics
      )
      SELECT
        window_dates.org_id AS org_id,
        window_dates.window_end_biz_date AS window_end_biz_date,
        COALESCE(dim_store.store_name, window_dates.org_id) AS store_name,
        COALESCE(kpi_window.revenue_7d, 0) AS revenue_7d,
        COALESCE(kpi_window.order_count_7d, 0) AS order_count_7d,
        COALESCE(kpi_window.total_clocks_7d, 0) AS total_clocks_7d,
        kpi_window.clock_effect_7d AS clock_effect_7d,
        kpi_window.average_ticket_7d AS average_ticket_7d,
        CASE
          WHEN COALESCE(metrics_window_7d.up_clock_record_count_7d, 0) > 0
            THEN COALESCE(metrics_window_7d.point_clock_record_count_7d, 0)
              / metrics_window_7d.up_clock_record_count_7d
          ELSE kpi_window.point_clock_rate_from_kpi_7d
        END AS point_clock_rate_7d,
        CASE
          WHEN COALESCE(metrics_window_7d.up_clock_record_count_7d, 0) > 0
            THEN COALESCE(metrics_window_7d.add_clock_record_count_7d, 0)
              / metrics_window_7d.up_clock_record_count_7d
          ELSE NULL
        END AS add_clock_rate_7d,
        COALESCE(metrics_window_7d.recharge_cash_7d, 0) AS recharge_cash_7d,
        COALESCE(metrics_window_7d.stored_consume_amount_7d, 0) AS stored_consume_amount_7d,
        CASE
          WHEN COALESCE(metrics_window_7d.recharge_cash_7d, 0) > 0
            THEN COALESCE(metrics_window_7d.stored_consume_amount_7d, 0)
              / metrics_window_7d.recharge_cash_7d
          ELSE NULL
        END AS stored_consume_rate_7d,
        metrics_window_7d.on_duty_tech_count_7d AS on_duty_tech_count_7d,
        CASE
          WHEN COALESCE(metrics_window_7d.service_order_count_7d, 0) > 0
            THEN COALESCE(metrics_window_7d.groupbuy_order_count_7d, 0)
              / metrics_window_7d.service_order_count_7d
          ELSE NULL
        END AS groupbuy_order_share_7d,
        COALESCE((last_metrics.metrics ->> 'groupbuyCohortCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_cohort_customer_count,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dRevisitCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_revisit_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dRevisitRate')::DOUBLE PRECISION AS groupbuy_7d_revisit_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dCardOpenedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_card_opened_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dCardOpenedRate')::DOUBLE PRECISION AS groupbuy_7d_card_opened_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dStoredValueConvertedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_stored_value_converted_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dStoredValueConversionRate')::DOUBLE PRECISION AS groupbuy_7d_stored_value_conversion_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy30dMemberPayConvertedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_30d_member_pay_converted_customer_count,
        (last_metrics.metrics ->> 'groupbuy30dMemberPayConversionRate')::DOUBLE PRECISION AS groupbuy_30d_member_pay_conversion_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuyFirstOrderCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_first_order_customer_count,
        COALESCE((last_metrics.metrics ->> 'groupbuyFirstOrderHighValueMemberCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_first_order_high_value_member_customer_count,
        (last_metrics.metrics ->> 'groupbuyFirstOrderHighValueMemberRate')::DOUBLE PRECISION AS groupbuy_first_order_high_value_member_rate,
        COALESCE((last_metrics.metrics ->> 'effectiveMembers')::DOUBLE PRECISION, 0) AS effective_members,
        COALESCE((last_metrics.metrics ->> 'sleepingMembers')::DOUBLE PRECISION, 0) AS sleeping_members,
        (last_metrics.metrics ->> 'sleepingMemberRate')::DOUBLE PRECISION AS sleeping_member_rate,
        COALESCE(metrics_window_7d.new_members_7d, 0) AS new_members_7d,
        metrics_window_7d.active_tech_count_7d AS active_tech_count_7d,
        COALESCE((last_metrics.metrics ->> 'currentStoredBalance')::DOUBLE PRECISION, 0) AS current_stored_balance,
        CASE
          WHEN COALESCE(metrics_window_30d.stored_consume_amount_28d, 0) > 0
            THEN COALESCE((last_metrics.metrics ->> 'currentStoredBalance')::DOUBLE PRECISION, 0)
              / (metrics_window_30d.stored_consume_amount_28d / 28.0)
              / 30.0
          ELSE NULL
        END AS stored_balance_life_months,
        CASE
          WHEN COALESCE(metrics_window_30d.recharge_cash_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.stored_consume_amount_30d, 0)
              / metrics_window_30d.recharge_cash_30d
          ELSE NULL
        END AS renewal_pressure_index_30d,
        COALESCE(member_repurchase_window.member_repurchase_base_customer_count_7d, 0) AS member_repurchase_base_customer_count_7d,
        COALESCE(member_repurchase_window.member_repurchase_returned_customer_count_7d, 0) AS member_repurchase_returned_customer_count_7d,
        CASE
          WHEN COALESCE(member_repurchase_window.member_repurchase_base_customer_count_7d, 0) > 0
            THEN COALESCE(member_repurchase_window.member_repurchase_returned_customer_count_7d, 0)::DOUBLE PRECISION
              / member_repurchase_window.member_repurchase_base_customer_count_7d
          ELSE NULL
        END AS member_repurchase_rate_7d
      FROM window_dates
      LEFT JOIN kpi_window
        ON kpi_window.org_id = window_dates.org_id
       AND kpi_window.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN metrics_window_7d
        ON metrics_window_7d.org_id = window_dates.org_id
       AND metrics_window_7d.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN metrics_window_30d
        ON metrics_window_30d.org_id = window_dates.org_id
       AND metrics_window_30d.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN member_repurchase_window
        ON member_repurchase_window.org_id = window_dates.org_id
       AND member_repurchase_window.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN last_metrics
        ON last_metrics.org_id = window_dates.org_id
       AND last_metrics.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN dim_store
        ON dim_store.org_id = window_dates.org_id;
    `);

    await this.params.pool.query(`
      CREATE ${relationKeyword} mv_store_summary_30d AS
      WITH window_dates AS (
        SELECT DISTINCT
          source_dates.org_id,
          source_dates.biz_date AS window_end_biz_date,
          CAST(source_dates.biz_date AS DATE) AS window_end_date
        FROM (
          SELECT org_id, biz_date FROM mv_store_manager_daily_kpi
          UNION
          SELECT org_id, biz_date FROM mart_daily_store_metrics
        ) AS source_dates
      ),
      metrics_daily AS (
        SELECT
          org_id,
          biz_date,
          CAST(biz_date AS DATE) AS biz_day,
          metrics_json::jsonb AS metrics
        FROM mart_daily_store_metrics
      ),
      kpi_window AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          SUM(kpi.daily_actual_revenue) AS revenue_30d,
          SUM(kpi.daily_order_count) AS order_count_30d,
          SUM(kpi.total_clocks) AS total_clocks_30d,
          CASE
            WHEN SUM(kpi.daily_order_count) > 0
              THEN SUM(kpi.daily_actual_revenue) / SUM(kpi.daily_order_count)
            ELSE NULL
          END AS average_ticket_30d,
          CASE
            WHEN SUM(kpi.total_clocks) > 0
              THEN SUM(kpi.daily_actual_revenue) / SUM(kpi.total_clocks)
            ELSE NULL
          END AS clock_effect_30d,
          CASE
            WHEN SUM(kpi.total_clocks) > 0
              THEN SUM(kpi.assign_clocks) / SUM(kpi.total_clocks)
            ELSE NULL
          END AS point_clock_rate_from_kpi_30d
        FROM window_dates
        INNER JOIN mv_store_manager_daily_kpi AS kpi
          ON kpi.org_id = window_dates.org_id
         AND CAST(kpi.biz_date AS DATE)
           BETWEEN (window_dates.window_end_date - 29)
               AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date
      ),
      metrics_window_30d AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          SUM(COALESCE((metrics_daily.metrics ->> 'serviceOrderCount')::DOUBLE PRECISION, 0)) AS service_order_count_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'groupbuyOrderCount')::DOUBLE PRECISION, 0)) AS groupbuy_order_count_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'upClockRecordCount')::DOUBLE PRECISION, 0)) AS up_clock_record_count_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'pointClockRecordCount')::DOUBLE PRECISION, 0)) AS point_clock_record_count_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'addClockRecordCount')::DOUBLE PRECISION, 0)) AS add_clock_record_count_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'newMembers')::DOUBLE PRECISION, 0)) AS new_members_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'rechargeCash')::DOUBLE PRECISION, 0)) AS recharge_cash_30d,
          SUM(COALESCE((metrics_daily.metrics ->> 'storedConsumeAmount')::DOUBLE PRECISION, 0)) AS stored_consume_amount_30d,
          AVG(COALESCE((metrics_daily.metrics ->> 'activeTechCount')::DOUBLE PRECISION, 0)) AS active_tech_count_30d,
          AVG(COALESCE((metrics_daily.metrics ->> 'onDutyTechCount')::DOUBLE PRECISION, 0)) AS on_duty_tech_count_30d
        FROM window_dates
        INNER JOIN metrics_daily
          ON metrics_daily.org_id = window_dates.org_id
         AND metrics_daily.biz_day BETWEEN (window_dates.window_end_date - 29)
                                      AND window_dates.window_end_date
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date
      ),
      member_visits AS (
        SELECT DISTINCT
          org_id,
          CAST(biz_date AS DATE) AS biz_day,
          customer_identity_key
        FROM mart_customer_tech_links
        WHERE identity_stable IS TRUE
          AND customer_identity_type = 'member'
      ),
      member_repurchase_base AS (
        SELECT
          window_dates.org_id,
          window_dates.window_end_biz_date,
          member_visits.customer_identity_key
        FROM window_dates
        INNER JOIN member_visits
          ON member_visits.org_id = window_dates.org_id
         AND member_visits.biz_day BETWEEN (window_dates.window_end_date - 13)
                                      AND (window_dates.window_end_date - 7)
        GROUP BY window_dates.org_id, window_dates.window_end_biz_date, member_visits.customer_identity_key
      ),
      member_repurchase_returned AS (
        SELECT
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          member_repurchase_base.customer_identity_key
        FROM member_repurchase_base
        INNER JOIN member_visits
          ON member_visits.org_id = member_repurchase_base.org_id
         AND member_visits.customer_identity_key = member_repurchase_base.customer_identity_key
         AND member_visits.biz_day BETWEEN (CAST(member_repurchase_base.window_end_biz_date AS DATE) - 6)
                                      AND CAST(member_repurchase_base.window_end_biz_date AS DATE)
        GROUP BY
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          member_repurchase_base.customer_identity_key
      ),
      member_repurchase_window AS (
        SELECT
          member_repurchase_base.org_id,
          member_repurchase_base.window_end_biz_date,
          COUNT(*) AS member_repurchase_base_customer_count_7d,
          COUNT(member_repurchase_returned.customer_identity_key) AS member_repurchase_returned_customer_count_7d
        FROM member_repurchase_base
        LEFT JOIN member_repurchase_returned
          ON member_repurchase_returned.org_id = member_repurchase_base.org_id
         AND member_repurchase_returned.window_end_biz_date = member_repurchase_base.window_end_biz_date
         AND member_repurchase_returned.customer_identity_key = member_repurchase_base.customer_identity_key
        GROUP BY member_repurchase_base.org_id, member_repurchase_base.window_end_biz_date
      ),
      last_metrics AS (
        SELECT
          org_id,
          biz_date AS window_end_biz_date,
          metrics_json::jsonb AS metrics
        FROM mart_daily_store_metrics
      )
      SELECT
        window_dates.org_id AS org_id,
        window_dates.window_end_biz_date AS window_end_biz_date,
        COALESCE(dim_store.store_name, window_dates.org_id) AS store_name,
        COALESCE(kpi_window.revenue_30d, 0) AS revenue_30d,
        COALESCE(kpi_window.order_count_30d, 0) AS order_count_30d,
        COALESCE(kpi_window.total_clocks_30d, 0) AS total_clocks_30d,
        kpi_window.clock_effect_30d AS clock_effect_30d,
        kpi_window.average_ticket_30d AS average_ticket_30d,
        CASE
          WHEN COALESCE(metrics_window_30d.up_clock_record_count_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.point_clock_record_count_30d, 0)
              / metrics_window_30d.up_clock_record_count_30d
          ELSE kpi_window.point_clock_rate_from_kpi_30d
        END AS point_clock_rate_30d,
        CASE
          WHEN COALESCE(metrics_window_30d.up_clock_record_count_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.add_clock_record_count_30d, 0)
              / metrics_window_30d.up_clock_record_count_30d
          ELSE NULL
        END AS add_clock_rate_30d,
        COALESCE(metrics_window_30d.recharge_cash_30d, 0) AS recharge_cash_30d,
        COALESCE(metrics_window_30d.stored_consume_amount_30d, 0) AS stored_consume_amount_30d,
        CASE
          WHEN COALESCE(metrics_window_30d.recharge_cash_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.stored_consume_amount_30d, 0)
              / metrics_window_30d.recharge_cash_30d
          ELSE NULL
        END AS stored_consume_rate_30d,
        metrics_window_30d.on_duty_tech_count_30d AS on_duty_tech_count_30d,
        CASE
          WHEN COALESCE(metrics_window_30d.service_order_count_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.groupbuy_order_count_30d, 0)
              / metrics_window_30d.service_order_count_30d
          ELSE NULL
        END AS groupbuy_order_share_30d,
        COALESCE((last_metrics.metrics ->> 'groupbuyCohortCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_cohort_customer_count,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dRevisitCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_revisit_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dRevisitRate')::DOUBLE PRECISION AS groupbuy_7d_revisit_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dCardOpenedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_card_opened_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dCardOpenedRate')::DOUBLE PRECISION AS groupbuy_7d_card_opened_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy7dStoredValueConvertedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_7d_stored_value_converted_customer_count,
        (last_metrics.metrics ->> 'groupbuy7dStoredValueConversionRate')::DOUBLE PRECISION AS groupbuy_7d_stored_value_conversion_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuy30dMemberPayConvertedCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_30d_member_pay_converted_customer_count,
        (last_metrics.metrics ->> 'groupbuy30dMemberPayConversionRate')::DOUBLE PRECISION AS groupbuy_30d_member_pay_conversion_rate,
        COALESCE((last_metrics.metrics ->> 'groupbuyFirstOrderCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_first_order_customer_count,
        COALESCE((last_metrics.metrics ->> 'groupbuyFirstOrderHighValueMemberCustomerCount')::DOUBLE PRECISION, 0) AS groupbuy_first_order_high_value_member_customer_count,
        (last_metrics.metrics ->> 'groupbuyFirstOrderHighValueMemberRate')::DOUBLE PRECISION AS groupbuy_first_order_high_value_member_rate,
        COALESCE((last_metrics.metrics ->> 'effectiveMembers')::DOUBLE PRECISION, 0) AS effective_members,
        COALESCE((last_metrics.metrics ->> 'sleepingMembers')::DOUBLE PRECISION, 0) AS sleeping_members,
        (last_metrics.metrics ->> 'sleepingMemberRate')::DOUBLE PRECISION AS sleeping_member_rate,
        COALESCE(metrics_window_30d.new_members_30d, 0) AS new_members_30d,
        metrics_window_30d.active_tech_count_30d AS active_tech_count_30d,
        COALESCE((last_metrics.metrics ->> 'currentStoredBalance')::DOUBLE PRECISION, 0) AS current_stored_balance,
        CASE
          WHEN COALESCE(metrics_window_30d.stored_consume_amount_30d, 0) > 0
            THEN COALESCE((last_metrics.metrics ->> 'currentStoredBalance')::DOUBLE PRECISION, 0)
              / (metrics_window_30d.stored_consume_amount_30d / 30.0)
              / 30.0
          ELSE NULL
        END AS stored_balance_life_months,
        CASE
          WHEN COALESCE(metrics_window_30d.recharge_cash_30d, 0) > 0
            THEN COALESCE(metrics_window_30d.stored_consume_amount_30d, 0)
              / metrics_window_30d.recharge_cash_30d
          ELSE NULL
        END AS renewal_pressure_index_30d,
        COALESCE(member_repurchase_window.member_repurchase_base_customer_count_7d, 0) AS member_repurchase_base_customer_count_7d,
        COALESCE(member_repurchase_window.member_repurchase_returned_customer_count_7d, 0) AS member_repurchase_returned_customer_count_7d,
        CASE
          WHEN COALESCE(member_repurchase_window.member_repurchase_base_customer_count_7d, 0) > 0
            THEN COALESCE(member_repurchase_window.member_repurchase_returned_customer_count_7d, 0)::DOUBLE PRECISION
              / member_repurchase_window.member_repurchase_base_customer_count_7d
          ELSE NULL
        END AS member_repurchase_rate_7d
      FROM window_dates
      LEFT JOIN kpi_window
        ON kpi_window.org_id = window_dates.org_id
       AND kpi_window.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN metrics_window_30d
        ON metrics_window_30d.org_id = window_dates.org_id
       AND metrics_window_30d.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN member_repurchase_window
        ON member_repurchase_window.org_id = window_dates.org_id
       AND member_repurchase_window.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN last_metrics
        ON last_metrics.org_id = window_dates.org_id
       AND last_metrics.window_end_biz_date = window_dates.window_end_biz_date
      LEFT JOIN dim_store
        ON dim_store.org_id = window_dates.org_id;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_store_day AS
      SELECT
        metrics.org_id AS org_id,
        metrics.biz_date AS biz_date,
        COALESCE(store.store_name, metrics.org_id) AS store_name,
        COALESCE((metrics.metrics_json::jsonb ->> 'serviceRevenue')::DOUBLE PRECISION, 0) AS service_revenue,
        COALESCE((metrics.metrics_json::jsonb ->> 'serviceOrderCount')::DOUBLE PRECISION, 0) AS service_order_count,
        COALESCE((metrics.metrics_json::jsonb ->> 'customerCount')::DOUBLE PRECISION, 0) AS customer_count,
        COALESCE((metrics.metrics_json::jsonb ->> 'totalClockCount')::DOUBLE PRECISION, 0) AS total_clocks,
        COALESCE((metrics.metrics_json::jsonb ->> 'averageTicket')::DOUBLE PRECISION, 0) AS average_ticket,
        COALESCE((metrics.metrics_json::jsonb ->> 'clockEffect')::DOUBLE PRECISION, 0) AS clock_effect,
        COALESCE((metrics.metrics_json::jsonb ->> 'pointClockRate')::DOUBLE PRECISION, 0) AS point_clock_rate,
        COALESCE((metrics.metrics_json::jsonb ->> 'addClockRate')::DOUBLE PRECISION, 0) AS add_clock_rate
      FROM mart_daily_store_metrics AS metrics
      LEFT JOIN dim_store AS store
        ON store.org_id = metrics.org_id;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_store_day_breakdown AS
      WITH day_keys AS (
        SELECT org_id, biz_date FROM mv_store_manager_daily_kpi
        UNION
        SELECT org_id, biz_date FROM mart_daily_store_metrics
      )
      SELECT
        day_keys.org_id AS org_id,
        day_keys.biz_date AS biz_date,
        COALESCE(store.store_name, day_keys.org_id) AS store_name,
        COALESCE(kpi.total_clocks, (metrics.metrics_json::jsonb ->> 'totalClockCount')::DOUBLE PRECISION, 0) AS total_clocks,
        COALESCE(kpi.assign_clocks, 0) AS assign_clocks,
        COALESCE(kpi.queue_clocks, 0) AS queue_clocks,
        COALESCE((metrics.metrics_json::jsonb ->> 'addClockRecordCount')::DOUBLE PRECISION, 0) AS add_clock_count,
        COALESCE((metrics.metrics_json::jsonb ->> 'upClockRecordCount')::DOUBLE PRECISION, 0) AS up_clock_record_count,
        COALESCE((metrics.metrics_json::jsonb ->> 'pointClockRecordCount')::DOUBLE PRECISION, 0) AS point_clock_record_count,
        COALESCE(kpi.point_clock_rate, (metrics.metrics_json::jsonb ->> 'pointClockRate')::DOUBLE PRECISION, 0) AS point_clock_rate,
        COALESCE((metrics.metrics_json::jsonb ->> 'addClockRate')::DOUBLE PRECISION, 0) AS add_clock_rate
      FROM day_keys
      LEFT JOIN mv_store_manager_daily_kpi AS kpi
        ON kpi.org_id = day_keys.org_id
       AND kpi.biz_date = day_keys.biz_date
      LEFT JOIN mart_daily_store_metrics AS metrics
        ON metrics.org_id = day_keys.org_id
       AND metrics.biz_date = day_keys.biz_date
      LEFT JOIN dim_store AS store
        ON store.org_id = day_keys.org_id;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_store_window AS
      SELECT
        review.org_id AS org_id,
        review.window_end_biz_date AS window_end_biz_date,
        7 AS window_days,
        review.store_name AS store_name,
        review.revenue_7d AS service_revenue,
        review.order_count_7d AS service_order_count,
        review.total_clocks_7d AS total_clocks,
        review.average_ticket_7d AS average_ticket,
        review.clock_effect_7d AS clock_effect,
        review.point_clock_rate_7d AS point_clock_rate,
        review.add_clock_rate_7d AS add_clock_rate,
        review.sleeping_member_rate AS sleeping_member_rate,
        review.renewal_pressure_index_30d AS renewal_pressure_index_30d,
        review.member_repurchase_rate_7d AS member_repurchase_rate_7d,
        COALESCE(review.sleeping_member_rate, 0) * 100
          + (1 - COALESCE(review.member_repurchase_rate_7d, 0)) * 40
          + GREATEST(COALESCE(review.renewal_pressure_index_30d, 1) - 1, 0) * 30
          AS risk_score
      FROM mv_store_review_7d AS review
      UNION ALL
      SELECT
        summary.org_id AS org_id,
        summary.window_end_biz_date AS window_end_biz_date,
        30 AS window_days,
        summary.store_name AS store_name,
        summary.revenue_30d AS service_revenue,
        summary.order_count_30d AS service_order_count,
        summary.total_clocks_30d AS total_clocks,
        summary.average_ticket_30d AS average_ticket,
        summary.clock_effect_30d AS clock_effect,
        summary.point_clock_rate_30d AS point_clock_rate,
        summary.add_clock_rate_30d AS add_clock_rate,
        summary.sleeping_member_rate AS sleeping_member_rate,
        summary.renewal_pressure_index_30d AS renewal_pressure_index_30d,
        summary.member_repurchase_rate_7d AS member_repurchase_rate_7d,
        COALESCE(summary.sleeping_member_rate, 0) * 100
          + (1 - COALESCE(summary.member_repurchase_rate_7d, 0)) * 40
          + GREATEST(COALESCE(summary.renewal_pressure_index_30d, 1) - 1, 0) * 30
          AS risk_score
      FROM mv_store_summary_30d AS summary;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_customer_profile_asof AS
      SELECT
        profile.org_id AS org_id,
        profile.window_end_biz_date AS as_of_biz_date,
        profile.customer_identity_key AS customer_identity_key,
        profile.customer_display_name AS customer_display_name,
        profile.member_id AS member_id,
        profile.member_card_no AS member_card_no,
        profile.phone AS phone,
        RIGHT(COALESCE(profile.phone, ''), 4) AS phone_suffix,
        profile.identity_stable AS identity_stable,
        profile.primary_segment AS primary_segment,
        profile.payment_segment AS payment_segment,
        profile.tech_loyalty_segment AS tech_loyalty_segment,
        profile.visit_count_30d AS visit_count_30d,
        profile.visit_count_90d AS visit_count_90d,
        profile.pay_amount_30d AS pay_amount_30d,
        profile.pay_amount_90d AS pay_amount_90d,
        profile.current_stored_amount AS current_stored_amount,
        profile.current_last_consume_time AS current_last_consume_time,
        profile.current_silent_days AS current_silent_days,
        CASE
          WHEN profile.identity_stable IS TRUE THEN profile.top_tech_name
          ELSE NULL
        END AS top_tech_name,
        COALESCE(profile.pay_amount_90d, 0) / 100
          + GREATEST(30 - COALESCE(profile.current_silent_days, 30), 0)
          + CASE WHEN profile.high_value_member_within_30d IS TRUE THEN 25 ELSE 0 END
          + CASE WHEN profile.stored_value_converted_within_7d IS TRUE THEN 15 ELSE 0 END
          AS followup_score,
        COALESCE(profile.current_silent_days, 0)
          + CASE WHEN profile.revisit_within_30d IS TRUE THEN 0 ELSE 15 END
          + CASE WHEN profile.high_value_member_within_30d IS TRUE THEN 10 ELSE 0 END
          AS risk_score
      FROM mv_customer_profile_90d AS profile;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_customer_ranked_list_asof AS
      SELECT
        profile.org_id AS org_id,
        profile.as_of_biz_date AS as_of_biz_date,
        profile.customer_identity_key AS customer_identity_key,
        profile.customer_display_name AS customer_display_name,
        profile.member_id AS member_id,
        profile.member_card_no AS member_card_no,
        profile.phone AS phone,
        profile.phone_suffix AS phone_suffix,
        profile.identity_stable AS identity_stable,
        profile.primary_segment AS primary_segment,
        COALESCE(
          queue.followup_bucket,
          CASE
            WHEN profile.primary_segment IN ('important-value-member', 'important-reactivation-member', 'sleeping-customer')
              THEN 'high-value-reactivation'
            WHEN profile.primary_segment = 'potential-growth-customer'
              THEN 'potential-growth'
            WHEN profile.primary_segment = 'groupbuy-retain-candidate'
              THEN 'groupbuy-retention'
            ELSE NULL
          END
        ) AS followup_bucket,
        profile.payment_segment AS payment_segment,
        profile.tech_loyalty_segment AS tech_loyalty_segment,
        profile.visit_count_30d AS visit_count_30d,
        profile.visit_count_90d AS visit_count_90d,
        profile.pay_amount_30d AS pay_amount_30d,
        profile.pay_amount_90d AS pay_amount_90d,
        profile.current_stored_amount AS current_stored_amount,
        profile.current_last_consume_time AS current_last_consume_time,
        profile.current_silent_days AS current_silent_days,
        CASE
          WHEN profile.identity_stable IS TRUE THEN COALESCE(queue.top_tech_name, profile.top_tech_name)
          ELSE NULL
        END AS top_tech_name,
        COALESCE(queue.execution_priority_score, queue.strategy_priority_score, profile.followup_score) AS followup_score,
        COALESCE(queue.churn_risk_score * 100, profile.risk_score) AS risk_score,
        queue.priority_band AS priority_band,
        queue.reason_summary AS reason_summary,
        queue.touch_advice_summary AS touch_advice_summary,
        queue.recommended_touch_weekday AS recommended_touch_weekday,
        queue.recommended_touch_daypart AS recommended_touch_daypart,
        queue.recommended_action_label AS recommended_action_label
      FROM serving_customer_profile_asof AS profile
      LEFT JOIN mart_member_reactivation_queue_daily AS queue
        ON queue.org_id = profile.org_id
       AND queue.biz_date = profile.as_of_biz_date
       AND queue.member_id = profile.member_id;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_tech_profile_window AS
      SELECT
        profile.org_id AS org_id,
        profile.window_end_biz_date AS window_end_biz_date,
        30 AS window_days,
        profile.tech_code AS tech_code,
        profile.tech_name AS tech_name,
        profile.served_customer_count_30d AS served_customer_count,
        profile.served_order_count_30d AS served_order_count,
        profile.total_clock_count_30d AS total_clock_count,
        profile.point_clock_rate_30d AS point_clock_rate,
        profile.add_clock_rate_30d AS add_clock_rate,
        profile.turnover_30d AS turnover,
        profile.market_revenue_30d AS market_revenue,
        profile.active_days_30d AS active_days
      FROM mv_tech_profile_30d AS profile;
    `);

    await this.params.pool.query(`
      CREATE OR REPLACE VIEW serving_hq_portfolio_window AS
      SELECT
        org_id,
        window_end_biz_date,
        window_days,
        store_name,
        service_revenue,
        service_order_count,
        total_clocks,
        average_ticket,
        clock_effect,
        point_clock_rate,
        add_clock_rate,
        sleeping_member_rate,
        renewal_pressure_index_30d,
        member_repurchase_rate_7d,
        risk_score
      FROM serving_store_window;
    `);
  }

  private async refreshAnalyticsViews(): Promise<void> {
    await this.servingPublicationStore.refreshAnalyticsViews();
  }

  private async relationExists(name: string): Promise<boolean> {
    return await this.servingPublicationStore.relationExists(name);
  }

  async ensureAnalyticsViewsReady(): Promise<void> {
    if (!this.initialized) {
      return;
    }
    for (const relation of REQUIRED_ANALYTICS_VIEWS) {
      if (!(await this.relationExists(relation))) {
        await this.rebuildAnalyticsViews();
        this.analyticsPublicationDirty = false;
        return;
      }
    }
  }

  async forceRebuildAnalyticsViews(): Promise<void> {
    if (!this.initialized || this.analyticsViewMode !== "materialized") {
      return;
    }
    for (const relation of REQUIRED_ANALYTICS_VIEWS) {
      if (!(await this.relationExists(relation))) {
        await this.rebuildAnalyticsViews();
        this.analyticsPublicationDirty = false;
        return;
      }
    }
    await this.refreshAnalyticsViews();
    this.analyticsPublicationDirty = false;
  }

  async publishServingManifest(servingVersion: string, publishedAt: string, notes?: string): Promise<void> {
    await this.servingPublicationStore.publishServingManifest(servingVersion, publishedAt, notes);
  }

  async publishAnalyticsViews(params: PublishAnalyticsViewsParams = {}): Promise<string | null> {
    if (!this.initialized) {
      return null;
    }
    const materialized = this.analyticsViewMode === "materialized";
    let needsRefresh =
      params.force === true || params.rebuild === true || this.analyticsPublicationDirty;
    if (materialized && !needsRefresh) {
      for (const relation of REQUIRED_ANALYTICS_VIEWS) {
        if (!(await this.relationExists(relation))) {
          needsRefresh = true;
          params.rebuild = true;
          break;
        }
      }
    }
    if (materialized && needsRefresh) {
      if (params.rebuild) {
        await this.rebuildAnalyticsViews();
      } else {
        await this.refreshAnalyticsViews();
      }
      this.analyticsPublicationDirty = false;
    } else if (this.analyticsPublicationDirty) {
      this.analyticsPublicationDirty = false;
    }
    const shouldPublishManifest =
      typeof params.publishedAt === "string" ||
      typeof params.servingVersion === "string" ||
      typeof params.notes === "string";
    if (!shouldPublishManifest) {
      return null;
    }
    const publishedAt = params.publishedAt ?? new Date().toISOString();
    const servingVersion = params.servingVersion ?? resolveGeneratedServingVersion(publishedAt);
    await this.servingPublicationStore.publishServingManifest(
      servingVersion,
      publishedAt,
      params.notes,
    );
    return servingVersion;
  }

  async getCurrentServingVersion(): Promise<string | null> {
    return await this.servingPublicationStore.getCurrentServingVersion();
  }

  async executeCompiledServingQuery(sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
    return await this.servingPublicationStore.executeCompiledServingQuery(sql, params);
  }

  private async handleAnalyticsMutation(options: AnalyticsWriteOptions = {}): Promise<void> {
    this.analyticsPublicationDirty = true;
    if (options.refreshViews === false) {
      return;
    }
    await this.publishAnalyticsViews();
  }

  async close(): Promise<void> {
    for (const lockKey of Array.from(this.advisoryLockClients.keys())) {
      await this.releaseAdvisoryLock(lockKey);
    }
    this.initialized = false;
  }

  async tableExists(tableName: string): Promise<boolean> {
    const result = await this.params.pool.query(
      `
        SELECT EXISTS (
          SELECT 1
          FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1
        ) AS exists
      `,
      [tableName],
    );
    return Boolean(result.rows[0]?.exists);
  }

  async countRows(tableName: string): Promise<number> {
    assertSafeTableName(tableName);
    const result = await this.params.pool.query(`SELECT COUNT(*)::int AS count FROM ${tableName}`);
    return normalizeNumeric(result.rows[0]?.count);
  }

  async beginSyncRun(params: { orgId: string; mode: string; startedAt: string }): Promise<string> {
    const syncRunId = randomUUID();
    await this.params.pool.query(
      `
        INSERT INTO sync_runs (sync_run_id, org_id, mode, started_at, status)
        VALUES ($1, $2, $3, $4, 'running')
      `,
      [syncRunId, params.orgId, params.mode, params.startedAt],
    );
    return syncRunId;
  }

  async finishSyncRun(params: {
    syncRunId: string;
    status: string;
    finishedAt: string;
    details?: unknown;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE sync_runs
        SET status = $1, finished_at = $2, details_json = $3
        WHERE sync_run_id = $4
      `,
      [params.status, params.finishedAt, JSON.stringify(params.details ?? {}), params.syncRunId],
    );
  }

  async recordSyncError(params: {
    syncRunId: string;
    orgId: string;
    endpoint: string;
    errorAt: string;
    errorMessage: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO sync_errors (sync_run_id, org_id, endpoint, error_at, error_message)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [params.syncRunId, params.orgId, params.endpoint, params.errorAt, params.errorMessage],
    );
  }

  async setEndpointWatermark(params: {
    orgId: string;
    endpoint: string;
    lastSuccessAt: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO endpoint_watermarks (org_id, endpoint, last_success_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (org_id, endpoint) DO UPDATE SET
          last_success_at = EXCLUDED.last_success_at
      `,
      [params.orgId, params.endpoint, params.lastSuccessAt],
    );
  }

  async getEndpointWatermark(orgId: string, endpoint: string): Promise<string | null> {
    const result = await this.params.pool.query(
      `
        SELECT last_success_at
        FROM endpoint_watermarks
        WHERE org_id = $1 AND endpoint = $2
      `,
      [orgId, endpoint],
    );
    return (result.rows[0]?.last_success_at as string | undefined) ?? null;
  }

  async getEndpointWatermarksForOrg(orgId: string): Promise<Record<string, string>> {
    const result = await this.params.pool.query(
      `
        SELECT endpoint, last_success_at
        FROM endpoint_watermarks
        WHERE org_id = $1
      `,
      [orgId],
    );
    return Object.fromEntries(
      result.rows.map((row: Record<string, unknown>) => [
        String(row.endpoint),
        String(row.last_success_at),
      ]),
    );
  }

  async listCompletedRunKeys(): Promise<Set<string>> {
    const result = await this.params.pool.query(
      `
        SELECT job_type, run_key
        FROM scheduled_job_runs
      `,
    );
    return new Set(
      result.rows.map(
        (row: Record<string, unknown>) => `${String(row.job_type)}:${String(row.run_key)}`,
      ),
    );
  }

  async getLatestScheduledJobRunTimes(): Promise<Partial<Record<ScheduledJobType, string>>> {
    const result = await this.params.pool.query(
      `
        SELECT job_type, MAX(ran_at) AS last_ran_at
        FROM scheduled_job_runs
        GROUP BY job_type
      `,
    );
    const summary: Partial<Record<ScheduledJobType, string>> = {};
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const jobType = String(row.job_type) as ScheduledJobType;
      const lastRanAt = row.last_ran_at as string | null;
      if (lastRanAt) {
        summary[jobType] = lastRanAt;
      }
    }
    return summary;
  }

  async markScheduledJobCompleted(jobType: string, runKey: string, ranAt: string): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO scheduled_job_runs (job_type, run_key, ran_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (job_type, run_key) DO UPDATE SET
          ran_at = EXCLUDED.ran_at
      `,
      [jobType, runKey, ranAt],
    );
  }

  async getScheduledJobState(
    jobType: string,
    stateKey: string,
  ): Promise<Record<string, unknown> | null> {
    const result = await this.params.pool.query(
      `
        SELECT state_json
        FROM scheduled_job_state
        WHERE job_type = $1 AND state_key = $2
      `,
      [jobType, stateKey],
    );
    const rawState = result.rows[0]?.state_json;
    if (typeof rawState !== "string" || rawState.trim().length === 0) {
      return null;
    }
    const parsed = JSON.parse(rawState);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  }

  async setScheduledJobState(
    jobType: string,
    stateKey: string,
    state: Record<string, unknown>,
    updatedAt: string,
  ): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO scheduled_job_state (job_type, state_key, state_json, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (job_type, state_key) DO UPDATE SET
          state_json = EXCLUDED.state_json,
          updated_at = EXCLUDED.updated_at
      `,
      [jobType, stateKey, JSON.stringify(state), updatedAt],
    );
  }

  async getHistoricalCoverageSnapshot(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<HetangHistoricalCoverageSnapshot> {
    const rawDayResult = await this.params.pool.query(
      `
        SELECT
          coverage_key,
          biz_date
        FROM (
          SELECT '1.2'::text AS coverage_key, biz_date
          FROM fact_consume_bills
          WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
          UNION ALL
          SELECT '1.3'::text AS coverage_key, biz_date
          FROM fact_recharge_bills
          WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
          UNION ALL
          SELECT '1.4'::text AS coverage_key, biz_date
          FROM fact_user_trades
          WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
          UNION ALL
          SELECT '1.6'::text AS coverage_key, biz_date
          FROM fact_tech_up_clock
          WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
          UNION ALL
          SELECT '1.7'::text AS coverage_key, biz_date
          FROM fact_tech_market
          WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ) AS raw_coverage
        GROUP BY coverage_key, biz_date
      `,
      [params.orgId, params.startBizDate, params.endBizDate],
    );
    const rawBatchResult = await this.params.pool.query(
      `
        SELECT endpoint, request_json, row_count
        FROM raw_api_batches
        WHERE org_id = $1
          AND endpoint IN ('1.2', '1.3', '1.4', '1.6', '1.7')
          AND request_json IS NOT NULL
          AND request_json <> ''
      `,
      [params.orgId],
    );

    let derivedRows: Array<Record<string, unknown>> = [];
    try {
      const derivedResult = await this.params.pool.query(
        `
          SELECT
            coverage_key,
            MIN(biz_date) AS min_biz_date,
            MAX(biz_date) AS max_biz_date,
            COUNT(*)::int AS row_count,
            COUNT(DISTINCT biz_date)::int AS day_count
          FROM (
            SELECT 'factMemberDailySnapshot'::text AS coverage_key, biz_date
            FROM fact_member_daily_snapshot
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'martCustomerSegments'::text AS coverage_key, biz_date
            FROM mart_customer_segments
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'martCustomerConversionCohorts'::text AS coverage_key, biz_date
            FROM mart_customer_conversion_cohorts
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'mvCustomerProfile90d'::text AS coverage_key, window_end_biz_date AS biz_date
            FROM mv_customer_profile_90d
            WHERE org_id = $1 AND window_end_biz_date BETWEEN $2 AND $3
          ) AS derived_coverage
          GROUP BY coverage_key
        `,
        [params.orgId, params.startBizDate, params.endBizDate],
      );
      derivedRows = derivedResult.rows as Array<Record<string, unknown>>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      if (!/mv_customer_profile_90d/iu.test(message)) {
        throw error;
      }
      const derivedFallbackResult = await this.params.pool.query(
        `
          SELECT
            coverage_key,
            MIN(biz_date) AS min_biz_date,
            MAX(biz_date) AS max_biz_date,
            COUNT(*)::int AS row_count,
            COUNT(DISTINCT biz_date)::int AS day_count
          FROM (
            SELECT 'factMemberDailySnapshot'::text AS coverage_key, biz_date
            FROM fact_member_daily_snapshot
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'martCustomerSegments'::text AS coverage_key, biz_date
            FROM mart_customer_segments
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'martCustomerConversionCohorts'::text AS coverage_key, biz_date
            FROM mart_customer_conversion_cohorts
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
            UNION ALL
            SELECT 'mvCustomerProfile90d'::text AS coverage_key, biz_date
            FROM mart_customer_segments
            WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
          ) AS derived_coverage
          GROUP BY coverage_key
        `,
        [params.orgId, params.startBizDate, params.endBizDate],
      );
      derivedRows = derivedFallbackResult.rows as Array<Record<string, unknown>>;
    }

    const rawCoverageDays = new Map<string, Set<string>>();
    const provisionalZeroRowCoverage = new Map<
      string,
      {
        endpoint: string;
        startBizDate: string;
        endBizDate: string;
        count: number;
      }
    >();
    for (const endpoint of ["1.2", "1.3", "1.4", "1.6", "1.7"] as const) {
      rawCoverageDays.set(endpoint, new Set<string>());
    }
    for (const row of rawDayResult.rows as Array<Record<string, unknown>>) {
      const coverageKey = String(row.coverage_key);
      const bizDate = typeof row.biz_date === "string" ? row.biz_date : undefined;
      if (!bizDate) {
        continue;
      }
      const days = rawCoverageDays.get(coverageKey);
      days?.add(bizDate);
    }
    for (const row of rawBatchResult.rows as Array<Record<string, unknown>>) {
      const endpoint = typeof row.endpoint === "string" ? row.endpoint : undefined;
      const requestJson = typeof row.request_json === "string" ? row.request_json : undefined;
      if (!endpoint || !requestJson) {
        continue;
      }
      const requestWindow = parseCoverageRequestWindow(requestJson);
      if (!requestWindow) {
        continue;
      }
      const clampedWindow = clampCoverageRange({
        startBizDate: requestWindow.startBizDate,
        endBizDate: requestWindow.endBizDate,
        rangeStartBizDate: params.startBizDate,
        rangeEndBizDate: params.endBizDate,
      });
      if (!clampedWindow) {
        continue;
      }
      const days = rawCoverageDays.get(endpoint);
      if (!days) {
        continue;
      }
      const rowCount = Number(row.row_count ?? 0);
      if (Number.isFinite(rowCount) && rowCount > 0) {
        addBizDateRangeToCoverage(days, clampedWindow.startBizDate, clampedWindow.endBizDate);
        continue;
      }

      const zeroRowCoverageKey = `${endpoint}:${clampedWindow.startBizDate}:${clampedWindow.endBizDate}`;
      provisionalZeroRowCoverage.set(zeroRowCoverageKey, {
        endpoint,
        startBizDate: clampedWindow.startBizDate,
        endBizDate: clampedWindow.endBizDate,
        count: (provisionalZeroRowCoverage.get(zeroRowCoverageKey)?.count ?? 0) + 1,
      });
    }
    for (const entry of provisionalZeroRowCoverage.values()) {
      if (entry.count < ZERO_ROW_BATCH_COVERAGE_CONFIRMATION_THRESHOLD) {
        continue;
      }
      const days = rawCoverageDays.get(entry.endpoint);
      if (!days) {
        continue;
      }
      addBizDateRangeToCoverage(days, entry.startBizDate, entry.endBizDate);
    }
    const derivedByKey = new Map(derivedRows.map((row) => [String(row.coverage_key), row]));

    return {
      orgId: params.orgId,
      startBizDate: params.startBizDate,
      endBizDate: params.endBizDate,
      rawFacts: {
        "1.2": buildHistoricalCoverageSpanFromDays({
          coverageDays: rawCoverageDays.get("1.2") ?? new Set<string>(),
          startBizDate: params.startBizDate,
          endBizDate: params.endBizDate,
        }),
        "1.3": buildHistoricalCoverageSpanFromDays({
          coverageDays: rawCoverageDays.get("1.3") ?? new Set<string>(),
          startBizDate: params.startBizDate,
          endBizDate: params.endBizDate,
        }),
        "1.4": buildHistoricalCoverageSpanFromDays({
          coverageDays: rawCoverageDays.get("1.4") ?? new Set<string>(),
          startBizDate: params.startBizDate,
          endBizDate: params.endBizDate,
        }),
        "1.6": buildHistoricalCoverageSpanFromDays({
          coverageDays: rawCoverageDays.get("1.6") ?? new Set<string>(),
          startBizDate: params.startBizDate,
          endBizDate: params.endBizDate,
        }),
        "1.7": buildHistoricalCoverageSpanFromDays({
          coverageDays: rawCoverageDays.get("1.7") ?? new Set<string>(),
          startBizDate: params.startBizDate,
          endBizDate: params.endBizDate,
        }),
      },
      derivedLayers: {
        factMemberDailySnapshot: mapHistoricalCoverageSpan(
          derivedByKey.get("factMemberDailySnapshot"),
        ),
        martCustomerSegments: mapHistoricalCoverageSpan(derivedByKey.get("martCustomerSegments")),
        martCustomerConversionCohorts: mapHistoricalCoverageSpan(
          derivedByKey.get("martCustomerConversionCohorts"),
        ),
        mvCustomerProfile90d: mapHistoricalCoverageSpan(derivedByKey.get("mvCustomerProfile90d")),
      },
    };
  }

  private normalizeBindingScopes(binding: HetangEmployeeBinding): string[] {
    const values =
      binding.scopeOrgIds && binding.scopeOrgIds.length > 0
        ? binding.scopeOrgIds
        : binding.orgId
          ? [binding.orgId]
          : [];
    return Array.from(
      new Set(values.map((entry) => entry.trim()).filter((entry) => entry.length > 0)),
    ).sort((left, right) => left.localeCompare(right));
  }

  private async getBindingScopes(params: {
    channel: string;
    senderId: string;
    fallbackOrgId?: string;
  }): Promise<string[]> {
    const result = await this.params.pool.query(
      `
        SELECT org_id
        FROM employee_binding_scopes
        WHERE channel = $1 AND sender_id = $2
        ORDER BY org_id
      `,
      [params.channel, params.senderId],
    );
    const scopes = result.rows
      .map((row: Record<string, unknown>) => String(row.org_id))
      .filter((entry) => entry.length > 0);
    if (scopes.length > 0) {
      return scopes;
    }
    return params.fallbackOrgId ? [params.fallbackOrgId] : [];
  }

  async upsertEmployeeBinding(binding: HetangEmployeeBinding): Promise<void> {
    const updatedAt = binding.updatedAt ?? new Date().toISOString();
    const scopeOrgIds = this.normalizeBindingScopes(binding);
    const primaryOrgId = binding.orgId ?? (scopeOrgIds.length === 1 ? scopeOrgIds[0] : null);
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          INSERT INTO employee_bindings (
            channel, sender_id, employee_name, role, org_id, is_active,
            hourly_quota, daily_quota, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
          ON CONFLICT (channel, sender_id) DO UPDATE SET
            employee_name = EXCLUDED.employee_name,
            role = EXCLUDED.role,
            org_id = EXCLUDED.org_id,
            is_active = EXCLUDED.is_active,
            hourly_quota = EXCLUDED.hourly_quota,
            daily_quota = EXCLUDED.daily_quota,
            notes = EXCLUDED.notes,
            updated_at = EXCLUDED.updated_at
        `,
        [
          binding.channel,
          binding.senderId,
          binding.employeeName ?? null,
          binding.role,
          primaryOrgId,
          binding.isActive,
          binding.hourlyQuota ?? null,
          binding.dailyQuota ?? null,
          binding.notes ?? null,
          updatedAt,
        ],
      );
      await client.query(
        `
          DELETE FROM employee_binding_scopes
          WHERE channel = $1 AND sender_id = $2
        `,
        [binding.channel, binding.senderId],
      );
      for (const orgId of scopeOrgIds) {
        await client.query(
          `
            INSERT INTO employee_binding_scopes (
              channel, sender_id, org_id, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $4)
          `,
          [binding.channel, binding.senderId, orgId, updatedAt],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getEmployeeBinding(params: {
    channel: string;
    senderId: string;
  }): Promise<HetangEmployeeBinding | null> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM employee_bindings
        WHERE channel = $1 AND sender_id = $2 AND is_active = TRUE
      `,
      [params.channel, params.senderId],
    );
    if (!result.rows[0]) {
      return null;
    }
    const row = result.rows[0] as Record<string, unknown>;
    const orgId = (row.org_id as string | null) ?? undefined;
    const scopeOrgIds = await this.getBindingScopes({
      channel: params.channel,
      senderId: params.senderId,
      fallbackOrgId: orgId,
    });
    return {
      channel: String(row.channel),
      senderId: String(row.sender_id),
      employeeName: (row.employee_name as string | null) ?? undefined,
      role: String(row.role) as HetangEmployeeBinding["role"],
      orgId,
      scopeOrgIds,
      isActive: Boolean(row.is_active),
      hourlyQuota:
        row.hourly_quota === null || row.hourly_quota === undefined
          ? undefined
          : normalizeNumeric(row.hourly_quota),
      dailyQuota:
        row.daily_quota === null || row.daily_quota === undefined
          ? undefined
          : normalizeNumeric(row.daily_quota),
      notes: (row.notes as string | null) ?? undefined,
      createdAt: (row.created_at as string | null) ?? undefined,
      updatedAt: (row.updated_at as string | null) ?? undefined,
    };
  }

  async listEmployeeBindings(channel?: string): Promise<HetangEmployeeBinding[]> {
    const result = channel
      ? await this.params.pool.query(
          `
            SELECT *
            FROM employee_bindings
            WHERE channel = $1 AND is_active = TRUE
            ORDER BY role, sender_id
          `,
          [channel],
        )
      : await this.params.pool.query(
          `
            SELECT *
            FROM employee_bindings
            WHERE is_active = TRUE
            ORDER BY channel, role, sender_id
          `,
        );
    const scopeRows = channel
      ? await this.params.pool.query(
          `
            SELECT channel, sender_id, org_id
            FROM employee_binding_scopes
            WHERE channel = $1
            ORDER BY sender_id, org_id
          `,
          [channel],
        )
      : await this.params.pool.query(
          `
            SELECT channel, sender_id, org_id
            FROM employee_binding_scopes
            ORDER BY channel, sender_id, org_id
          `,
        );
    const scopeMap = new Map<string, string[]>();
    for (const row of scopeRows.rows as Array<Record<string, unknown>>) {
      const key = `${String(row.channel)}:${String(row.sender_id)}`;
      const values = scopeMap.get(key) ?? [];
      values.push(String(row.org_id));
      scopeMap.set(key, values);
    }
    return result.rows.map((row: Record<string, unknown>) => {
      const channelValue = String(row.channel);
      const senderId = String(row.sender_id);
      const orgId = (row.org_id as string | null) ?? undefined;
      return {
        channel: channelValue,
        senderId,
        employeeName: (row.employee_name as string | null) ?? undefined,
        role: String(row.role) as HetangEmployeeBinding["role"],
        orgId,
        scopeOrgIds: scopeMap.get(`${channelValue}:${senderId}`) ?? (orgId ? [orgId] : []),
        isActive: Boolean(row.is_active),
        hourlyQuota:
          row.hourly_quota === null || row.hourly_quota === undefined
            ? undefined
            : normalizeNumeric(row.hourly_quota),
        dailyQuota:
          row.daily_quota === null || row.daily_quota === undefined
            ? undefined
            : normalizeNumeric(row.daily_quota),
        notes: (row.notes as string | null) ?? undefined,
        createdAt: (row.created_at as string | null) ?? undefined,
        updatedAt: (row.updated_at as string | null) ?? undefined,
      };
    });
  }

  async revokeEmployeeBinding(params: {
    channel: string;
    senderId: string;
    updatedAt?: string;
  }): Promise<void> {
    const updatedAt = params.updatedAt ?? new Date().toISOString();
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE employee_bindings
          SET is_active = FALSE, updated_at = $3
          WHERE channel = $1 AND sender_id = $2
        `,
        [params.channel, params.senderId, updatedAt],
      );
      await client.query(
        `
          DELETE FROM employee_binding_scopes
          WHERE channel = $1 AND sender_id = $2
        `,
        [params.channel, params.senderId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordCommandAudit(record: HetangCommandAuditRecord): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO command_audit_logs (
          occurred_at, channel, sender_id, command_name, action,
          requested_org_id, effective_org_id, decision, consume_quota, reason, command_body, response_excerpt
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        record.occurredAt,
        record.channel,
        record.senderId ?? null,
        record.commandName,
        record.action,
        record.requestedOrgId ?? null,
        record.effectiveOrgId ?? null,
        record.decision,
        record.consumeQuota ?? true,
        record.reason,
        record.commandBody,
        record.responseExcerpt ?? null,
      ],
    );
  }

  async countAllowedCommandAudits(params: {
    channel: string;
    senderId: string;
    since: string;
  }): Promise<number> {
    const result = await this.params.pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM command_audit_logs
        WHERE channel = $1
          AND sender_id = $2
          AND decision = 'allowed'
          AND consume_quota = TRUE
          AND occurred_at >= $3
      `,
      [params.channel, params.senderId, params.since],
    );
    return normalizeNumeric(result.rows[0]?.count);
  }

  async recordInboundMessageAudit(record: HetangInboundMessageAuditRecord): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO inbound_message_audit_logs (
          request_id, channel, account_id, sender_id, sender_name, conversation_id, thread_id,
          is_group, was_mentioned, platform_message_id, content, effective_content, received_at, recorded_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14
        )
        ON CONFLICT (request_id) DO UPDATE SET
          channel = EXCLUDED.channel,
          account_id = EXCLUDED.account_id,
          sender_id = EXCLUDED.sender_id,
          sender_name = EXCLUDED.sender_name,
          conversation_id = EXCLUDED.conversation_id,
          thread_id = EXCLUDED.thread_id,
          is_group = EXCLUDED.is_group,
          was_mentioned = EXCLUDED.was_mentioned,
          platform_message_id = EXCLUDED.platform_message_id,
          content = EXCLUDED.content,
          effective_content = EXCLUDED.effective_content,
          received_at = EXCLUDED.received_at,
          recorded_at = EXCLUDED.recorded_at
      `,
      [
        record.requestId,
        record.channel,
        record.accountId ?? null,
        record.senderId ?? null,
        record.senderName ?? null,
        record.conversationId ?? null,
        record.threadId ?? null,
        record.isGroup,
        record.wasMentioned ?? null,
        record.platformMessageId ?? null,
        record.content,
        record.effectiveContent ?? null,
        record.receivedAt,
        record.recordedAt ?? new Date().toISOString(),
      ],
    );
  }

  async listInboundMessageAudits(
    params: {
      channel?: string;
      senderId?: string;
      conversationId?: string;
      contains?: string;
      limit?: number;
    } = {},
  ): Promise<HetangInboundMessageAuditRecord[]> {
    const values: Array<string | number> = [];
    const where: string[] = [];
    if (params.channel) {
      values.push(params.channel);
      where.push(`channel = $${values.length}`);
    }
    if (params.senderId) {
      values.push(params.senderId);
      where.push(`sender_id = $${values.length}`);
    }
    if (params.conversationId) {
      values.push(params.conversationId);
      where.push(`conversation_id = $${values.length}`);
    }
    if (params.contains) {
      values.push(`%${params.contains}%`);
      where.push(
        `(COALESCE(sender_name, '') ILIKE $${values.length} OR content ILIKE $${values.length} OR COALESCE(effective_content, '') ILIKE $${values.length})`,
      );
    }
    const limit = Math.max(1, Math.min(200, Math.trunc(params.limit ?? 20)));
    values.push(limit);
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM inbound_message_audit_logs
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY received_at DESC, id DESC
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      id:
        row.id === null || row.id === undefined
          ? undefined
          : normalizeNumeric(row.id),
      requestId: String(row.request_id),
      channel: String(row.channel),
      accountId: (row.account_id as string | null) ?? undefined,
      senderId: (row.sender_id as string | null) ?? undefined,
      senderName: (row.sender_name as string | null) ?? undefined,
      conversationId: (row.conversation_id as string | null) ?? undefined,
      threadId: (row.thread_id as string | null) ?? undefined,
      isGroup: Boolean(row.is_group),
      wasMentioned:
        row.was_mentioned === null || row.was_mentioned === undefined
          ? undefined
          : Boolean(row.was_mentioned),
      platformMessageId: (row.platform_message_id as string | null) ?? undefined,
      content: String(row.content),
      effectiveContent: (row.effective_content as string | null) ?? undefined,
      receivedAt: String(row.received_at),
      recordedAt: (row.recorded_at as string | null) ?? undefined,
    }));
  }

  async createAnalysisJob(job: HetangAnalysisJob): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO analysis_jobs (
          job_id, job_type, capability_id, org_id, raw_text, time_frame_label, start_biz_date, end_biz_date,
          channel, target, account_id, thread_id, sender_id, status, attempt_count,
          result_text, error_message, created_at, updated_at, started_at, finished_at, delivered_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22
        )
      `,
      [
        job.jobId,
        job.jobType,
        job.capabilityId ?? null,
        job.orgId,
        job.rawText,
        job.timeFrameLabel,
        job.startBizDate,
        job.endBizDate,
        job.channel,
        job.target,
        job.accountId ?? null,
        job.threadId ?? null,
        job.senderId ?? null,
        job.status,
        job.attemptCount,
        job.resultText ?? null,
        job.errorMessage ?? null,
        job.createdAt,
        job.updatedAt,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.deliveredAt ?? null,
      ],
    );
  }

  async upsertAnalysisSubscriber(params: {
    jobId: string;
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
    senderId?: string;
    createdAt: string;
  }): Promise<HetangAnalysisSubscriber> {
    const subscriberKey = buildAnalysisSubscriberKey(params);
    const result = await this.params.pool.query(
      `
        INSERT INTO analysis_job_subscribers (
          subscriber_key, job_id, channel, target, account_id, thread_id, sender_id,
          created_at, updated_at, delivered_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $8, NULL
        )
        ON CONFLICT (subscriber_key) DO UPDATE SET
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `,
      [
        subscriberKey,
        params.jobId,
        params.channel,
        params.target,
        params.accountId ?? null,
        params.threadId ?? null,
        params.senderId ?? null,
        params.createdAt,
      ],
    );
    return mapAnalysisSubscriberRow(result.rows[0] as Record<string, unknown>);
  }

  async listAnalysisSubscribers(jobId: string): Promise<HetangAnalysisSubscriber[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM analysis_job_subscribers
        WHERE job_id = $1
        ORDER BY created_at, subscriber_key
      `,
      [jobId],
    );
    return result.rows.map((row: Record<string, unknown>) => mapAnalysisSubscriberRow(row));
  }

  async countPendingAnalysisJobsByOrg(orgId: string): Promise<number> {
    const result = await this.params.pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM analysis_jobs
        WHERE org_id = $1
          AND status IN ('pending', 'running')
      `,
      [orgId],
    );
    return normalizeNumeric(result.rows[0]?.count);
  }

  private isAnalysisDeadLetterEnabled(): boolean {
    return this.params.deadLetterEnabled !== false;
  }

  private async recordAnalysisDeadLetter(params: {
    jobId: string;
    orgId: string;
    deadLetterScope: "job" | "subscriber";
    reason: string;
    observedAt: string;
    subscriberKey?: string;
    payloadJson?: string;
  }): Promise<void> {
    const deadLetterKey = md5(
      [
        params.jobId,
        params.orgId,
        params.deadLetterScope,
        params.subscriberKey ?? "",
        params.reason,
      ].join("|"),
    );
    await this.params.pool.query(
      `
        INSERT INTO analysis_dead_letters (
          dead_letter_key, job_id, subscriber_key, org_id, dead_letter_scope,
          reason, payload_json, created_at, resolved_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, NULL
        )
        ON CONFLICT (dead_letter_key) DO NOTHING
      `,
      [
        deadLetterKey,
        params.jobId,
        params.subscriberKey ?? null,
        params.orgId,
        params.deadLetterScope,
        params.reason,
        params.payloadJson ?? null,
        params.observedAt,
      ],
    );
  }

  async getAnalysisDeliveryHealthSummary(): Promise<HetangAnalysisDeliveryHealthSummary> {
    const jobCountsResult = await this.params.pool.query(
      `
        SELECT
          SUM(
            CASE
              WHEN delivered_at IS NULL
               AND delivery_abandoned_at IS NULL
               AND next_delivery_after IS NULL
              THEN 1
              ELSE 0
            END
          )::int AS pending_count,
          SUM(
            CASE
              WHEN delivered_at IS NULL
               AND delivery_abandoned_at IS NULL
               AND next_delivery_after IS NOT NULL
              THEN 1
              ELSE 0
            END
          )::int AS retrying_count,
          SUM(CASE WHEN delivery_abandoned_at IS NOT NULL THEN 1 ELSE 0 END)::int AS abandoned_count
        FROM analysis_jobs
        WHERE status IN ('completed', 'failed')
          AND job_id NOT IN (
            SELECT job_id
            FROM analysis_job_subscribers
          )
      `,
    );
    const subscriberCountsResult = await this.params.pool.query(
      `
        SELECT
          SUM(
            CASE
              WHEN delivered_at IS NULL
               AND delivery_abandoned_at IS NULL
               AND next_delivery_after IS NULL
              THEN 1
              ELSE 0
            END
          )::int AS pending_count,
          SUM(
            CASE
              WHEN delivered_at IS NULL
               AND delivery_abandoned_at IS NULL
               AND next_delivery_after IS NOT NULL
              THEN 1
              ELSE 0
            END
          )::int AS retrying_count,
          SUM(CASE WHEN delivery_abandoned_at IS NOT NULL THEN 1 ELSE 0 END)::int AS abandoned_count
        FROM analysis_job_subscribers
      `,
    );
    const jobCounts = (jobCountsResult.rows[0] ?? {}) as Record<string, unknown>;
    const subscriberCounts = (subscriberCountsResult.rows[0] ?? {}) as Record<string, unknown>;
    return {
      jobPendingCount: normalizeNumeric(jobCounts.pending_count ?? 0),
      jobRetryingCount: normalizeNumeric(jobCounts.retrying_count ?? 0),
      jobAbandonedCount: normalizeNumeric(jobCounts.abandoned_count ?? 0),
      subscriberPendingCount: normalizeNumeric(subscriberCounts.pending_count ?? 0),
      subscriberRetryingCount: normalizeNumeric(subscriberCounts.retrying_count ?? 0),
      subscriberAbandonedCount: normalizeNumeric(subscriberCounts.abandoned_count ?? 0),
    };
  }

  async getAnalysisQueueSummary(): Promise<HetangAnalysisQueueSummary> {
    const statusCountsResult = await this.params.pool.query(
      `
        SELECT
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::int AS pending_count,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running_count,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::int AS completed_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int AS failed_count
        FROM analysis_jobs
      `,
    );
    const deliveryHealth = await this.getAnalysisDeliveryHealthSummary();
    const deadLetterCountsResult = await this.params.pool.query(
      `
        SELECT COUNT(*)::int AS unresolved_dead_letter_count
        FROM analysis_dead_letters
        WHERE resolved_at IS NULL
      `,
    );
    const statusCounts = (statusCountsResult.rows[0] ?? {}) as Record<string, unknown>;
    return {
      pendingCount: normalizeNumeric(statusCounts.pending_count ?? 0),
      runningCount: normalizeNumeric(statusCounts.running_count ?? 0),
      completedCount: normalizeNumeric(statusCounts.completed_count ?? 0),
      failedCount: normalizeNumeric(statusCounts.failed_count ?? 0),
      jobDeliveryPendingCount: deliveryHealth.jobPendingCount,
      jobDeliveryRetryingCount: deliveryHealth.jobRetryingCount,
      jobDeliveryAbandonedCount: deliveryHealth.jobAbandonedCount,
      subscriberDeliveryPendingCount: deliveryHealth.subscriberPendingCount,
      subscriberDeliveryRetryingCount: deliveryHealth.subscriberRetryingCount,
      subscriberDeliveryAbandonedCount: deliveryHealth.subscriberAbandonedCount,
      unresolvedDeadLetterCount: normalizeNumeric(
        deadLetterCountsResult.rows[0]?.unresolved_dead_letter_count ?? 0,
      ),
    };
  }

  async listAnalysisDeadLetters(
    params: {
      orgId?: string;
      deadLetterScope?: HetangAnalysisDeadLetter["deadLetterScope"];
      unresolvedOnly?: boolean;
      limit?: number;
    } = {},
  ): Promise<HetangAnalysisDeadLetter[]> {
    const values: Array<string | number> = [];
    const where: string[] = [];
    if (params.orgId) {
      values.push(params.orgId);
      where.push(`org_id = $${values.length}`);
    }
    if (params.deadLetterScope) {
      values.push(params.deadLetterScope);
      where.push(`dead_letter_scope = $${values.length}`);
    }
    if (params.unresolvedOnly !== false) {
      where.push("resolved_at IS NULL");
    }
    values.push(Math.max(1, Math.min(100, params.limit ?? 20)));
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM analysis_dead_letters
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY created_at DESC, dead_letter_key
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((row: Record<string, unknown>) => mapAnalysisDeadLetterRow(row));
  }

  async replayAnalysisDeadLetter(params: {
    deadLetterKey: string;
    replayedAt: string;
  }): Promise<HetangAnalysisDeadLetter | null> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      const deadLetterResult = await client.query(
        `
          SELECT *
          FROM analysis_dead_letters
          WHERE dead_letter_key = $1
          FOR UPDATE
        `,
        [params.deadLetterKey],
      );
      const row = deadLetterResult.rows[0] as Record<string, unknown> | undefined;
      if (!row) {
        await client.query("COMMIT");
        return null;
      }
      const deadLetter = mapAnalysisDeadLetterRow(row);
      if (!deadLetter.resolvedAt) {
        await client.query(
          `
            UPDATE analysis_jobs
            SET delivered_at = NULL,
                delivery_attempt_count = 0,
                last_delivery_attempt_at = NULL,
                last_delivery_error = NULL,
                next_delivery_after = NULL,
                delivery_abandoned_at = NULL,
                updated_at = $2
            WHERE job_id = $1
          `,
          [deadLetter.jobId, params.replayedAt],
        );
        if (deadLetter.subscriberKey) {
          await client.query(
            `
              UPDATE analysis_job_subscribers
              SET delivered_at = NULL,
                  delivery_attempt_count = 0,
                  last_delivery_attempt_at = NULL,
                  last_delivery_error = NULL,
                  next_delivery_after = NULL,
                  delivery_abandoned_at = NULL,
                  updated_at = $2
              WHERE subscriber_key = $1
            `,
            [deadLetter.subscriberKey, params.replayedAt],
          );
        } else {
          await client.query(
            `
              UPDATE analysis_job_subscribers
              SET delivered_at = NULL,
                  delivery_attempt_count = 0,
                  last_delivery_attempt_at = NULL,
                  last_delivery_error = NULL,
                  next_delivery_after = NULL,
                  delivery_abandoned_at = NULL,
                  updated_at = $2
              WHERE job_id = $1
            `,
            [deadLetter.jobId, params.replayedAt],
          );
        }
        await client.query(
          `
            UPDATE analysis_dead_letters
            SET resolved_at = $2
            WHERE dead_letter_key = $1
          `,
          [params.deadLetterKey, params.replayedAt],
        );
        await client.query(
          `
            UPDATE analysis_dead_letters
            SET resolved_at = $2
            WHERE job_id = $1
              AND resolved_at IS NULL
              AND dead_letter_scope = 'job'
              AND reason = 'delivery abandoned after subscriber fan-out exhaustion'
          `,
          [deadLetter.jobId, params.replayedAt],
        );
      }
      const updatedResult = await client.query(
        `
          SELECT *
          FROM analysis_dead_letters
          WHERE dead_letter_key = $1
        `,
        [params.deadLetterKey],
      );
      await client.query("COMMIT");
      const updated = updatedResult.rows[0] as Record<string, unknown> | undefined;
      return updated ? mapAnalysisDeadLetterRow(updated) : deadLetter;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getNextDeliverableAnalysisSubscription(): Promise<
    | (HetangAnalysisJob & {
        subscriberKey: string;
        deliveryChannel: string;
        deliveryTarget: string;
        deliveryAccountId?: string;
        deliveryThreadId?: string;
      })
    | null
  >;
  async getNextDeliverableAnalysisSubscription(asOf?: string): Promise<
    | (HetangAnalysisJob & {
        subscriberKey: string;
        deliveryChannel: string;
        deliveryTarget: string;
        deliveryAccountId?: string;
        deliveryThreadId?: string;
      })
    | null
  > {
    const result = await this.params.pool.query(
      `
        SELECT
          jobs.*,
          subs.subscriber_key,
          subs.channel AS delivery_channel,
          subs.target AS delivery_target,
          subs.account_id AS delivery_account_id,
          subs.thread_id AS delivery_thread_id
        FROM analysis_jobs jobs
        INNER JOIN analysis_job_subscribers subs
          ON subs.job_id = jobs.job_id
        WHERE jobs.status IN ('completed', 'failed')
          AND subs.delivered_at IS NULL
          AND subs.delivery_abandoned_at IS NULL
          AND (subs.next_delivery_after IS NULL OR subs.next_delivery_after <= $1)
        ORDER BY jobs.finished_at, jobs.updated_at, subs.created_at, subs.subscriber_key
        LIMIT 1
      `,
      [asOf ?? new Date().toISOString()],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const job = mapAnalysisJobRow(row);
    return {
      ...job,
      subscriberKey: String(row.subscriber_key),
      deliveryChannel: String(row.delivery_channel),
      deliveryTarget: String(row.delivery_target),
      deliveryAccountId: (row.delivery_account_id as string | null) ?? undefined,
      deliveryThreadId: (row.delivery_thread_id as string | null) ?? undefined,
    };
  }

  async getAnalysisJob(jobId: string): Promise<HetangAnalysisJob | null> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM analysis_jobs
        WHERE job_id = $1
      `,
      [jobId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapAnalysisJobRow(row) : null;
  }

  async listAnalysisJobs(
    params: {
      orgId?: string;
      status?: HetangAnalysisJobStatus;
    } = {},
  ): Promise<HetangAnalysisJob[]> {
    const values: string[] = [];
    const where: string[] = [];
    if (params.orgId) {
      values.push(params.orgId);
      where.push(`org_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      where.push(`status = $${values.length}`);
    }
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM analysis_jobs
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY updated_at DESC, created_at DESC, job_id
      `,
      values,
    );
    return result.rows.map((row: Record<string, unknown>) => mapAnalysisJobRow(row));
  }

  async findReusableAnalysisJob(params: {
    jobType: HetangAnalysisJob["jobType"];
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<HetangAnalysisJob | null> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM analysis_jobs
        WHERE job_type = $1
          AND org_id = $2
          AND start_biz_date = $3
          AND end_biz_date = $4
          AND status IN ('pending', 'running', 'completed')
        ORDER BY
          CASE status
            WHEN 'running' THEN 0
            WHEN 'pending' THEN 1
            WHEN 'completed' THEN 2
            ELSE 9
          END,
          updated_at DESC,
          created_at DESC,
          job_id
        LIMIT 1
      `,
      [params.jobType, params.orgId, params.startBizDate, params.endBizDate],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapAnalysisJobRow(row) : null;
  }

  async getNextDeliverableAnalysisJob(asOf?: string): Promise<HetangAnalysisJob | null> {
    const result = await this.params.pool.query(
      `
        SELECT jobs.*
        FROM analysis_jobs jobs
        LEFT JOIN analysis_job_subscribers subs
          ON subs.job_id = jobs.job_id
         AND subs.delivery_abandoned_at IS NULL
        WHERE jobs.delivered_at IS NULL
          AND jobs.delivery_abandoned_at IS NULL
          AND jobs.status IN ('completed', 'failed')
          AND (jobs.next_delivery_after IS NULL OR jobs.next_delivery_after <= $1)
          AND subs.job_id IS NULL
        ORDER BY jobs.finished_at, jobs.updated_at, jobs.job_id
        LIMIT 1
      `,
      [asOf ?? new Date().toISOString()],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapAnalysisJobRow(row) : null;
  }

  async claimNextPendingAnalysisJob(params: {
    startedAt: string;
    staleBefore?: string;
  }): Promise<HetangAnalysisJob | null> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      const selected = await client.query(
        `
          SELECT job_id
          FROM analysis_jobs
          WHERE status = 'pending'
             OR (
               status = 'running'
               AND $1::text IS NOT NULL
               AND COALESCE(updated_at, started_at, created_at) <= $1
             )
          ORDER BY
            CASE
              WHEN status = 'pending' THEN 0
              ELSE 1
            END,
            created_at,
            job_id
          LIMIT 1
          FOR UPDATE
        `,
        [params.staleBefore ?? null],
      );
      const jobId = selected.rows[0]?.job_id as string | undefined;
      if (!jobId) {
        await client.query("COMMIT");
        return null;
      }
      const updated = await client.query(
        `
          UPDATE analysis_jobs
          SET status = 'running',
              attempt_count = attempt_count + 1,
              started_at = $2,
              updated_at = $2,
              finished_at = NULL,
              delivered_at = NULL,
              delivery_attempt_count = 0,
              last_delivery_attempt_at = NULL,
              last_delivery_error = NULL,
              next_delivery_after = NULL,
              delivery_abandoned_at = NULL,
              error_message = NULL
          WHERE job_id = $1
            AND (
              status = 'pending'
              OR (
                status = 'running'
                AND $3::text IS NOT NULL
                AND COALESCE(updated_at, started_at, created_at) <= $3
              )
            )
          RETURNING *
        `,
        [jobId, params.startedAt, params.staleBefore ?? null],
      );
      await client.query("COMMIT");
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      return row ? mapAnalysisJobRow(row) : null;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async completeAnalysisJob(params: {
    jobId: string;
    resultText: string;
    finishedAt: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET status = 'completed',
            result_text = $2,
            error_message = NULL,
            finished_at = $3,
            updated_at = $3
        WHERE job_id = $1
      `,
      [params.jobId, params.resultText, params.finishedAt],
    );
  }

  async failAnalysisJob(params: {
    jobId: string;
    errorMessage: string;
    finishedAt: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET status = 'failed',
            error_message = $2,
            finished_at = $3,
            updated_at = $3
        WHERE job_id = $1
      `,
      [params.jobId, params.errorMessage, params.finishedAt],
    );
  }

  async retryAnalysisJob(params: {
    jobId: string;
    retriedAt: string;
  }): Promise<HetangAnalysisJob | null> {
    const result = await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET status = 'pending',
            result_text = NULL,
            error_message = NULL,
            updated_at = $2,
            started_at = NULL,
            finished_at = NULL,
            delivered_at = NULL,
            delivery_attempt_count = 0,
            last_delivery_attempt_at = NULL,
            last_delivery_error = NULL,
            next_delivery_after = NULL,
            delivery_abandoned_at = NULL
        WHERE job_id = $1
          AND status = 'failed'
        RETURNING *
      `,
      [params.jobId, params.retriedAt],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (row) {
      await this.params.pool.query(
        `
          UPDATE analysis_job_subscribers
          SET delivered_at = NULL,
              delivery_attempt_count = 0,
              last_delivery_attempt_at = NULL,
              last_delivery_error = NULL,
              next_delivery_after = NULL,
              delivery_abandoned_at = NULL,
              updated_at = $2
          WHERE job_id = $1
        `,
        [params.jobId, params.retriedAt],
      );
    }
    return row ? mapAnalysisJobRow(row) : null;
  }

  async markAnalysisSubscriberDelivered(params: {
    subscriberKey: string;
    deliveredAt: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE analysis_job_subscribers
        SET delivered_at = $2,
            last_delivery_error = NULL,
            next_delivery_after = NULL,
            delivery_abandoned_at = NULL,
            updated_at = $2
        WHERE subscriber_key = $1
      `,
      [params.subscriberKey, params.deliveredAt],
    );
  }

  async markAnalysisSubscriberDeliveryAttempt(params: {
    subscriberKey: string;
    attemptedAt: string;
    errorMessage: string;
    nextDeliveryAfter: string;
  }): Promise<void> {
    const result = await this.params.pool.query(
      `
        UPDATE analysis_job_subscribers
        SET delivery_attempt_count = COALESCE(delivery_attempt_count, 0) + 1,
            last_delivery_attempt_at = $2,
            last_delivery_error = $3,
            next_delivery_after = CASE
              WHEN COALESCE(delivery_attempt_count, 0) + 1 >= $5 THEN NULL
              ELSE $4
            END,
            delivery_abandoned_at = CASE
              WHEN COALESCE(delivery_attempt_count, 0) + 1 >= $5 THEN $2
              ELSE NULL
            END,
            updated_at = $2
        WHERE subscriber_key = $1
        RETURNING job_id, delivery_abandoned_at
      `,
      [
        params.subscriberKey,
        params.attemptedAt,
        params.errorMessage,
        params.nextDeliveryAfter,
        ANALYSIS_DELIVERY_MAX_ATTEMPTS,
      ],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if ((row?.delivery_abandoned_at as string | null) && row?.job_id) {
      if (this.isAnalysisDeadLetterEnabled()) {
        const orgResult = await this.params.pool.query(
          `
            SELECT org_id
            FROM analysis_jobs
            WHERE job_id = $1
            LIMIT 1
          `,
          [String(row.job_id)],
        );
        const orgId = orgResult.rows[0]?.org_id as string | undefined;
        if (orgId) {
          await this.recordAnalysisDeadLetter({
            jobId: String(row.job_id),
            subscriberKey: params.subscriberKey,
            orgId,
            deadLetterScope: "subscriber",
            reason: params.errorMessage,
            observedAt: params.attemptedAt,
            payloadJson: JSON.stringify({
              nextDeliveryAfter: params.nextDeliveryAfter,
            }),
          });
        }
      }
      await this.syncAnalysisJobDeliveryState(String(row.job_id), params.attemptedAt);
    }
  }

  async markAllAnalysisSubscribersDelivered(params: {
    jobId: string;
    deliveredAt: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE analysis_job_subscribers
        SET delivered_at = $2,
            last_delivery_error = NULL,
            next_delivery_after = NULL,
            delivery_abandoned_at = NULL,
            updated_at = $2
        WHERE job_id = $1
          AND delivered_at IS NULL
      `,
      [params.jobId, params.deliveredAt],
    );
  }

  async refreshAnalysisJobDeliveryState(params: {
    jobId: string;
    deliveredAt: string;
  }): Promise<void> {
    await this.syncAnalysisJobDeliveryState(params.jobId, params.deliveredAt);
  }

  private async syncAnalysisJobDeliveryState(jobId: string, observedAt: string): Promise<void> {
    const summary = await this.params.pool.query(
      `
        SELECT
          SUM(
            CASE WHEN delivered_at IS NULL AND delivery_abandoned_at IS NULL THEN 1 ELSE 0 END
          )::int AS pending_count,
          SUM(CASE WHEN delivered_at IS NOT NULL THEN 1 ELSE 0 END)::int AS delivered_count
        FROM analysis_job_subscribers
        WHERE job_id = $1
      `,
      [jobId],
    );
    const pendingCount = normalizeNumeric(summary.rows[0]?.pending_count);
    const deliveredCount = normalizeNumeric(summary.rows[0]?.delivered_count);
    if (pendingCount === 0 && deliveredCount > 0) {
      await this.markAnalysisJobDelivered({
        jobId,
        deliveredAt: observedAt,
      });
      return;
    }
    if (pendingCount === 0 && deliveredCount === 0) {
      await this.markAnalysisJobDeliveryAbandoned({
        jobId,
        abandonedAt: observedAt,
      });
    }
  }

  async markAnalysisJobDelivered(params: { jobId: string; deliveredAt: string }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET delivered_at = $2,
            last_delivery_error = NULL,
            next_delivery_after = NULL,
            delivery_abandoned_at = NULL,
            updated_at = $2
        WHERE job_id = $1
      `,
      [params.jobId, params.deliveredAt],
    );
  }

  async markAnalysisJobDeliveryAttempt(params: {
    jobId: string;
    attemptedAt: string;
    errorMessage: string;
    nextDeliveryAfter: string;
  }): Promise<void> {
    const result = await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET delivery_attempt_count = COALESCE(delivery_attempt_count, 0) + 1,
            last_delivery_attempt_at = $2,
            last_delivery_error = $3,
            next_delivery_after = CASE
              WHEN COALESCE(delivery_attempt_count, 0) + 1 >= $5 THEN NULL
              ELSE $4
            END,
            delivery_abandoned_at = CASE
              WHEN COALESCE(delivery_attempt_count, 0) + 1 >= $5 THEN $2
              ELSE NULL
            END,
            updated_at = $2
        WHERE job_id = $1
        RETURNING org_id, delivery_abandoned_at
      `,
      [
        params.jobId,
        params.attemptedAt,
        params.errorMessage,
        params.nextDeliveryAfter,
        ANALYSIS_DELIVERY_MAX_ATTEMPTS,
      ],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (
      this.isAnalysisDeadLetterEnabled() &&
      (row?.delivery_abandoned_at as string | null) &&
      row?.org_id
    ) {
      await this.recordAnalysisDeadLetter({
        jobId: params.jobId,
        orgId: String(row.org_id),
        deadLetterScope: "job",
        reason: params.errorMessage,
        observedAt: params.attemptedAt,
        payloadJson: JSON.stringify({
          nextDeliveryAfter: params.nextDeliveryAfter,
        }),
      });
    }
  }

  async markAnalysisJobDeliveryAbandoned(params: {
    jobId: string;
    abandonedAt: string;
  }): Promise<void> {
    const result = await this.params.pool.query(
      `
        UPDATE analysis_jobs
        SET delivery_abandoned_at = $2,
            next_delivery_after = NULL,
            updated_at = $2
        WHERE job_id = $1
        RETURNING org_id
      `,
      [params.jobId, params.abandonedAt],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (this.isAnalysisDeadLetterEnabled() && row?.org_id) {
      await this.recordAnalysisDeadLetter({
        jobId: params.jobId,
        orgId: String(row.org_id),
        deadLetterScope: "job",
        reason: "delivery abandoned after subscriber fan-out exhaustion",
        observedAt: params.abandonedAt,
      });
    }
  }

  async createActionItem(item: HetangActionItem): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO action_center_items (
          action_id, org_id, biz_date, category, title, priority, status,
          source_kind, source_ref, owner_name, due_date, result_note, effect_score,
          created_by_channel, created_by_sender_id, created_by_name,
          created_at, updated_at, completed_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19
        )
        ON CONFLICT (action_id) DO UPDATE SET
          org_id = EXCLUDED.org_id,
          biz_date = EXCLUDED.biz_date,
          category = EXCLUDED.category,
          title = EXCLUDED.title,
          priority = EXCLUDED.priority,
          status = EXCLUDED.status,
          source_kind = EXCLUDED.source_kind,
          source_ref = EXCLUDED.source_ref,
          owner_name = EXCLUDED.owner_name,
          due_date = EXCLUDED.due_date,
          result_note = EXCLUDED.result_note,
          effect_score = EXCLUDED.effect_score,
          created_by_channel = EXCLUDED.created_by_channel,
          created_by_sender_id = EXCLUDED.created_by_sender_id,
          created_by_name = EXCLUDED.created_by_name,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          completed_at = EXCLUDED.completed_at
      `,
      [
        item.actionId,
        item.orgId,
        item.bizDate ?? null,
        item.category,
        item.title,
        item.priority,
        item.status,
        item.sourceKind,
        item.sourceRef ?? null,
        item.ownerName ?? null,
        item.dueDate ?? null,
        item.resultNote ?? null,
        item.effectScore ?? null,
        item.createdByChannel ?? null,
        item.createdBySenderId ?? null,
        item.createdByName ?? null,
        item.createdAt,
        item.updatedAt,
        item.completedAt ?? null,
      ],
    );
  }

  async updateActionItemStatus(params: {
    actionId: string;
    status: HetangActionItem["status"];
    resultNote?: string;
    effectScore?: number;
    ownerName?: string;
    dueDate?: string;
    updatedAt: string;
    completedAt?: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE action_center_items
        SET status = $2,
            result_note = COALESCE($3, result_note),
            effect_score = COALESCE($4, effect_score),
            owner_name = COALESCE($5, owner_name),
            due_date = COALESCE($6, due_date),
            updated_at = $7,
            completed_at = COALESCE($8, completed_at)
        WHERE action_id = $1
      `,
      [
        params.actionId,
        params.status,
        params.resultNote ?? null,
        params.effectScore ?? null,
        params.ownerName ?? null,
        params.dueDate ?? null,
        params.updatedAt,
        params.completedAt ?? null,
      ],
    );
  }

  async getActionItem(actionId: string): Promise<HetangActionItem | null> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM action_center_items
        WHERE action_id = $1
      `,
      [actionId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      actionId: String(row.action_id),
      orgId: String(row.org_id),
      bizDate: (row.biz_date as string | null) ?? undefined,
      category: String(row.category),
      title: String(row.title),
      priority: String(row.priority) as HetangActionItem["priority"],
      status: String(row.status) as HetangActionItem["status"],
      sourceKind: String(row.source_kind) as HetangActionItem["sourceKind"],
      sourceRef: (row.source_ref as string | null) ?? undefined,
      ownerName: (row.owner_name as string | null) ?? undefined,
      dueDate: (row.due_date as string | null) ?? undefined,
      resultNote: (row.result_note as string | null) ?? undefined,
      effectScore:
        row.effect_score === null || row.effect_score === undefined
          ? undefined
          : normalizeNumeric(row.effect_score),
      createdByChannel: (row.created_by_channel as string | null) ?? undefined,
      createdBySenderId: (row.created_by_sender_id as string | null) ?? undefined,
      createdByName: (row.created_by_name as string | null) ?? undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: (row.completed_at as string | null) ?? undefined,
    };
  }

  async listActionItems(
    params: {
      orgId?: string;
      status?: HetangActionItem["status"];
    } = {},
  ): Promise<HetangActionItem[]> {
    const values: string[] = [];
    const where: string[] = [];
    if (params.orgId) {
      values.push(params.orgId);
      where.push(`org_id = $${values.length}`);
    }
    if (params.status) {
      values.push(params.status);
      where.push(`status = $${values.length}`);
    }
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM action_center_items
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY org_id, action_id
      `,
      values,
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      actionId: String(row.action_id),
      orgId: String(row.org_id),
      bizDate: (row.biz_date as string | null) ?? undefined,
      category: String(row.category),
      title: String(row.title),
      priority: String(row.priority) as HetangActionItem["priority"],
      status: String(row.status) as HetangActionItem["status"],
      sourceKind: String(row.source_kind) as HetangActionItem["sourceKind"],
      sourceRef: (row.source_ref as string | null) ?? undefined,
      ownerName: (row.owner_name as string | null) ?? undefined,
      dueDate: (row.due_date as string | null) ?? undefined,
      resultNote: (row.result_note as string | null) ?? undefined,
      effectScore:
        row.effect_score === null || row.effect_score === undefined
          ? undefined
          : normalizeNumeric(row.effect_score),
      createdByChannel: (row.created_by_channel as string | null) ?? undefined,
      createdBySenderId: (row.created_by_sender_id as string | null) ?? undefined,
      createdByName: (row.created_by_name as string | null) ?? undefined,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      completedAt: (row.completed_at as string | null) ?? undefined,
    }));
  }

  async upsertControlTowerSetting(record: HetangControlTowerSettingRecord): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO control_tower_settings (
          scope_type, scope_key, setting_key, value_json, updated_at, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (scope_type, scope_key, setting_key) DO UPDATE SET
          value_json = EXCLUDED.value_json,
          updated_at = EXCLUDED.updated_at,
          updated_by = EXCLUDED.updated_by
      `,
      [
        record.scopeType,
        record.scopeKey,
        record.settingKey,
        JSON.stringify(record.value),
        record.updatedAt,
        record.updatedBy ?? null,
      ],
    );
  }

  async listControlTowerSettings(
    params: {
      scopeType?: HetangControlTowerScopeType;
      scopeKey?: string;
    } = {},
  ): Promise<HetangControlTowerSettingRecord[]> {
    const values: string[] = [];
    const where: string[] = [];
    if (params.scopeType) {
      values.push(params.scopeType);
      where.push(`scope_type = $${values.length}`);
    }
    if (params.scopeKey) {
      values.push(params.scopeKey);
      where.push(`scope_key = $${values.length}`);
    }
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM control_tower_settings
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY scope_type, scope_key, setting_key
      `,
      values,
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      scopeType: String(row.scope_type) as HetangControlTowerScopeType,
      scopeKey: String(row.scope_key),
      settingKey: String(row.setting_key),
      value: parseControlTowerValue(String(row.value_json)),
      updatedAt: String(row.updated_at),
      updatedBy: (row.updated_by as string | null) ?? undefined,
    }));
  }

  async resolveControlTowerSettings(
    orgId?: string,
  ): Promise<Record<string, HetangControlTowerSettingValue>> {
    const globalSettings = await this.listControlTowerSettings({
      scopeType: "global",
      scopeKey: "global",
    });
    const resolved = Object.fromEntries(
      globalSettings.map((entry) => [entry.settingKey, entry.value]),
    ) as Record<string, HetangControlTowerSettingValue>;
    if (!orgId) {
      return resolved;
    }
    const storeSettings = await this.listControlTowerSettings({
      scopeType: "store",
      scopeKey: orgId,
    });
    for (const entry of storeSettings) {
      resolved[entry.settingKey] = entry.value;
    }
    return resolved;
  }

  async recordRawBatch(params: {
    batchId: string;
    syncRunId?: string;
    endpoint: string;
    orgId: string;
    fetchedAt: string;
    requestJson?: string;
    responseJson?: string;
    rowCount: number;
  }): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO raw_api_batches (
          batch_id, sync_run_id, endpoint, org_id, fetched_at, row_count, request_json, response_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (batch_id) DO UPDATE SET
          response_json = EXCLUDED.response_json,
          row_count = EXCLUDED.row_count
      `,
      [
        params.batchId,
        params.syncRunId ?? null,
        params.endpoint,
        params.orgId,
        params.fetchedAt,
        params.rowCount,
        params.requestJson ?? null,
        params.responseJson ?? null,
      ],
    );
  }

  async recordRawRows(params: {
    endpoint: string;
    orgId: string;
    batchId: string;
    fetchedAt: string;
    rows: Array<Record<string, unknown>>;
  }): Promise<void> {
    for (const row of params.rows) {
      const rowKey = resolveRawRowKey(params.endpoint, row, params.orgId);
      const rowJson = JSON.stringify(row);
      await this.params.pool.query(
        `
          INSERT INTO raw_api_rows (
            endpoint, org_id, row_key, row_fingerprint, batch_id, raw_store_name,
            source_time, row_json, first_seen_at, last_seen_at, seen_count
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
          ON CONFLICT (endpoint, org_id, row_key) DO UPDATE SET
            batch_id = EXCLUDED.batch_id,
            raw_store_name = EXCLUDED.raw_store_name,
            source_time = EXCLUDED.source_time,
            row_json = EXCLUDED.row_json,
            last_seen_at = EXCLUDED.last_seen_at,
            seen_count = raw_api_rows.seen_count + 1
        `,
        [
          params.endpoint,
          params.orgId,
          rowKey,
          md5(rowJson),
          params.batchId,
          rowValue(row, "OrgName") || rowValue(row, "CorsOrgName") || null,
          rowValue(row, "OptTime") || rowValue(row, "CTime") || rowValue(row, "SettleTime") || null,
          rowJson,
          params.fetchedAt,
          params.fetchedAt,
        ],
      );
    }
  }

  async getRawRowSeenCount(endpoint: string, orgId: string, rowKey: string): Promise<number> {
    const result = await this.params.pool.query(
      `
        SELECT seen_count
        FROM raw_api_rows
        WHERE endpoint = $1 AND org_id = $2 AND row_key = $3
      `,
      [endpoint, orgId, rowKey],
    );
    return normalizeNumeric(result.rows[0]?.seen_count);
  }

  async insertExternalSourceDocument(row: {
    documentId: string;
    sourceId: string;
    sourceTier: HetangExternalSourceTier;
    sourceUrl?: string;
    title: string;
    summary?: string;
    contentText?: string;
    entity?: string;
    action?: string;
    object?: string;
    score?: number;
    publishedAt: string;
    eventAt?: string;
    fetchedAt: string;
    theme?: string;
    blockedReason?: string;
    rawJson?: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO external_source_documents (
          document_id, source_id, source_tier, source_url, title, summary, content_text,
          entity, action, object_text, score,
          published_at, event_at, fetched_at, theme, blocked_reason, raw_json,
          created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11,
          $12, $13, $14, $15, $16, $17,
          $14, $14
        )
        ON CONFLICT (document_id) DO UPDATE SET
          source_id = EXCLUDED.source_id,
          source_tier = EXCLUDED.source_tier,
          source_url = EXCLUDED.source_url,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          content_text = EXCLUDED.content_text,
          entity = EXCLUDED.entity,
          action = EXCLUDED.action,
          object_text = EXCLUDED.object_text,
          score = EXCLUDED.score,
          published_at = EXCLUDED.published_at,
          event_at = EXCLUDED.event_at,
          fetched_at = EXCLUDED.fetched_at,
          theme = EXCLUDED.theme,
          blocked_reason = EXCLUDED.blocked_reason,
          raw_json = EXCLUDED.raw_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.documentId,
        row.sourceId,
        row.sourceTier,
        row.sourceUrl ?? "",
        row.title,
        row.summary ?? "",
        row.contentText ?? null,
        row.entity ?? null,
        row.action ?? null,
        row.object ?? null,
        row.score ?? null,
        row.publishedAt,
        row.eventAt ?? null,
        row.fetchedAt,
        row.theme ?? null,
        row.blockedReason ?? null,
        row.rawJson ?? JSON.stringify({ documentId: row.documentId }),
      ],
    );
  }

  async listFreshExternalSourceDocuments(params: {
    sincePublishedAt: string;
    theme?: string;
    limit?: number;
  }): Promise<
    Array<{
      documentId: string;
      sourceId: string;
      sourceTier: HetangExternalSourceTier;
      sourceUrl: string;
      title: string;
      summary: string;
      score?: number;
      theme?: string;
      publishedAt: string;
      blockedReason?: string;
    }>
  > {
    const values: Array<string | number> = [params.sincePublishedAt];
    const where = [`published_at >= $${values.length}`];
    if (params.theme) {
      values.push(params.theme);
      where.push(`theme = $${values.length}`);
    }
    const limit = Math.max(1, Math.floor(params.limit ?? 50));
    values.push(limit);
    const result = await this.params.pool.query(
      `
        SELECT
          document_id,
          source_id,
          source_tier,
          source_url,
          title,
          summary,
          score,
          theme,
          published_at,
          blocked_reason
        FROM external_source_documents
        WHERE ${where.join(" AND ")}
        ORDER BY published_at DESC, document_id
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((entry: Record<string, unknown>) => ({
      documentId: String(entry.document_id),
      sourceId: String(entry.source_id),
      sourceTier: String(entry.source_tier) as HetangExternalSourceTier,
      sourceUrl: String(entry.source_url),
      title: String(entry.title),
      summary: String(entry.summary),
      score:
        entry.score === null || entry.score === undefined
          ? undefined
          : normalizeNumeric(entry.score),
      theme: (entry.theme as string | null) ?? undefined,
      publishedAt: String(entry.published_at),
      blockedReason: (entry.blocked_reason as string | null) ?? undefined,
    }));
  }

  async listExternalSourceDocuments(
    params: {
      sourceId?: string;
      publishedSince?: string;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      documentId: string;
      sourceId: string;
      sourceTier: HetangExternalSourceTier;
      sourceUrl: string;
      title: string;
      summary: string;
      entity?: string;
      action?: string;
      object?: string;
      score?: number;
      theme?: string;
      publishedAt: string;
      eventAt?: string;
      blockedReason?: string;
    }>
  > {
    const values: Array<string | number> = [];
    const where: string[] = [];
    if (params.sourceId) {
      values.push(params.sourceId);
      where.push(`source_id = $${values.length}`);
    }
    if (params.publishedSince) {
      values.push(params.publishedSince);
      where.push(`published_at >= $${values.length}`);
    }
    const limit = Math.max(1, Math.floor(params.limit ?? 50));
    values.push(limit);
    const result = await this.params.pool.query(
      `
        SELECT
          document_id,
          source_id,
          source_tier,
          source_url,
          title,
          summary,
          entity,
          action,
          object_text,
          score,
          theme,
          published_at,
          event_at,
          blocked_reason
        FROM external_source_documents
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY published_at DESC, document_id
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((entry: Record<string, unknown>) => ({
      documentId: String(entry.document_id),
      sourceId: String(entry.source_id),
      sourceTier: String(entry.source_tier) as HetangExternalSourceTier,
      sourceUrl: String(entry.source_url),
      title: String(entry.title),
      summary: String(entry.summary),
      entity: (entry.entity as string | null) ?? undefined,
      action: (entry.action as string | null) ?? undefined,
      object: (entry.object_text as string | null) ?? undefined,
      score:
        entry.score === null || entry.score === undefined
          ? undefined
          : normalizeNumeric(entry.score),
      theme: (entry.theme as string | null) ?? undefined,
      publishedAt: String(entry.published_at),
      eventAt: (entry.event_at as string | null) ?? undefined,
      blockedReason: (entry.blocked_reason as string | null) ?? undefined,
    }));
  }

  async upsertExternalEventCandidate(
    row: HetangExternalEventCandidate & {
      documentId?: string;
      sourceDocumentId?: string;
      sourceTier?: HetangExternalSourceTier;
      sourceUrl?: string;
      rawJson?: string;
      createdAt?: string;
      updatedAt?: string;
    },
  ): Promise<void> {
    const sourceDocumentId = row.sourceDocumentId ?? row.documentId ?? row.candidateId;
    const sourceDocument = await this.params.pool.query(
      `
        SELECT source_tier, source_url
        FROM external_source_documents
        WHERE document_id = $1
      `,
      [sourceDocumentId],
    );
    const tier =
      row.sourceTier ??
      row.tier ??
      (sourceDocument.rows[0]?.source_tier as HetangExternalSourceTier | undefined) ??
      "b";
    const sourceUrl =
      row.sourceUrl ?? (sourceDocument.rows[0]?.source_url as string | null) ?? null;
    const createdAt = row.createdAt ?? row.publishedAt;
    const updatedAt = row.updatedAt ?? createdAt;
    const rawJson = row.rawJson ?? JSON.stringify(row);
    await this.params.pool.query(
      `
        INSERT INTO external_event_candidates (
          candidate_id, source_document_id, source_id, source_tier, source_url, title, summary,
          entity, action, object_text, theme, normalized_key, published_at, event_at, score,
          blocked_reason, raw_json, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19
        )
        ON CONFLICT (candidate_id) DO UPDATE SET
          source_document_id = EXCLUDED.source_document_id,
          source_id = EXCLUDED.source_id,
          source_tier = EXCLUDED.source_tier,
          source_url = EXCLUDED.source_url,
          title = EXCLUDED.title,
          summary = EXCLUDED.summary,
          entity = EXCLUDED.entity,
          action = EXCLUDED.action,
          object_text = EXCLUDED.object_text,
          theme = EXCLUDED.theme,
          normalized_key = EXCLUDED.normalized_key,
          published_at = EXCLUDED.published_at,
          event_at = EXCLUDED.event_at,
          score = EXCLUDED.score,
          blocked_reason = EXCLUDED.blocked_reason,
          raw_json = EXCLUDED.raw_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.candidateId,
        sourceDocumentId,
        row.sourceId,
        tier,
        sourceUrl,
        row.title,
        row.summary,
        row.entity,
        row.action,
        row.object ?? null,
        row.theme,
        row.normalizedKey,
        row.publishedAt,
        row.eventAt ?? null,
        row.score,
        row.blockedReason ?? null,
        rawJson,
        createdAt,
        updatedAt,
      ],
    );
  }

  async listExternalEventCandidates(
    params: {
      theme?: string;
      publishedSince?: string;
      includeBlocked?: boolean;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      candidateId: string;
      documentId: string;
      sourceId: string;
      sourceTier: HetangExternalSourceTier;
      sourceUrl?: string;
      title: string;
      summary: string;
      entity: string;
      action: string;
      object?: string;
      theme: string;
      normalizedKey: string;
      publishedAt: string;
      eventAt?: string;
      score: number;
      blockedReason?: string;
    }>
  > {
    const values: Array<string | number> = [];
    const where: string[] = [];
    if (params.theme) {
      values.push(params.theme);
      where.push(`theme = $${values.length}`);
    }
    if (params.publishedSince) {
      values.push(params.publishedSince);
      where.push(`published_at >= $${values.length}`);
    }
    if (!params.includeBlocked) {
      where.push("blocked_reason IS NULL");
    }
    const limit = Math.max(1, Math.floor(params.limit ?? 50));
    values.push(limit);
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM external_event_candidates
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY published_at DESC, score DESC, candidate_id
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((entry: Record<string, unknown>) => ({
      candidateId: String(entry.candidate_id),
      documentId: String(entry.source_document_id),
      sourceId: String(entry.source_id),
      sourceTier: String(entry.source_tier) as HetangExternalSourceTier,
      sourceUrl: (entry.source_url as string | null) ?? undefined,
      title: String(entry.title),
      summary: String(entry.summary),
      entity: String(entry.entity),
      action: String(entry.action),
      object: (entry.object_text as string | null) ?? undefined,
      theme: String(entry.theme),
      normalizedKey: String(entry.normalized_key),
      publishedAt: String(entry.published_at),
      eventAt: (entry.event_at as string | null) ?? undefined,
      score: normalizeNumeric(entry.score),
      blockedReason: (entry.blocked_reason as string | null) ?? undefined,
    }));
  }

  async upsertExternalEventCard(row: {
    cardId: string;
    issueDate?: string;
    theme: string;
    entity: string;
    action: string;
    object?: string;
    summary: string;
    publishedAt: string;
    eventAt?: string;
    score: number;
    sourceTier?: HetangExternalSourceTier;
    sources?: Array<{
      sourceId: string;
      displayName?: string;
      tier: HetangExternalSourceTier;
      url?: string;
      notes?: string;
    }>;
    sourceUrls?: string[];
    sourceDocumentIds?: string[];
    candidateIds: string[];
    createdAt?: string;
    updatedAt?: string;
  }): Promise<void> {
    const issueDate = row.issueDate ?? row.publishedAt.slice(0, 10);
    const sourceUrls =
      row.sourceUrls ?? row.sources?.map((source) => source.url ?? "").filter(Boolean) ?? [];
    const sourceDocumentIds = row.sourceDocumentIds ?? [];
    const sources =
      row.sources ??
      sourceUrls.map((url, index) => ({
        sourceId: row.sourceDocumentIds?.[index] ?? `source-${index + 1}`,
        tier: row.sourceTier ?? "b",
        url,
      }));
    const sourceTier = resolveStrongestSourceTier(sources, row.sourceTier);
    const createdAt = row.createdAt ?? row.publishedAt;
    const updatedAt = row.updatedAt ?? createdAt;
    await this.params.pool.query(
      `
        INSERT INTO external_event_cards (
          card_id, issue_date, theme, entity, action, object_text, summary,
          published_at, event_at, score, source_tier, sources_json, source_urls_json,
          source_document_ids_json, candidate_ids_json, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17
        )
        ON CONFLICT (card_id) DO UPDATE SET
          issue_date = EXCLUDED.issue_date,
          theme = EXCLUDED.theme,
          entity = EXCLUDED.entity,
          action = EXCLUDED.action,
          object_text = EXCLUDED.object_text,
          summary = EXCLUDED.summary,
          published_at = EXCLUDED.published_at,
          event_at = EXCLUDED.event_at,
          score = EXCLUDED.score,
          source_tier = EXCLUDED.source_tier,
          sources_json = EXCLUDED.sources_json,
          source_urls_json = EXCLUDED.source_urls_json,
          source_document_ids_json = EXCLUDED.source_document_ids_json,
          candidate_ids_json = EXCLUDED.candidate_ids_json,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.cardId,
        issueDate,
        row.theme,
        row.entity,
        row.action,
        row.object ?? null,
        row.summary,
        row.publishedAt,
        row.eventAt ?? null,
        row.score,
        sourceTier,
        JSON.stringify(sources),
        JSON.stringify(sourceUrls),
        JSON.stringify(sourceDocumentIds),
        JSON.stringify(row.candidateIds),
        createdAt,
        updatedAt,
      ],
    );
  }

  async listExternalEventCards(
    params: {
      issueDate?: string;
      theme?: string;
      publishedAtFrom?: string;
      publishedAtTo?: string;
      publishedSince?: string;
      publishedBefore?: string;
      limit?: number;
    } = {},
  ): Promise<
    Array<{
      cardId: string;
      issueDate: string;
      theme: string;
      entity: string;
      action: string;
      object?: string;
      summary: string;
      publishedAt: string;
      eventAt?: string;
      score: number;
      sourceTier: HetangExternalSourceTier;
      sources: Array<{
        sourceId: string;
        displayName?: string;
        tier: HetangExternalSourceTier;
        url?: string;
        notes?: string;
      }>;
      sourceUrls: string[];
      sourceDocumentIds: string[];
      candidateIds: string[];
    }>
  > {
    const values: Array<string | number> = [];
    const where: string[] = [];
    if (params.issueDate) {
      values.push(params.issueDate);
      where.push(`issue_date = $${values.length}`);
    }
    if (params.theme) {
      values.push(params.theme);
      where.push(`theme = $${values.length}`);
    }
    const publishedAtFrom = params.publishedAtFrom ?? params.publishedSince;
    if (publishedAtFrom) {
      values.push(publishedAtFrom);
      where.push(`published_at >= $${values.length}`);
    }
    const publishedAtTo = params.publishedAtTo ?? params.publishedBefore;
    if (publishedAtTo) {
      values.push(publishedAtTo);
      where.push(`published_at <= $${values.length}`);
    }
    const limit = Math.max(1, Math.floor(params.limit ?? 50));
    values.push(limit);
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM external_event_cards
        ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY published_at DESC, score DESC, card_id
        LIMIT $${values.length}
      `,
      values,
    );
    return result.rows.map((entry: Record<string, unknown>) => ({
      cardId: String(entry.card_id),
      issueDate: String(entry.issue_date),
      theme: String(entry.theme),
      entity: String(entry.entity),
      action: String(entry.action),
      object: (entry.object_text as string | null) ?? undefined,
      summary: String(entry.summary),
      publishedAt: String(entry.published_at),
      eventAt: (entry.event_at as string | null) ?? undefined,
      score: normalizeNumeric(entry.score),
      sourceTier: String(entry.source_tier) as HetangExternalSourceTier,
      sources: parseSourceConfigs(entry.sources_json),
      sourceUrls: parseStringArray(entry.source_urls_json),
      sourceDocumentIds: parseStringArray(entry.source_document_ids_json),
      candidateIds: parseStringArray(entry.candidate_ids_json),
    }));
  }

  async getExternalEventCard(cardId: string): Promise<{
    cardId: string;
    issueDate: string;
    theme: string;
    entity: string;
    action: string;
    object?: string;
    summary: string;
    publishedAt: string;
    eventAt?: string;
    score: number;
    sourceTier: HetangExternalSourceTier;
    sources: Array<{
      sourceId: string;
      displayName?: string;
      tier: HetangExternalSourceTier;
      url?: string;
      notes?: string;
    }>;
    sourceUrls: string[];
    sourceDocumentIds: string[];
    candidateIds: string[];
  } | null> {
    const result = await this.listExternalEventCards({
      limit: 1,
    });
    if (result.length === 0) {
      return null;
    }
    const direct = result.find((entry) => entry.cardId === cardId);
    if (direct) {
      return direct;
    }
    const query = await this.params.pool.query(
      `
        SELECT *
        FROM external_event_cards
        WHERE card_id = $1
      `,
      [cardId],
    );
    const row = query.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      cardId: String(row.card_id),
      issueDate: String(row.issue_date),
      theme: String(row.theme),
      entity: String(row.entity),
      action: String(row.action),
      object: (row.object_text as string | null) ?? undefined,
      summary: String(row.summary),
      publishedAt: String(row.published_at),
      eventAt: (row.event_at as string | null) ?? undefined,
      score: normalizeNumeric(row.score),
      sourceTier: String(row.source_tier) as HetangExternalSourceTier,
      sources: parseSourceConfigs(row.sources_json),
      sourceUrls: parseStringArray(row.source_urls_json),
      sourceDocumentIds: parseStringArray(row.source_document_ids_json),
      candidateIds: parseStringArray(row.candidate_ids_json),
    };
  }

  async createExternalBriefIssue(row: {
    issueId: string;
    issueDate: string;
    topic: string;
    createdAt: string;
    items?: HetangExternalBriefItem[];
  }): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO external_brief_issues (
          issue_id, issue_date, topic, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT (issue_id) DO UPDATE SET
          issue_date = EXCLUDED.issue_date,
          topic = EXCLUDED.topic,
          updated_at = EXCLUDED.updated_at
      `,
      [row.issueId, row.issueDate, row.topic, row.createdAt],
    );
    if (row.items && row.items.length > 0) {
      await this.insertExternalBriefItems(row.issueId, row.items);
    }
  }

  async insertExternalBriefItems(issueId: string, items: HetangExternalBriefItem[]): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM external_brief_items
          WHERE issue_id = $1
        `,
        [issueId],
      );
      const writtenAt = new Date().toISOString();
      for (const item of items) {
        await client.query(
          `
            INSERT INTO external_brief_items (
              issue_id, item_id, card_id, title, theme, summary,
              why_it_matters, score, rank_order, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
          `,
          [
            issueId,
            item.itemId,
            item.cardId,
            item.title,
            item.theme,
            item.summary,
            item.whyItMatters,
            item.score,
            item.rank,
            writtenAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listExternalBriefItems(issueId: string): Promise<HetangExternalBriefItem[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM external_brief_items
        WHERE issue_id = $1
        ORDER BY rank_order, item_id
      `,
      [issueId],
    );
    return result.rows.map((entry: Record<string, unknown>) => ({
      itemId: String(entry.item_id),
      cardId: String(entry.card_id),
      title: String(entry.title),
      theme: String(entry.theme),
      summary: String(entry.summary),
      whyItMatters: String(entry.why_it_matters),
      score: normalizeNumeric(entry.score),
      rank: normalizeNumeric(entry.rank_order),
    }));
  }

  async getExternalBriefIssue(issueId: string): Promise<{
    issueId: string;
    issueDate: string;
    topic: string;
    createdAt: string;
    updatedAt: string;
    items: HetangExternalBriefItem[];
  } | null> {
    const issue = await this.params.pool.query(
      `
        SELECT *
        FROM external_brief_issues
        WHERE issue_id = $1
      `,
      [issueId],
    );
    const row = issue.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    const items = await this.listExternalBriefItems(issueId);
    return {
      issueId: String(row.issue_id),
      issueDate: String(row.issue_date),
      topic: String(row.topic),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      items,
    };
  }

  async getLatestExternalBriefIssue(): Promise<{
    issueId: string;
    issueDate: string;
    topic: string;
    createdAt: string;
    updatedAt: string;
    items: HetangExternalBriefItem[];
  } | null> {
    const issue = await this.params.pool.query(
      `
        SELECT *
        FROM external_brief_issues
        ORDER BY issue_date DESC, created_at DESC, issue_id DESC
        LIMIT 1
      `,
    );
    const row = issue.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return this.getExternalBriefIssue(String(row.issue_id));
  }

  private async upsertMany<T>(rows: T[], queryBuilder: (row: T) => Promise<void>): Promise<void> {
    for (const row of rows) {
      await queryBuilder(row);
    }
  }

  async upsertMemberCurrent(rows: MemberCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_member_current (
            org_id, member_id, name, phone, stored_amount, consume_amount,
            created_time, last_consume_time, silent_days, raw_store_name, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (org_id, member_id) DO UPDATE SET
            name = EXCLUDED.name,
            phone = EXCLUDED.phone,
            stored_amount = EXCLUDED.stored_amount,
            consume_amount = EXCLUDED.consume_amount,
            created_time = EXCLUDED.created_time,
            last_consume_time = EXCLUDED.last_consume_time,
            silent_days = EXCLUDED.silent_days,
            raw_store_name = EXCLUDED.raw_store_name,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.memberId,
          row.name,
          row.phone ?? null,
          row.storedAmount,
          row.consumeAmount,
          row.createdTime ?? null,
          row.lastConsumeTime ?? null,
          row.silentDays,
          row.rawStoreName ?? null,
          row.rawJson,
        ],
      );
    });
  }

  async snapshotMembers(bizDate: string, rows: MemberCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_member_daily_snapshot (
            biz_date, org_id, member_id, name, stored_amount, consume_amount,
            last_consume_time, silent_days, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (biz_date, org_id, member_id) DO UPDATE SET
            name = EXCLUDED.name,
            stored_amount = EXCLUDED.stored_amount,
            consume_amount = EXCLUDED.consume_amount,
            last_consume_time = EXCLUDED.last_consume_time,
            silent_days = EXCLUDED.silent_days,
            raw_json = EXCLUDED.raw_json
        `,
        [
          bizDate,
          row.orgId,
          row.memberId,
          row.name,
          row.storedAmount,
          row.consumeAmount,
          row.lastConsumeTime ?? null,
          row.silentDays,
          row.rawJson,
        ],
      );
    });
  }

  async snapshotMemberCards(bizDate: string, rows: MemberCardCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_member_cards_daily_snapshot (
            biz_date, org_id, member_id, card_id, card_no, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (biz_date, org_id, card_id) DO UPDATE SET
            member_id = EXCLUDED.member_id,
            card_no = EXCLUDED.card_no,
            raw_json = EXCLUDED.raw_json
        `,
        [bizDate, row.orgId, row.memberId, row.cardId, row.cardNo ?? null, row.rawJson],
      );
    });
  }

  async replaceMemberDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCurrentRecord[],
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM fact_member_daily_snapshot
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO fact_member_daily_snapshot (
              biz_date, org_id, member_id, name, stored_amount, consume_amount,
              last_consume_time, silent_days, raw_json
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            bizDate,
            row.orgId,
            row.memberId,
            row.name,
            row.storedAmount,
            row.consumeAmount,
            row.lastConsumeTime ?? null,
            row.silentDays,
            row.rawJson,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async replaceMemberCardDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM fact_member_cards_daily_snapshot
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO fact_member_cards_daily_snapshot (
              biz_date, org_id, member_id, card_id, card_no, raw_json
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [bizDate, orgId, row.memberId, row.cardId, row.cardNo ?? null, row.rawJson],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async upsertMemberCards(rows: MemberCardCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_member_cards_current (
            org_id, member_id, card_id, card_no, raw_json
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (org_id, card_id) DO UPDATE SET
            member_id = EXCLUDED.member_id,
            card_no = EXCLUDED.card_no,
            raw_json = EXCLUDED.raw_json
        `,
        [row.orgId, row.memberId, row.cardId, row.cardNo ?? null, row.rawJson],
      );
    });
  }

  async upsertConsumeBills(
    rows: ConsumeBillRecord[],
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_consume_bills (
            org_id, settle_id, settle_no, pay_amount, consume_amount,
            discount_amount, anti_flag, opt_time, biz_date, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (org_id, settle_id) DO UPDATE SET
            settle_no = EXCLUDED.settle_no,
            pay_amount = EXCLUDED.pay_amount,
            consume_amount = EXCLUDED.consume_amount,
            discount_amount = EXCLUDED.discount_amount,
            anti_flag = EXCLUDED.anti_flag,
            opt_time = EXCLUDED.opt_time,
            biz_date = EXCLUDED.biz_date,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.settleId,
          row.settleNo ?? null,
          row.payAmount,
          row.consumeAmount,
          row.discountAmount,
          row.antiFlag,
          row.optTime,
          row.bizDate,
          row.rawJson,
        ],
      );
    });
    await this.handleAnalyticsMutation(options);
  }

  async upsertRechargeBills(
    rows: RechargeBillRecord[],
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_recharge_bills (
            org_id, recharge_id, reality_amount, total_amount,
            donate_amount, anti_flag, opt_time, biz_date, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (org_id, recharge_id) DO UPDATE SET
            reality_amount = EXCLUDED.reality_amount,
            total_amount = EXCLUDED.total_amount,
            donate_amount = EXCLUDED.donate_amount,
            anti_flag = EXCLUDED.anti_flag,
            opt_time = EXCLUDED.opt_time,
            biz_date = EXCLUDED.biz_date,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.rechargeId,
          row.realityAmount,
          row.totalAmount,
          row.donateAmount,
          row.antiFlag,
          row.optTime,
          row.bizDate,
          row.rawJson,
        ],
      );
    });
  }

  async upsertUserTrades(rows: UserTradeRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_user_trades (
            org_id, row_fingerprint, trade_no, opt_time, biz_date, card_opt_type,
            change_balance, change_reality, change_donate, change_integral,
            payment_type, anti_flag, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (org_id, row_fingerprint) DO UPDATE SET
            trade_no = EXCLUDED.trade_no,
            opt_time = EXCLUDED.opt_time,
            biz_date = EXCLUDED.biz_date,
            card_opt_type = EXCLUDED.card_opt_type,
            change_balance = EXCLUDED.change_balance,
            change_reality = EXCLUDED.change_reality,
            change_donate = EXCLUDED.change_donate,
            change_integral = EXCLUDED.change_integral,
            payment_type = EXCLUDED.payment_type,
            anti_flag = EXCLUDED.anti_flag,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.rowFingerprint,
          row.tradeNo ?? null,
          row.optTime,
          row.bizDate,
          row.cardOptType ?? null,
          row.changeBalance,
          row.changeReality,
          row.changeDonate,
          row.changeIntegral,
          row.paymentType ?? null,
          row.antiFlag,
          row.rawJson,
        ],
      );
    });
  }

  async upsertTechCurrent(rows: TechCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO dim_tech_current (
            org_id, tech_code, tech_name, is_work, is_job, point_clock_num,
            wheel_clock_num, base_wages, raw_store_name, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (org_id, tech_code) DO UPDATE SET
            tech_name = EXCLUDED.tech_name,
            is_work = EXCLUDED.is_work,
            is_job = EXCLUDED.is_job,
            point_clock_num = EXCLUDED.point_clock_num,
            wheel_clock_num = EXCLUDED.wheel_clock_num,
            base_wages = EXCLUDED.base_wages,
            raw_store_name = EXCLUDED.raw_store_name,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.techCode,
          row.techName,
          row.isWork,
          row.isJob,
          row.pointClockNum,
          row.wheelClockNum,
          row.baseWages,
          row.rawStoreName ?? null,
          row.rawJson,
        ],
      );
    });
  }

  async snapshotTechCurrent(bizDate: string, rows: TechCurrentRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_tech_daily_snapshot (
            biz_date, org_id, tech_code, tech_name, is_work, is_job,
            point_clock_num, wheel_clock_num, base_wages, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (biz_date, org_id, tech_code) DO UPDATE SET
            tech_name = EXCLUDED.tech_name,
            is_work = EXCLUDED.is_work,
            is_job = EXCLUDED.is_job,
            point_clock_num = EXCLUDED.point_clock_num,
            wheel_clock_num = EXCLUDED.wheel_clock_num,
            base_wages = EXCLUDED.base_wages,
            raw_json = EXCLUDED.raw_json
        `,
        [
          bizDate,
          row.orgId,
          row.techCode,
          row.techName,
          row.isWork,
          row.isJob,
          row.pointClockNum,
          row.wheelClockNum,
          row.baseWages,
          row.rawJson,
        ],
      );
    });
  }

  async upsertTechUpClockRows(
    rows: TechUpClockRecord[],
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_tech_up_clock (
            org_id, row_fingerprint, person_code, person_name, settle_no,
            hand_card_code, item_name, clock_type, count, turnover, comm,
            ctime, settle_time, biz_date, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          ON CONFLICT (org_id, row_fingerprint) DO UPDATE SET
            person_code = EXCLUDED.person_code,
            person_name = EXCLUDED.person_name,
            settle_no = EXCLUDED.settle_no,
            hand_card_code = EXCLUDED.hand_card_code,
            item_name = EXCLUDED.item_name,
            clock_type = EXCLUDED.clock_type,
            count = EXCLUDED.count,
            turnover = EXCLUDED.turnover,
            comm = EXCLUDED.comm,
            ctime = EXCLUDED.ctime,
            settle_time = EXCLUDED.settle_time,
            biz_date = EXCLUDED.biz_date,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.rowFingerprint,
          row.personCode,
          row.personName,
          row.settleNo ?? null,
          row.handCardCode ?? null,
          row.itemName ?? null,
          row.clockType ?? null,
          row.count,
          row.turnover,
          row.comm,
          row.ctime ?? null,
          row.settleTime ?? null,
          row.bizDate,
          row.rawJson,
        ],
      );
    });
    await this.handleAnalyticsMutation(options);
  }

  async upsertTechMarketRows(
    rows: TechMarketRecord[],
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_tech_market (
            org_id, record_key, market_id, settle_no, hand_card_code, room_code,
            person_code, person_name, item_id, item_name, item_type_name, item_category,
            sales_code, sales_name, count, after_disc, commission, settle_time, biz_date, raw_json
          ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20
          )
          ON CONFLICT (org_id, record_key) DO UPDATE SET
            market_id = EXCLUDED.market_id,
            settle_no = EXCLUDED.settle_no,
            hand_card_code = EXCLUDED.hand_card_code,
            room_code = EXCLUDED.room_code,
            person_code = EXCLUDED.person_code,
            person_name = EXCLUDED.person_name,
            item_id = EXCLUDED.item_id,
            item_name = EXCLUDED.item_name,
            item_type_name = EXCLUDED.item_type_name,
            item_category = EXCLUDED.item_category,
            sales_code = EXCLUDED.sales_code,
            sales_name = EXCLUDED.sales_name,
            count = EXCLUDED.count,
            after_disc = EXCLUDED.after_disc,
            commission = EXCLUDED.commission,
            settle_time = EXCLUDED.settle_time,
            biz_date = EXCLUDED.biz_date,
            raw_json = EXCLUDED.raw_json
        `,
        [
          row.orgId,
          row.recordKey,
          row.marketId ?? null,
          row.settleNo ?? null,
          row.handCardCode ?? null,
          row.roomCode ?? null,
          row.personCode ?? null,
          row.personName ?? null,
          row.itemId ?? null,
          row.itemName ?? null,
          row.itemTypeName ?? null,
          row.itemCategory ?? null,
          row.salesCode ?? null,
          row.salesName ?? null,
          row.count,
          row.afterDisc,
          row.commission,
          row.settleTime ?? null,
          row.bizDate,
          row.rawJson,
        ],
      );
    });
    await this.handleAnalyticsMutation(options);
  }

  async upsertTechCommissionSnapshots(rows: TechCommissionSnapshotRecord[]): Promise<void> {
    await this.upsertMany(rows, async (row) => {
      await this.params.pool.query(
        `
          INSERT INTO fact_tech_commission_snapshot (
            biz_date, org_id, item_id, item_name, rule_hash, raw_json
          ) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (biz_date, org_id, item_id, rule_hash) DO UPDATE SET
            item_name = EXCLUDED.item_name,
            raw_json = EXCLUDED.raw_json
        `,
        [row.bizDate, row.orgId, row.itemId, row.itemName ?? null, row.ruleHash, row.rawJson],
      );
    });
  }

  async listMemberIds(orgId: string): Promise<string[]> {
    const result = await this.params.pool.query(
      `
        SELECT member_id
        FROM fact_member_current
        WHERE org_id = $1
        ORDER BY member_id
      `,
      [orgId],
    );
    return result.rows.map((row: Record<string, unknown>) => String(row.member_id));
  }

  async listMemberCardIds(orgId: string): Promise<string[]> {
    const result = await this.params.pool.query(
      `
        SELECT card_id
        FROM fact_member_cards_current
        WHERE org_id = $1
        ORDER BY card_id
      `,
      [orgId],
    );
    return result.rows.map((row: Record<string, unknown>) => String(row.card_id));
  }

  async listCurrentMemberCards(orgId: string): Promise<MemberCardCurrentRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_member_cards_current
        WHERE org_id = $1
        ORDER BY member_id, card_id
      `,
      [orgId],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      memberId: String(record.member_id),
      cardId: String(record.card_id),
      cardNo: (record.card_no as string | null) ?? undefined,
      rawJson: String(record.raw_json),
    }));
  }

  async listRecentUserTradeCandidateCardIds(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<string[]> {
    const currentCards = await this.listCurrentMemberCards(params.orgId);
    const cardIdByCardNo = new Map<string, string>();
    const activityAtByCardId = new Map<string, string>();

    for (const card of currentCards) {
      if (card.cardNo) {
        cardIdByCardNo.set(card.cardNo, card.cardId);
      }
      const raw = parseJsonRecord(card.rawJson);
      const lastUseAt = normalizeSortableTimestamp(raw.LastUseTime);
      if (
        isBizDateWithinRange(
          extractBizDateFromTimestamp(lastUseAt),
          params.startBizDate,
          params.endBizDate,
        )
      ) {
        rememberCandidateActivity(activityAtByCardId, card.cardId, lastUseAt);
      }
    }

    const rechargeBills = await this.listRechargeBillsByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
    for (const bill of rechargeBills) {
      const raw = parseJsonRecord(bill.rawJson);
      const rawCardId =
        raw.CardId === undefined || raw.CardId === null ? undefined : String(raw.CardId);
      const rawCardNo =
        raw.CardNo === undefined || raw.CardNo === null ? undefined : String(raw.CardNo);
      const cardId = rawCardId ?? (rawCardNo ? cardIdByCardNo.get(rawCardNo) : undefined);
      rememberCandidateActivity(activityAtByCardId, cardId, normalizeSortableTimestamp(bill.optTime));
    }

    const consumeBills = await this.listConsumeBillsByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
    for (const bill of consumeBills) {
      const raw = parseJsonRecord(bill.rawJson);
      const rawCardId =
        raw.CardId === undefined || raw.CardId === null ? undefined : String(raw.CardId);
      if (rawCardId) {
        rememberCandidateActivity(
          activityAtByCardId,
          rawCardId,
          normalizeSortableTimestamp(bill.optTime),
        );
      }
      const candidateCardNos = new Set([
        ...collectStringTokens(raw.HandCardCode),
        ...collectStringTokens(raw.HandCardCodes),
      ]);
      for (const cardNo of candidateCardNos) {
        rememberCandidateActivity(
          activityAtByCardId,
          cardIdByCardNo.get(cardNo),
          normalizeSortableTimestamp(bill.optTime),
        );
      }
    }

    return Array.from(activityAtByCardId.entries())
      .sort(
        ([leftCardId, leftActivityAt], [rightCardId, rightActivityAt]) =>
          rightActivityAt.localeCompare(leftActivityAt) || leftCardId.localeCompare(rightCardId),
      )
      .map(([cardId]) => cardId);
  }

  async listMemberCardDailySnapshotsByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<MemberCardDailySnapshotRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_member_cards_daily_snapshot
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, member_id, card_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    if (result.rows.length > 0) {
      return result.rows.map((record: Record<string, unknown>) => ({
        bizDate: String(record.biz_date),
        orgId,
        memberId: String(record.member_id),
        cardId: String(record.card_id),
        cardNo: (record.card_no as string | null) ?? undefined,
        rawJson: String(record.raw_json),
      }));
    }

    const legacyResult = await this.params.pool.query(
      `
        SELECT biz_date, raw_json
        FROM fact_member_daily_snapshot
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, member_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return legacyResult.rows.flatMap((record: Record<string, unknown>) => {
      const bizDate = String(record.biz_date);
      return normalizeMemberCardRows(parseJsonRecord(String(record.raw_json)), orgId).map((card) => ({
        bizDate,
        ...card,
      }));
    });
  }

  async listActiveTechCodes(orgId: string): Promise<string[]> {
    const result = await this.params.pool.query(
      `
        SELECT tech_code
        FROM dim_tech_current
        WHERE org_id = $1
        ORDER BY tech_code
      `,
      [orgId],
    );
    return result.rows.map((row: Record<string, unknown>) => String(row.tech_code));
  }

  async listConsumeBillsByDate(orgId: string, bizDate: string): Promise<ConsumeBillRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_consume_bills
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY opt_time, settle_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      settleId: String(record.settle_id),
      settleNo: (record.settle_no as string | null) ?? undefined,
      payAmount: normalizeNumeric(record.pay_amount),
      consumeAmount: normalizeNumeric(record.consume_amount),
      discountAmount: normalizeNumeric(record.discount_amount),
      antiFlag: Boolean(record.anti_flag),
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listConsumeBillsByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<ConsumeBillRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_consume_bills
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, opt_time, settle_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      settleId: String(record.settle_id),
      settleNo: (record.settle_no as string | null) ?? undefined,
      payAmount: normalizeNumeric(record.pay_amount),
      consumeAmount: normalizeNumeric(record.consume_amount),
      discountAmount: normalizeNumeric(record.discount_amount),
      antiFlag: Boolean(record.anti_flag),
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listStoreManagerDailyKpiByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<StoreManagerDailyKpiRow[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mv_store_manager_daily_kpi
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date DESC
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      bizDate: String(record.biz_date),
      orgId: String(record.org_id),
      storeName: String(record.store_name ?? orgId),
      dailyActualRevenue: normalizeNumeric(record.daily_actual_revenue),
      dailyCardConsume: normalizeNumeric(record.daily_card_consume),
      dailyOrderCount: normalizeNumeric(record.daily_order_count),
      totalClocks: normalizeNumeric(record.total_clocks),
      assignClocks: normalizeNumeric(record.assign_clocks),
      queueClocks: normalizeNumeric(record.queue_clocks),
      pointClockRate:
        record.point_clock_rate === null || record.point_clock_rate === undefined
          ? null
          : normalizeNumeric(record.point_clock_rate),
      averageTicket:
        record.average_ticket === null || record.average_ticket === undefined
          ? null
          : normalizeNumeric(record.average_ticket),
      clockEffect:
        record.clock_effect === null || record.clock_effect === undefined
          ? null
          : normalizeNumeric(record.clock_effect),
    }));
  }

  async listTechProfile30dByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<TechProfile30dRow[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mv_tech_profile_30d
        WHERE org_id = $1 AND window_end_biz_date BETWEEN $2 AND $3
        ORDER BY window_end_biz_date DESC, tech_code
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId: String(record.org_id),
      windowEndBizDate: String(record.window_end_biz_date),
      techCode: String(record.tech_code),
      techName: String(record.tech_name),
      servedCustomerCount30d: normalizeNumeric(record.served_customer_count_30d),
      servedOrderCount30d: normalizeNumeric(record.served_order_count_30d),
      serviceDayCount30d: normalizeNumeric(record.service_day_count_30d),
      totalClockCount30d: normalizeNumeric(record.total_clock_count_30d),
      pointClockCount30d: normalizeNumeric(record.point_clock_count_30d),
      queueClockCount30d: normalizeNumeric(record.queue_clock_count_30d),
      pointClockRate30d:
        record.point_clock_rate_30d === null || record.point_clock_rate_30d === undefined
          ? null
          : normalizeNumeric(record.point_clock_rate_30d),
      addClockRate30d:
        record.add_clock_rate_30d === null || record.add_clock_rate_30d === undefined
          ? null
          : normalizeNumeric(record.add_clock_rate_30d),
      turnover30d: normalizeNumeric(record.turnover_30d),
      commission30d: normalizeNumeric(record.commission_30d),
      marketRevenue30d: normalizeNumeric(record.market_revenue_30d),
      activeDays30d: normalizeNumeric(record.active_days_30d),
    }));
  }

  async listStoreReview7dByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<StoreReview7dRow[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mv_store_review_7d
        WHERE org_id = $1 AND window_end_biz_date BETWEEN $2 AND $3
        ORDER BY window_end_biz_date DESC
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId: String(record.org_id),
      windowEndBizDate: String(record.window_end_biz_date),
      storeName: String(record.store_name ?? orgId),
      revenue7d: normalizeNumeric(record.revenue_7d),
      orderCount7d: normalizeNumeric(record.order_count_7d),
      totalClocks7d: normalizeNumeric(record.total_clocks_7d),
      clockEffect7d:
        record.clock_effect_7d === null || record.clock_effect_7d === undefined
          ? null
          : normalizeNumeric(record.clock_effect_7d),
      averageTicket7d:
        record.average_ticket_7d === null || record.average_ticket_7d === undefined
          ? null
          : normalizeNumeric(record.average_ticket_7d),
      pointClockRate7d:
        record.point_clock_rate_7d === null || record.point_clock_rate_7d === undefined
          ? null
          : normalizeNumeric(record.point_clock_rate_7d),
      addClockRate7d:
        record.add_clock_rate_7d === null || record.add_clock_rate_7d === undefined
          ? null
          : normalizeNumeric(record.add_clock_rate_7d),
      rechargeCash7d: normalizeNumeric(record.recharge_cash_7d),
      storedConsumeAmount7d: normalizeNumeric(record.stored_consume_amount_7d),
      storedConsumeRate7d:
        record.stored_consume_rate_7d === null || record.stored_consume_rate_7d === undefined
          ? null
          : normalizeNumeric(record.stored_consume_rate_7d),
      onDutyTechCount7d:
        record.on_duty_tech_count_7d === null || record.on_duty_tech_count_7d === undefined
          ? null
          : normalizeNumeric(record.on_duty_tech_count_7d),
      groupbuyOrderShare7d:
        record.groupbuy_order_share_7d === null || record.groupbuy_order_share_7d === undefined
          ? null
          : normalizeNumeric(record.groupbuy_order_share_7d),
      groupbuyCohortCustomerCount: normalizeNumeric(record.groupbuy_cohort_customer_count),
      groupbuy7dRevisitCustomerCount: normalizeNumeric(record.groupbuy_7d_revisit_customer_count),
      groupbuy7dRevisitRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_revisit_rate,
        numerator: record.groupbuy_7d_revisit_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy7dCardOpenedCustomerCount: normalizeNumeric(
        record.groupbuy_7d_card_opened_customer_count,
      ),
      groupbuy7dCardOpenedRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_card_opened_rate,
        numerator: record.groupbuy_7d_card_opened_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy7dStoredValueConvertedCustomerCount: normalizeNumeric(
        record.groupbuy_7d_stored_value_converted_customer_count,
      ),
      groupbuy7dStoredValueConversionRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_stored_value_conversion_rate,
        numerator: record.groupbuy_7d_stored_value_converted_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy30dMemberPayConvertedCustomerCount: normalizeNumeric(
        record.groupbuy_30d_member_pay_converted_customer_count,
      ),
      groupbuy30dMemberPayConversionRate: normalizeRateFromCounts({
        rate: record.groupbuy_30d_member_pay_conversion_rate,
        numerator: record.groupbuy_30d_member_pay_converted_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuyFirstOrderCustomerCount: normalizeNumeric(record.groupbuy_first_order_customer_count),
      groupbuyFirstOrderHighValueMemberCustomerCount: normalizeNumeric(
        record.groupbuy_first_order_high_value_member_customer_count,
      ),
      groupbuyFirstOrderHighValueMemberRate:
        record.groupbuy_first_order_high_value_member_rate === null ||
        record.groupbuy_first_order_high_value_member_rate === undefined
          ? null
          : normalizeNumeric(record.groupbuy_first_order_high_value_member_rate),
      effectiveMembers: normalizeNumeric(record.effective_members),
      sleepingMembers: normalizeNumeric(record.sleeping_members),
      sleepingMemberRate:
        record.sleeping_member_rate === null || record.sleeping_member_rate === undefined
          ? null
          : normalizeNumeric(record.sleeping_member_rate),
      newMembers7d: normalizeNumeric(record.new_members_7d),
      activeTechCount7d:
        record.active_tech_count_7d === null || record.active_tech_count_7d === undefined
          ? null
          : normalizeNumeric(record.active_tech_count_7d),
      currentStoredBalance: normalizeNumeric(record.current_stored_balance),
      storedBalanceLifeMonths:
        record.stored_balance_life_months === null || record.stored_balance_life_months === undefined
          ? null
          : normalizeNumeric(record.stored_balance_life_months),
      renewalPressureIndex30d:
        record.renewal_pressure_index_30d === null ||
        record.renewal_pressure_index_30d === undefined
          ? null
          : normalizeNumeric(record.renewal_pressure_index_30d),
      memberRepurchaseBaseCustomerCount7d: normalizeNumeric(
        record.member_repurchase_base_customer_count_7d,
      ),
      memberRepurchaseReturnedCustomerCount7d: normalizeNumeric(
        record.member_repurchase_returned_customer_count_7d,
      ),
      memberRepurchaseRate7d: normalizeRateFromCounts({
        rate: record.member_repurchase_rate_7d,
        numerator: record.member_repurchase_returned_customer_count_7d,
        denominator: record.member_repurchase_base_customer_count_7d,
      }),
    }));
  }

  async listStoreSummary30dByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<StoreSummary30dRow[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mv_store_summary_30d
        WHERE org_id = $1 AND window_end_biz_date BETWEEN $2 AND $3
        ORDER BY window_end_biz_date DESC
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId: String(record.org_id),
      windowEndBizDate: String(record.window_end_biz_date),
      storeName: String(record.store_name ?? orgId),
      revenue30d: normalizeNumeric(record.revenue_30d),
      orderCount30d: normalizeNumeric(record.order_count_30d),
      totalClocks30d: normalizeNumeric(record.total_clocks_30d),
      clockEffect30d:
        record.clock_effect_30d === null || record.clock_effect_30d === undefined
          ? null
          : normalizeNumeric(record.clock_effect_30d),
      averageTicket30d:
        record.average_ticket_30d === null || record.average_ticket_30d === undefined
          ? null
          : normalizeNumeric(record.average_ticket_30d),
      pointClockRate30d:
        record.point_clock_rate_30d === null || record.point_clock_rate_30d === undefined
          ? null
          : normalizeNumeric(record.point_clock_rate_30d),
      addClockRate30d:
        record.add_clock_rate_30d === null || record.add_clock_rate_30d === undefined
          ? null
          : normalizeNumeric(record.add_clock_rate_30d),
      rechargeCash30d: normalizeNumeric(record.recharge_cash_30d),
      storedConsumeAmount30d: normalizeNumeric(record.stored_consume_amount_30d),
      storedConsumeRate30d:
        record.stored_consume_rate_30d === null || record.stored_consume_rate_30d === undefined
          ? null
          : normalizeNumeric(record.stored_consume_rate_30d),
      onDutyTechCount30d:
        record.on_duty_tech_count_30d === null || record.on_duty_tech_count_30d === undefined
          ? null
          : normalizeNumeric(record.on_duty_tech_count_30d),
      groupbuyOrderShare30d:
        record.groupbuy_order_share_30d === null || record.groupbuy_order_share_30d === undefined
          ? null
          : normalizeNumeric(record.groupbuy_order_share_30d),
      groupbuyCohortCustomerCount: normalizeNumeric(record.groupbuy_cohort_customer_count),
      groupbuy7dRevisitCustomerCount: normalizeNumeric(record.groupbuy_7d_revisit_customer_count),
      groupbuy7dRevisitRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_revisit_rate,
        numerator: record.groupbuy_7d_revisit_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy7dCardOpenedCustomerCount: normalizeNumeric(
        record.groupbuy_7d_card_opened_customer_count,
      ),
      groupbuy7dCardOpenedRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_card_opened_rate,
        numerator: record.groupbuy_7d_card_opened_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy7dStoredValueConvertedCustomerCount: normalizeNumeric(
        record.groupbuy_7d_stored_value_converted_customer_count,
      ),
      groupbuy7dStoredValueConversionRate: normalizeRateFromCounts({
        rate: record.groupbuy_7d_stored_value_conversion_rate,
        numerator: record.groupbuy_7d_stored_value_converted_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuy30dMemberPayConvertedCustomerCount: normalizeNumeric(
        record.groupbuy_30d_member_pay_converted_customer_count,
      ),
      groupbuy30dMemberPayConversionRate: normalizeRateFromCounts({
        rate: record.groupbuy_30d_member_pay_conversion_rate,
        numerator: record.groupbuy_30d_member_pay_converted_customer_count,
        denominator: record.groupbuy_cohort_customer_count,
      }),
      groupbuyFirstOrderCustomerCount: normalizeNumeric(record.groupbuy_first_order_customer_count),
      groupbuyFirstOrderHighValueMemberCustomerCount: normalizeNumeric(
        record.groupbuy_first_order_high_value_member_customer_count,
      ),
      groupbuyFirstOrderHighValueMemberRate:
        record.groupbuy_first_order_high_value_member_rate === null ||
        record.groupbuy_first_order_high_value_member_rate === undefined
          ? null
          : normalizeNumeric(record.groupbuy_first_order_high_value_member_rate),
      effectiveMembers: normalizeNumeric(record.effective_members),
      sleepingMembers: normalizeNumeric(record.sleeping_members),
      sleepingMemberRate:
        record.sleeping_member_rate === null || record.sleeping_member_rate === undefined
          ? null
          : normalizeNumeric(record.sleeping_member_rate),
      newMembers30d: normalizeNumeric(record.new_members_30d),
      activeTechCount30d:
        record.active_tech_count_30d === null || record.active_tech_count_30d === undefined
          ? null
          : normalizeNumeric(record.active_tech_count_30d),
      currentStoredBalance: normalizeNumeric(record.current_stored_balance),
      storedBalanceLifeMonths:
        record.stored_balance_life_months === null ||
        record.stored_balance_life_months === undefined
          ? null
          : normalizeNumeric(record.stored_balance_life_months),
      renewalPressureIndex30d:
        record.renewal_pressure_index_30d === null ||
        record.renewal_pressure_index_30d === undefined
          ? null
          : normalizeNumeric(record.renewal_pressure_index_30d),
      memberRepurchaseBaseCustomerCount7d: normalizeNumeric(
        record.member_repurchase_base_customer_count_7d,
      ),
      memberRepurchaseReturnedCustomerCount7d: normalizeNumeric(
        record.member_repurchase_returned_customer_count_7d,
      ),
      memberRepurchaseRate7d: normalizeRateFromCounts({
        rate: record.member_repurchase_rate_7d,
        numerator: record.member_repurchase_returned_customer_count_7d,
        denominator: record.member_repurchase_base_customer_count_7d,
      }),
    }));
  }

  async listRechargeBillsByDate(orgId: string, bizDate: string): Promise<RechargeBillRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_recharge_bills
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY opt_time, recharge_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rechargeId: String(record.recharge_id),
      realityAmount: normalizeNumeric(record.reality_amount),
      totalAmount: normalizeNumeric(record.total_amount),
      donateAmount: normalizeNumeric(record.donate_amount),
      antiFlag: Boolean(record.anti_flag),
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listRechargeBillsByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<RechargeBillRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_recharge_bills
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, opt_time, recharge_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rechargeId: String(record.recharge_id),
      realityAmount: normalizeNumeric(record.reality_amount),
      totalAmount: normalizeNumeric(record.total_amount),
      donateAmount: normalizeNumeric(record.donate_amount),
      antiFlag: Boolean(record.anti_flag),
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listUserTradesByDate(orgId: string, bizDate: string): Promise<UserTradeRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_user_trades
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY opt_time, row_fingerprint
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rowFingerprint: String(record.row_fingerprint),
      tradeNo: (record.trade_no as string | null) ?? undefined,
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      cardOptType: (record.card_opt_type as string | null) ?? undefined,
      changeBalance: normalizeNumeric(record.change_balance),
      changeReality: normalizeNumeric(record.change_reality),
      changeDonate: normalizeNumeric(record.change_donate),
      changeIntegral: normalizeNumeric(record.change_integral),
      paymentType: (record.payment_type as string | null) ?? undefined,
      antiFlag: Boolean(record.anti_flag),
      rawJson: String(record.raw_json),
    }));
  }

  async listUserTradesByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<UserTradeRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_user_trades
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, opt_time, row_fingerprint
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rowFingerprint: String(record.row_fingerprint),
      tradeNo: (record.trade_no as string | null) ?? undefined,
      optTime: String(record.opt_time),
      bizDate: String(record.biz_date),
      cardOptType: (record.card_opt_type as string | null) ?? undefined,
      changeBalance: normalizeNumeric(record.change_balance),
      changeReality: normalizeNumeric(record.change_reality),
      changeDonate: normalizeNumeric(record.change_donate),
      changeIntegral: normalizeNumeric(record.change_integral),
      paymentType: (record.payment_type as string | null) ?? undefined,
      antiFlag: Boolean(record.anti_flag),
      rawJson: String(record.raw_json),
    }));
  }

  async listTechUpClockByDate(orgId: string, bizDate: string): Promise<TechUpClockRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_tech_up_clock
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY settle_time, row_fingerprint
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rowFingerprint: String(record.row_fingerprint),
      personCode: String(record.person_code),
      personName: String(record.person_name),
      settleNo: (record.settle_no as string | null) ?? undefined,
      handCardCode: (record.hand_card_code as string | null) ?? undefined,
      itemName: (record.item_name as string | null) ?? undefined,
      clockType: (record.clock_type as string | null) ?? undefined,
      count: normalizeNumeric(record.count),
      turnover: normalizeNumeric(record.turnover),
      comm: normalizeNumeric(record.comm),
      ctime: (record.ctime as string | null) ?? undefined,
      settleTime: (record.settle_time as string | null) ?? undefined,
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listTechUpClockByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<TechUpClockRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_tech_up_clock
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, settle_time, row_fingerprint
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      rowFingerprint: String(record.row_fingerprint),
      personCode: String(record.person_code),
      personName: String(record.person_name),
      settleNo: (record.settle_no as string | null) ?? undefined,
      handCardCode: (record.hand_card_code as string | null) ?? undefined,
      itemName: (record.item_name as string | null) ?? undefined,
      clockType: (record.clock_type as string | null) ?? undefined,
      count: normalizeNumeric(record.count),
      turnover: normalizeNumeric(record.turnover),
      comm: normalizeNumeric(record.comm),
      ctime: (record.ctime as string | null) ?? undefined,
      settleTime: (record.settle_time as string | null) ?? undefined,
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listTechMarketByDate(orgId: string, bizDate: string): Promise<TechMarketRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_tech_market
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY settle_time, record_key
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      recordKey: String(record.record_key),
      marketId: (record.market_id as string | null) ?? undefined,
      settleNo: (record.settle_no as string | null) ?? undefined,
      handCardCode: (record.hand_card_code as string | null) ?? undefined,
      roomCode: (record.room_code as string | null) ?? undefined,
      personCode: (record.person_code as string | null) ?? undefined,
      personName: (record.person_name as string | null) ?? undefined,
      itemId: (record.item_id as string | null) ?? undefined,
      itemName: (record.item_name as string | null) ?? undefined,
      itemTypeName: (record.item_type_name as string | null) ?? undefined,
      itemCategory:
        record.item_category === null || record.item_category === undefined
          ? undefined
          : normalizeNumeric(record.item_category),
      salesCode: (record.sales_code as string | null) ?? undefined,
      salesName: (record.sales_name as string | null) ?? undefined,
      count: normalizeNumeric(record.count),
      afterDisc: normalizeNumeric(record.after_disc),
      commission: normalizeNumeric(record.commission),
      settleTime: (record.settle_time as string | null) ?? undefined,
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listTechMarketByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<TechMarketRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_tech_market
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, settle_time, record_key
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      recordKey: String(record.record_key),
      marketId: (record.market_id as string | null) ?? undefined,
      settleNo: (record.settle_no as string | null) ?? undefined,
      handCardCode: (record.hand_card_code as string | null) ?? undefined,
      roomCode: (record.room_code as string | null) ?? undefined,
      personCode: (record.person_code as string | null) ?? undefined,
      personName: (record.person_name as string | null) ?? undefined,
      itemId: (record.item_id as string | null) ?? undefined,
      itemName: (record.item_name as string | null) ?? undefined,
      itemTypeName: (record.item_type_name as string | null) ?? undefined,
      itemCategory:
        record.item_category === null || record.item_category === undefined
          ? undefined
          : normalizeNumeric(record.item_category),
      salesCode: (record.sales_code as string | null) ?? undefined,
      salesName: (record.sales_name as string | null) ?? undefined,
      count: normalizeNumeric(record.count),
      afterDisc: normalizeNumeric(record.after_disc),
      commission: normalizeNumeric(record.commission),
      settleTime: (record.settle_time as string | null) ?? undefined,
      bizDate: String(record.biz_date),
      rawJson: String(record.raw_json),
    }));
  }

  async listCurrentMembers(orgId: string): Promise<MemberCurrentRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_member_current
        WHERE org_id = $1
        ORDER BY member_id
      `,
      [orgId],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      memberId: String(record.member_id),
      name: String(record.name),
      phone: (record.phone as string | null) ?? undefined,
      storedAmount: normalizeNumeric(record.stored_amount),
      consumeAmount: normalizeNumeric(record.consume_amount),
      createdTime: (record.created_time as string | null) ?? undefined,
      lastConsumeTime: (record.last_consume_time as string | null) ?? undefined,
      silentDays: normalizeNumeric(record.silent_days),
      rawStoreName: (record.raw_store_name as string | null) ?? undefined,
      rawJson: String(record.raw_json),
    }));
  }

  async listMemberDailySnapshotsByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<MemberDailySnapshotRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_member_daily_snapshot
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date, member_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => {
      const rawJson = String(record.raw_json);
      const normalized = normalizeMemberRow(parseJsonRecord(rawJson), orgId);
      return {
        bizDate: String(record.biz_date),
        orgId,
        memberId: String(record.member_id),
        name: String(record.name),
        phone: normalized?.phone,
        storedAmount: normalizeNumeric(record.stored_amount),
        consumeAmount: normalizeNumeric(record.consume_amount),
        createdTime: normalized?.createdTime,
        lastConsumeTime:
          (record.last_consume_time as string | null) ?? normalized?.lastConsumeTime,
        silentDays: normalizeNumeric(record.silent_days),
        rawStoreName: normalized?.rawStoreName,
        rawJson,
      };
    });
  }

  async findCurrentMembersByPhoneSuffix(
    orgId: string,
    phoneSuffix: string,
  ): Promise<MemberCurrentRecord[]> {
    const digits = phoneSuffix.replace(/\D/gu, "");
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_member_current
        WHERE org_id = $1
          AND phone IS NOT NULL
          AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 4) = $2
        ORDER BY member_id
      `,
      [orgId, digits],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      memberId: String(record.member_id),
      name: String(record.name),
      phone: (record.phone as string | null) ?? undefined,
      storedAmount: normalizeNumeric(record.stored_amount),
      consumeAmount: normalizeNumeric(record.consume_amount),
      createdTime: (record.created_time as string | null) ?? undefined,
      lastConsumeTime: (record.last_consume_time as string | null) ?? undefined,
      silentDays: normalizeNumeric(record.silent_days),
      rawStoreName: (record.raw_store_name as string | null) ?? undefined,
      rawJson: String(record.raw_json),
    }));
  }

  async listCurrentTech(orgId: string): Promise<TechCurrentRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM dim_tech_current
        WHERE org_id = $1
        ORDER BY tech_code
      `,
      [orgId],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      techCode: String(record.tech_code),
      techName: String(record.tech_name),
      isWork: Boolean(record.is_work),
      isJob: Boolean(record.is_job),
      pointClockNum: normalizeNumeric(record.point_clock_num),
      wheelClockNum: normalizeNumeric(record.wheel_clock_num),
      baseWages: normalizeNumeric(record.base_wages),
      rawStoreName: (record.raw_store_name as string | null) ?? undefined,
      rawJson: String(record.raw_json),
    }));
  }

  async listTechDailySnapshotByDate(orgId: string, bizDate: string): Promise<TechCurrentRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM fact_tech_daily_snapshot
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY tech_code
      `,
      [orgId, bizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId,
      techCode: String(record.tech_code),
      techName: String(record.tech_name),
      isWork: Boolean(record.is_work),
      isJob: Boolean(record.is_job),
      pointClockNum: normalizeNumeric(record.point_clock_num),
      wheelClockNum: normalizeNumeric(record.wheel_clock_num),
      baseWages: normalizeNumeric(record.base_wages),
      rawJson: String(record.raw_json),
    }));
  }

  async getStoreName(orgId: string): Promise<string> {
    const result = await this.params.pool.query(
      `
        SELECT store_name
        FROM dim_store
        WHERE org_id = $1
      `,
      [orgId],
    );
    return (result.rows[0]?.store_name as string | undefined) ?? orgId;
  }

  async saveDailyMetrics(
    metrics: DailyStoreMetrics,
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO mart_daily_store_metrics (org_id, biz_date, metrics_json, updated_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (org_id, biz_date) DO UPDATE SET
          metrics_json = EXCLUDED.metrics_json,
          updated_at = EXCLUDED.updated_at
      `,
      [metrics.orgId, metrics.bizDate, JSON.stringify(metrics), updatedAt],
    );
    await this.handleAnalyticsMutation(options);
  }

  async getDailyMetrics(orgId: string, bizDate: string): Promise<DailyStoreMetrics | null> {
    const result = await this.params.pool.query(
      `
        SELECT metrics_json
        FROM mart_daily_store_metrics
        WHERE org_id = $1 AND biz_date = $2
      `,
      [orgId, bizDate],
    );
    return result.rows[0]?.metrics_json
      ? (JSON.parse(String(result.rows[0].metrics_json)) as DailyStoreMetrics)
      : null;
  }

  async replaceDailyAlerts(
    orgId: string,
    bizDate: string,
    alerts: DailyStoreAlert[],
  ): Promise<void> {
    const dedupedAlerts = Array.from(
      alerts.reduce((map, alert) => map.set(alert.code, alert), new Map<string, DailyStoreAlert>()),
      ([, alert]) => alert,
    );
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_daily_store_alerts
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const alert of dedupedAlerts) {
        await client.query(
          `
            INSERT INTO mart_daily_store_alerts (org_id, biz_date, alert_code, severity, message)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (org_id, biz_date, alert_code) DO UPDATE SET
              severity = EXCLUDED.severity,
              message = EXCLUDED.message
          `,
          [orgId, bizDate, alert.code, alert.severity, alert.message],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getDailyAlerts(orgId: string, bizDate: string): Promise<DailyStoreAlert[]> {
    const result = await this.params.pool.query(
      `
        SELECT alert_code, severity, message
        FROM mart_daily_store_alerts
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY alert_code
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      code: String(row.alert_code),
      severity: String(row.severity) as DailyStoreAlert["severity"],
      message: String(row.message),
    }));
  }

  async replaceCustomerTechLinks(
    orgId: string,
    bizDate: string,
    rows: CustomerTechLinkRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_customer_tech_links
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_customer_tech_links (
              org_id, biz_date, settle_id, settle_no,
              customer_identity_key, customer_identity_type, customer_display_name,
              member_id, member_card_no, reference_code, member_label,
              identity_stable, tech_code, tech_name,
              customer_count_in_settle, tech_count_in_settle,
              tech_turnover, tech_commission, order_pay_amount, order_consume_amount,
              item_names_json, link_confidence, link_json, updated_at
            ) VALUES (
              $1, $2, $3, $4,
              $5, $6, $7,
              $8, $9, $10, $11,
              $12, $13, $14,
              $15, $16,
              $17, $18, $19, $20,
              $21, $22, $23, $24
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.settleId,
            row.settleNo ?? null,
            row.customerIdentityKey,
            row.customerIdentityType,
            row.customerDisplayName,
            row.memberId ?? null,
            row.memberCardNo ?? null,
            row.referenceCode ?? null,
            row.memberLabel ?? null,
            row.identityStable,
            row.techCode,
            row.techName,
            row.customerCountInSettle,
            row.techCountInSettle,
            row.techTurnover,
            row.techCommission,
            row.orderPayAmount,
            row.orderConsumeAmount,
            JSON.stringify(row.itemNames),
            row.linkConfidence,
            row.rawJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listCustomerTechLinks(orgId: string, bizDate: string): Promise<CustomerTechLinkRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_customer_tech_links
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY settle_no, customer_identity_key, tech_code
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) => mapCustomerTechLinkRow(orgId, row));
  }

  async listCustomerTechLinksByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<CustomerTechLinkRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_customer_tech_links
        WHERE org_id = $1 AND biz_date >= $2 AND biz_date <= $3
        ORDER BY biz_date, settle_no, customer_identity_key, tech_code
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((row: Record<string, unknown>) => mapCustomerTechLinkRow(orgId, row));
  }

  async replaceCustomerSegments(
    orgId: string,
    bizDate: string,
    rows: CustomerSegmentRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_customer_segments
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_customer_segments (
              org_id, biz_date, customer_identity_key, customer_identity_type, customer_display_name,
              member_id, member_card_no, reference_code, member_label,
              identity_stable, segment_eligible,
              first_biz_date, last_biz_date, days_since_last_visit,
              visit_count_30d, visit_count_90d,
              pay_amount_30d, pay_amount_90d,
              member_pay_amount_90d, groupbuy_amount_90d, direct_pay_amount_90d,
              distinct_tech_count_90d, top_tech_code, top_tech_name,
              top_tech_visit_count_90d, top_tech_visit_share_90d,
              recency_segment, frequency_segment, monetary_segment,
              payment_segment, tech_loyalty_segment, primary_segment,
              tag_keys_json, segment_json, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11,
              $12, $13, $14,
              $15, $16,
              $17, $18,
              $19, $20, $21,
              $22, $23, $24,
              $25, $26,
              $27, $28, $29,
              $30, $31, $32,
              $33, $34, $35
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.customerIdentityKey,
            row.customerIdentityType,
            row.customerDisplayName,
            row.memberId ?? null,
            row.memberCardNo ?? null,
            row.referenceCode ?? null,
            row.memberLabel ?? null,
            row.identityStable,
            row.segmentEligible,
            row.firstBizDate ?? null,
            row.lastBizDate ?? null,
            row.daysSinceLastVisit,
            row.visitCount30d,
            row.visitCount90d,
            row.payAmount30d,
            row.payAmount90d,
            row.memberPayAmount90d,
            row.groupbuyAmount90d,
            row.directPayAmount90d,
            row.distinctTechCount90d,
            row.topTechCode ?? null,
            row.topTechName ?? null,
            row.topTechVisitCount90d,
            row.topTechVisitShare90d,
            row.recencySegment,
            row.frequencySegment,
            row.monetarySegment,
            row.paymentSegment,
            row.techLoyaltySegment,
            row.primarySegment,
            JSON.stringify(row.tagKeys),
            row.rawJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listCustomerSegments(orgId: string, bizDate: string): Promise<CustomerSegmentRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_customer_segments
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY pay_amount_90d DESC, customer_identity_key
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) => ({
      orgId,
      bizDate: String(row.biz_date),
      customerIdentityKey: String(row.customer_identity_key),
      customerIdentityType: String(
        row.customer_identity_type,
      ) as CustomerSegmentRecord["customerIdentityType"],
      customerDisplayName: String(row.customer_display_name),
      memberId: (row.member_id as string | null) ?? undefined,
      memberCardNo: (row.member_card_no as string | null) ?? undefined,
      referenceCode: (row.reference_code as string | null) ?? undefined,
      memberLabel: (row.member_label as string | null) ?? undefined,
      identityStable: Boolean(row.identity_stable),
      segmentEligible: Boolean(row.segment_eligible),
      firstBizDate: (row.first_biz_date as string | null) ?? undefined,
      lastBizDate: (row.last_biz_date as string | null) ?? undefined,
      daysSinceLastVisit: normalizeNumeric(row.days_since_last_visit),
      visitCount30d: normalizeNumeric(row.visit_count_30d),
      visitCount90d: normalizeNumeric(row.visit_count_90d),
      payAmount30d: normalizeNumeric(row.pay_amount_30d),
      payAmount90d: normalizeNumeric(row.pay_amount_90d),
      memberPayAmount90d: normalizeNumeric(row.member_pay_amount_90d),
      groupbuyAmount90d: normalizeNumeric(row.groupbuy_amount_90d),
      directPayAmount90d: normalizeNumeric(row.direct_pay_amount_90d),
      distinctTechCount90d: normalizeNumeric(row.distinct_tech_count_90d),
      topTechCode: (row.top_tech_code as string | null) ?? undefined,
      topTechName: (row.top_tech_name as string | null) ?? undefined,
      topTechVisitCount90d: normalizeNumeric(row.top_tech_visit_count_90d),
      topTechVisitShare90d:
        row.top_tech_visit_share_90d === null || row.top_tech_visit_share_90d === undefined
          ? null
          : normalizeNumeric(row.top_tech_visit_share_90d),
      recencySegment: String(row.recency_segment) as CustomerSegmentRecord["recencySegment"],
      frequencySegment: String(row.frequency_segment) as CustomerSegmentRecord["frequencySegment"],
      monetarySegment: String(row.monetary_segment) as CustomerSegmentRecord["monetarySegment"],
      paymentSegment: String(row.payment_segment) as CustomerSegmentRecord["paymentSegment"],
      techLoyaltySegment: String(
        row.tech_loyalty_segment,
      ) as CustomerSegmentRecord["techLoyaltySegment"],
      primarySegment: String(row.primary_segment) as CustomerSegmentRecord["primarySegment"],
      tagKeys: parseTagKeys(row.tag_keys_json),
      rawJson: String(row.segment_json),
    }));
  }

  async replaceCustomerConversionCohorts(
    orgId: string,
    bizDate: string,
    rows: CustomerConversionCohortRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_customer_conversion_cohorts
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_customer_conversion_cohorts (
              org_id, biz_date, customer_identity_key, customer_identity_type, customer_display_name,
              member_id, member_card_no, reference_code, identity_stable,
              first_groupbuy_biz_date, first_groupbuy_opt_time, first_groupbuy_settle_id,
              first_groupbuy_settle_no, first_groupbuy_amount,
              first_observed_biz_date, last_observed_biz_date, first_observed_is_groupbuy,
              revisit_within_7d, revisit_within_30d, card_opened_within_7d,
              stored_value_converted_within_7d, member_pay_converted_within_30d,
              visit_count_30d_after_groupbuy, pay_amount_30d_after_groupbuy,
              member_pay_amount_30d_after_groupbuy, high_value_member_within_30d,
              cohort_json, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12,
              $13, $14,
              $15, $16, $17,
              $18, $19, $20,
              $21, $22,
              $23, $24,
              $25, $26,
              $27, $28
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.customerIdentityKey,
            row.customerIdentityType,
            row.customerDisplayName,
            row.memberId ?? null,
            row.memberCardNo ?? null,
            row.referenceCode ?? null,
            row.identityStable,
            row.firstGroupbuyBizDate ?? null,
            row.firstGroupbuyOptTime ?? null,
            row.firstGroupbuySettleId ?? null,
            row.firstGroupbuySettleNo ?? null,
            row.firstGroupbuyAmount,
            row.firstObservedBizDate ?? null,
            row.lastObservedBizDate ?? null,
            row.firstObservedIsGroupbuy,
            row.revisitWithin7d,
            row.revisitWithin30d,
            row.cardOpenedWithin7d,
            row.storedValueConvertedWithin7d,
            row.memberPayConvertedWithin30d,
            row.visitCount30dAfterGroupbuy,
            row.payAmount30dAfterGroupbuy,
            row.memberPayAmount30dAfterGroupbuy,
            row.highValueMemberWithin30d,
            row.rawJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listCustomerConversionCohortsByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<CustomerConversionCohortRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_customer_conversion_cohorts
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date DESC, customer_identity_key
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapCustomerConversionCohortRow(orgId, row),
    );
  }

  async replaceMemberReactivationFeatures(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationFeatureRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_member_reactivation_features_daily
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_member_reactivation_features_daily (
              org_id, biz_date, member_id, customer_identity_key, customer_display_name,
              member_card_no, reference_code, primary_segment,
              days_since_last_visit, visit_count_30d, visit_count_90d,
              pay_amount_30d, pay_amount_90d,
              member_pay_amount_30d, member_pay_amount_90d,
              recharge_total_30d, recharge_total_90d,
              recharge_count_30d, recharge_count_90d, days_since_last_recharge,
              current_stored_balance_inferred,
              stored_balance_7d_ago, stored_balance_30d_ago, stored_balance_90d_ago,
              stored_balance_delta_7d, stored_balance_delta_30d, stored_balance_delta_90d,
              depletion_velocity_30d, projected_balance_days_left,
              recharge_to_member_pay_ratio_90d,
              dominant_visit_daypart, preferred_daypart_share_90d,
              dominant_visit_weekday, preferred_weekday_share_90d,
              dominant_visit_month_phase, preferred_month_phase_share_90d,
              weekend_visit_share_90d, late_night_visit_share_90d, overnight_visit_share_90d,
              average_visit_gap_days_90d, visit_gap_stddev_days_90d,
              cycle_deviation_score, time_preference_confidence_score,
              trajectory_confidence_score, reactivation_priority_score,
              feature_json, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8,
              $9, $10, $11,
              $12, $13,
              $14, $15,
              $16, $17,
              $18, $19, $20,
              $21,
              $22, $23, $24,
              $25, $26, $27,
              $28, $29,
              $30,
              $31, $32,
              $33, $34,
              $35, $36,
              $37, $38,
              $39, $40, $41,
              $42, $43,
              $44, $45,
              $46, $47
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.memberId,
            row.customerIdentityKey,
            row.customerDisplayName,
            row.memberCardNo ?? null,
            row.referenceCode ?? null,
            row.primarySegment,
            row.daysSinceLastVisit,
            row.visitCount30d,
            row.visitCount90d,
            row.payAmount30d,
            row.payAmount90d,
            row.memberPayAmount30d,
            row.memberPayAmount90d,
            row.rechargeTotal30d,
            row.rechargeTotal90d,
            row.rechargeCount30d,
            row.rechargeCount90d,
            row.daysSinceLastRecharge,
            row.currentStoredBalanceInferred,
            row.storedBalance7dAgo,
            row.storedBalance30dAgo,
            row.storedBalance90dAgo,
            row.storedBalanceDelta7d,
            row.storedBalanceDelta30d,
            row.storedBalanceDelta90d,
            row.depletionVelocity30d,
            row.projectedBalanceDaysLeft,
            row.rechargeToMemberPayRatio90d,
            row.dominantVisitDaypart,
            row.preferredDaypartShare90d,
            row.dominantVisitWeekday,
            row.preferredWeekdayShare90d,
            row.dominantVisitMonthPhase,
            row.preferredMonthPhaseShare90d,
            row.weekendVisitShare90d,
            row.lateNightVisitShare90d,
            row.overnightVisitShare90d,
            row.averageVisitGapDays90d,
            row.visitGapStddevDays90d,
            row.cycleDeviationScore,
            row.timePreferenceConfidenceScore,
            row.trajectoryConfidenceScore,
            row.reactivationPriorityScore,
            row.featureJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listMemberReactivationFeatures(
    orgId: string,
    bizDate: string,
  ): Promise<MemberReactivationFeatureRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_features_daily
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY reactivation_priority_score DESC, member_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationFeatureRow(orgId, row),
    );
  }

  async listMemberReactivationFeaturesByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<MemberReactivationFeatureRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_features_daily
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date DESC, reactivation_priority_score DESC, member_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationFeatureRow(orgId, row),
    );
  }

  async replaceMemberReactivationStrategies(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationStrategyRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_member_reactivation_strategies_daily
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_member_reactivation_strategies_daily (
              org_id, biz_date, member_id, customer_identity_key, customer_display_name,
              primary_segment, reactivation_priority_score,
              churn_risk_score, churn_risk_label,
              revisit_probability_7d, revisit_window_label,
              recommended_touch_weekday, recommended_touch_daypart,
              touch_window_match_score, touch_window_label,
              lifecycle_momentum_score, lifecycle_momentum_label,
              recommended_action_label, strategy_priority_score,
              strategy_json, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7,
              $8, $9,
              $10, $11,
              $12, $13,
              $14, $15,
              $16, $17,
              $18, $19,
              $20, $21
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.memberId,
            row.customerIdentityKey,
            row.customerDisplayName,
            row.primarySegment,
            row.reactivationPriorityScore,
            row.churnRiskScore,
            row.churnRiskLabel,
            row.revisitProbability7d,
            row.revisitWindowLabel,
            row.recommendedTouchWeekday,
            row.recommendedTouchDaypart,
            row.touchWindowMatchScore,
            row.touchWindowLabel,
            row.lifecycleMomentumScore,
            row.lifecycleMomentumLabel,
            row.recommendedActionLabel,
            row.strategyPriorityScore,
            row.strategyJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listMemberReactivationStrategies(
    orgId: string,
    bizDate: string,
  ): Promise<MemberReactivationStrategyRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_strategies_daily
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY strategy_priority_score DESC, member_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationStrategyRow(orgId, row),
    );
  }

  async listMemberReactivationStrategiesByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<MemberReactivationStrategyRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_strategies_daily
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date DESC, strategy_priority_score DESC, member_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationStrategyRow(orgId, row),
    );
  }

  async replaceMemberReactivationQueue(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationQueueRecord[],
    updatedAt: string,
    options: AnalyticsWriteOptions = {},
  ): Promise<void> {
    const client = await this.params.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          DELETE FROM mart_member_reactivation_queue_daily
          WHERE org_id = $1 AND biz_date = $2
        `,
        [orgId, bizDate],
      );
      for (const row of rows) {
        await client.query(
          `
            INSERT INTO mart_member_reactivation_queue_daily (
              org_id, biz_date, member_id, customer_identity_key, customer_display_name,
              member_card_no, reference_code, primary_segment, followup_bucket,
              reactivation_priority_score, strategy_priority_score, execution_priority_score,
              priority_band, priority_rank,
              churn_risk_label, churn_risk_score, revisit_window_label,
              recommended_action_label, recommended_touch_weekday, recommended_touch_daypart,
              touch_window_label, reason_summary, touch_advice_summary,
              days_since_last_visit, visit_count_90d, pay_amount_90d,
              current_stored_balance_inferred, projected_balance_days_left,
              birthday_month_day, next_birthday_biz_date, birthday_window_days, birthday_boost_score,
              top_tech_name,
              queue_json, updated_at
            ) VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              $10, $11, $12,
              $13, $14,
              $15, $16, $17,
              $18, $19, $20,
              $21, $22, $23,
              $24, $25, $26,
              $27, $28,
              $29, $30, $31, $32,
              $33,
              $34, $35
            )
          `,
          [
            row.orgId,
            row.bizDate,
            row.memberId,
            row.customerIdentityKey,
            row.customerDisplayName,
            row.memberCardNo ?? null,
            row.referenceCode ?? null,
            row.primarySegment,
            row.followupBucket,
            row.reactivationPriorityScore,
            row.strategyPriorityScore,
            row.executionPriorityScore,
            row.priorityBand,
            row.priorityRank,
            row.churnRiskLabel,
            row.churnRiskScore,
            row.revisitWindowLabel,
            row.recommendedActionLabel,
            row.recommendedTouchWeekday,
            row.recommendedTouchDaypart,
            row.touchWindowLabel,
            row.reasonSummary,
            row.touchAdviceSummary,
            row.daysSinceLastVisit,
            row.visitCount90d,
            row.payAmount90d,
            row.currentStoredBalanceInferred,
            row.projectedBalanceDaysLeft,
            row.birthdayMonthDay ?? null,
            row.nextBirthdayBizDate ?? null,
            row.birthdayWindowDays ?? null,
            row.birthdayBoostScore,
            row.topTechName ?? null,
            row.queueJson,
            updatedAt,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await this.handleAnalyticsMutation(options);
  }

  async listMemberReactivationQueue(
    orgId: string,
    bizDate: string,
  ): Promise<MemberReactivationQueueRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_queue_daily
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY priority_rank ASC, execution_priority_score DESC, strategy_priority_score DESC, member_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationQueueRow(orgId, row),
    );
  }

  async listMemberReactivationQueueByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<MemberReactivationQueueRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mart_member_reactivation_queue_daily
        WHERE org_id = $1 AND biz_date BETWEEN $2 AND $3
        ORDER BY biz_date DESC, priority_rank ASC, execution_priority_score DESC, strategy_priority_score DESC, member_id
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationQueueRow(orgId, row),
    );
  }

  async upsertMemberReactivationFeedback(row: MemberReactivationFeedbackRecord): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO ops_member_reactivation_feedback (
          org_id, biz_date, member_id, feedback_status,
          followed_by, followed_at,
          contacted, replied, booked, arrived,
          note, updated_at
        ) VALUES (
          $1, $2, $3, $4,
          $5, $6,
          $7, $8, $9, $10,
          $11, $12
        )
        ON CONFLICT (org_id, biz_date, member_id) DO UPDATE SET
          feedback_status = EXCLUDED.feedback_status,
          followed_by = EXCLUDED.followed_by,
          followed_at = EXCLUDED.followed_at,
          contacted = EXCLUDED.contacted,
          replied = EXCLUDED.replied,
          booked = EXCLUDED.booked,
          arrived = EXCLUDED.arrived,
          note = EXCLUDED.note,
          updated_at = EXCLUDED.updated_at
      `,
      [
        row.orgId,
        row.bizDate,
        row.memberId,
        row.feedbackStatus,
        row.followedBy ?? null,
        row.followedAt ?? null,
        row.contacted,
        row.replied,
        row.booked,
        row.arrived,
        row.note ?? null,
        row.updatedAt,
      ],
    );
  }

  async listMemberReactivationFeedback(
    orgId: string,
    bizDate: string,
  ): Promise<MemberReactivationFeedbackRecord[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM ops_member_reactivation_feedback
        WHERE org_id = $1 AND biz_date = $2
        ORDER BY updated_at DESC, member_id
      `,
      [orgId, bizDate],
    );
    return result.rows.map((row: Record<string, unknown>) =>
      mapMemberReactivationFeedbackRow(orgId, row),
    );
  }

  async listCustomerProfile90dByDateRange(
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ): Promise<CustomerProfile90dRow[]> {
    const result = await this.params.pool.query(
      `
        SELECT *
        FROM mv_customer_profile_90d
        WHERE org_id = $1 AND window_end_biz_date BETWEEN $2 AND $3
        ORDER BY window_end_biz_date DESC, pay_amount_90d DESC, customer_identity_key
      `,
      [orgId, startBizDate, endBizDate],
    );
    return result.rows.map((record: Record<string, unknown>) => ({
      orgId: String(record.org_id),
      windowEndBizDate: String(record.window_end_biz_date),
      customerIdentityKey: String(record.customer_identity_key),
      customerIdentityType: String(
        record.customer_identity_type,
      ) as CustomerProfile90dRow["customerIdentityType"],
      customerDisplayName: String(record.customer_display_name),
      memberId: (record.member_id as string | null) ?? undefined,
      memberCardNo: (record.member_card_no as string | null) ?? undefined,
      referenceCode: (record.reference_code as string | null) ?? undefined,
      memberLabel: (record.member_label as string | null) ?? undefined,
      phone: (record.phone as string | null) ?? undefined,
      identityStable: Boolean(record.identity_stable),
      segmentEligible: Boolean(record.segment_eligible),
      firstBizDate: (record.first_biz_date as string | null) ?? undefined,
      lastBizDate: (record.last_biz_date as string | null) ?? undefined,
      daysSinceLastVisit: normalizeNumeric(record.days_since_last_visit),
      visitCount30d: normalizeNumeric(record.visit_count_30d),
      visitCount90d: normalizeNumeric(record.visit_count_90d),
      payAmount30d: normalizeNumeric(record.pay_amount_30d),
      payAmount90d: normalizeNumeric(record.pay_amount_90d),
      memberPayAmount90d: normalizeNumeric(record.member_pay_amount_90d),
      groupbuyAmount90d: normalizeNumeric(record.groupbuy_amount_90d),
      directPayAmount90d: normalizeNumeric(record.direct_pay_amount_90d),
      distinctTechCount90d: normalizeNumeric(record.distinct_tech_count_90d),
      topTechCode: (record.top_tech_code as string | null) ?? undefined,
      topTechName: (record.top_tech_name as string | null) ?? undefined,
      topTechVisitCount90d: normalizeNumeric(record.top_tech_visit_count_90d),
      topTechVisitShare90d:
        record.top_tech_visit_share_90d === null || record.top_tech_visit_share_90d === undefined
          ? null
          : normalizeNumeric(record.top_tech_visit_share_90d),
      recencySegment: String(record.recency_segment) as CustomerProfile90dRow["recencySegment"],
      frequencySegment: String(
        record.frequency_segment,
      ) as CustomerProfile90dRow["frequencySegment"],
      monetarySegment: String(record.monetary_segment) as CustomerProfile90dRow["monetarySegment"],
      paymentSegment: String(record.payment_segment) as CustomerProfile90dRow["paymentSegment"],
      techLoyaltySegment: String(
        record.tech_loyalty_segment,
      ) as CustomerProfile90dRow["techLoyaltySegment"],
      primarySegment: String(record.primary_segment) as CustomerProfile90dRow["primarySegment"],
      tagKeys: parseTagKeys(record.tag_keys_json),
      currentStoredAmount: normalizeNumeric(record.current_stored_amount),
      currentConsumeAmount: normalizeNumeric(record.current_consume_amount),
      currentCreatedTime: (record.current_created_time as string | null) ?? undefined,
      currentLastConsumeTime: (record.current_last_consume_time as string | null) ?? undefined,
      currentSilentDays: normalizeNumeric(record.current_silent_days),
      firstGroupbuyBizDate: (record.first_groupbuy_biz_date as string | null) ?? undefined,
      revisitWithin7d: Boolean(record.revisit_within_7d),
      revisitWithin30d: Boolean(record.revisit_within_30d),
      cardOpenedWithin7d: Boolean(record.card_opened_within_7d),
      storedValueConvertedWithin7d: Boolean(record.stored_value_converted_within_7d),
      memberPayConvertedWithin30d: Boolean(record.member_pay_converted_within_30d),
      highValueMemberWithin30d: Boolean(record.high_value_member_within_30d),
    }));
  }

  async saveDailyReport(report: DailyStoreReport, generatedAt: string): Promise<void> {
    await this.params.pool.query(
      `
        INSERT INTO mart_daily_store_reports (
          org_id, biz_date, store_name, complete, markdown, report_json, generated_at, sent_at, send_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)
        ON CONFLICT (org_id, biz_date) DO UPDATE SET
          store_name = EXCLUDED.store_name,
          complete = EXCLUDED.complete,
          markdown = EXCLUDED.markdown,
          report_json = EXCLUDED.report_json,
          generated_at = EXCLUDED.generated_at,
          sent_at = COALESCE(mart_daily_store_reports.sent_at, EXCLUDED.sent_at),
          send_status = COALESCE(mart_daily_store_reports.send_status, EXCLUDED.send_status)
      `,
      [
        report.orgId,
        report.bizDate,
        report.storeName,
        report.complete,
        report.markdown,
        JSON.stringify(report),
        generatedAt,
      ],
    );
  }

  async markReportSent(params: {
    orgId: string;
    bizDate: string;
    sentAt: string;
    sendStatus: string;
  }): Promise<void> {
    await this.params.pool.query(
      `
        UPDATE mart_daily_store_reports
        SET sent_at = $1, send_status = $2
        WHERE org_id = $3 AND biz_date = $4
      `,
      [params.sentAt, params.sendStatus, params.orgId, params.bizDate],
    );
  }

  async getDailyReport(
    orgId: string,
    bizDate: string,
  ): Promise<(DailyStoreReport & { sentAt?: string | null; sendStatus?: string | null }) | null> {
    const result = await this.params.pool.query(
      `
        SELECT report_json, sent_at, send_status
        FROM mart_daily_store_reports
        WHERE org_id = $1 AND biz_date = $2
      `,
      [orgId, bizDate],
    );
    if (!result.rows[0]?.report_json) {
      return null;
    }
    const parsed = JSON.parse(String(result.rows[0].report_json)) as DailyStoreReport;
    return {
      ...parsed,
      sentAt: (result.rows[0].sent_at as string | null) ?? null,
      sendStatus: (result.rows[0].send_status as string | null) ?? null,
    };
  }
}
