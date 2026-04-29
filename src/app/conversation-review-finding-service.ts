import type {
  HetangConversationReviewAnalysisSignal,
  HetangConversationReviewCustomerProfileSignal,
  HetangConversationReviewFindingCandidate,
  HetangConversationReviewFindingCandidateSet,
  HetangConversationReviewFollowupTarget,
  HetangConversationReviewShadowSignal,
  HetangInboundMessageAuditRecord,
} from "../types.js";

function normalizeMatchText(text: string): string {
  return text.replace(/\s+/gu, "").trim().toLowerCase();
}

function hasExplicitDayWindow(normalized: string): boolean {
  return /近?\d+天/iu.test(normalized) || /(昨天|今日|今天|昨日|本周|上周|本月|上月)/u.test(normalized);
}

function resolveFollowupTargets(
  findingType: HetangConversationReviewFindingCandidate["findingType"],
): HetangConversationReviewFollowupTarget[] {
  switch (findingType) {
    case "scope_gap":
      return ["sample_candidate", "backlog_candidate"];
    case "analysis_gap":
    case "reply_quality_issue":
      return ["backlog_candidate", "deploy_followup_candidate"];
    case "memory_candidate":
      return ["backlog_candidate"];
    default:
      return ["backlog_candidate"];
  }
}

function buildScopeGapFinding(
  audit: HetangInboundMessageAuditRecord,
): HetangConversationReviewFindingCandidate | null {
  const normalized = normalizeMatchText(audit.content);
  if (!normalized) {
    return null;
  }
  if (!/(这几天|近几天)/u.test(normalized) || hasExplicitDayWindow(normalized)) {
    return null;
  }
  return {
    conversationId: audit.conversationId,
    channel: audit.channel,
    accountId: audit.accountId,
    chatId: audit.conversationId,
    senderId: audit.senderId,
    findingType: "scope_gap",
    severity: "high",
    confidence: 0.96,
    title: "口语时间范围未结构化",
    summary: "用户使用“这几天/近几天”这类口语范围，但系统需要显式默认窗口规则来稳定解释。",
    evidenceJson: JSON.stringify({
      requestId: audit.requestId,
      rawText: audit.content,
      receivedAt: audit.receivedAt,
    }),
    suggestedActionType: "add_eval_sample",
    suggestedActionPayloadJson: JSON.stringify({
      gapKind: "implicit_time_window",
      rawText: audit.content,
    }),
    followupTargets: resolveFollowupTargets("scope_gap"),
  };
}

function buildReplyQualityFinding(
  audit: HetangInboundMessageAuditRecord,
): HetangConversationReviewFindingCandidate | null {
  const normalized = normalizeMatchText(audit.content);
  if (!/(回复错了|回复不了|乱七八糟|答错了|为什么回复不了)/u.test(normalized)) {
    return null;
  }
  return {
    conversationId: audit.conversationId,
    channel: audit.channel,
    accountId: audit.accountId,
    chatId: audit.conversationId,
    senderId: audit.senderId,
    findingType: "reply_quality_issue",
    severity: "high",
    confidence: 0.92,
    title: "用户显式指出回复质量问题",
    summary: "用户直接反馈回复错误、不可用或表达混乱，说明该问法需要进入质量复盘。",
    evidenceJson: JSON.stringify({
      requestId: audit.requestId,
      rawText: audit.content,
      receivedAt: audit.receivedAt,
    }),
    suggestedActionType: "tighten_guardrail",
    suggestedActionPayloadJson: JSON.stringify({
      rawText: audit.content,
      signal: "explicit_negative_feedback",
    }),
    followupTargets: resolveFollowupTargets("reply_quality_issue"),
  };
}

function buildMemoryCandidateFinding(
  audit: HetangInboundMessageAuditRecord,
): HetangConversationReviewFindingCandidate | null {
  const normalized = normalizeMatchText(audit.content);
  if (!/(默认5天|默认五天|以后理解成|以后按|以后都按)/u.test(normalized)) {
    return null;
  }
  return {
    conversationId: audit.conversationId,
    channel: audit.channel,
    accountId: audit.accountId,
    chatId: audit.conversationId,
    senderId: audit.senderId,
    findingType: "memory_candidate",
    severity: "medium",
    confidence: 0.9,
    title: "用户给出稳定口径约定",
    summary: "用户提供了可能长期有效的默认解释规则，适合进入受控记忆或结构化配置候选。",
    evidenceJson: JSON.stringify({
      requestId: audit.requestId,
      rawText: audit.content,
      receivedAt: audit.receivedAt,
    }),
    suggestedActionType: "promote_to_structured_config",
    suggestedActionPayloadJson: JSON.stringify({
      rawText: audit.content,
      candidateKind: "default_rule",
    }),
    followupTargets: resolveFollowupTargets("memory_candidate"),
    memoryCandidateJson: JSON.stringify({
      rawText: audit.content,
      source: "user_correction",
    }),
  };
}

function buildCustomerProfileFinding(
  signal: HetangConversationReviewCustomerProfileSignal,
): HetangConversationReviewFindingCandidate | null {
  switch (signal.signalType) {
    case "missing_observation":
      return {
        orgId: signal.orgId,
        storeName: signal.storeName,
        findingType: "capability_gap",
        severity: signal.severity,
        confidence: 0.93,
        title: "顾客经营画像缺少观察输入",
        summary: signal.summary,
        evidenceJson: signal.evidenceJson,
        suggestedActionType: "add_customer_observation_capture",
        suggestedActionPayloadJson: JSON.stringify({
          signalType: signal.signalType,
          customerIdentityKey: signal.customerIdentityKey,
          memberId: signal.memberId,
        }),
        followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
      };
    case "stale_profile":
      return {
        orgId: signal.orgId,
        storeName: signal.storeName,
        findingType: "capability_gap",
        severity: signal.severity,
        confidence: 0.95,
        title: "顾客经营画像已过期",
        summary: signal.summary,
        evidenceJson: signal.evidenceJson,
        suggestedActionType: "refresh_customer_operating_profile",
        suggestedActionPayloadJson: JSON.stringify({
          signalType: signal.signalType,
          customerIdentityKey: signal.customerIdentityKey,
          memberId: signal.memberId,
        }),
        followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
      };
    case "low_hit_action":
      return {
        orgId: signal.orgId,
        storeName: signal.storeName,
        findingType: "analysis_gap",
        severity: signal.severity,
        confidence: 0.88,
        title: "画像桥接动作命中偏低",
        summary: signal.summary,
        evidenceJson: signal.evidenceJson,
        suggestedActionType: "tighten_action_profile_bridge",
        suggestedActionPayloadJson: JSON.stringify({
          signalType: signal.signalType,
          customerIdentityKey: signal.customerIdentityKey,
          memberId: signal.memberId,
        }),
        followupTargets: ["backlog_candidate", "deploy_followup_candidate"],
      };
    default:
      return null;
  }
}

function buildAnalysisGapFinding(
  signal: HetangConversationReviewAnalysisSignal,
): HetangConversationReviewFindingCandidate | null {
  if (!signal.fallbackStage) {
    return null;
  }
  const severity = signal.fallbackStage === "bounded_synthesis" ? "high" : "medium";
  return {
    jobId: signal.jobId,
    orgId: signal.orgId,
    storeName: signal.storeName,
    findingType: "analysis_gap",
    severity,
    confidence: 0.94,
    title: "分析链发生降级回退",
    summary: `analysis 在 ${signal.fallbackStage} 阶段发生 fallback，说明该诊断链仍有能力缺口。`,
    evidenceJson: JSON.stringify({
      jobId: signal.jobId,
      orgId: signal.orgId,
      storeName: signal.storeName,
      fallbackStage: signal.fallbackStage,
    }),
    suggestedActionType: "add_diagnostic_signal",
    suggestedActionPayloadJson: JSON.stringify({
      jobId: signal.jobId,
      fallbackStage: signal.fallbackStage,
    }),
    followupTargets: resolveFollowupTargets("analysis_gap"),
  };
}

function dedupeFindings(
  findings: HetangConversationReviewFindingCandidate[],
): HetangConversationReviewFindingCandidate[] {
  const seen = new Set<string>();
  const deduped: HetangConversationReviewFindingCandidate[] = [];
  for (const finding of findings) {
    const key = [
      finding.findingType,
      finding.conversationId ?? "",
      finding.jobId ?? "",
      finding.title,
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(finding);
  }
  return deduped;
}

export function buildConversationReviewFindingCandidates(params: {
  inboundAudits: HetangInboundMessageAuditRecord[];
  analysisSignals: HetangConversationReviewAnalysisSignal[];
  customerProfileSignals?: HetangConversationReviewCustomerProfileSignal[];
  shadowSignals: HetangConversationReviewShadowSignal[];
}): HetangConversationReviewFindingCandidateSet {
  const findings: HetangConversationReviewFindingCandidate[] = [];

  for (const audit of params.inboundAudits) {
    const scopeGapFinding = buildScopeGapFinding(audit);
    if (scopeGapFinding) {
      findings.push(scopeGapFinding);
    }

    const replyQualityFinding = buildReplyQualityFinding(audit);
    if (replyQualityFinding) {
      findings.push(replyQualityFinding);
    }

    const memoryCandidateFinding = buildMemoryCandidateFinding(audit);
    if (memoryCandidateFinding) {
      findings.push(memoryCandidateFinding);
    }
  }

  for (const signal of params.analysisSignals) {
    const analysisGapFinding = buildAnalysisGapFinding(signal);
    if (analysisGapFinding) {
      findings.push(analysisGapFinding);
    }
  }

  for (const signal of params.customerProfileSignals ?? []) {
    const profileFinding = buildCustomerProfileFinding(signal);
    if (profileFinding) {
      findings.push(profileFinding);
    }
  }

  void params.shadowSignals;

  return {
    findings: dedupeFindings(findings),
  };
}
