import type { Pool } from "pg";
import type {
  HetangConversationClarificationReason,
  HetangConversationSemanticStateSnapshot,
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

function parseObjectRecord(value: unknown): Record<string, unknown> {
  if (!value) {
    return {};
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseStringArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed)
        ? parsed.filter((entry): entry is string => typeof entry === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function isClarificationReason(
  value: unknown,
): value is HetangConversationClarificationReason {
  return (
    value === "missing-store" ||
    value === "missing-time" ||
    value === "missing-metric" ||
    value === "mixed-scope" ||
    value === "missing-object-scope"
  );
}

export class HetangConversationSemanticStateStore {
  private initialized = false;

  constructor(private readonly queryable: Queryable) {}

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    await this.queryable.query(`
      CREATE TABLE IF NOT EXISTS conversation_semantic_state (
        session_id TEXT PRIMARY KEY,
        channel TEXT NOT NULL,
        sender_id TEXT,
        conversation_id TEXT,
        current_goal TEXT,
        current_lane TEXT,
        last_intent_kind TEXT,
        clarification_pending BOOLEAN NOT NULL DEFAULT FALSE,
        clarification_reason TEXT,
        anchored_slots_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        missing_slots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
        belief_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        desire_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        intention_state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        last_route_snapshot_json JSONB,
        confidence DOUBLE PRECISION,
        updated_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_conversation_semantic_state_expiry
        ON conversation_semantic_state (expires_at);

      ALTER TABLE conversation_semantic_state
        ALTER COLUMN updated_at TYPE TIMESTAMPTZ
        USING updated_at::timestamptz;

      ALTER TABLE conversation_semantic_state
        ALTER COLUMN expires_at TYPE TIMESTAMPTZ
        USING CASE
          WHEN expires_at IS NULL OR btrim(expires_at) = '' THEN NULL
          ELSE expires_at::timestamptz
        END;
    `);
    this.initialized = true;
  }

  async getConversationSemanticState(
    sessionId: string,
  ): Promise<HetangConversationSemanticStateSnapshot | null> {
    await this.initialize();
    const result = await this.queryable.query(
      `
        SELECT *
        FROM conversation_semantic_state
        WHERE session_id = $1
        LIMIT 1
      `,
      [sessionId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return null;
    }
    return {
      sessionId: String(row.session_id),
      channel: String(row.channel),
      senderId: typeof row.sender_id === "string" ? row.sender_id : undefined,
      conversationId: typeof row.conversation_id === "string" ? row.conversation_id : undefined,
      currentGoal: typeof row.current_goal === "string" ? row.current_goal : undefined,
      currentLane:
        row.current_lane === "meta" || row.current_lane === "query" || row.current_lane === "analysis"
          ? row.current_lane
          : undefined,
      lastIntentKind: typeof row.last_intent_kind === "string" ? row.last_intent_kind : undefined,
      clarificationPending: row.clarification_pending === true,
      clarificationReason: isClarificationReason(row.clarification_reason)
        ? row.clarification_reason
        : undefined,
      anchoredSlots: parseObjectRecord(row.anchored_slots_json),
      missingSlots: parseStringArray(row.missing_slots_json),
      beliefState: parseObjectRecord(row.belief_state_json),
      desireState: parseObjectRecord(row.desire_state_json),
      intentionState: parseObjectRecord(row.intention_state_json),
      lastRouteSnapshot: parseObjectRecord(row.last_route_snapshot_json),
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      updatedAt: normalizeTimestampField(row.updated_at) ?? String(row.updated_at),
      expiresAt: normalizeTimestampField(row.expires_at),
    };
  }

  async upsertConversationSemanticState(snapshot: HetangConversationSemanticStateSnapshot): Promise<void> {
    await this.initialize();
    await this.queryable.query(
      `
        INSERT INTO conversation_semantic_state (
          session_id, channel, sender_id, conversation_id, current_goal, current_lane,
          last_intent_kind, clarification_pending, clarification_reason, anchored_slots_json,
          missing_slots_json, belief_state_json, desire_state_json, intention_state_json,
          last_route_snapshot_json, confidence, updated_at, expires_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10::jsonb,
          $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb,
          $15::jsonb, $16, $17, $18
        )
        ON CONFLICT (session_id) DO UPDATE SET
          channel = EXCLUDED.channel,
          sender_id = EXCLUDED.sender_id,
          conversation_id = EXCLUDED.conversation_id,
          current_goal = EXCLUDED.current_goal,
          current_lane = EXCLUDED.current_lane,
          last_intent_kind = EXCLUDED.last_intent_kind,
          clarification_pending = EXCLUDED.clarification_pending,
          clarification_reason = EXCLUDED.clarification_reason,
          anchored_slots_json = EXCLUDED.anchored_slots_json,
          missing_slots_json = EXCLUDED.missing_slots_json,
          belief_state_json = EXCLUDED.belief_state_json,
          desire_state_json = EXCLUDED.desire_state_json,
          intention_state_json = EXCLUDED.intention_state_json,
          last_route_snapshot_json = EXCLUDED.last_route_snapshot_json,
          confidence = EXCLUDED.confidence,
          updated_at = EXCLUDED.updated_at,
          expires_at = EXCLUDED.expires_at
      `,
      [
        snapshot.sessionId,
        snapshot.channel,
        snapshot.senderId ?? null,
        snapshot.conversationId ?? null,
        snapshot.currentGoal ?? null,
        snapshot.currentLane ?? null,
        snapshot.lastIntentKind ?? null,
        snapshot.clarificationPending,
        snapshot.clarificationReason ?? null,
        JSON.stringify(snapshot.anchoredSlots ?? {}),
        JSON.stringify(snapshot.missingSlots ?? []),
        JSON.stringify(snapshot.beliefState ?? {}),
        JSON.stringify(snapshot.desireState ?? {}),
        JSON.stringify(snapshot.intentionState ?? {}),
        JSON.stringify(snapshot.lastRouteSnapshot ?? {}),
        snapshot.confidence ?? null,
        snapshot.updatedAt,
        snapshot.expiresAt ?? null,
      ],
    );
  }

  async deleteExpiredConversationSemanticState(nowIso: string): Promise<void> {
    await this.initialize();
    await this.queryable.query(
      `
        DELETE FROM conversation_semantic_state
        WHERE expires_at IS NOT NULL
          AND expires_at <= $1::timestamptz
      `,
      [nowIso],
    );
  }
}
