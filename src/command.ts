import { resolveHetangCommandAction, resolveQuotaLimits } from "./access.js";
import { buildHetangAccessContext } from "./access/access-context.js";
import {
  renderAnalysisQueueLimitMessage,
  renderAnalysisQueueMessage,
} from "./analysis-queue-message.js";
import {
  extractHetangAnalysisOrchestrationMetadata,
  summarizeHetangAnalysisOrchestration,
  summarizeHetangAnalysisResult,
} from "./analysis-result.js";
import {
  materializeHetangAnalysisRequest,
  resolveHetangNaturalLanguageRoute,
} from "./analysis-router.js";
import { hasHetangApiCredentials } from "./config.js";
import { formatControlTowerSettings, validateControlTowerSettingValue } from "./control-tower.js";
import { hasMetricIntent, renderMetricQueryResponse, resolveMetricIntent } from "./metric-query.js";
import { executeHetangQuery } from "./query-engine.js";
import { HetangOpsRuntime, isHetangAnalysisQueueLimitError } from "./runtime.js";
import { resolveReportBizDate } from "./time.js";
import { resolvePreviousMonthKey } from "./monthly-report.js";
import {
  type CustomerObservationSourceRole,
  type HetangEmployeeBinding,
  type HetangOpsConfig,
  type MemberReactivationFeedbackStatus,
} from "./types.js";

function resolveOrgId(config: HetangOpsConfig, token: string | undefined): string | undefined {
  if (!token) {
    return undefined;
  }
  const normalized = token.trim();
  const direct = config.stores.find((entry) => entry.orgId === normalized);
  if (direct) {
    return direct.orgId;
  }
  const byName = config.stores.find(
    (entry) => entry.storeName === normalized || entry.rawAliases.includes(normalized),
  );
  return byName?.orgId;
}

export function formatHetangCommandHelp(): string {
  return [
    "Usage: /hetang status",
    "       /hetang sync [OrgId|门店名]",
    "       /hetang report [OrgId|门店名] [YYYY-MM-DD]",
    "       /hetang report [OrgId|门店名] [YYYY-MM-DD] [指标...]",
    "       /hetang report monthly [YYYY-MM]",
    "       /hetang query [自然语言问题]",
    "       /hetang analysis list [OrgId|门店名] [pending|running|completed|failed]",
    "       /hetang analysis status [任务ID]",
    "       /hetang analysis retry [任务ID]",
    "       /hetang chart weekly [YYYY-MM-DD]",
    "       /hetang queue status",
    "       /hetang queue deadletters [job|subscriber|all]",
    "       /hetang queue replay [死信ID]",
    "       /hetang queue cleanup stale-invalid-chatid-subscriber [limit]",
    "       /hetang action list [OrgId|门店名]",
    "       /hetang action create [OrgId|门店名] [分类] [low|medium|high] [标题]",
    "       /hetang action approve|reject|start|done|fail [动作单ID] [备注/分数]",
    "       /hetang learning [OrgId|门店名]",
    "       /hetang observation add [OrgId|门店名] [memberId] [signalDomain] [signalKey] [值] [备注]",
    "       /hetang review",
    "       /hetang reactivation summary [OrgId|门店名] [YYYY-MM-DD]",
    "       /hetang reactivation tasks [OrgId|门店名] [YYYY-MM-DD] [pending|contacted|replied|booked|arrived|closed]",
    "       /hetang reactivation update [OrgId|门店名] [YYYY-MM-DD] [memberId] [pending|contacted|replied|booked|arrived|closed] [跟进人] [备注]",
    "       /hetang intel run",
    "       /hetang intel latest",
    "       /hetang intel issue [issueId]",
    "       /hetang intel sources",
    "       /hetang tower show [global|OrgId|门店名]",
    "       /hetang tower set [global|OrgId|门店名] [key] [value]",
    "       /hetang whoami",
  ].join("\n");
}

function isDateToken(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/u.test(value.trim()));
}

function isMonthToken(value: string | undefined): boolean {
  return Boolean(value && /^\d{4}-\d{2}$/u.test(value.trim()));
}

function summarizeText(value: string): string {
  const trimmed = value.trim();
  return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 157)}...`;
}

function resolveBindingScopeOrgIds(binding: HetangEmployeeBinding): string[] {
  if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
    return binding.scopeOrgIds;
  }
  return binding.orgId ? [binding.orgId] : [];
}

function resolveDefaultNaturalLanguageOrgId(binding: HetangEmployeeBinding): string | undefined {
  const scopeOrgIds = resolveBindingScopeOrgIds(binding);
  return scopeOrgIds.length === 1 ? scopeOrgIds[0] : undefined;
}

function formatBindingStoreSummary(
  config: HetangOpsConfig,
  binding: HetangEmployeeBinding,
): string {
  const scopeOrgIds = resolveBindingScopeOrgIds(binding);
  if (binding.role === "hq" && scopeOrgIds.length === 0) {
    return "总部（可查全部门店）";
  }
  if (scopeOrgIds.length === 0) {
    return "总部";
  }
  const labels = scopeOrgIds.map((orgId) => {
    const store = config.stores.find((entry) => entry.orgId === orgId);
    return store?.storeName ?? orgId;
  });
  return labels.join("、");
}

function formatWhoAmI(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
  hourlyCount: number;
  dailyCount: number;
}): string {
  if (!params.binding) {
    return "当前企微账号未绑定门店权限，请联系管理员授权。";
  }
  const limits = resolveQuotaLimits(params.binding);
  return [
    `身份：${params.binding.employeeName ?? params.binding.senderId}`,
    `角色：${params.binding.role}`,
    `门店：${formatBindingStoreSummary(params.config, params.binding)}`,
    `小时用量：${params.hourlyCount}/${limits.hourlyLimit}`,
    `今日用量：${params.dailyCount}/${limits.dailyLimit}`,
  ].join("\n");
}

function messageForDeniedReason(reason: string): string {
  switch (reason) {
    case "unbound":
      return "当前企微账号未绑定门店权限，请联系管理员授权。";
    case "disabled":
      return "当前账号已停用数据问答权限。";
    case "role-denied":
      return "当前角色暂未开放经营数据问答。";
    case "hq-only":
      return "该命令仅总部账号可用。";
    case "binding-missing-org":
      return "当前账号未绑定门店，请联系管理员修正授权。";
    case "manager-multi-store-requires-org":
      return "当前账号已绑定多个门店，请先指定门店名或 OrgId。";
    case "manager-cross-store":
      return "当前账号仅允许查看绑定门店数据。";
    case "hourly-quota-exceeded":
      return "当前小时问答限额已用尽，请稍后再试。";
    case "daily-quota-exceeded":
      return "当前日问答限额已用尽，请明天再试。";
    case "sync-disabled":
      return "当前环境仅启用身份与权限校验，数据同步尚未启用。";
    case "reporting-disabled":
      return "当前环境仅启用身份与权限校验，经营日报尚未启用。";
    case "api-credentials-missing":
      return "当前环境未配置 Hetang API 同步凭证，已保留数据库问答与日报查询能力，暂不可执行同步。";
    default:
      return "当前请求未通过访问控制校验。";
  }
}

function parseReportArgs(
  config: HetangOpsConfig,
  tokens: string[],
): {
  reportKind: "daily" | "monthly";
  requestedOrgId?: string;
  requestedStoreToken?: string;
  bizDate?: string;
  month?: string;
  metricIntentText?: string;
} {
  const subAction = tokens[1]?.toLowerCase();
  if (subAction === "monthly" || subAction === "month" || tokens[1] === "月报") {
    return {
      reportKind: "monthly",
      month: isMonthToken(tokens[2]) ? tokens[2] : undefined,
    };
  }

  let index = 1;
  let requestedStoreToken: string | undefined;
  let requestedOrgId: string | undefined;

  if (tokens[index] && !isDateToken(tokens[index]) && !hasMetricIntent(tokens[index])) {
    requestedStoreToken = tokens[index];
    requestedOrgId = resolveOrgId(config, tokens[index]);
    index += 1;
  }

  let bizDate: string | undefined;
  if (isDateToken(tokens[index])) {
    bizDate = tokens[index];
    index += 1;
  }

  return {
    reportKind: "daily",
    requestedStoreToken,
    requestedOrgId,
    bizDate,
    metricIntentText: tokens.slice(index).join(" "),
  };
}

type ActionArgs = {
  subAction: string;
  requestedStoreToken?: string;
  requestedOrgId?: string;
  actionId?: string;
  category?: string;
  priority?: "low" | "medium" | "high";
  title?: string;
  note?: string;
  effectScore?: number;
};

type AnalysisArgs = {
  subAction: string;
  requestedStoreToken?: string;
  requestedOrgId?: string;
  status?: "pending" | "running" | "completed" | "failed";
  jobId?: string;
};

type IntelArgs = {
  subAction: string;
  issueId?: string;
};

type ChartArgs = {
  subAction: string;
  weekEndBizDate?: string;
};

type ReactivationArgs = {
  subAction: string;
  requestedStoreToken?: string;
  requestedOrgId?: string;
  bizDate?: string;
  feedbackStatus?: MemberReactivationFeedbackStatus;
  memberId?: string;
  followedBy?: string;
  note?: string;
  limit?: number;
};

type ObservationArgs = {
  subAction: string;
  requestedStoreToken?: string;
  requestedOrgId?: string;
  memberId?: string;
  signalDomain?: string;
  signalKey?: string;
  valueText?: string;
  note?: string;
};

type QueueArgs = {
  subAction: "status" | "deadletters" | "replay" | "cleanup";
  deadLetterScope?: "job" | "subscriber";
  deadLetterKey?: string;
  residualClass?: "stale-invalid-chatid-subscriber";
  limit?: number;
};

function isPriorityToken(value: string | undefined): value is "low" | "medium" | "high" {
  return value === "low" || value === "medium" || value === "high";
}

function isAnalysisStatusToken(
  value: string | undefined,
): value is "pending" | "running" | "completed" | "failed" {
  return value === "pending" || value === "running" || value === "completed" || value === "failed";
}

function parseActionArgs(config: HetangOpsConfig, tokens: string[]): ActionArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "help";
  if (subAction === "list") {
    const requestedStoreToken = tokens[2];
    return {
      subAction,
      requestedStoreToken,
      requestedOrgId: resolveOrgId(config, requestedStoreToken),
    };
  }
  if (subAction === "create") {
    let index = 2;
    let requestedStoreToken: string | undefined;
    let requestedOrgId: string | undefined;
    const candidateOrgId = resolveOrgId(config, tokens[index]);
    if (candidateOrgId) {
      requestedStoreToken = tokens[index];
      requestedOrgId = candidateOrgId;
      index += 1;
    }
    const category = tokens[index];
    if (!category) {
      return { subAction, requestedStoreToken, requestedOrgId };
    }
    index += 1;
    const priorityToken = tokens[index];
    const priority: ActionArgs["priority"] = isPriorityToken(priorityToken)
      ? priorityToken
      : "medium";
    if (isPriorityToken(priorityToken)) {
      index += 1;
    }
    return {
      subAction,
      requestedStoreToken,
      requestedOrgId,
      category,
      priority,
      title: tokens.slice(index).join(" ").trim(),
    };
  }
  if (
    subAction === "approve" ||
    subAction === "reject" ||
    subAction === "start" ||
    subAction === "done" ||
    subAction === "fail"
  ) {
    const actionId = tokens[2];
    if (subAction === "done" && tokens[3] && /^-?\d+(?:\.\d+)?$/u.test(tokens[3])) {
      return {
        subAction,
        actionId,
        effectScore: Number(tokens[3]),
        note: tokens.slice(4).join(" ").trim(),
      };
    }
    return {
      subAction,
      actionId,
      note: tokens.slice(3).join(" ").trim(),
    };
  }
  return { subAction };
}

function parseAnalysisArgs(config: HetangOpsConfig, tokens: string[]): AnalysisArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "list";
  if (subAction === "list") {
    let index = 2;
    let requestedStoreToken: string | undefined;
    let requestedOrgId: string | undefined;
    if (tokens[index] && !isAnalysisStatusToken(tokens[index])) {
      requestedStoreToken = tokens[index];
      requestedOrgId = resolveOrgId(config, requestedStoreToken);
      index += 1;
    }
    const statusToken = tokens[index];
    const status: AnalysisArgs["status"] = isAnalysisStatusToken(statusToken)
      ? statusToken
      : undefined;
    return {
      subAction,
      requestedStoreToken,
      requestedOrgId,
      status,
    };
  }
  if (subAction === "status" || subAction === "retry") {
    return {
      subAction,
      jobId: tokens[2],
    };
  }
  return { subAction };
}

function parseLearningArgs(config: HetangOpsConfig, tokens: string[]) {
  const requestedStoreToken = tokens[1];
  return {
    requestedStoreToken,
    requestedOrgId: resolveOrgId(config, requestedStoreToken),
  };
}

function isMemberReactivationFeedbackStatus(
  value: string | undefined,
): value is MemberReactivationFeedbackStatus {
  return (
    value === "pending" ||
    value === "contacted" ||
    value === "replied" ||
    value === "booked" ||
    value === "arrived" ||
    value === "closed"
  );
}

function parseReactivationArgs(config: HetangOpsConfig, tokens: string[]): ReactivationArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "summary";
  let index = 2;
  let requestedStoreToken: string | undefined;
  let requestedOrgId: string | undefined;

  const candidateStoreToken = tokens[index];
  if (candidateStoreToken) {
    const candidateOrgId = resolveOrgId(config, candidateStoreToken);
    const shouldTreatAsStoreToken =
      Boolean(candidateOrgId) ||
      ((subAction === "summary" || subAction === "tasks") &&
        !isDateToken(candidateStoreToken) &&
        !isMemberReactivationFeedbackStatus(candidateStoreToken));
    if (shouldTreatAsStoreToken) {
      requestedStoreToken = candidateStoreToken;
      requestedOrgId = candidateOrgId;
      index += 1;
    }
  }

  const bizDate = isDateToken(tokens[index]) ? tokens[index] : undefined;
  if (bizDate) {
    index += 1;
  }

  if (subAction === "tasks") {
    const feedbackStatusToken = tokens[index];
    const feedbackStatus = isMemberReactivationFeedbackStatus(feedbackStatusToken)
      ? feedbackStatusToken
      : undefined;
    if (feedbackStatus) {
      index += 1;
    }
    const limitToken = Number(tokens[index]);
    const limit = Number.isInteger(limitToken) && limitToken > 0 ? limitToken : undefined;
    return {
      subAction,
      requestedStoreToken,
      requestedOrgId,
      bizDate,
      feedbackStatus,
      limit,
    };
  }

  if (subAction === "update") {
    const memberId = tokens[index];
    const feedbackStatusToken = tokens[index + 1];
    const feedbackStatus = isMemberReactivationFeedbackStatus(feedbackStatusToken)
      ? feedbackStatusToken
      : undefined;
    const followedBy = tokens[index + 2];
    const note = tokens.slice(index + 3).join(" ").trim();
    return {
      subAction,
      requestedStoreToken,
      requestedOrgId,
      bizDate,
      memberId,
      feedbackStatus,
      followedBy,
      note: note || undefined,
    };
  }

  return {
    subAction,
    requestedStoreToken,
    requestedOrgId,
    bizDate,
  };
}

function parseObservationArgs(config: HetangOpsConfig, tokens: string[]): ObservationArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "add";
  let index = 2;
  let requestedStoreToken: string | undefined;
  let requestedOrgId: string | undefined;

  const candidateStoreToken = tokens[index];
  const candidateOrgId = resolveOrgId(config, candidateStoreToken);
  if (candidateOrgId) {
    requestedStoreToken = candidateStoreToken;
    requestedOrgId = candidateOrgId;
    index += 1;
  }

  return {
    subAction,
    requestedStoreToken,
    requestedOrgId,
    memberId: tokens[index],
    signalDomain: tokens[index + 1],
    signalKey: tokens[index + 2],
    valueText: tokens[index + 3],
    note: tokens.slice(index + 4).join(" ").trim() || undefined,
  };
}

function parseIntelArgs(tokens: string[]): IntelArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "latest";
  return {
    subAction,
    issueId: subAction === "issue" ? tokens[2] : undefined,
  };
}

function parseChartArgs(tokens: string[]): ChartArgs {
  const subAction = tokens[1]?.toLowerCase() ?? "weekly";
  return {
    subAction,
    weekEndBizDate: isDateToken(tokens[2]) ? tokens[2] : undefined,
  };
}

function parseQueueArgs(tokens: string[]): QueueArgs {
  const subAction = tokens[1]?.toLowerCase();
  if (subAction === "deadletters") {
    const scopeToken = tokens[2]?.toLowerCase();
    return {
      subAction,
      deadLetterScope:
        scopeToken === "job" || scopeToken === "subscriber" ? scopeToken : undefined,
    };
  }
  if (subAction === "replay") {
    return {
      subAction,
      deadLetterKey: tokens[2],
    };
  }
  if (subAction === "cleanup") {
    const residualClass =
      tokens[2]?.toLowerCase() === "stale-invalid-chatid-subscriber"
        ? "stale-invalid-chatid-subscriber"
        : undefined;
    const parsedLimit = Number(tokens[3]);
    return {
      subAction,
      residualClass,
      limit: Number.isInteger(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined,
    };
  }
  return {
    subAction: "status",
  };
}

function parseTowerValue(rawValue: string): boolean | number | string {
  const trimmed = rawValue.trim();
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

function parseTowerArgs(config: HetangOpsConfig, tokens: string[]) {
  const subAction = tokens[1]?.toLowerCase() ?? "show";
  const scopeToken = tokens[2];
  const requestedOrgId =
    scopeToken && scopeToken !== "global" ? resolveOrgId(config, scopeToken) : undefined;
  return {
    subAction,
    scopeToken,
    requestedOrgId,
    settingKey: tokens[3],
    value: tokens.length > 4 ? parseTowerValue(tokens.slice(4).join(" ")) : undefined,
  };
}

function resolvePolicyOrgId(
  binding: HetangEmployeeBinding | null,
  requestedOrgId?: string,
): string | undefined {
  if (requestedOrgId) {
    return requestedOrgId;
  }
  if (!binding) {
    return undefined;
  }
  const scoped = resolveBindingScopeOrgIds(binding);
  return scoped.length === 1 ? scoped[0] : undefined;
}

function resolveQuotaOverrides(settings: Record<string, boolean | number | string>) {
  return {
    hourlyLimit:
      typeof settings["quota.hourlyLimit"] === "number" ? settings["quota.hourlyLimit"] : undefined,
    dailyLimit:
      typeof settings["quota.dailyLimit"] === "number" ? settings["quota.dailyLimit"] : undefined,
  };
}

function formatActionResponse(item: {
  actionId: string;
  storeName?: string;
  status: string;
  category: string;
  title: string;
  priority: string;
}): string {
  return [
    `已创建动作单 ${item.actionId}`,
    `门店：${item.storeName ?? "-"}`,
    `状态：${item.status}`,
    `分类：${item.category}`,
    `优先级：${item.priority}`,
    `标题：${item.title}`,
  ].join("\n");
}

function formatLearningSummary(summary: {
  storeName: string;
  totalActionCount: number;
  decidedActionCount: number;
  adoptedActionCount: number;
  rejectedActionCount: number;
  doneActionCount: number;
  failedActionCount: number;
  adoptionRate: number | null;
  completionRate: number | null;
  analysisJobCount: number;
  analysisCompletedCount: number;
  analysisFailedCount: number;
  analysisRetriedJobCount: number;
  analysisCompletionRate: number | null;
  analysisRetryRate: number | null;
  analysisAverageDurationMinutes: number | null;
  analysisFallbackCount: number;
  analysisFallbackRate: number | null;
  analysisFallbackStageBreakdown: Array<{
    stage: string;
    count: number;
  }>;
  analysisAutoActionItemCount: number;
  analysisActionedJobCount: number;
  analysisActionConversionRate: number | null;
  analysisAverageActionsPerCompletedJob: number | null;
  topEffectiveCategories: Array<{
    category: string;
    actionCount: number;
    averageEffectScore: number;
  }>;
}): string {
  const topCategory =
    summary.topEffectiveCategories.length > 0
      ? summary.topEffectiveCategories
          .map(
            (entry) =>
              `${entry.category} ${entry.actionCount} 条，平均效果 ${entry.averageEffectScore.toFixed(1)}`,
          )
          .join("；")
      : "暂无效果回填";
  const fallbackBreakdown =
    summary.analysisFallbackStageBreakdown.length > 0
      ? summary.analysisFallbackStageBreakdown
          .map((entry) => `${entry.stage} ${entry.count} 条`)
          .join("；")
      : "无";
  return [
    `${summary.storeName} 学习摘要`,
    `动作总数 ${summary.totalActionCount}，已决策 ${summary.decidedActionCount}`,
    `采纳率 ${summary.adoptionRate === null ? "N/A" : `${(summary.adoptionRate * 100).toFixed(1)}%`}（采纳 ${summary.adoptedActionCount} / 驳回 ${summary.rejectedActionCount}）`,
    `完结率 ${summary.completionRate === null ? "N/A" : `${(summary.completionRate * 100).toFixed(1)}%`}（完成 ${summary.doneActionCount} / 失败 ${summary.failedActionCount}）`,
    `分析任务 ${summary.analysisJobCount} 条，完成率 ${summary.analysisCompletionRate === null ? "N/A" : `${(summary.analysisCompletionRate * 100).toFixed(1)}%`}（完成 ${summary.analysisCompletedCount} / 失败 ${summary.analysisFailedCount}）`,
    `分析重试率 ${summary.analysisRetryRate === null ? "N/A" : `${(summary.analysisRetryRate * 100).toFixed(1)}%`}（重试 ${summary.analysisRetriedJobCount} 条）`,
    `分析退化率 ${summary.analysisFallbackRate === null ? "N/A" : `${(summary.analysisFallbackRate * 100).toFixed(1)}%`}（fallback ${summary.analysisFallbackCount} / completed ${summary.analysisCompletedCount}）`,
    `退化分布：${fallbackBreakdown}`,
    `分析平均耗时 ${summary.analysisAverageDurationMinutes === null ? "N/A" : `${summary.analysisAverageDurationMinutes.toFixed(1)} 分钟`}`,
    `分析转动作 ${summary.analysisActionConversionRate === null ? "N/A" : `${(summary.analysisActionConversionRate * 100).toFixed(1)}%`}（落地 ${summary.analysisActionedJobCount} 个分析任务 / ${summary.analysisAutoActionItemCount} 条动作单）`,
    `单次完成分析平均落地 ${summary.analysisAverageActionsPerCompletedJob === null ? "N/A" : `${summary.analysisAverageActionsPerCompletedJob.toFixed(1)} 条动作`}`,
    `高效果类目：${topCategory}`,
  ].join("\n");
}

function formatConversationReviewSummary(summary: {
  latestRun: {
    reviewRunId: string;
    reviewDate: string;
    status: string;
    findingCount: number;
  } | null;
  summary: {
    reviewMode: string;
    reviewHeadline?: string;
  } | null;
  topFindingTypes: Array<{
    findingType: string;
    count: number;
  }>;
  suggestedActionCounts: Array<{
    suggestedActionType: string;
    count: number;
  }>;
  followupTargetCounts: Array<{
    followupTarget: string;
    count: number;
  }>;
  unresolvedHighSeverityFindings: Array<{
    findingType: string;
    title: string;
    summary: string;
  }>;
}): string {
  if (!summary.latestRun) {
    return "暂无对话复盘批次。";
  }

  return [
    "对话复盘摘要",
    `批次：${summary.latestRun.reviewRunId}`,
    `日期：${summary.latestRun.reviewDate}`,
    `状态：${summary.latestRun.status}`,
    `问题数：${summary.latestRun.findingCount}`,
    `模式：${summary.summary?.reviewMode ?? "deterministic-only"}`,
    ...(summary.summary?.reviewHeadline ? [`优先结论：${summary.summary.reviewHeadline}`] : []),
    `Top Finding：${
      summary.topFindingTypes.length > 0
        ? summary.topFindingTypes
            .map((item) => `${item.findingType} ${item.count}`)
            .join("；")
        : "无"
    }`,
    `建议动作：${
      summary.suggestedActionCounts.length > 0
        ? summary.suggestedActionCounts
            .map((item) => `${item.suggestedActionType} ${item.count}`)
            .join("；")
        : "无"
    }`,
    `进入主链：${
      summary.followupTargetCounts.length > 0
        ? summary.followupTargetCounts
            .map((item) => `${item.followupTarget} ${item.count}`)
            .join("；")
        : "无"
    }`,
    `高优先未解：${
      summary.unresolvedHighSeverityFindings.length > 0
        ? summary.unresolvedHighSeverityFindings
            .map((item) => `[${item.findingType}] ${item.title}`)
            .join("；")
        : "无"
    }`,
  ].join("\n");
}

function formatPercent(rate: number | null): string {
  return rate === null ? "N/A" : `${(rate * 100).toFixed(1)}%`;
}

function formatReactivationExecutionSummary(params: {
  storeName: string;
  summary: {
    bizDate: string;
    totalTaskCount: number;
    pendingCount: number;
    contactedCount: number;
    bookedCount: number;
    arrivedCount: number;
    contactRate: number | null;
    bookingRate: number | null;
    arrivalRate: number | null;
    priorityBandCounts: Array<{
      priorityBand: string;
      count: number;
    }>;
    followupBucketCounts: Array<{
      followupBucket: string;
      count: number;
    }>;
    topPendingTasks: Array<{
      customerDisplayName: string;
      priorityBand: string;
      daysSinceLastVisit: number;
      currentStoredBalanceInferred: number;
    }>;
  };
}): string {
  const topPending =
    params.summary.topPendingTasks.length > 0
      ? params.summary.topPendingTasks
          .map(
            (task) =>
              `${task.customerDisplayName}(${task.priorityBand}，${task.daysSinceLastVisit}天未到店，余额${task.currentStoredBalanceInferred.toFixed(0)}元)`,
          )
          .join("；")
      : "无";
  return [
    `${params.storeName} ${params.summary.bizDate} 召回执行摘要`,
    `任务总数 ${params.summary.totalTaskCount}｜待跟进 ${params.summary.pendingCount}｜已联系 ${params.summary.contactedCount}｜已预约 ${params.summary.bookedCount}｜已到店 ${params.summary.arrivedCount}`,
    `联系率 ${formatPercent(params.summary.contactRate)}｜预约率 ${formatPercent(params.summary.bookingRate)}｜到店率 ${formatPercent(params.summary.arrivalRate)}`,
    `优先级分布：${
      params.summary.priorityBandCounts.length > 0
        ? params.summary.priorityBandCounts
            .map((entry) => `${entry.priorityBand} ${entry.count}`)
            .join("；")
        : "无"
    }`,
    `召回桶：${
      params.summary.followupBucketCounts.length > 0
        ? params.summary.followupBucketCounts
            .map((entry) => `${entry.followupBucket} ${entry.count}`)
            .join("；")
        : "无"
    }`,
    `高优先待跟进：${topPending}`,
  ].join("\n");
}

function formatReactivationExecutionTasks(params: {
  storeName: string;
  bizDate: string;
  feedbackStatus?: MemberReactivationFeedbackStatus;
  tasks: Array<{
    memberId: string;
    customerDisplayName: string;
    priorityBand: string;
    feedbackStatus: MemberReactivationFeedbackStatus;
    daysSinceLastVisit: number;
    currentStoredBalanceInferred: number;
    reasonSummary: string;
    touchAdviceSummary: string;
  }>;
}): string {
  if (params.tasks.length === 0) {
    return `${params.storeName} ${params.bizDate} 暂无召回任务。`;
  }
  return [
    `${params.storeName} ${params.bizDate} 召回任务`,
    `${params.feedbackStatus ?? "全部"} ${params.tasks.length} 条`,
    ...params.tasks.map(
      (task) =>
        `- ${task.memberId} ${task.customerDisplayName} [${task.priorityBand}/${task.feedbackStatus}] ${task.daysSinceLastVisit}天未到店｜余额${task.currentStoredBalanceInferred.toFixed(0)}元｜${task.reasonSummary}｜${task.touchAdviceSummary}`,
    ),
  ].join("\n");
}

function buildMemberReactivationFeedbackFlags(status: MemberReactivationFeedbackStatus) {
  switch (status) {
    case "pending":
      return { contacted: false, replied: false, booked: false, arrived: false };
    case "contacted":
      return { contacted: true, replied: false, booked: false, arrived: false };
    case "replied":
      return { contacted: true, replied: true, booked: false, arrived: false };
    case "booked":
      return { contacted: true, replied: true, booked: true, arrived: false };
    case "arrived":
      return { contacted: true, replied: true, booked: true, arrived: true };
    case "closed":
      return { contacted: true, replied: false, booked: false, arrived: false };
  }
}

function summarizeFallbackStageBreakdown(
  resultTexts: Array<string | undefined>,
): string {
  const breakdown = Array.from(
    resultTexts.reduce((map, resultText) => {
      const fallbackStage = extractHetangAnalysisOrchestrationMetadata(resultText)?.fallbackStage;
      if (!fallbackStage) {
        return map;
      }
      map.set(fallbackStage, (map.get(fallbackStage) ?? 0) + 1);
      return map;
    }, new Map<string, number>()),
  )
    .map(([stage, count]) => `${stage} ${count} 条`)
    .sort((left, right) => left.localeCompare(right));
  return breakdown.length > 0 ? breakdown.join("；") : "无";
}

function formatAnalysisListResponse(
  scopeLabel: string,
  items: Array<{
    jobId: string;
    storeName?: string;
    status: string;
    timeFrameLabel: string;
    startBizDate: string;
    endBizDate: string;
    resultText?: string;
  }>,
): string {
  if (items.length === 0) {
    return `${scopeLabel} 暂无分析任务。`;
  }
  const fallbackCount = items.filter((item) => {
    const orchestration = extractHetangAnalysisOrchestrationMetadata(item.resultText);
    return Boolean(orchestration?.fallbackStage);
  }).length;
  return [
    `${scopeLabel} 分析任务`,
    `共 ${items.length} 条，fallback ${fallbackCount} 条`,
    `退化分布：${summarizeFallbackStageBreakdown(items.map((item) => item.resultText))}`,
    ...items.map(
      (item) => {
        const orchestrationLine = summarizeHetangAnalysisOrchestration(item.resultText)?.trim();
        return [
          `- ${item.jobId} [${item.status}] ${item.storeName ?? "-"} | ${item.timeFrameLabel} | ${item.startBizDate}..${item.endBizDate}`,
          ...(orchestrationLine ? [`  分析链路：${orchestrationLine}`] : []),
        ].join("\n");
      },
    ),
  ].join("\n");
}

function formatAnalysisStatusResponse(job: {
  jobId: string;
  storeName?: string;
  status: string;
  timeFrameLabel: string;
  startBizDate: string;
  endBizDate: string;
  attemptCount: number;
  resultText?: string;
  errorMessage?: string;
  deliveredAt?: string;
  deliveryAttemptCount?: number;
  lastDeliveryAttemptAt?: string;
  lastDeliveryError?: string;
  nextDeliveryAfter?: string;
  deliveryAbandonedAt?: string;
}): string {
  const detail =
    job.status === "completed"
      ? `结果：${summarizeText(summarizeHetangAnalysisResult(job.resultText)?.trim() || "无可复用结果")}`
      : job.status === "failed"
        ? `失败原因：${summarizeText(job.errorMessage?.trim() || "未知错误")}`
        : "结果：处理中";
  const orchestrationLine =
    job.status === "completed"
      ? summarizeHetangAnalysisOrchestration(job.resultText)?.trim()
      : undefined;
  const deliveryStatus = job.deliveryAbandonedAt
    ? "已终止"
    : job.deliveredAt
      ? "已送达"
      : job.nextDeliveryAfter
        ? `待重试（${job.nextDeliveryAfter}）`
        : "待发送";
  const deliveryAttemptLine =
    job.deliveryAttemptCount && job.deliveryAttemptCount > 0
      ? `投递尝试：${job.deliveryAttemptCount}`
      : undefined;
  const deliveryErrorLine = job.lastDeliveryError
    ? `投递异常：${summarizeText(job.lastDeliveryError)}`
    : undefined;
  return [
    `分析任务 ${job.jobId}`,
    `门店：${job.storeName ?? "-"}`,
    `状态：${job.status}`,
    `时间窗：${job.timeFrameLabel} (${job.startBizDate}..${job.endBizDate})`,
    `尝试次数：${job.attemptCount}`,
    `投递状态：${deliveryStatus}`,
    ...(deliveryAttemptLine ? [deliveryAttemptLine] : []),
    ...(deliveryErrorLine ? [deliveryErrorLine] : []),
    ...(orchestrationLine ? [`分析链路：${orchestrationLine}`] : []),
    detail,
  ].join("\n");
}

function formatQueueStatusResponse(summary: {
  sync: {
    pendingCount: number;
    completedCount: number;
    waitingCount: number;
  };
  delivery: {
    pendingCount: number;
    completedCount: number;
    waitingCount: number;
  };
  analysis: {
    pendingCount: number;
    runningCount: number;
    failedCount: number;
    unresolvedDeadLetterCount: number;
    jobDeliveryPendingCount: number;
    subscriberDeliveryPendingCount: number;
  };
}): string {
  return [
    "队列状态",
    `同步队列：待处理 ${summary.sync.pendingCount}｜等待 ${summary.sync.waitingCount}｜已完成 ${summary.sync.completedCount}`,
    `投递队列：待处理 ${summary.delivery.pendingCount}｜等待 ${summary.delivery.waitingCount}｜已完成 ${summary.delivery.completedCount}`,
    `分析队列：待处理 ${summary.analysis.pendingCount}｜运行中 ${summary.analysis.runningCount}｜失败 ${summary.analysis.failedCount}`,
    `分析投递：任务待投 ${summary.analysis.jobDeliveryPendingCount}｜订阅待投 ${summary.analysis.subscriberDeliveryPendingCount}｜死信 ${summary.analysis.unresolvedDeadLetterCount}`,
  ].join("\n");
}

function formatDeadLetterListResponse(
  items: Array<{
    deadLetterKey: string;
    deadLetterScope: string;
    jobId: string;
    reason: string;
    createdAt: string;
    resolvedAt?: string;
  }>,
): string {
  if (items.length === 0) {
    return "分析死信为空。";
  }
  return [
    "分析死信",
    ...items.map(
      (item) =>
        `- ${item.deadLetterKey} [${item.deadLetterScope}] ${item.jobId} | ${summarizeText(item.reason)} | ${item.resolvedAt ? `resolved ${item.resolvedAt}` : `created ${item.createdAt}`}`,
    ),
  ].join("\n");
}

function formatIncompleteReportMessage(params: {
  storeName: string;
  bizDate: string;
  alerts: Array<{ message: string }>;
}): string {
  const alertLines =
    params.alerts.length > 0 ? params.alerts.map((entry) => `- ${entry.message}`) : [];
  return [
    `${params.storeName} ${params.bizDate} 营业日数据尚未完成同步，当前不输出正式日报。`,
    ...alertLines,
  ].join("\n");
}

function resolveCommandReplyTarget(params: {
  replyTarget?: string;
  senderId?: string;
  from?: string;
  to?: string;
}): string | undefined {
  const explicit = params.replyTarget?.trim();
  if (explicit) {
    return explicit;
  }
  const sender = params.senderId?.trim();
  if (sender) {
    return sender;
  }
  const from = params.from?.trim();
  if (from) {
    return from;
  }
  const to = params.to?.trim();
  return to || undefined;
}

function formatExternalSourceList(config: HetangOpsConfig): string {
  const sources = [...config.externalIntelligence.sources].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  );
  if (sources.length === 0) {
    return "HQ 外部情报源\n当前未配置任何外部源。";
  }
  return [
    "HQ 外部情报源",
    ...sources.map(
      (source) =>
        `- ${source.displayName ?? source.sourceId} [${source.tier}] ${source.sourceId}${source.url ? ` ${source.url}` : ""}`,
    ),
    `HQ 投递：${config.externalIntelligence.hqDelivery.channel} / ${config.externalIntelligence.hqDelivery.target}`,
  ].join("\n");
}

export async function runHetangTypedQuery(params: {
  runtime: HetangOpsRuntime;
  config: HetangOpsConfig;
  queryText: string;
  channel?: string;
  senderId?: string;
  commandBody?: string;
  now?: Date;
}): Promise<string> {
  const now = params.now ?? new Date();
  const occurredAt = now.toISOString();
  const channel = params.channel ?? "unknown";
  const senderId = params.senderId;
  const queryText = params.queryText.trim();
  const commandBody = params.commandBody ?? `/hetang query ${queryText}`.trim();

  const binding =
    senderId && params.channel
      ? await params.runtime.getEmployeeBinding({
          channel,
          senderId,
        })
      : null;
  const usage =
    senderId && params.channel
      ? await params.runtime.getCommandUsage({
          channel,
          senderId,
          now,
        })
      : { hourlyCount: 0, dailyCount: 0 };
  const controlTowerSettings = await params.runtime.resolveControlTowerSettings({
    orgId: resolvePolicyOrgId(binding, undefined),
  });
  const quotaOverrides = resolveQuotaOverrides(controlTowerSettings);
  const accessContext = buildHetangAccessContext({
    action: "query",
    binding,
    usage,
    requestedOrgId: undefined,
    quotaOverrides,
  });
  const access = {
    allowed: accessContext.decision.status === "allow",
    action: "query" as const,
    reason: accessContext.decision.reason,
    effectiveOrgId: accessContext.scope.effective_org_id,
    hourlyLimit: accessContext.quotas.hourly_limit,
    dailyLimit: accessContext.quotas.daily_limit,
    consumeQuota: accessContext.decision.consume_quota,
  };

  if (!queryText) {
    const text = "请直接输入自然语言问题，例如：/hetang query 义乌店昨天营收";
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action: "query",
      decision: "denied",
      consumeQuota: access.consumeQuota,
      reason: "query-empty",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (!access.allowed) {
    const text = messageForDeniedReason(access.reason);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action: "query",
      requestedOrgId: undefined,
      effectiveOrgId: access.effectiveOrgId,
      decision: "denied",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  const result = await executeHetangQuery({
    runtime: params.runtime,
    config: params.config,
    binding: binding!,
    text: queryText,
    now,
  });
  await params.runtime.recordCommandAudit({
    occurredAt,
    channel,
    senderId,
    commandName: "hetang",
    action: "query",
    requestedOrgId:
      result.requestedOrgIds.length > 0 ? result.requestedOrgIds.join(",") : undefined,
    effectiveOrgId:
      result.effectiveOrgIds.length > 0 ? result.effectiveOrgIds.join(",") : undefined,
    decision: "allowed",
    consumeQuota: access.consumeQuota,
    reason: access.reason,
    commandBody,
    responseExcerpt: summarizeText(result.text),
    queryEntrySource: result.entry?.source,
    queryEntryReason: result.entry?.reason,
  });
  return result.text;
}

export async function runHetangCommand(params: {
  runtime: HetangOpsRuntime;
  config: HetangOpsConfig;
  args: string;
  channel?: string;
  senderId?: string;
  commandBody?: string;
  from?: string;
  to?: string;
  accountId?: string;
  messageThreadId?: string | number;
  replyTarget?: string;
  now?: Date;
}): Promise<string> {
  const now = params.now ?? new Date();
  const tokens = params.args.split(/\s+/u).filter(Boolean);
  const action = resolveHetangCommandAction(params.args);
  const occurredAt = now.toISOString();
  const channel = params.channel ?? "unknown";
  const senderId = params.senderId;
  const commandBody = params.commandBody ?? `/hetang ${params.args}`.trim();

  if (action === "help") {
    const text = formatHetangCommandHelp();
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "allowed",
      consumeQuota: false,
      reason: "help",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  const binding =
    senderId && params.channel
      ? await params.runtime.getEmployeeBinding({
          channel,
          senderId,
        })
      : null;
  const usage =
    senderId && params.channel
      ? await params.runtime.getCommandUsage({
          channel,
          senderId,
          now,
        })
      : { hourlyCount: 0, dailyCount: 0 };

  if (action === "whoami") {
    const text = formatWhoAmI({
      config: params.config,
      binding,
      hourlyCount: usage.hourlyCount,
      dailyCount: usage.dailyCount,
    });
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      effectiveOrgId: binding?.orgId,
      decision: "allowed",
      consumeQuota: false,
      reason: binding ? "whoami-bound" : "whoami-unbound",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  const reportArgs = action === "report" ? parseReportArgs(params.config, tokens) : undefined;
  const analysisArgs = action === "analysis" ? parseAnalysisArgs(params.config, tokens) : undefined;
  const chartArgs = action === "chart" ? parseChartArgs(tokens) : undefined;
  const intelArgs = action === "intel" ? parseIntelArgs(tokens) : undefined;
  const queueArgs = action === "queue" ? parseQueueArgs(tokens) : undefined;
  const actionArgs = action === "action" ? parseActionArgs(params.config, tokens) : undefined;
  const learningArgs = action === "learning" ? parseLearningArgs(params.config, tokens) : undefined;
  const reactivationArgs =
    action === "reactivation" ? parseReactivationArgs(params.config, tokens) : undefined;
  const observationArgs =
    action === "observation" ? parseObservationArgs(params.config, tokens) : undefined;
  const towerArgs = action === "tower" ? parseTowerArgs(params.config, tokens) : undefined;
  const queryText = action === "query" ? tokens.slice(1).join(" ").trim() : undefined;
  const metricIntent = reportArgs ? resolveMetricIntent(reportArgs.metricIntentText ?? "") : null;
  const existingAnalysisJob =
    action === "analysis" &&
    analysisArgs?.jobId &&
    (analysisArgs.subAction === "status" || analysisArgs.subAction === "retry")
      ? await params.runtime.getAnalysisJob(analysisArgs.jobId)
      : null;
  const existingAction =
    action === "action" &&
    actionArgs?.actionId &&
    ["approve", "reject", "start", "done", "fail"].includes(actionArgs.subAction)
      ? await params.runtime.getActionItem(actionArgs.actionId)
      : null;
  const requestedOrgId =
    action === "report"
      ? reportArgs?.requestedOrgId
      : action === "analysis"
        ? (analysisArgs?.requestedOrgId ??
          existingAnalysisJob?.orgId ??
          (analysisArgs?.jobId ? resolvePolicyOrgId(binding, undefined) : undefined))
        : action === "action"
          ? (actionArgs?.requestedOrgId ?? existingAction?.orgId)
          : action === "learning"
            ? learningArgs?.requestedOrgId
            : action === "reactivation"
              ? reactivationArgs?.requestedOrgId
            : action === "observation"
              ? observationArgs?.requestedOrgId
            : action === "tower"
              ? towerArgs?.requestedOrgId
              : action === "sync"
                ? resolveOrgId(params.config, tokens[1])
                : undefined;
  const requestedStoreToken =
    action === "report"
      ? reportArgs?.requestedStoreToken
      : action === "analysis"
        ? analysisArgs?.requestedStoreToken
        : action === "action"
          ? actionArgs?.requestedStoreToken
          : action === "learning"
            ? learningArgs?.requestedStoreToken
            : action === "reactivation"
              ? reactivationArgs?.requestedStoreToken
            : action === "observation"
              ? observationArgs?.requestedStoreToken
            : action === "tower"
              ? towerArgs?.scopeToken !== "global"
                ? towerArgs?.scopeToken
                : undefined
              : action === "sync"
                ? tokens[1]
                : undefined;

  if (requestedStoreToken && !requestedOrgId) {
    const text = "未识别门店，请使用配置中的标准门店名或 OrgId。";
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "denied",
      consumeQuota: false,
      reason: "unknown-store",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  const controlTowerSettings = await params.runtime.resolveControlTowerSettings({
    orgId: resolvePolicyOrgId(binding, requestedOrgId),
  });
  const quotaOverrides = resolveQuotaOverrides(controlTowerSettings);

  const accessContext = buildHetangAccessContext({
    action,
    binding,
    usage,
    requestedOrgId,
    quotaOverrides,
  });
  const access = {
    allowed: accessContext.decision.status === "allow",
    action,
    reason: accessContext.decision.reason,
    effectiveOrgId: accessContext.scope.effective_org_id,
    hourlyLimit: accessContext.quotas.hourly_limit,
    dailyLimit: accessContext.quotas.daily_limit,
    consumeQuota: accessContext.decision.consume_quota,
  };

  if (accessContext.decision.status !== "allow") {
    const text = messageForDeniedReason(accessContext.decision.reason);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: accessContext.scope.effective_org_id,
      decision: "denied",
      consumeQuota: accessContext.decision.consume_quota,
      reason: accessContext.decision.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "sync" && !params.config.sync.enabled) {
    const text = messageForDeniedReason("sync-disabled");
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: access.effectiveOrgId,
      decision: "denied",
      consumeQuota: access.consumeQuota,
      reason: "sync-disabled",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "sync" && !hasHetangApiCredentials(params.config)) {
    const text = messageForDeniedReason("api-credentials-missing");
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: access.effectiveOrgId,
      decision: "denied",
      consumeQuota: access.consumeQuota,
      reason: "api-credentials-missing",
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "status") {
    const text = await params.runtime.doctor();
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "queue") {
    if (queueArgs?.subAction === "deadletters") {
      const items = await params.runtime.listAnalysisDeadLetters({
        deadLetterScope: queueArgs.deadLetterScope,
      });
      const text = formatDeadLetterListResponse(items);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: false,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (queueArgs?.subAction === "replay") {
      if (!queueArgs.deadLetterKey) {
        return "请使用：/hetang queue replay [死信ID]";
      }
      const replayed = await params.runtime.replayAnalysisDeadLetter({
        deadLetterKey: queueArgs.deadLetterKey,
        replayedAt: occurredAt,
      });
      const text = replayed
        ? `已重放死信 ${replayed.deadLetterKey}，对应任务 ${replayed.jobId} 已重新开放投递。`
        : "未找到该死信记录，请确认死信 ID。";
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: false,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (queueArgs?.subAction === "cleanup") {
      if (queueArgs.residualClass !== "stale-invalid-chatid-subscriber") {
        return "请使用：/hetang queue cleanup stale-invalid-chatid-subscriber [limit]";
      }
      const cleanup =
        await params.runtime.cleanupStaleInvalidChatidSubscriberResiduals({
          resolvedAt: occurredAt,
          limit: queueArgs.limit,
        });
      const text =
        `已清理历史坏订阅残留 ${cleanup.residualClass}：` +
        `subscriber ${cleanup.cleanedSubscriberCount}，` +
        `job ${cleanup.cleanedJobCount}，` +
        `deadletter ${cleanup.resolvedDeadLetterCount}。`;
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: false,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    const summary = await params.runtime.getQueueStatus(now);
    const text = formatQueueStatusResponse(summary);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "allowed",
      consumeQuota: false,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "intel") {
    if (!params.config.externalIntelligence.enabled) {
      const text = "HQ 外部情报功能当前未启用。";
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (intelArgs?.subAction === "run") {
      const issue = await (
        params.runtime as HetangOpsRuntime & {
          buildExternalBriefIssue: (params: { now: Date; deliver: boolean }) => Promise<{
            markdown: string;
          } | null>;
        }
      ).buildExternalBriefIssue({
        now,
        deliver: false,
      });
      const text = issue?.markdown ?? "今日暂无达到阈值的 HQ 外部情报。";
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (intelArgs?.subAction === "latest") {
      const text = await (
        params.runtime as HetangOpsRuntime & {
          renderLatestExternalBriefIssue: () => Promise<string>;
        }
      ).renderLatestExternalBriefIssue();
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (intelArgs?.subAction === "issue") {
      if (!intelArgs.issueId) {
        return "请使用：/hetang intel issue [issueId]";
      }
      const text = await (
        params.runtime as HetangOpsRuntime & {
          renderExternalBriefIssueById: (issueId: string) => Promise<string>;
        }
      ).renderExternalBriefIssueById(intelArgs.issueId);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (intelArgs?.subAction === "sources") {
      const text = formatExternalSourceList(params.config);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    return "请使用：/hetang intel run|latest|issue [issueId]|sources";
  }

  if (action === "chart") {
    if (chartArgs?.subAction !== "weekly") {
      return "请使用：/hetang chart weekly [YYYY-MM-DD]";
    }
    const weekEndBizDate =
      chartArgs.weekEndBizDate ??
      resolveReportBizDate({
        now,
        timeZone: params.config.timeZone,
        cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
      });
    await (
      params.runtime as HetangOpsRuntime & {
        sendWeeklyChartImage: (params: {
          weekEndBizDate?: string;
          now?: Date;
        }) => Promise<string>;
      }
    ).sendWeeklyChartImage({
      weekEndBizDate,
      now,
    });
    const text = `荷塘悦色5店周经营图表已发送（截至 ${weekEndBizDate}）。`;
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "query") {
    if (!queryText) {
      const text = "请直接输入自然语言问题，例如：/hetang query 义乌店昨天营收";
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "denied",
        consumeQuota: access.consumeQuota,
        reason: "query-empty",
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    const route = resolveHetangNaturalLanguageRoute({
      config: params.config,
      content: queryText,
      now,
      defaultOrgId: binding ? resolveDefaultNaturalLanguageOrgId(binding) : undefined,
    });
    if (route?.action === "analysis") {
      const analysisRequest = materializeHetangAnalysisRequest({
        config: params.config,
        binding,
        request: route.request,
      });
      const replyTarget = resolveCommandReplyTarget({
        replyTarget: params.replyTarget,
        senderId,
        from: params.from,
        to: params.to,
      });
      let text: string;
      try {
        const job = await params.runtime.enqueueAnalysisJob({
          capabilityId: route.capabilityId,
          ...analysisRequest,
          notification: {
            channel,
            target: replyTarget ?? senderId ?? analysisRequest.orgId,
            accountId: params.accountId,
            threadId: params.messageThreadId == null ? undefined : String(params.messageThreadId),
          },
          senderId,
          createdAt: occurredAt,
          subscribeToCompletion: Boolean(replyTarget ?? senderId),
        });
        text = renderAnalysisQueueMessage({
          job,
          fallbackStoreName: analysisRequest.storeName,
          fallbackTimeFrameLabel: analysisRequest.timeFrameLabel,
        });
      } catch (error) {
        if (!isHetangAnalysisQueueLimitError(error)) {
          throw error;
        }
        text = renderAnalysisQueueLimitMessage({
          storeName: analysisRequest.storeName,
          timeFrameLabel: analysisRequest.timeFrameLabel,
          pendingCount: error.pendingCount,
          limit: error.limit,
        });
      }
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: analysisRequest.orgId,
        effectiveOrgId: analysisRequest.orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    const result = await executeHetangQuery({
      runtime: params.runtime,
      config: params.config,
      binding: binding!,
      text: queryText,
      now,
    });
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId:
        result.requestedOrgIds.length > 0 ? result.requestedOrgIds.join(",") : undefined,
      effectiveOrgId:
        result.effectiveOrgIds.length > 0 ? result.effectiveOrgIds.join(",") : undefined,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(result.text),
      queryEntrySource: result.entry?.source,
      queryEntryReason: result.entry?.reason,
    });
    return result.text;
  }

  if (action === "sync") {
    const orgId = access.effectiveOrgId ?? requestedOrgId;
    const lines = await params.runtime.syncStores({
      orgIds: orgId ? [orgId] : undefined,
      now,
    });
    const text = lines.join("\n");
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: orgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "analysis") {
    if (analysisArgs?.subAction === "list") {
      const orgId = access.effectiveOrgId ?? requestedOrgId;
      const items = await params.runtime.listAnalysisJobs({
        orgId,
        status: analysisArgs.status,
      });
      const scopeLabel =
        orgId && params.config.stores.find((entry) => entry.orgId === orgId)?.storeName
          ? params.config.stores.find((entry) => entry.orgId === orgId)!.storeName
          : "全部门店";
      const text = formatAnalysisListResponse(scopeLabel, items);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: orgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (analysisArgs?.subAction === "status") {
      if (!existingAnalysisJob || !analysisArgs.jobId) {
        return "未找到分析任务，请确认任务 ID。";
      }
      const text = formatAnalysisStatusResponse(existingAnalysisJob);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: existingAnalysisJob.orgId,
        effectiveOrgId: existingAnalysisJob.orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (analysisArgs?.subAction === "retry") {
      if (!existingAnalysisJob || !analysisArgs.jobId) {
        return "未找到分析任务，请确认任务 ID。";
      }
      if (controlTowerSettings["analysis.retryEnabled"] === false) {
        const text = "当前已关闭分析任务重试，请联系总部在 Control Tower 中开启。";
        await params.runtime.recordCommandAudit({
          occurredAt,
          channel,
          senderId,
          commandName: "hetang",
          action,
          requestedOrgId: existingAnalysisJob.orgId,
          effectiveOrgId: existingAnalysisJob.orgId,
          decision: "allowed",
          consumeQuota: access.consumeQuota,
          reason: access.reason,
          commandBody,
          responseExcerpt: summarizeText(text),
        });
        return text;
      }
      if (existingAnalysisJob.status !== "failed") {
        const text = `分析任务 ${existingAnalysisJob.jobId} 当前状态为 ${existingAnalysisJob.status}，暂不需要重试。`;
        await params.runtime.recordCommandAudit({
          occurredAt,
          channel,
          senderId,
          commandName: "hetang",
          action,
          requestedOrgId: existingAnalysisJob.orgId,
          effectiveOrgId: existingAnalysisJob.orgId,
          decision: "allowed",
          consumeQuota: access.consumeQuota,
          reason: access.reason,
          commandBody,
          responseExcerpt: summarizeText(text),
        });
        return text;
      }
      const retried = await params.runtime.retryAnalysisJob({
        jobId: analysisArgs.jobId,
        retriedAt: occurredAt,
      });
      const text = retried
        ? `分析任务 ${retried.jobId} 已重新入队，可稍后使用 /hetang analysis status ${retried.jobId} 查看进度。`
        : "分析任务重试失败，请稍后再试。";
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: existingAnalysisJob.orgId,
        effectiveOrgId: existingAnalysisJob.orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    return "请使用：/hetang analysis list [OrgId|门店名] [pending|running|completed|failed]";
  }

  if (action === "action") {
    if (actionArgs?.subAction === "list") {
      const orgId = access.effectiveOrgId ?? requestedOrgId;
      const items = await params.runtime.listActions({ orgId });
      const scopeLabel =
        orgId && params.config.stores.find((entry) => entry.orgId === orgId)?.storeName
          ? params.config.stores.find((entry) => entry.orgId === orgId)!.storeName
          : "全部门店";
      const text =
        items.length > 0
          ? [
              `${scopeLabel} 动作单`,
              ...items.map(
                (item) => `- ${item.actionId} [${item.status}] ${item.category} | ${item.title}`,
              ),
            ].join("\n")
          : `${scopeLabel} 暂无动作单。`;
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (actionArgs?.subAction === "create") {
      const orgId = access.effectiveOrgId ?? requestedOrgId;
      if (!orgId || !actionArgs.category || !actionArgs.title) {
        return "请使用：/hetang action create [OrgId|门店名] [分类] [low|medium|high] [标题]";
      }
      const item = await params.runtime.createAction({
        orgId,
        bizDate: resolveReportBizDate({
          now,
          timeZone: params.config.timeZone,
          cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
        }),
        category: actionArgs.category,
        title: actionArgs.title,
        priority: actionArgs.priority ?? "medium",
        status: "proposed",
        sourceKind: "manual",
        createdByChannel: channel,
        createdBySenderId: senderId,
        createdByName: binding?.employeeName,
      });
      const text = formatActionResponse(item);
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: orgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (!existingAction || !actionArgs?.actionId) {
      return "未找到动作单，请确认动作单 ID。";
    }
    const statusMap = {
      approve: "approved",
      reject: "rejected",
      start: "executing",
      done: "done",
      fail: "failed",
    } as const;
    const updated = await params.runtime.updateActionStatus({
      actionId: actionArgs.actionId,
      status: statusMap[actionArgs.subAction as keyof typeof statusMap],
      resultNote: actionArgs.note,
      effectScore: actionArgs.effectScore,
      updatedAt: occurredAt,
    });
    const text = updated
      ? `动作单 ${updated.actionId} 已更新为 ${updated.status}`
      : "动作单更新失败，请稍后再试。";
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId: existingAction.orgId,
      effectiveOrgId: existingAction.orgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "learning") {
    const orgId = access.effectiveOrgId ?? requestedOrgId;
    const summary = await params.runtime.getLearningSummary({ orgId });
    const text = formatLearningSummary(summary);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId: orgId,
      effectiveOrgId: orgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "observation") {
    const orgId = access.effectiveOrgId ?? requestedOrgId;
    const storeName =
      (orgId && params.config.stores.find((entry) => entry.orgId === orgId)?.storeName) ??
      orgId ??
      "未知门店";
    if (observationArgs?.subAction !== "add") {
      return "请使用：/hetang observation add [OrgId|门店名] [memberId] [signalDomain] [signalKey] [值] [备注]";
    }
    if (
      !orgId ||
      !observationArgs.memberId ||
      !observationArgs.signalDomain ||
      !observationArgs.signalKey ||
      !observationArgs.valueText
    ) {
      return "请使用：/hetang observation add [OrgId|门店名] [memberId] [signalDomain] [signalKey] [值] [备注]";
    }
    const sourceRole: CustomerObservationSourceRole = "store_manager";
    const captured = await params.runtime.captureCustomerServiceObservation({
      orgId,
      memberId: observationArgs.memberId,
      signalDomain: observationArgs.signalDomain,
      signalKey: observationArgs.signalKey,
      valueText: observationArgs.valueText,
      rawNote: observationArgs.note,
      observerId: senderId,
      operatorId: senderId,
      sourceRole,
      observedAt: occurredAt,
      updatedAt: occurredAt,
    });
    const text = [
      "顾客观察已记录",
      `门店：${storeName}`,
      `会员：${observationArgs.memberId}`,
      `信号：${observationArgs.signalDomain}.${observationArgs.signalKey}`,
      `值：${observationArgs.valueText}`,
      `来源角色：${sourceRole}`,
      `已发布信号：${captured.publishedSignalCount}`,
      ...(observationArgs.note ? [`备注：${observationArgs.note}`] : []),
    ].join("\n");
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId: orgId,
      effectiveOrgId: orgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "review") {
    const summary = await params.runtime.getConversationReviewSummary();
    const text = formatConversationReviewSummary(summary);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "reactivation") {
    const orgId = access.effectiveOrgId ?? requestedOrgId;
    const storeName =
      (orgId && params.config.stores.find((entry) => entry.orgId === orgId)?.storeName) ??
      orgId ??
      "未知门店";
    const bizDate =
      reactivationArgs?.bizDate ??
      resolveReportBizDate({
        now,
        timeZone: params.config.timeZone,
        cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
      });

    if (reactivationArgs?.subAction === "summary") {
      if (!orgId) {
        return "请使用：/hetang reactivation summary [OrgId|门店名] [YYYY-MM-DD]";
      }
      const summary = await params.runtime.getMemberReactivationExecutionSummary({
        orgId,
        bizDate,
        pendingLimit: 5,
      });
      const text = formatReactivationExecutionSummary({ storeName, summary });
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: orgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (reactivationArgs?.subAction === "tasks") {
      if (!orgId) {
        return "请使用：/hetang reactivation tasks [OrgId|门店名] [YYYY-MM-DD] [pending|contacted|replied|booked|arrived|closed]";
      }
      const tasks = await params.runtime.listMemberReactivationExecutionTasks({
        orgId,
        bizDate,
        feedbackStatus: reactivationArgs.feedbackStatus,
        limit: reactivationArgs.limit ?? 10,
      });
      const text = formatReactivationExecutionTasks({
        storeName,
        bizDate,
        feedbackStatus: reactivationArgs.feedbackStatus,
        tasks,
      });
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: orgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    if (reactivationArgs?.subAction === "update") {
      if (!orgId || !bizDate || !reactivationArgs.memberId || !reactivationArgs.feedbackStatus) {
        return "请使用：/hetang reactivation update [OrgId|门店名] [YYYY-MM-DD] [memberId] [pending|contacted|replied|booked|arrived|closed] [跟进人] [备注]";
      }
      await params.runtime.upsertMemberReactivationExecutionFeedback({
        orgId,
        bizDate,
        memberId: reactivationArgs.memberId,
        feedbackStatus: reactivationArgs.feedbackStatus,
        followedBy: reactivationArgs.followedBy ?? binding?.employeeName ?? senderId,
        followedAt: occurredAt,
        ...buildMemberReactivationFeedbackFlags(reactivationArgs.feedbackStatus),
        note: reactivationArgs.note,
        updatedAt: occurredAt,
      });
      const text = [
        "召回反馈已更新",
        `门店：${storeName}`,
        `日期：${bizDate}`,
        `会员：${reactivationArgs.memberId}`,
        `状态：${reactivationArgs.feedbackStatus}`,
        `跟进人：${reactivationArgs.followedBy ?? binding?.employeeName ?? senderId ?? "-"}`,
        ...(reactivationArgs.note ? [`备注：${reactivationArgs.note}`] : []),
      ].join("\n");
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId: orgId,
        effectiveOrgId: orgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    return "请使用：/hetang reactivation summary|tasks|update ...";
  }

  if (action === "tower") {
    if (towerArgs?.subAction === "set") {
      if (!towerArgs.settingKey || towerArgs.value === undefined) {
        return "请使用：/hetang tower set [global|OrgId|门店名] [key] [value]";
      }
      const validation = validateControlTowerSettingValue({
        key: towerArgs.settingKey,
        value: towerArgs.value,
      });
      if (!validation.ok) {
        await params.runtime.recordCommandAudit({
          occurredAt,
          channel,
          senderId,
          commandName: "hetang",
          action,
          requestedOrgId,
          effectiveOrgId: requestedOrgId,
          decision: "denied",
          consumeQuota: false,
          reason: "tower-setting-invalid",
          commandBody,
          responseExcerpt: summarizeText(validation.message),
        });
        return validation.message;
      }
      const record = await params.runtime.upsertControlTowerSetting({
        scopeType: requestedOrgId ? "store" : "global",
        scopeKey: requestedOrgId ?? "global",
        settingKey: towerArgs.settingKey,
        value: validation.value,
        updatedAt: occurredAt,
        updatedBy: senderId,
      });
      const scopeLabel =
        requestedOrgId && params.config.stores.find((entry) => entry.orgId === requestedOrgId)
          ? params.config.stores.find((entry) => entry.orgId === requestedOrgId)!.storeName
          : "global";
      const text = `Control Tower 已更新\n范围：${scopeLabel}\n${record.settingKey} = ${String(record.value)}`;
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        requestedOrgId,
        effectiveOrgId: requestedOrgId,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    const settings = await params.runtime.resolveControlTowerSettings({ orgId: requestedOrgId });
    const scopeLabel =
      requestedOrgId && params.config.stores.find((entry) => entry.orgId === requestedOrgId)
        ? `(${params.config.stores.find((entry) => entry.orgId === requestedOrgId)!.storeName})`
        : "(global)";
    const text = formatControlTowerSettings(scopeLabel, settings);
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: requestedOrgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  if (action === "report") {
    if (reportArgs?.reportKind === "monthly") {
      if (binding?.role !== "hq") {
        const text = messageForDeniedReason("hq-only");
        await params.runtime.recordCommandAudit({
          occurredAt,
          channel,
          senderId,
          commandName: "hetang",
          action,
          decision: "denied",
          consumeQuota: false,
          reason: "hq-only",
          commandBody,
          responseExcerpt: summarizeText(text),
        });
        return text;
      }

      const reportBizDate = resolveReportBizDate({
        now,
        timeZone: params.config.timeZone,
        cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
      });
      const month = reportArgs.month ?? resolvePreviousMonthKey(reportBizDate.slice(0, 7));
      const text = await (
        params.runtime as HetangOpsRuntime & {
          renderMonthlyReport: (params: { month?: string; now?: Date }) => Promise<string>;
        }
      ).renderMonthlyReport({
        month,
        now,
      });
      await params.runtime.recordCommandAudit({
        occurredAt,
        channel,
        senderId,
        commandName: "hetang",
        action,
        decision: "allowed",
        consumeQuota: access.consumeQuota,
        reason: access.reason,
        commandBody,
        responseExcerpt: summarizeText(text),
      });
      return text;
    }

    const orgId = access.effectiveOrgId ?? requestedOrgId ?? params.config.stores[0]?.orgId;
    if (!orgId) {
      return "No store configured.";
    }
    const bizDate =
      reportArgs?.bizDate ??
      resolveReportBizDate({
        now,
        timeZone: params.config.timeZone,
        cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
      });
    const report = await params.runtime.buildReport({ orgId, bizDate, now });
    const hasMetricQuery = Boolean(
      metricIntent && (metricIntent.supported.length > 0 || metricIntent.unsupported.length > 0),
    );
    const text = hasMetricQuery
      ? renderMetricQueryResponse({
          storeName: report.storeName,
          bizDate,
          metrics: report.metrics,
          complete: report.complete,
          resolution: metricIntent!,
        })
      : report.complete
        ? report.markdown
        : formatIncompleteReportMessage({
            storeName: report.storeName,
            bizDate,
            alerts: report.alerts,
          });
    await params.runtime.recordCommandAudit({
      occurredAt,
      channel,
      senderId,
      commandName: "hetang",
      action,
      requestedOrgId,
      effectiveOrgId: orgId,
      decision: "allowed",
      consumeQuota: access.consumeQuota,
      reason: access.reason,
      commandBody,
      responseExcerpt: summarizeText(text),
    });
    return text;
  }

  return formatHetangCommandHelp();
}
