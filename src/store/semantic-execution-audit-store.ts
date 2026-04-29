import type { Pool } from "pg";
import type {
  HetangSemanticAnalysisFrameworkCount,
  HetangSemanticExecutionAuditRecord,
  HetangSemanticFailureClassCount,
  HetangSemanticQualitySummary,
  HetangSemanticRouteUpgradeCount,
} from "../types.js";

type Queryable = Pick<Pool, "query">;

function normalizeTimestampField(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  return undefined;
}

function resolveLowerBoundIso(params: {
  windowHours: number;
  now: Date;
  occurredAfter?: string;
}): string {
  const windowLowerBound = new Date(
    params.now.getTime() - params.windowHours * 3_600_000,
  ).toISOString();
  if (!params.occurredAfter) {
    return windowLowerBound;
  }
  const occurredAfterMs = Date.parse(params.occurredAfter);
  if (!Number.isFinite(occurredAfterMs)) {
    return windowLowerBound;
  }
  return new Date(Math.max(Date.parse(windowLowerBound), occurredAfterMs)).toISOString();
}

function normalizeNumeric(value: unknown): number {
  return typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number(value)
      : 0;
}

function normalizeNullableNumeric(value: unknown): number | null {
  const numeric = normalizeNumeric(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export class HetangSemanticExecutionAuditStore {
  private initialized = false;

  constructor(private readonly queryable: Queryable) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.queryable.query(`
      CREATE TABLE IF NOT EXISTS semantic_execution_audits (
        audit_id BIGSERIAL PRIMARY KEY,
        request_id TEXT,
        entry TEXT NOT NULL,
        entry_source TEXT,
        channel TEXT,
        sender_id TEXT,
        conversation_id TEXT,
        raw_text TEXT NOT NULL,
        effective_text TEXT,
        semantic_lane TEXT,
        intent_kind TEXT,
        capability_id TEXT,
        analysis_framework_id TEXT,
        analysis_persona_id TEXT,
        route_upgrade_kind TEXT,
        state_carried_forward BOOLEAN NOT NULL DEFAULT FALSE,
        topic_switch_detected BOOLEAN NOT NULL DEFAULT FALSE,
        clarification_needed BOOLEAN NOT NULL DEFAULT FALSE,
        clarification_reason TEXT,
        fallback_used BOOLEAN NOT NULL DEFAULT FALSE,
        executed BOOLEAN NOT NULL DEFAULT FALSE,
        success BOOLEAN NOT NULL DEFAULT FALSE,
        failure_class TEXT,
        duration_ms INTEGER,
        occurred_at TIMESTAMPTZ NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_semantic_execution_audits_occurred_at
        ON semantic_execution_audits (occurred_at DESC);

      CREATE INDEX IF NOT EXISTS idx_semantic_execution_audits_failure_class
        ON semantic_execution_audits (failure_class, occurred_at DESC);

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS analysis_framework_id TEXT;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS analysis_persona_id TEXT;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS route_upgrade_kind TEXT;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS state_carried_forward BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS topic_switch_detected BOOLEAN NOT NULL DEFAULT FALSE;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS deploy_marker TEXT;

      ALTER TABLE semantic_execution_audits
        ADD COLUMN IF NOT EXISTS serving_version TEXT;

      ALTER TABLE semantic_execution_audits
        ALTER COLUMN occurred_at TYPE TIMESTAMPTZ
        USING occurred_at::timestamptz;

      CREATE INDEX IF NOT EXISTS idx_semantic_execution_audits_deploy_marker
        ON semantic_execution_audits (deploy_marker, occurred_at DESC);
    `);
    this.initialized = true;
  }

  async insertSemanticExecutionAudit(record: HetangSemanticExecutionAuditRecord): Promise<void> {
    await this.initialize();
    await this.queryable.query(
      `
        INSERT INTO semantic_execution_audits (
          request_id, entry, entry_source, channel, sender_id, conversation_id,
          raw_text, effective_text, semantic_lane, intent_kind, capability_id,
          analysis_framework_id, analysis_persona_id, route_upgrade_kind,
          state_carried_forward, topic_switch_detected,
          deploy_marker, serving_version,
          clarification_needed, clarification_reason, fallback_used, executed,
          success, failure_class, duration_ms, occurred_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14,
          $15, $16,
          $17, $18,
          $19, $20, $21, $22,
          $23, $24, $25, $26
        )
      `,
      [
        record.requestId ?? null,
        record.entry,
        record.entrySource ?? null,
        record.channel ?? null,
        record.senderId ?? null,
        record.conversationId ?? null,
        record.rawText,
        record.effectiveText ?? null,
        record.semanticLane ?? null,
        record.intentKind ?? null,
        record.capabilityId ?? null,
        record.analysisFrameworkId ?? null,
        record.analysisPersonaId ?? null,
        record.routeUpgradeKind ?? null,
        record.stateCarriedForward === true,
        record.topicSwitchDetected === true,
        record.deployMarker ?? null,
        record.servingVersion ?? null,
        record.clarificationNeeded,
        record.clarificationReason ?? null,
        record.fallbackUsed,
        record.executed,
        record.success,
        record.failureClass ?? null,
        record.durationMs ?? null,
        record.occurredAt,
      ],
    );
  }

  private buildSemanticQualityFilter(params: {
    windowHours: number;
    now: Date;
    occurredAfter?: string;
    deployMarker?: string;
  }): { clauses: string[]; values: unknown[] } {
    const clauses = ["occurred_at >= $1::timestamptz"];
    const values: unknown[] = [resolveLowerBoundIso(params)];
    if (typeof params.deployMarker === "string" && params.deployMarker.trim().length > 0) {
      clauses.push(`deploy_marker = $${values.length + 1}`);
      values.push(params.deployMarker.trim());
    }
    return { clauses, values };
  }

  private async getTopAnalysisFrameworkCounts(params: {
    windowHours: number;
    now: Date;
    limit: number;
    occurredAfter?: string;
    deployMarker?: string;
  }): Promise<HetangSemanticAnalysisFrameworkCount[]> {
    await this.initialize();
    const filter = this.buildSemanticQualityFilter(params);
    const result = await this.queryable.query(
      `
        SELECT analysis_framework_id, COUNT(*)::int AS count
        FROM semantic_execution_audits
        WHERE ${filter.clauses.join("\n          AND ")}
          AND analysis_framework_id IS NOT NULL
        GROUP BY analysis_framework_id
        ORDER BY count DESC, analysis_framework_id ASC
        LIMIT $${filter.values.length + 1}
      `,
      [...filter.values, params.limit],
    );
    return result.rows.map((row) => ({
      frameworkId: String(row.analysis_framework_id),
      count: normalizeNumeric(row.count),
    }));
  }

  private async getTopRouteUpgradeCounts(params: {
    windowHours: number;
    now: Date;
    limit: number;
    occurredAfter?: string;
    deployMarker?: string;
  }): Promise<HetangSemanticRouteUpgradeCount[]> {
    await this.initialize();
    const filter = this.buildSemanticQualityFilter(params);
    const result = await this.queryable.query(
      `
        SELECT route_upgrade_kind, COUNT(*)::int AS count
        FROM semantic_execution_audits
        WHERE ${filter.clauses.join("\n          AND ")}
          AND route_upgrade_kind IS NOT NULL
        GROUP BY route_upgrade_kind
        ORDER BY count DESC, route_upgrade_kind ASC
        LIMIT $${filter.values.length + 1}
      `,
      [...filter.values, params.limit],
    );
    return result.rows.map((row) => ({
      upgradeKind: String(row.route_upgrade_kind),
      count: normalizeNumeric(row.count),
    }));
  }

  async getSemanticFailureTopCounts(params: {
    windowHours: number;
    now: Date;
    limit: number;
    occurredAfter?: string;
    deployMarker?: string;
  }): Promise<HetangSemanticFailureClassCount[]> {
    await this.initialize();
    const filter = this.buildSemanticQualityFilter(params);
    const result = await this.queryable.query(
      `
        SELECT failure_class, COUNT(*)::int AS count
        FROM semantic_execution_audits
        WHERE ${filter.clauses.join("\n          AND ")}
          AND failure_class IS NOT NULL
        GROUP BY failure_class
        ORDER BY count DESC, failure_class ASC
        LIMIT $${filter.values.length + 1}
      `,
      [...filter.values, params.limit],
    );
    return result.rows.map((row) => ({
      failureClass: String(row.failure_class),
      count: normalizeNumeric(row.count),
    }));
  }

  async getSemanticQualitySummary(params: {
    windowHours: number;
    now: Date;
    limit: number;
    occurredAfter?: string;
    deployMarker?: string;
  }): Promise<HetangSemanticQualitySummary> {
    await this.initialize();
    const filter = this.buildSemanticQualityFilter(params);
    const summaryResult = await this.queryable.query(
      `
        SELECT
          COUNT(*)::int AS total_count,
          COALESCE(SUM(CASE WHEN success THEN 1 ELSE 0 END), 0)::int AS success_count,
          COALESCE(SUM(CASE WHEN clarification_needed THEN 1 ELSE 0 END), 0)::int AS clarify_count,
          COALESCE(SUM(CASE WHEN fallback_used THEN 1 ELSE 0 END), 0)::int AS fallback_used_count,
          COALESCE(SUM(CASE WHEN state_carried_forward THEN 1 ELSE 0 END), 0)::int AS carry_success_count,
          COALESCE(SUM(CASE WHEN state_carried_forward OR topic_switch_detected OR clarification_needed THEN 1 ELSE 0 END), 0)::int AS carry_opportunity_count,
          COALESCE(SUM(CASE WHEN topic_switch_detected THEN 1 ELSE 0 END), 0)::int AS topic_switch_count,
          MAX(occurred_at) AS latest_occurred_at
        FROM semantic_execution_audits
        WHERE ${filter.clauses.join("\n          AND ")}
      `,
      filter.values,
    );
    const row = (summaryResult.rows[0] ?? {}) as Record<string, unknown>;
    const totalCount = normalizeNumeric(row.total_count);
    const successCount = normalizeNumeric(row.success_count);
    const clarifyCount = normalizeNumeric(row.clarify_count);
    const fallbackUsedCount = normalizeNumeric(row.fallback_used_count);
    const carrySuccessCount = normalizeNumeric(row.carry_success_count);
    const carryOpportunityCount = normalizeNumeric(row.carry_opportunity_count);
    const topicSwitchCount = normalizeNumeric(row.topic_switch_count);
    const topFailureClasses = await this.getSemanticFailureTopCounts({
      windowHours: params.windowHours,
      now: params.now,
      limit: params.limit,
      occurredAfter: params.occurredAfter,
      deployMarker: params.deployMarker,
    });
    const [topAnalysisFrameworks, topRouteUpgrades] = await Promise.all([
      this.getTopAnalysisFrameworkCounts({
        windowHours: params.windowHours,
        now: params.now,
        limit: params.limit,
        occurredAfter: params.occurredAfter,
        deployMarker: params.deployMarker,
      }),
      this.getTopRouteUpgradeCounts({
        windowHours: params.windowHours,
        now: params.now,
        limit: params.limit,
        occurredAfter: params.occurredAfter,
        deployMarker: params.deployMarker,
      }),
    ]);

    return {
      windowHours: params.windowHours,
      totalCount,
      successCount,
      successRate: totalCount > 0 ? successCount / totalCount : null,
      clarifyCount,
      clarifyRate: totalCount > 0 ? clarifyCount / totalCount : null,
      fallbackUsedCount,
      fallbackRate: totalCount > 0 ? fallbackUsedCount / totalCount : null,
      carrySuccessCount,
      carrySuccessRate:
        carryOpportunityCount > 0 ? carrySuccessCount / carryOpportunityCount : null,
      topicSwitchCount,
      latestOccurredAt: normalizeTimestampField(row.latest_occurred_at),
      topFailureClasses,
      topAnalysisFrameworks,
      topRouteUpgrades,
      optimizationBacklog: [],
      sampleCandidates: [],
    };
  }
}
