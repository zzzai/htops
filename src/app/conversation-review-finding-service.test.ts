import { describe, expect, it } from "vitest";
import { buildConversationReviewFindingCandidates } from "./conversation-review-finding-service.js";
import type { HetangInboundMessageAuditRecord } from "../types.js";

const inboundAudits: HetangInboundMessageAuditRecord[] = [
  {
    requestId: "req-1",
    channel: "wecom",
    senderId: "u-1",
    conversationId: "chat-1",
    isGroup: false,
    content: "这几天义乌店加钟率多少",
    receivedAt: "2026-04-16T10:00:00.000Z",
  },
];

describe("buildConversationReviewFindingCandidates", () => {
  it("derives deterministic review findings from audit and fallback signals", () => {
    const result = buildConversationReviewFindingCandidates({
      inboundAudits,
      analysisSignals: [
        {
          jobId: "job-1",
          orgId: "1001",
          storeName: "义乌店",
          fallbackStage: "bounded_synthesis",
        },
      ],
      shadowSignals: [],
    });

    expect(result.findings.map((item) => item.findingType)).toEqual(
      expect.arrayContaining(["scope_gap", "analysis_gap"]),
    );
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          findingType: "scope_gap",
          suggestedActionType: "add_eval_sample",
          followupTargets: ["sample_candidate", "backlog_candidate"],
        }),
        expect.objectContaining({
          findingType: "analysis_gap",
          suggestedActionType: "add_diagnostic_signal",
          followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
        }),
      ]),
    );
  });
});
