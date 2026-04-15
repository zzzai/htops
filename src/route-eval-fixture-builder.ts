import { resolveSemanticIntent } from "./semantic-intent.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "./types.js";

export type RouteEvalFixtureDraft = {
  id: string;
  rawText: string;
  expectedLane: "meta" | "query" | "analysis";
  expectedIntentKind: string;
  expectedOrgIds?: string[];
  expectedCapabilityId?: string;
  notes?: string;
};

function normalizeFixtureText(audit: HetangInboundMessageAuditRecord): string {
  return (audit.effectiveContent?.trim() || audit.content.trim()).replace(/\s+/gu, " ");
}

function buildFixtureNotes(audit: HetangInboundMessageAuditRecord): string {
  const parts = [
    audit.receivedAt ? `receivedAt=${audit.receivedAt}` : null,
    audit.channel ? `channel=${audit.channel}` : null,
    audit.senderName ? `sender=${audit.senderName}` : audit.senderId ? `senderId=${audit.senderId}` : null,
    audit.conversationId ? `conversation=${audit.conversationId}` : null,
  ].filter((value): value is string => Boolean(value));
  return parts.join("; ");
}

export function buildRouteEvalFixturesFromInboundAudits(params: {
  config: HetangOpsConfig;
  audits: HetangInboundMessageAuditRecord[];
  now: Date;
}): RouteEvalFixtureDraft[] {
  const seen = new Set<string>();
  const fixtures: RouteEvalFixtureDraft[] = [];

  for (const audit of params.audits) {
    const rawText = normalizeFixtureText(audit);
    if (!rawText || seen.has(rawText)) {
      continue;
    }
    seen.add(rawText);

    const intent = resolveSemanticIntent({
      config: params.config,
      text: rawText,
      now: params.now,
    });

    fixtures.push({
      id: `audit-${String(fixtures.length + 1).padStart(3, "0")}`,
      rawText,
      expectedLane: intent.lane,
      expectedIntentKind: intent.kind,
      ...(intent.scope.orgIds.length > 0 ? { expectedOrgIds: intent.scope.orgIds } : {}),
      ...(intent.capabilityId ? { expectedCapabilityId: intent.capabilityId } : {}),
      ...(buildFixtureNotes(audit) ? { notes: buildFixtureNotes(audit) } : {}),
    });
  }

  return fixtures;
}
