import { resolveIntentClarifierDecision } from "./intent-clarifier-service.js";
import { resolveMatchedStores } from "../store-aliases.js";
import type { HetangOpsConfig } from "../types.js";

const IDENTITY_ASK_KEYWORDS =
  /(你是谁|你是干嘛的|你能做什么|你可以做什么|你是什么角色|介绍一下你自己|自我介绍一下|你主要负责什么)/u;
const CAPABILITY_ASK_KEYWORDS =
  /(支持哪些能力|支持什么能力|现在支持哪些能力|你现在支持哪些能力|能查什么|现在能问什么|支持哪些问题|能做哪些查询)/u;
const BUSINESS_DOMAIN_KEYWORDS =
  /(营收|收入|营业额|流水|经营|业绩|门店|店|会员|客户|顾客|技师|召回|唤回|跟进|复购|储值|开卡|沉默|团购|来源|充值|排班|钟效|点钟|加钟|等待|生日|复盘|日报|报告)/u;
const NEGATIVE_REVIEW_CONSTRAINT_KEYWORDS =
  /(不要|别|不用).*(经营复盘|复盘)|不是.*(经营复盘|复盘)/u;
const CAPABILITY_TEMPLATE_KEYWORDS = /(当前已支持|暂未接入)/u;
const GENERIC_UNMATCHED_REPLY =
  /^(未识别为可执行的门店数据问题，请补充门店、时间或指标。|未识别到可执行查询。)$/u;
const CUSTOMER_FOLLOWUP_KEYWORDS = /(召回|唤回|跟进|名单|高价值待唤回)/u;

export type ReplyGuardDecision =
  | { action: "send" }
  | { action: "clarify"; text: string; reason: string }
  | { action: "repair"; reason: string };

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function resolveMatchedStoreNames(config: HetangOpsConfig, text: string): string[] {
  return resolveMatchedStores(config, text).map((match) => match.storeName);
}

function resolveExampleStoreName(config: HetangOpsConfig, userText: string): string {
  return resolveMatchedStoreNames(config, userText)[0] ?? config.stores[0]?.storeName ?? "义乌店";
}

function resolveBusinessTemplateClarification(config: HetangOpsConfig, userText: string): string {
  const clarifier = resolveIntentClarifierDecision({
    config,
    text: userText,
  });
  if (clarifier.kind === "clarify") {
    return clarifier.text;
  }
  const storeName = resolveExampleStoreName(config, userText);
  if (CUSTOMER_FOLLOWUP_KEYWORDS.test(userText)) {
    return `我先不回空话。直接说：${storeName}高价值待唤回名单，或 ${storeName}近30天最值得召回的顾客名单。`;
  }
  return "我先不回能力菜单。直接给我门店 + 时间 + 指标/对象，我按这个口径答。";
}

export function shouldRunReplyGuard(params: { text: string }): boolean {
  const normalized = normalizeText(params.text);
  if (!normalized) {
    return false;
  }
  if (IDENTITY_ASK_KEYWORDS.test(normalized) || CAPABILITY_ASK_KEYWORDS.test(normalized)) {
    return false;
  }
  return BUSINESS_DOMAIN_KEYWORDS.test(normalized);
}

export function resolveReplyGuardDecision(params: {
  config: HetangOpsConfig;
  userText: string;
  replyText?: string;
}): ReplyGuardDecision {
  const replyText = params.replyText?.trim() ?? "";
  if (!replyText || !shouldRunReplyGuard({ text: params.userText })) {
    return { action: "send" };
  }

  if (
    NEGATIVE_REVIEW_CONSTRAINT_KEYWORDS.test(params.userText) &&
    /(经营复盘|复盘)/u.test(replyText)
  ) {
    const storeName = resolveExampleStoreName(params.config, params.userText);
    return {
      action: "clarify",
      reason: "negative-constraint-violation",
      text: `好，这次不按经营复盘回。你直接说：${storeName}昨天经营数据报告，或 ${storeName}总钟数怎么构成。`,
    };
  }

  const askedStores = resolveMatchedStoreNames(params.config, params.userText);
  const repliedStores = resolveMatchedStoreNames(params.config, replyText);
  if (
    askedStores.length === 1 &&
    repliedStores.length > 0 &&
    !repliedStores.includes(askedStores[0]) &&
    repliedStores.some((storeName) => storeName !== askedStores[0])
  ) {
    return {
      action: "repair",
      reason: "store-mismatch",
    };
  }

  if (CAPABILITY_TEMPLATE_KEYWORDS.test(replyText)) {
    return {
      action: "clarify",
      reason: "business-template-mismatch",
      text: resolveBusinessTemplateClarification(params.config, params.userText),
    };
  }

  if (GENERIC_UNMATCHED_REPLY.test(replyText)) {
    return {
      action: "clarify",
      reason: "generic-unmatched-business-ask",
      text: resolveBusinessTemplateClarification(params.config, params.userText),
    };
  }

  return { action: "send" };
}
