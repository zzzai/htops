import { resolveAutoProvisionEmployeeBinding } from "./access-roster.js";
import {
  renderAnalysisQueueLimitMessage,
  renderAnalysisQueueMessage,
} from "./analysis-queue-message.js";
import { resolveIntentClarifierDecision } from "./app/intent-clarifier-service.js";
import {
  materializeHetangAnalysisRequest,
  resolveHetangNaturalLanguageRoute,
  type HetangNaturalLanguageCommand,
} from "./analysis-router.js";
import { runHetangCommand, runHetangTypedQuery } from "./command.js";
import { resolveHetangQueryIntent } from "./query-intent.js";
import {
  normalizeHetangSemanticText,
  resolveHetangQuerySemanticContext,
} from "./query-semantics.js";
import { isHetangAnalysisQueueLimitError } from "./runtime.js";
import { resolveFirstMatchedStoreName } from "./store-aliases.js";
import {
  resolveBusinessGuidanceIntent,
  resolveClarifierIntentKind,
  resolveSemanticIntent,
  resolveSemanticQueryExecutionInfo,
  resolveUnsupportedPreRouteIntent,
  type HetangSemanticIntent,
  type HetangRouteSnapshot,
} from "./semantic-intent.js";
import type { HetangEmployeeBinding, HetangLogger, HetangOpsConfig } from "./types.js";

type HetangCommandRuntime = Parameters<typeof runHetangCommand>[0]["runtime"];
export type HetangSemanticMetaQueryProbeOutcome =
  | "none"
  | "query_answer"
  | "generic_unmatched"
  | "probe_failed";
export type HetangSemanticFrontDoorDecision =
  | "continue"
  | "semantic_meta_early_stop"
  | "semantic_query_direct"
  | "semantic_analysis_direct";
export type HetangSemanticFrontDoorAction =
  | {
      decision: "continue";
      text: undefined;
      probeOutcome: null;
    }
  | {
      decision: Exclude<HetangSemanticFrontDoorDecision, "continue">;
      text: string;
      probeOutcome: HetangSemanticMetaQueryProbeOutcome | null;
    };

export type HetangInboundClaimEvent = {
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  senderName?: string;
  threadId?: string | number;
  content: string;
  isGroup: boolean;
  wasMentioned?: boolean;
};

export type HetangInboundClaimContext = {
  channelId: string;
  accountId?: string;
  conversationId?: string;
};

export type HetangInboundReplySender = (params: {
  channel: string;
  target: string;
  accountId?: string;
  threadId?: string;
  message: string;
}) => Promise<void>;

const IDENTITY_ASK_KEYWORDS =
  /(你是谁|你是干嘛的|你能做什么|你可以做什么|你是什么角色|介绍一下你自己|自我介绍一下|你主要负责什么)/u;
const CAPABILITY_ASK_KEYWORDS =
  /(支持哪些能力|支持什么能力|现在支持哪些能力|你现在支持哪些能力|能查什么|现在能问什么|支持哪些问题|能做哪些查询)/u;
const CUSTOMER_SATISFACTION_LOOKUP_KEYWORDS = /(满意度|满意率|好评率|差评率|评价|口碑)/u;
const SCHEDULE_DETAIL_LOOKUP_KEYWORDS =
  /(排班表|排班明细|班表|班次安排|明天排班|下周排班|预约排班|出勤安排)/u;
const FORECAST_LOOKUP_KEYWORDS =
  /(预测|预估|预计|估计|明天客流|下周客流|明天营收|下周营收|明天单数|下周单数)/u;
const REALTIME_QUEUE_LOOKUP_KEYWORDS = /(等位|排队|候钟|等钟)/u;
const PENDING_SETTLEMENT_LOOKUP_KEYWORDS = /(待结账|未结账|待结算|未结算)/u;
const BUSINESS_DOMAIN_KEYWORDS =
  /(营收|业绩|经营|复盘|顾客|会员|客户|技师|总部|门店|团购|储值|开卡|复购|留存|流失|唤回|跟进|名单|画像|点钟|加钟|钟效|人效|排班|风险|危险|盘子|大盘)/u;
const STRATEGY_GUIDE_KEYWORDS = /(策略|打法|方向|方案|抓手|怎么抓|怎么推|怎么落|怎么安排)/u;
const BUSINESS_CORRECTION_KEYWORDS =
  /(乱回|乱答|乱回复|瞎回|瞎回复|答非所问|没听懂|没理解|理解错|不是这个意思|别套模板|不要模板|别给模板|别发清单|别发能力清单|重新回答|重答)/u;
const TIME_SCOPE_HINT_KEYWORDS =
  /(今天|今日|昨天|昨日|明天|本周|本月|上周|上月|下周|下月|近\d+[天周月年]|过去\d+[天周月年]|最近\d+[天周月年]|\d{4}-\d{2}-\d{2}|\d{4}年\s*\d{1,2}月\s*\d{1,2}日|\d{1,2}月\s*\d{1,2}日)/u;
const GENERIC_BUSINESS_UNRECOGNIZED_REPLY =
  /^(未识别为可执行的门店数据问题，请补充门店、时间或指标。|未识别到可执行查询。)$/u;

export function resolveDefaultNaturalLanguageOrgId(
  binding: {
    orgId?: string;
    scopeOrgIds?: string[];
    isActive?: boolean;
    role?: string;
  } | null,
): string | undefined {
  if (!binding || binding.isActive === false || binding.role === "disabled") {
    return undefined;
  }
  const scopeOrgIds =
    binding.scopeOrgIds && binding.scopeOrgIds.length > 0
      ? binding.scopeOrgIds
      : binding.orgId
        ? [binding.orgId]
        : [];
  return scopeOrgIds.length === 1 ? scopeOrgIds[0] : undefined;
}

export async function resolveInboundEmployeeBinding(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  event: Pick<HetangInboundClaimEvent, "channel" | "senderId" | "senderName">;
}): Promise<HetangEmployeeBinding | null> {
  let binding = null;
  if (params.event.senderId && typeof params.runtime.getEmployeeBinding === "function") {
    try {
      binding = await params.runtime.getEmployeeBinding({
        channel: params.event.channel,
        senderId: params.event.senderId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.warn(
        `hetang-ops: inbound default binding lookup failed for ${params.event.senderId}: ${message}`,
      );
    }
  }
  if (
    !binding &&
    params.event.senderId &&
    typeof params.runtime.grantEmployeeBinding === "function" &&
    params.event.channel === "wecom"
  ) {
    const autoBinding = resolveAutoProvisionEmployeeBinding({
      config: params.config,
      channel: params.event.channel,
      senderId: params.event.senderId,
      senderName: params.event.senderName,
    });
    if (autoBinding) {
      try {
        await params.runtime.grantEmployeeBinding(autoBinding);
        binding = autoBinding;
        params.logger.info(
          `hetang-ops: auto-provisioned ${autoBinding.role} binding for ${params.event.senderId} (${autoBinding.employeeName})`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        params.logger.warn(
          `hetang-ops: inbound auto-provision failed for ${params.event.senderId}: ${message}`,
        );
      }
    }
  }
  return binding;
}

export function resolveHetangNaturalLanguageCommand(params: {
  config: HetangOpsConfig;
  content: string;
  now: Date;
}): HetangNaturalLanguageCommand | null {
  const route = resolveHetangNaturalLanguageRoute({
    config: params.config,
    content: params.content,
    now: params.now,
  });
  if (!route || route.action !== "query") {
    return null;
  }
  return route;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function asksAssistantIdentity(text: string): boolean {
  const normalized = normalizeText(text);
  return normalized.length > 0 && normalized.length <= 32 && IDENTITY_ASK_KEYWORDS.test(normalized);
}

function asksCapabilitySurface(text: string): boolean {
  const normalized = normalizeText(text);
  return (
    normalized.length > 0 && normalized.length <= 32 && CAPABILITY_ASK_KEYWORDS.test(normalized)
  );
}

function resolveMentionedStoreName(config: HetangOpsConfig, text: string): string | undefined {
  return resolveFirstMatchedStoreName(config, text);
}

function resolveUnsupportedBirthdayLookupReply(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  void params;
  return null;
}

function resolveScopedStoreName(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | undefined {
  return (
    resolveMentionedStoreName(params.config, params.content) ??
    (resolveDefaultNaturalLanguageOrgId(params.binding)
      ? resolveBindingStoreNames(params.config, params.binding)[0]
      : undefined)
  );
}

function resolveUnsupportedBusinessLookupReply(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  const storeName = resolveScopedStoreName(params);
  const scopedTarget = storeName ? `${storeName}的` : "";

  if (
    CUSTOMER_SATISFACTION_LOOKUP_KEYWORDS.test(params.content) &&
    /(顾客|客户|会员|服务)/u.test(params.content)
  ) {
    return formatCapabilitySurfaceReply({
      config: params.config,
      binding: params.binding,
      lead: `当前还没接入顾客评价 / 满意度字段，暂时不能严肃给出${scopedTarget}满意度结论。`,
      detail:
        "但你可以直接改问经营代理指标，比如点钟率、加钟率、老客绑定、复购和储值转化，我现在能按这些口径给你稳答。",
    });
  }

  if (SCHEDULE_DETAIL_LOOKUP_KEYWORDS.test(params.content)) {
    return formatCapabilitySurfaceReply({
      config: params.config,
      binding: params.binding,
      lead: `当前还没接入完整班表和预约排班明细，暂时不能直接给出${scopedTarget}排班表。`,
      detail: "现在可以先问我钟效、点钟率、加钟率、晚场承接和技师画像，我先帮你判断排班该往哪调。",
    });
  }

  if (FORECAST_LOOKUP_KEYWORDS.test(params.content)) {
    return formatCapabilitySurfaceReply({
      config: params.config,
      binding: params.binding,
      lead: "当前先基于历史经营数据做复盘，还没开放未来客流 / 营收预测口径。",
      detail: "你可以先用日报和复盘把最近的经营走势看清，我再帮你收成动作建议。",
    });
  }

  if (REALTIME_QUEUE_LOOKUP_KEYWORDS.test(params.content)) {
    return formatCapabilitySurfaceReply({
      config: params.config,
      binding: params.binding,
      lead: `当前还没接入${scopedTarget}等位 / 候钟实时状态，暂时不能严肃回答有没有客人在等位。`,
      detail: "现在已支持：上钟中技师人数、空闲技师名单。等位和排队要等实时队列事实源接通后再开放。",
    });
  }

  if (PENDING_SETTLEMENT_LOOKUP_KEYWORDS.test(params.content)) {
    return formatCapabilitySurfaceReply({
      config: params.config,
      binding: params.binding,
      lead: `当前还没接入${scopedTarget}待结账 / 待结算实时单据状态，暂时不能严肃回答后台还有几张待结账的单。`,
      detail: "现在已支持：当前上钟中人数、空闲技师名单、日报和经营复盘。待结账状态要等实时结算态事实源接通。",
    });
  }

  return null;
}

function resolveAmbiguousBusinessLookupReply(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.content,
  });
  if (!semanticContext.routeSignals.hqStoreMixedScope) {
    return null;
  }

  const storeName =
    semanticContext.explicitOrgIds.length === 1
      ? (params.config.stores.find((store) => store.orgId === semanticContext.explicitOrgIds[0])
          ?.storeName ?? "该门店")
      : "该门店";

  return [
    "这句话里同时包含五店全景和单店诊断，我先不硬猜，避免把问题路由错。",
    `你可以拆成两句直接问：`,
    `- 哪家店最危险`,
    `- ${storeName}近7天具体哪里有问题`,
    "",
    "如果你是想先看总部盘子，我先回五店全景；如果你是想直接拆单店，我就直接下钻那家店。",
  ].join("\n");
}

function resolveBindingStoreNames(
  config: HetangOpsConfig,
  binding: HetangEmployeeBinding | null,
): string[] {
  if (!binding) {
    return [];
  }
  const scopeOrgIds =
    binding.scopeOrgIds && binding.scopeOrgIds.length > 0
      ? binding.scopeOrgIds
      : binding.orgId
        ? [binding.orgId]
        : [];
  return scopeOrgIds
    .map((orgId) => config.stores.find((store) => store.orgId === orgId)?.storeName ?? orgId)
    .filter(Boolean);
}

function formatCapabilitySurfaceSummary(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
}): string {
  const storeNames = resolveBindingStoreNames(params.config, params.binding);
  const scopeLine =
    params.binding?.role === "hq"
      ? storeNames.length > 0
        ? `当前总部权限覆盖：${storeNames.join("、")}。`
        : "当前总部权限覆盖：全部门店。"
      : storeNames.length > 0
        ? `当前可直接查看：${storeNames.join("、")}。`
        : null;

  const supportedLines =
    params.binding?.role === "hq"
      ? [
          "- 五店全景：近7天 / 近30天五店盘子稳不稳、哪家店最近最危险、下周优先动作",
          "- 单店经营：昨天营收、今日营收、近7天经营复盘、近30天盘子稳不稳",
          "- 经营判断：盘子有没有问题、最近该先抓复购还是储值、哪个班次没接住",
          "- 顾客经营：高价值待唤回、潜力成长、团购留存、最近30天哪10个顾客最值得跟进",
          "- 生日经营：今天 / 明天 / 本周 / 本月生日会员名单、高价值生日会员、生日唤回名单",
          "- 会员字段经营：会员来源沉默、营销人字段边界、标签经营优先级",
          "- 技师经营：某位技师近30天画像、点钟率、加钟率、钟效、人效",
          "- 等待体验：平均等待时长、最长等待时段、等待最高技师、点钟/排钟等待差异",
          "- 充值归因：近30天哪种卡型充值最好、哪个客服带来的充值最多",
        ]
      : [
          "- 日报与复盘：昨天营收、今日营收、近7天经营复盘、近30天盘子稳不稳",
          "- 经营判断：盘子有没有问题、最近该先抓复购还是储值、哪个班次没接住",
          "- 顾客经营：高价值待唤回、潜力成长、团购留存、最近30天哪10个顾客最值得跟进",
          "- 生日经营：今天 / 明天 / 本周 / 本月生日会员名单、高价值生日会员、生日唤回名单",
          "- 顾客画像：某位顾客近90天消费、偏好项目、偏好技师、流失风险",
          "- 会员字段经营：会员来源沉默、营销人字段边界、标签经营优先级",
          "- 技师画像：某位技师近30天画像、点钟率、加钟率、钟效、人效",
          "- 等待体验：平均等待时长、最长等待时段、等待最高技师、点钟/排钟等待差异",
          "- 充值归因：近30天哪种卡型充值最好、哪个客服带来的充值最多",
        ];

  return [
    ...(scopeLine ? [scopeLine, ""] : []),
    "当前已支持：",
    ...supportedLines,
    "",
    "暂未接入：",
    "- 顾客满意度 / 评价 / 口碑结论",
    "- 完整班表 / 预约排班明细",
    "- 未来客流 / 营收预测",
    "",
    "建议这样问：",
    "- 昨天营收",
    "- 义乌店近7天经营复盘",
    "- 义乌店明天过生日的高价值会员有哪些",
    "- 迎宾店昨天平均等待时长多少分钟",
    "- 义乌店哪种来源的会员更容易沉默",
    "- 义乌店近30天哪种卡型充值最好",
    "- 迎宾店高价值待唤回名单",
    "- 杨木甲近30天技师画像",
  ].join("\n");
}

function formatCapabilitySurfaceReply(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
  lead: string;
  detail?: string;
}): string {
  return [
    params.lead,
    ...(params.detail ? [params.detail] : []),
    "",
    formatCapabilitySurfaceSummary(params),
  ].join("\n");
}

function resolveCapabilitySurfaceReply(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
}): string {
  return formatCapabilitySurfaceReply({
    config: params.config,
    binding: params.binding,
    lead: "我是荷塘AI小助手。先把我当前在经营数据模式下已经支持和暂未接入的能力边界说清楚，后面你直接按这个口径问，我会回得更快更稳。",
  });
}

function formatAssistantIdentityReply(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
  senderId?: string;
}): string {
  const name = params.binding?.employeeName ?? params.senderId ?? "你好";
  if (!params.binding || params.binding.isActive === false || params.binding.role === "disabled") {
    return [
      `${name}，我是荷塘AI小助手。`,
      "我主要帮你看门店日报、经营复盘、会员画像和技师表现。",
      "当前这个账号还没绑定经营权限，联系管理员授权后，我就能开始干正事了。",
    ].join("\n");
  }

  const storeNames = resolveBindingStoreNames(params.config, params.binding);
  if (params.binding.role === "hq") {
    return [
      `${name}，我是荷塘AI小助手，当前在连锁经营参谋模式。`,
      "我主要帮你看五店经营、识别风险门店、拆解营收、会员和技师问题，并把建议落到具体动作。",
      storeNames.length > 0
        ? `当前重点可直接查看：${storeNames.join("、")}。`
        : "当前可直接查看全部门店。",
      "你可以直接问：本周五店经营怎么样、哪家店最近最危险、华美店近7天经营复盘。",
    ].join("\n");
  }

  if (storeNames.length > 0) {
    return [
      `${name}，我是荷塘AI小助手，当前在门店经营参谋模式。`,
      `我主要帮你看${storeNames.join("、")}的日报、周度复盘、顾客画像、技师画像和重点跟进名单，重点看营收、转化、留存和排班承接。`,
      "你可以直接问：昨天营收、近7天经营复盘、3月份最值得跟进的顾客有哪些。",
    ].join("\n");
  }

  if (params.binding.role === "staff") {
    return [
      `${name}，我是荷塘AI小助手。`,
      "你当前是普通问答权限，我可以帮你解释经营概念、整理话术、润色方案和梳理待办，但不直接提供门店经营数据查询。",
      "如果后续需要查看门店数据，让总部给你开通对应门店权限就行。",
    ].join("\n");
  }

  return [
    `${name}，我是荷塘AI小助手。`,
    "我主要帮你处理经营数据查询和复盘建议。",
    "你可以直接问：昨天营收、近7天经营复盘、有哪些重点顾客需要跟进。",
  ].join("\n");
}

function resolveBusinessRephraseGuide(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  const guidanceIntent = resolveBusinessGuidanceIntent({
    config: params.config,
    text: params.content,
    binding: params.binding,
  });
  if (!guidanceIntent) {
    return null;
  }
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text: params.content,
  });
  const semanticContent = normalizeHetangSemanticText(params.content);

  const storeName = resolveScopedStoreName(params);
  const storeNames = resolveBindingStoreNames(params.config, params.binding);
  const hasStoreScope = semanticContext.hasStoreContext || Boolean(storeName);
  const hasResolvedScope = hasStoreScope || semanticContext.allStoresRequested;
  const hasTimeScope = TIME_SCOPE_HINT_KEYWORDS.test(params.content);
  const customerLikeAsk =
    semanticContext.semanticSlots.object === "customer" ||
    /(会员|客户|顾客|客人|召回|唤回|跟进)/u.test(semanticContent);

  if (guidanceIntent.kind === "guidance_strategy_open_question") {
    if (hasResolvedScope && hasTimeScope) {
      return "先别空讲策略。先告诉我你想看营收、点钟率、加钟率、顾客跟进还是技师承接，我先给经营事实，再收成动作。";
    }
    if (hasResolvedScope) {
      return `先别空讲策略。把${storeName ?? "这家店"}的时间范围补出来，我先给你经营事实，再收成动作。`;
    }
    return "先别空讲策略。直接给我门店名和时间范围，我先把经营事实查出来，再给动作。";
  }

  if (guidanceIntent.kind === "guidance_customer_missing_store") {
    return "先带门店名，我再直接给你召回/跟进对象，不再回能力清单。";
  }

  if (
    guidanceIntent.kind === "guidance_store_missing_time_range" ||
    guidanceIntent.kind === "guidance_customer_missing_time_range" ||
    guidanceIntent.kind === "guidance_tech_missing_time_range" ||
    guidanceIntent.kind === "guidance_missing_time_range"
  ) {
    if (customerLikeAsk && hasStoreScope) {
      return `先补一个时间范围，我就能直接给${storeName ?? "这家店"}的召回/跟进口径。比如：${storeName ?? "这家店"}近30天最值得召回的顾客是哪个。`;
    }
    if (!hasStoreScope) {
      if (params.binding?.role === "hq") {
        return "先说清是看单店还是五店全景，再补一个时间范围。比如：昨天各店营收排名，或 义乌店近7天经营复盘。";
      }
      if (storeNames.length > 0) {
        return `先把时间范围补出来，我就按${storeNames.join("、")}直接答，不再给你贴能力菜单。`;
      }
      return "先带门店名和时间范围，我就能直接查，不再回模板。";
    }
    return `${storeName ?? "这家店"}还差时间范围。直接补昨天 / 近7天 / 近30天，我就能答。`;
  }

  if (
    guidanceIntent.kind === "guidance_store_missing_metric" ||
    guidanceIntent.kind === "guidance_customer_missing_metric" ||
    guidanceIntent.kind === "guidance_tech_missing_metric" ||
    guidanceIntent.kind === "guidance_missing_metric"
  ) {
    if (semanticContext.allStoresRequested) {
      return "门店和时间我知道了，但经营口径还不够具体。直接补一句想看营收、点钟率、加钟率、顾客跟进还是技师承接。";
    }
    return `${storeName ?? "这家店"}的门店和时间我知道了，但还差一个更明确的经营口径。直接补一句想看营收、点钟率、加钟率、顾客跟进还是技师承接。`;
  }

  return `这句话还差一个更明确的经营口径。直接给我门店 + 时间 + 指标/对象，我就按这个口径答。`;
}

function resolveGenericUnmatchedReply(params: {
  config: HetangOpsConfig;
  binding: HetangEmployeeBinding | null;
}): string {
  void params;
  return [
    "我当前主要处理荷塘门店经营数据问题。",
    "这句话还没落到可执行口径。直接给我门店 + 时间 + 指标/对象，我会短答，不再套模板。",
  ].join("\n");
}

function resolveConceptExplainReply(text: string): string {
  const normalized = normalizeHetangSemanticText(text);
  if (/复盘/u.test(normalized)) {
    return [
      "复盘不是空讲建议，而是把经营事实收成动作。",
      "先看事实：营收、点钟率、加钟率、顾客跟进和技师承接到底哪里变了。",
      "再找原因：是团购、排班、会员、技师承接还是门店节奏出了问题。",
      "最后落动作：先抓哪一个指标、哪一批顾客、哪一位技师，今天就怎么改。",
    ].join("\n");
  }
  if (/点钟率/u.test(normalized)) {
    return [
      "点钟率，就是点钟单量占实际上钟记录的比例。",
      "它高，说明顾客主动点指定技师的能力强；它低，说明自然承接或轮牌更多。",
      "看点钟率时，最好和点钟数量、加钟率一起看，单看比例容易失真。",
    ].join("\n");
  }
  if (/加钟率/u.test(normalized)) {
    return [
      "加钟率，就是加钟单量占上钟记录的比例。",
      "它反映顾客是否愿意延长服务时长，通常和服务体验、技师承接、项目匹配有关。",
      "看加钟率时，最好同时看加钟数量和总上钟量，才能判断是真提升还是样本太小。",
    ].join("\n");
  }
  if (/钟效/u.test(normalized)) {
    return [
      "钟效，通常看每位在岗技师或每个班次带来的钟数/产出效率。",
      "它不是单纯越高越好，还要结合排班饱和度、点钟率和顾客等待情况一起看。",
      "如果你愿意，我可以再按门店经营口径告诉你钟效应该和哪几个指标搭配看。",
    ].join("\n");
  }
  return [
    "这是一个经营概念题。",
    "我建议先把概念落到具体门店、时间和指标上，我再按经营口径直接解释，不空讲定义。",
  ].join("\n");
}

export function resolveSemanticMetaReply(params: {
  config: HetangOpsConfig;
  text: string;
  intent: HetangSemanticIntent;
  binding: HetangEmployeeBinding | null;
  senderId?: string;
}): string | null {
  switch (params.intent.kind) {
    case "identity":
      return formatAssistantIdentityReply({
        config: params.config,
        binding: params.binding,
        senderId: params.senderId,
      });
    case "capability":
      return resolveCapabilitySurfaceReply({
        config: params.config,
        binding: params.binding,
      });
    case "business_correction":
      return (
        resolveBusinessCorrectionReply({
          config: params.config,
          content: params.text,
          binding: params.binding,
        }) ??
        "收到，这次我不回模板。你把问题直接重发；如果还缺条件，我只补问一句。"
      );
    case "unsupported_customer_satisfaction":
    case "unsupported_schedule_detail":
    case "unsupported_forecast":
    case "unsupported_realtime_queue":
    case "unsupported_pending_settlement":
    case "unsupported_lookup":
      return (
        resolveUnsupportedBusinessLookupReply({
          config: params.config,
          content: params.text,
          binding: params.binding,
        }) ?? resolveGenericUnmatchedReply({ config: params.config, binding: params.binding })
      );
    case "structured_report_draft":
      return (
        resolveStructuredDailyReportDraftReply(params.text) ??
        "这像是一份日报草稿。我可以帮你收成正式结构，但先别把草稿直接当查询口令。"
      );
    case "negative_constraint":
      return (
        resolveNegativeReportConstraintReply({
          config: params.config,
          content: params.text,
          binding: params.binding,
        }) ?? "收到，这次我不按复盘口径回。你直接说要看哪家店哪天的经营数据。"
      );
    case "concept_explain":
      return resolveConceptExplainReply(params.text);
    case "clarify":
    case "clarify_missing_store":
    case "clarify_missing_time":
    case "clarify_missing_object_scope": {
      const clarifierDecision = resolveIntentClarifierDecision({
        config: params.config,
        text: params.text,
        binding: params.binding,
      });
      return (
        params.intent.clarificationText ??
        (clarifierDecision.kind === "clarify"
          ? clarifierDecision.text
          : "我需要再补一个关键条件，才能继续往下答。")
      );
    }
    case "clarify_mixed_scope":
      return (
        resolveAmbiguousBusinessLookupReply({
          config: params.config,
          content: params.text,
          binding: params.binding,
        }) ?? params.intent.clarificationText ?? "这句话同时混了总部盘子和单店问题，我先不硬猜。"
      );
    case "guidance_strategy_open_question":
    case "guidance_customer_missing_store":
    case "guidance_store_missing_time_range":
    case "guidance_customer_missing_time_range":
    case "guidance_tech_missing_time_range":
    case "guidance_missing_time_range":
    case "guidance_store_missing_metric":
    case "guidance_customer_missing_metric":
    case "guidance_tech_missing_metric":
    case "guidance_missing_metric":
    case "business_guidance":
      return (
        resolveBusinessRephraseGuide({
          config: params.config,
          content: params.text,
          binding: params.binding,
        }) ?? resolveGenericUnmatchedReply({ config: params.config, binding: params.binding })
      );
    case "generic_unmatched":
      return resolveGenericUnmatchedReply({ config: params.config, binding: params.binding });
    case "query":
    case "analysis":
      return null;
  }
}

function shouldProbeQueryFromSemanticMeta(intent: HetangSemanticIntent): boolean {
  switch (intent.kind) {
    case "guidance_strategy_open_question":
    case "guidance_customer_missing_store":
    case "guidance_store_missing_time_range":
    case "guidance_customer_missing_time_range":
    case "guidance_tech_missing_time_range":
    case "guidance_missing_time_range":
    case "guidance_store_missing_metric":
    case "guidance_customer_missing_metric":
    case "guidance_tech_missing_metric":
    case "guidance_missing_metric":
    case "business_guidance":
    case "generic_unmatched":
      return true;
    default:
      return false;
  }
}

export async function resolveSemanticMetaReplyWithQueryProbe(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  text: string;
  intent: HetangSemanticIntent;
  binding: HetangEmployeeBinding | null;
  channel?: string;
  senderId?: string;
  now?: Date;
  queryRunner?: typeof runHetangTypedQuery;
}): Promise<{
  message: string | null;
  probeOutcome: HetangSemanticMetaQueryProbeOutcome;
}> {
  const baseMessage = resolveSemanticMetaReply({
    config: params.config,
    text: params.text,
    intent: params.intent,
    binding: params.binding,
    senderId: params.senderId,
  });
  if (!shouldProbeQueryFromSemanticMeta(params.intent)) {
    return {
      message: baseMessage,
      probeOutcome: "none",
    };
  }
  try {
    const probeText = await (params.queryRunner ?? runHetangTypedQuery)({
      runtime: params.runtime,
      config: params.config,
      queryText: params.text,
      channel: params.channel,
      senderId: params.senderId,
      commandBody: `/hetang query ${params.text}`,
      now: params.now,
    });
    if (GENERIC_BUSINESS_UNRECOGNIZED_REPLY.test(probeText)) {
      return {
        message: baseMessage,
        probeOutcome: "generic_unmatched",
      };
    }
    return {
      message: probeText,
      probeOutcome: "query_answer",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    params.logger.warn(
      `hetang-ops: semantic meta query probe failed for "${params.text}": ${detail}`,
    );
    return {
      message: baseMessage,
      probeOutcome: "probe_failed",
    };
  }
}

export async function resolveSemanticEarlyStopGate(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  text: string;
  intent: HetangSemanticIntent;
  binding: HetangEmployeeBinding | null;
  channel?: string;
  senderId?: string;
  notification?: {
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
  };
  now?: Date;
  queryRunner?: typeof runHetangTypedQuery;
}): Promise<HetangSemanticFrontDoorAction> {
  if (params.intent.lane !== "meta") {
    return {
      decision: "continue",
      text: undefined,
      probeOutcome: null,
    };
  }

  const semanticMetaOutcome = await resolveSemanticMetaReplyWithQueryProbe({
    config: params.config,
    runtime: params.runtime,
    logger: params.logger,
    text: params.text,
    intent: params.intent,
    binding: params.binding,
    channel: params.channel,
    senderId: params.senderId,
    now: params.now,
    queryRunner: params.queryRunner,
  });
  if (!semanticMetaOutcome.message) {
    return {
      decision: "continue",
      text: undefined,
      probeOutcome: null,
    };
  }
  return {
    decision: "semantic_meta_early_stop",
    text: semanticMetaOutcome.message,
    probeOutcome: semanticMetaOutcome.probeOutcome,
  };
}

async function executeSemanticLaneAction(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  text: string;
  intent: HetangSemanticIntent;
  binding: HetangEmployeeBinding | null;
  channel?: string;
  senderId?: string;
  notification?: {
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
  };
  now?: Date;
  queryRunner?: typeof runHetangTypedQuery;
}): Promise<HetangSemanticFrontDoorAction> {
  if (params.intent.lane === "query") {
    return {
      decision: "semantic_query_direct",
      text: await (params.queryRunner ?? runHetangTypedQuery)({
        runtime: params.runtime,
        config: params.config,
        queryText: params.text,
        channel: params.channel,
        senderId: params.senderId,
        commandBody: `/hetang query ${params.text}`,
        now: params.now,
      }),
      probeOutcome: null,
    };
  }

  if (params.intent.lane === "analysis") {
    if (!params.intent.analysisRequest || !params.notification?.target) {
      return {
        decision: "continue",
        text: undefined,
        probeOutcome: null,
      };
    }
    const analysisRequest = materializeHetangAnalysisRequest({
      config: params.config,
      binding: params.binding,
      request: params.intent.analysisRequest,
    });
    try {
      const job = await params.runtime.enqueueAnalysisJob({
        capabilityId: params.intent.capabilityId,
        ...analysisRequest,
        notification: params.notification,
        senderId: params.senderId,
        createdAt: (params.now ?? new Date()).toISOString(),
        subscribeToCompletion: true,
      });
      return {
        decision: "semantic_analysis_direct",
        text: renderAnalysisQueueMessage({
          job,
          fallbackStoreName: analysisRequest.storeName,
          fallbackTimeFrameLabel: analysisRequest.timeFrameLabel,
        }),
        probeOutcome: null,
      };
    } catch (error) {
      if (!isHetangAnalysisQueueLimitError(error)) {
        throw error;
      }
      return {
        decision: "semantic_analysis_direct",
        text: renderAnalysisQueueLimitMessage({
          storeName: analysisRequest.storeName,
          timeFrameLabel: analysisRequest.timeFrameLabel,
          pendingCount: error.pendingCount,
          limit: error.limit,
        }),
        probeOutcome: null,
      };
    }
  }

  return {
    decision: "continue",
    text: undefined,
    probeOutcome: null,
  };
}

export async function executeSemanticFrontDoorAction(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  text: string;
  intent: HetangSemanticIntent;
  binding: HetangEmployeeBinding | null;
  channel?: string;
  senderId?: string;
  notification?: {
    channel: string;
    target: string;
    accountId?: string;
    threadId?: string;
  };
  now?: Date;
  queryRunner?: typeof runHetangTypedQuery;
}): Promise<HetangSemanticFrontDoorAction> {
  const earlyStopAction = await resolveSemanticEarlyStopGate(params);
  if (earlyStopAction.decision !== "continue") {
    return earlyStopAction;
  }

  return executeSemanticLaneAction(params);
}

export function resolveLegacyInboundRouteSnapshot(params: {
  config: HetangOpsConfig;
  text: string;
  now: Date;
  binding: HetangEmployeeBinding | null;
  defaultOrgId?: string;
}): HetangRouteSnapshot {
  if (asksAssistantIdentity(params.text)) {
    return {
      lane: "meta",
      kind: "identity",
    };
  }

  if (asksCapabilitySurface(params.text)) {
    return {
      lane: "meta",
      kind: "capability",
    };
  }

  if (
    resolveBusinessCorrectionReply({
      config: params.config,
      content: params.text,
      binding: params.binding,
    })
  ) {
    return {
      lane: "meta",
      kind: "business_correction",
    };
  }

  const unsupportedBirthdayReply = resolveUnsupportedBirthdayLookupReply({
    config: params.config,
    content: params.text,
    binding: params.binding,
  });
  const unsupportedBusinessReply =
    unsupportedBirthdayReply ??
    resolveUnsupportedBusinessLookupReply({
      config: params.config,
      content: params.text,
      binding: params.binding,
    });
  const ambiguousBusinessReply = unsupportedBusinessReply
    ? null
    : resolveAmbiguousBusinessLookupReply({
        config: params.config,
        content: params.text,
        binding: params.binding,
      });
  if (unsupportedBusinessReply || ambiguousBusinessReply) {
    const unsupportedPreRouteIntent = resolveUnsupportedPreRouteIntent({
      text: params.text,
      semanticContext: resolveHetangQuerySemanticContext({
        config: params.config,
        text: params.text,
      }),
    });
    return {
      lane: "meta",
      kind: unsupportedPreRouteIntent?.kind ?? "unsupported_lookup",
    };
  }

  if (resolveStructuredDailyReportDraftReply(params.text)) {
    return {
      lane: "meta",
      kind: "structured_report_draft",
    };
  }

  if (
    resolveNegativeReportConstraintReply({
      config: params.config,
      content: params.text,
      binding: params.binding,
    })
  ) {
    return {
      lane: "meta",
      kind: "negative_constraint",
    };
  }

  const inboundRuleIntent = resolveHetangQueryIntent({
    config: params.config,
    text: params.text,
    now: params.now,
  });
  const clarifierDecision = resolveIntentClarifierDecision({
    config: params.config,
    text: params.text,
    binding: params.binding,
    ruleIntent: inboundRuleIntent,
  });
  if (
    clarifierDecision.kind === "clarify" &&
    inboundRuleIntent &&
    (inboundRuleIntent.routeConfidence === "high" || inboundRuleIntent.requiresClarification)
  ) {
    return {
      lane: "meta",
      kind: resolveClarifierIntentKind(clarifierDecision),
    };
  }

  const match = resolveHetangNaturalLanguageRoute({
    config: params.config,
    content: params.text,
    now: params.now,
    defaultOrgId: params.defaultOrgId ?? resolveDefaultNaturalLanguageOrgId(params.binding),
  });
  if (!match) {
    const fallbackGuide = resolveBusinessRephraseGuide({
      config: params.config,
      content: params.text,
      binding: params.binding,
    });
    const guidanceIntent = fallbackGuide
      ? resolveBusinessGuidanceIntent({
          config: params.config,
          text: params.text,
          binding: params.binding,
        })
      : null;
    return {
      lane: "meta",
      kind: guidanceIntent?.kind ?? (fallbackGuide ? "business_guidance" : "generic_unmatched"),
    };
  }

  if (match.action === "analysis") {
    return {
      lane: "analysis",
      kind: "analysis",
      action: "analysis",
      capabilityId: match.capabilityId,
    };
  }

  const queryExecution = inboundRuleIntent
    ? resolveSemanticQueryExecutionInfo({
        queryIntent: inboundRuleIntent,
        binding: params.binding,
        defaultOrgId: params.defaultOrgId ?? resolveDefaultNaturalLanguageOrgId(params.binding),
        fallbackOrgIds: resolveHetangQuerySemanticContext({
          config: params.config,
          text: params.text,
        }).explicitOrgIds,
      })
    : null;

  return {
    lane: "query",
    kind: "query",
    action: queryExecution?.planAction ?? "summary",
    capabilityId: queryExecution?.capabilityId,
  };
}

function resolveBusinessCorrectionReply(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  if (!BUSINESS_CORRECTION_KEYWORDS.test(params.content)) {
    return null;
  }
  const storeName = resolveScopedStoreName(params);
  const exampleStoreName =
    storeName ?? resolveBindingStoreNames(params.config, params.binding)[0] ?? "义乌店";
  return [
    "收到，这次我不再回能力清单，也不空讲。",
    `你把问题直接重发；如果还缺关键条件，我只补问一句。比如：${exampleStoreName}近30天最值得召回的顾客是哪个。`,
  ].join("\n");
}

function normalizeInlinePunctuation(line: string): string {
  return line.replace(/:/gu, "：").replace(/\s+/gu, " ").trim();
}

function normalizeStructuredDailyReportFactLine(line: string): string | null {
  const normalized = normalizeInlinePunctuation(line);
  if (
    /^(注：)?包间上座率\/翻房率、毛利\/净利\/保本点、CAC\/活动ROI需补充房间\/成本\/营销配置后再进入正式分析。?$/u.test(
      normalized,
    )
  ) {
    return null;
  }
  if (/^技师出勤：没有专职SPA师$/u.test(normalized)) {
    return "技师出勤：";
  }
  return normalized;
}

function resolveStructuredDailyReportDraftReply(content: string): string | null {
  if (
    !/(我需要一份|整理成一份|生成一份|写一份)/u.test(content) ||
    !/(日报|经营数据报告)/u.test(content) ||
    !content.includes("\n")
  ) {
    return null;
  }

  const lines = content
    .split(/\r?\n/gu)
    .map((line) => line.trim())
    .filter(Boolean);
  const title =
    lines.find((line) => /\d{4}年\s*\d{1,2}月\s*\d{1,2}日.*(店|门店).*(经营数据报告|日报|报告)/u.test(line)) ??
    null;
  if (!title) {
    return null;
  }

  const titleIndex = lines.indexOf(title);
  const rawFactLines = lines
    .slice(titleIndex + 1)
    .filter(
      (line) =>
        /[:：]/u.test(line) ||
        /\d+(位|个|元|单|人|钟)/u.test(line) ||
        /(没有专职|共计)/u.test(line),
    )
    .map((line) => normalizeStructuredDailyReportFactLine(line))
    .filter((line): line is string => Boolean(line))
    .map((line) => `- ${line}`);
  if (rawFactLines.length < 3) {
    return null;
  }

  return [normalizeInlinePunctuation(title), ...rawFactLines].join("\n");
}

function resolveNegativeReportConstraintReply(params: {
  config: HetangOpsConfig;
  content: string;
  binding: HetangEmployeeBinding | null;
}): string | null {
  if (!/(不要|别|不用).*(经营复盘|复盘)|不是.*(经营复盘|复盘)/u.test(params.content)) {
    return null;
  }
  const storeName = resolveScopedStoreName(params);
  return [
    `好，这次不按经营复盘回。${storeName ? `我改按${storeName}的单日数据口径来答。` : ""}`,
    "你如果要的是单日经营数据报告，我会按日报口径直接答，不再展开周度/月度复盘。",
    storeName
      ? `可以直接说：${storeName}昨天经营数据报告，或 ${storeName}总钟数怎么构成。`
      : "可以直接说：某门店昨天经营数据报告，或 某门店总钟数怎么构成。",
  ].join("\n");
}

export function createHetangInboundClaimHandler(params: {
  config: HetangOpsConfig;
  runtime: HetangCommandRuntime;
  logger: HetangLogger;
  sendReply: HetangInboundReplySender;
  observeRoute?: (route: HetangRouteSnapshot) => void;
  observeMetaQueryProbeOutcome?: (outcome: HetangSemanticMetaQueryProbeOutcome) => void;
  now?: () => Date;
}) {
  return async (
    event: HetangInboundClaimEvent,
    ctx: HetangInboundClaimContext,
  ): Promise<{ handled: true } | void> => {
    // Some host integrations do not always populate `wasMentioned` for group events.
    // Only suppress group replies when the host explicitly says the bot was not mentioned.
    if (event.isGroup && event.wasMentioned === false) {
      return;
    }

    const currentNow = params.now?.() ?? new Date();
    const binding = await resolveInboundEmployeeBinding({
      config: params.config,
      runtime: params.runtime,
      logger: params.logger,
      event,
    });
    const target =
      event.conversationId ?? ctx.conversationId ?? (!event.isGroup ? event.senderId : undefined);
    const threadId = event.threadId == null ? undefined : String(event.threadId);
    const semanticIntent = resolveSemanticIntent({
      config: params.config,
      text: event.content,
      now: currentNow,
      binding,
      defaultOrgId: resolveDefaultNaturalLanguageOrgId(binding),
    });

    // Legacy pre-routing branches are gone.
    // Semantic intent is now the single direct execution input here:
    // - meta => semantic early-stop reply / query probe
    // - query => typed direct execution
    // - analysis => direct queue enqueue from intent.analysisRequest
    //
    // resolveLegacyInboundRouteSnapshot() stays only for shadow telemetry comparison
    // in message-entry-service.ts (routing.mode=shadow).

    if (!target) {
      params.observeRoute?.({
        lane: semanticIntent.lane,
        kind: semanticIntent.kind,
        action: semanticIntent.action,
        capabilityId: semanticIntent.capabilityId,
      });
      params.logger.warn("hetang-ops: inbound claim matched but no reply target was available");
      return { handled: true };
    }

    let text = "门店数据助手暂时不可用，请稍后再试。";
    try {
      const semanticFrontDoorAction = await executeSemanticFrontDoorAction({
        config: params.config,
        runtime: params.runtime,
        logger: params.logger,
        text: event.content,
        intent: semanticIntent,
        binding,
        channel: event.channel,
        senderId: event.senderId,
        notification: {
          channel: event.channel,
          target,
          accountId: event.accountId ?? ctx.accountId,
          threadId,
        },
        now: currentNow,
      });
      if (semanticFrontDoorAction.probeOutcome) {
        params.observeMetaQueryProbeOutcome?.(semanticFrontDoorAction.probeOutcome);
      }

      if (semanticFrontDoorAction.decision !== "continue") {
        params.observeRoute?.({
          lane: semanticIntent.lane,
          kind: semanticIntent.kind,
          action: semanticIntent.action,
          capabilityId: semanticIntent.capabilityId,
        });
        text = semanticFrontDoorAction.text;
      } else if (semanticIntent.lane === "analysis" && !semanticIntent.analysisRequest) {
        // Semantic intent classified as analysis but the analysis-router did not
        // produce a materialized request (edge case). Fall back to generic guidance.
        params.observeRoute?.({
          lane: "meta",
          kind: "generic_unmatched",
          action: "clarify",
        });
        text = resolveGenericUnmatchedReply({ config: params.config, binding });
      } else {
        params.observeRoute?.({
          lane: semanticIntent.lane,
          kind: semanticIntent.kind,
          action: semanticIntent.action,
          capabilityId: semanticIntent.capabilityId,
        });
        text = resolveGenericUnmatchedReply({ config: params.config, binding });
      }

      if (
        semanticIntent.lane === "query" &&
        GENERIC_BUSINESS_UNRECOGNIZED_REPLY.test(text)
      ) {
        text =
          resolveBusinessRephraseGuide({
            config: params.config,
            content: event.content,
            binding,
          }) ?? resolveGenericUnmatchedReply({ config: params.config, binding });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.error(`hetang-ops: inbound claim failed for "${event.content}": ${message}`);
    }

    try {
      await params.sendReply({
        channel: event.channel,
        target,
        accountId: event.accountId ?? ctx.accountId,
        threadId,
        message: text,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      params.logger.error(`hetang-ops: inbound reply send failed: ${message}`);
    }

    return { handled: true };
  };
}
