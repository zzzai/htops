import type { HetangInboundMessageAuditRecord } from "./types.js";

type Queryable = {
  query: (
    sql: string,
    params: Array<string | number>,
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

function normalizeNumeric(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid numeric value: ${String(value)}`);
  }
  return parsed;
}

export async function listInboundAuditsReadOnly(
  queryable: Queryable,
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
  const result = await queryable.query(
    `
      SELECT *
      FROM inbound_message_audit_logs
      ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY received_at DESC, id DESC
      LIMIT $${values.length}
    `,
    values,
  );

  return result.rows.map((row) => ({
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
