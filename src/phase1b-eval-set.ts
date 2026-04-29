import { buildRouteEvalFixturesFromInboundAudits } from "./route-eval-fixture-builder.js";
import type { HetangInboundMessageAuditRecord, HetangOpsConfig } from "./types.js";

export type Phase1bEvalSet = {
  sourceAuditCount: number;
  includedAuditCount: number;
  fixtureCount: number;
  fixtures: ReturnType<typeof buildRouteEvalFixturesFromInboundAudits>;
};

function normalizeAuditText(audit: HetangInboundMessageAuditRecord): string {
  return (audit.effectiveContent?.trim() || audit.content.trim()).replace(/\s+/gu, " ");
}

export function filterInboundAuditsForEvalSet(params: {
  audits: HetangInboundMessageAuditRecord[];
  includeUnmentionedGroupMessages?: boolean;
  limit?: number;
}): HetangInboundMessageAuditRecord[] {
  const includeUnmentionedGroupMessages = params.includeUnmentionedGroupMessages === true;
  const seenTexts = new Set<string>();
  const filtered: HetangInboundMessageAuditRecord[] = [];
  const maxCount =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.floor(params.limit))
      : Number.POSITIVE_INFINITY;

  for (const audit of params.audits) {
    const normalizedText = normalizeAuditText(audit);
    if (!normalizedText) {
      continue;
    }
    if (audit.isGroup && audit.wasMentioned === false && !includeUnmentionedGroupMessages) {
      continue;
    }
    if (seenTexts.has(normalizedText)) {
      continue;
    }
    seenTexts.add(normalizedText);
    filtered.push(audit);
    if (filtered.length >= maxCount) {
      break;
    }
  }

  return filtered;
}

export function buildPhase1bEvalSet(params: {
  config: HetangOpsConfig;
  audits: HetangInboundMessageAuditRecord[];
  now: Date;
  includeUnmentionedGroupMessages?: boolean;
  limit?: number;
}): Phase1bEvalSet {
  const includedAudits = filterInboundAuditsForEvalSet({
    audits: params.audits,
    includeUnmentionedGroupMessages: params.includeUnmentionedGroupMessages,
    limit: params.limit,
  });
  const fixtures = buildRouteEvalFixturesFromInboundAudits({
    config: params.config,
    audits: includedAudits,
    now: params.now,
  });
  return {
    sourceAuditCount: params.audits.length,
    includedAuditCount: includedAudits.length,
    fixtureCount: fixtures.length,
    fixtures,
  };
}
