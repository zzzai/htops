import type { HetangExternalEventCard } from "../types.js";
import type { HetangResolvedAiLaneConfig } from "../ai-lanes/types.js";
import type { AssembledExternalBriefItem } from "./assemble.js";

export type ExternalBriefLlmResolvedConfig = Pick<
  HetangResolvedAiLaneConfig,
  "laneId" | "model" | "reasoningMode" | "timeoutMs" | "responseMode"
>;

export type ExternalBriefLlmClient = {
  expandExternalBriefItem: (input: {
    rank: number;
    bucket: AssembledExternalBriefItem["bucket"];
    title: string;
    theme: string;
    entity: string;
    publishedAt: string;
    summary: string;
    whyItMatters: string;
    sourceLabels: string[];
    llmConfig?: ExternalBriefLlmResolvedConfig;
  }) => Promise<{
    summary?: string;
    whyItMatters?: string;
  } | null>;
};

export type EnrichedExternalBriefNarrative = {
  summary: string;
  whyItMatters: string;
  usedLlm: boolean;
};

function formatEventTime(value: string | undefined): string {
  if (!value) {
    return "最近";
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const resolved = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  return `${resolved.year}-${resolved.month}-${resolved.day} ${resolved.hour}:${resolved.minute}`;
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveSourceLabels(card: HetangExternalEventCard): string[] {
  return card.sources
    .map((source) => source.displayName?.trim() || source.sourceId.trim())
    .filter(Boolean);
}

function buildThemeImpact(theme: string): string {
  switch (theme) {
    case "pricing-competition":
      return "价格带变化会直接影响同城比较和转化，今天需要复核门店团购价格带、主推套餐与到店转化波动。";
    case "chain-brand":
      return "头部连锁动作会改变商圈用户预期和流量分配，今天需要盯紧竞店动作、平台曝光与转化变化。";
    case "platform-rule":
      return "平台规则变化会影响投放、核销和履约成本，今天需要检查对应平台动作是否需要同步调整。";
    case "strategy-organization":
      return "组织和战略动作会在中期改变经营打法，需要持续跟踪是否会传导到价格、渠道或门店动作。";
    default:
      return "外部热点会改变消费心智、流量或监管环境，今天需要判断是否会影响到店客流和转化节奏。";
  }
}

export function buildFallbackExternalNarrative(params: {
  item: Pick<
    AssembledExternalBriefItem,
    "title" | "theme" | "entity" | "summary" | "whyItMatters" | "publishedAt"
  >;
  card: Pick<
    HetangExternalEventCard,
    "entity" | "action" | "object" | "theme" | "eventAt" | "publishedAt" | "sources"
  >;
}): Pick<EnrichedExternalBriefNarrative, "summary" | "whyItMatters"> {
  const eventTime = formatEventTime(
    params.card.eventAt ?? params.card.publishedAt ?? params.item.publishedAt,
  );
  const sourceLabels = resolveSourceLabels(params.card as HetangExternalEventCard);
  const sourceText = sourceLabels.length > 0 ? `${sourceLabels.join("、")}等来源` : "多个来源";
  const objectText = params.card.object ? `对${params.card.object}` : "";

  return {
    summary: `${params.card.entity}在 ${eventTime} ${objectText}发起${params.card.action}，当前已由${sourceText}交叉确认，说明这一轮价格动作已经进入可执行观察阶段。`,
    whyItMatters: buildThemeImpact(params.card.theme),
  };
}

export async function enrichExternalBriefItemNarrative(params: {
  item: AssembledExternalBriefItem;
  card: HetangExternalEventCard;
  llm?: ExternalBriefLlmClient;
  llmConfig?: ExternalBriefLlmResolvedConfig;
}): Promise<EnrichedExternalBriefNarrative> {
  const fallback = buildFallbackExternalNarrative(params);
  if (!params.llm) {
    return {
      ...fallback,
      usedLlm: false,
    };
  }

  const sourceLabels = resolveSourceLabels(params.card);
  const llmResult = await params.llm.expandExternalBriefItem({
    rank: params.item.rank,
    bucket: params.item.bucket,
    title: params.item.title,
    theme: params.item.theme,
    entity: params.item.entity,
    publishedAt: params.item.publishedAt,
    summary: params.item.summary,
    whyItMatters: params.item.whyItMatters,
    sourceLabels,
    llmConfig: params.llmConfig,
  });

  const summary = trimToUndefined(llmResult?.summary) ?? fallback.summary;
  const whyItMatters = trimToUndefined(llmResult?.whyItMatters) ?? fallback.whyItMatters;
  const usedLlm = Boolean(
    trimToUndefined(llmResult?.summary) && trimToUndefined(llmResult?.whyItMatters),
  );

  return {
    summary,
    whyItMatters,
    usedLlm,
  };
}
