import { resolveHetangQuerySemanticContext } from "./query-semantics.js";
import type { HetangOpsConfig } from "./types.js";

export type SemanticFrontdoorLane =
  | "store_data_query"
  | "semantic_asset_design"
  | "methodology_concept"
  | "book_knowledge_qa"
  | "brand_marketing_plan"
  | "external_research"
  | "casual_or_correction"
  | "unknown";

export type SemanticFrontdoorDomain =
  | "store"
  | "customer"
  | "technician"
  | "brand"
  | "marketing"
  | "management"
  | "system";

export type SemanticFrontdoorClassification = {
  lane: SemanticFrontdoorLane;
  domain?: SemanticFrontdoorDomain;
  intent?: string;
  requiresStore: boolean;
  requiresTime: boolean;
  requiresMetric: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
  targetCapabilityId?: string;
};

const CASUAL_OR_CORRECTION_RE =
  /^(你好|您好|hi|hello|谢谢|收到|好的|好|嗯|ok|OK|在吗|在不在|辛苦了|又傻了|仔细审题)$/u;
const SEMANTIC_ASSET_RE =
  /(OSI|osi|语义资产|语义包|语义层|语义模型|字段分域|分域管理|字段定义|基础字段|拓展指标|扩展指标|关联关系|指标口径|业务术语|术语解释|标签体系|客户标签|会员标签|顾客标签|画像标签|标签模型|标签分层|标签草案|schema|Schema|wiki|Wiki)/u;
const ASSET_DESIGN_ACTION_RE =
  /(草案|设计|定义|字段|分域|体系|关联|口径|模型|怎么用|如何用|怎么用于|如何用于|怎么做|如何做|搭建|构建|抽取|封装|注册|contract|Contract)/u;
const METHODOLOGY_CONCEPT_RE =
  /(什么是|什么叫|何为|什么意思|如何理解|怎么理解|如何定义|怎么定义|定义|如何搭建|怎么搭建|搭建|如何构建|怎么构建|构建|如何设计|怎么设计|设计|建模|模型|世界模型|物理模型|AI物理模型|ai物理模型|经营世界|服务实体|经营模型|业务模型|商业模型|架构|体系|结构|机制|框架|逻辑|方法论|飞轮)/u;
const BOOK_KNOWLEDGE_RE =
  /(书籍|书本|本书|这本书|图书|知识库|章节|读书笔记|理论|方法论).*(如何|怎么|用于|应用|提炼|总结|理解|落地)|(华与华理论|营销书|管理书|品牌书|战略书)/u;
const BRAND_MARKETING_RE =
  /(品牌|定位|策划|营销|传播|超级符号|口号|slogan|视觉锤|华与华).*(全案|方案|策略|打法|策划|定位|设计|传播|营销|落地)|(用华与华.*品牌|品牌策划全案)/u;
const EXTERNAL_RESEARCH_RE =
  /(竞品|竞争对手|行业|市场|赛道|舆情|全网|周边|商业行情).*(分析|研究|调研|搜索|对比|拆解|报告)|(分析|研究|调研|搜索|对比|拆解).*(竞品|竞争对手|行业|市场|赛道|舆情|全网|周边|商业行情)/u;
const TIME_HINT_RE =
  /(今天|今日|昨天|昨日|明天|本周|本月|上周|上月|下周|下月|最近|近期|近\d+[天周月年]|过去\d+[天周月年]|\d{4}-\d{2}-\d{2}|\d{4}年\s*\d{1,2}月|\d{1,2}月)/u;

function compactText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

function resolveDomain(text: string): SemanticFrontdoorDomain | undefined {
  if (/(客户|顾客|客人|会员|标签|画像|客群)/u.test(text)) {
    return "customer";
  }
  if (/(技师|老师|手艺人)/u.test(text)) {
    return "technician";
  }
  if (/(品牌|华与华|营销|策划|传播|定位|超级符号)/u.test(text)) {
    return /营销书|营销/u.test(text) && !/(品牌|定位|策划|传播|超级符号)/u.test(text)
      ? "marketing"
      : /管理/u.test(text)
        ? "management"
        : "brand";
  }
  if (/(管理|组织|店长|制度|SOP|sop)/u.test(text)) {
    return "management";
  }
  if (/(门店|店|经营|营收|客流|钟数)/u.test(text)) {
    return "store";
  }
  if (/(系统|接口|数据|语义层|架构|模型)/u.test(text)) {
    return "system";
  }
  return undefined;
}

function resolveStoreDataCapabilityId(params: {
  semanticContext: ReturnType<typeof resolveHetangQuerySemanticContext>;
}): string {
  const context = params.semanticContext;
  if (context.mentionsHqPortfolioKeyword || context.allStoresRequested) {
    return context.mentionsAdviceKeyword ? "hq_portfolio_focus_v1" : "hq_portfolio_overview_v1";
  }
  if (context.mentionsBirthdayKeyword) {
    return "birthday_member_list_v1";
  }
  if (context.mentionsCustomerRelationKeyword) {
    return "customer_relation_lookup_v1";
  }
  if (context.mentionsPhoneSuffixKeyword) {
    return "customer_profile_lookup_v1";
  }
  if (context.mentionsCustomerSegmentKeyword || context.mentionsMemberMarketingKeyword) {
    return context.mentionsMemberMarketingKeyword
      ? "member_marketing_analysis_v1"
      : "customer_segment_list_v1";
  }
  if (context.mentionsTechCurrentKeyword) {
    return "tech_current_runtime_v1";
  }
  if (context.mentionsTechProfileKeyword) {
    return "tech_profile_lookup_v1";
  }
  if (context.semanticSlots.object === "tech") {
    return "tech_leaderboard_ranking_v1";
  }
  if (context.mentionsWaitExperienceKeyword) {
    return "wait_experience_analysis_v1";
  }
  if (context.mentionsArrivalProfileKeyword) {
    return "arrival_profile_timeseries_v1";
  }
  if (context.mentionsRechargeAttributionKeyword) {
    return "recharge_attribution_analysis_v1";
  }
  if (context.mentionsAdviceKeyword) {
    return "store_advice_v1";
  }
  if (context.mentionsRiskKeyword) {
    return "store_risk_v1";
  }
  if (context.mentionsAnomalyKeyword) {
    return "store_anomaly_v1";
  }
  if (context.mentionsTrendKeyword) {
    return "store_trend_v1";
  }
  if (context.mentionsRankingKeyword) {
    return "store_ranking_v1";
  }
  if (context.mentionsReportKeyword) {
    return "store_report_v1";
  }
  return "store_metric_summary_v1";
}

function isConcreteStoreDataAsk(params: {
  text: string;
  semanticContext: ReturnType<typeof resolveHetangQuerySemanticContext>;
}): boolean {
  const context = params.semanticContext;
  return (
    context.hasStoreContext ||
    context.hasDataKeyword ||
    context.metrics.supported.length > 0 ||
    context.metrics.unsupported.length > 0 ||
    context.mentionsCustomerSegmentKeyword ||
    context.mentionsCustomerRelationKeyword ||
    context.mentionsMemberMarketingKeyword ||
    context.mentionsRechargeAttributionKeyword ||
    context.mentionsWaitExperienceKeyword ||
    context.mentionsTechCurrentKeyword ||
    context.mentionsTechProfileKeyword ||
    context.mentionsHqPortfolioKeyword
  );
}

export function resolveSemanticFrontdoorClassification(params: {
  config: HetangOpsConfig;
  text: string;
}): SemanticFrontdoorClassification {
  const text = params.text.trim();
  const compact = compactText(text);
  const semanticContext = resolveHetangQuerySemanticContext({
    config: params.config,
    text,
  });
  const semanticText = semanticContext.semanticText;
  const domain = resolveDomain(semanticText);

  if (!compact || CASUAL_OR_CORRECTION_RE.test(compact)) {
    return {
      lane: "casual_or_correction",
      domain,
      intent: "casual_or_correction",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: compact ? "high" : "low",
      reason: "frontdoor:casual-or-correction",
    };
  }

  if (
    SEMANTIC_ASSET_RE.test(semanticText) &&
    (ASSET_DESIGN_ACTION_RE.test(semanticText) || !semanticContext.hasStoreContext)
  ) {
    return {
      lane: "semantic_asset_design",
      domain: domain ?? "system",
      intent: "design_semantic_asset",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "high",
      reason: "frontdoor:semantic-asset-signals",
    };
  }

  if (BRAND_MARKETING_RE.test(semanticText) && !semanticContext.hasStoreContext) {
    return {
      lane: "brand_marketing_plan",
      domain: domain ?? "brand",
      intent: "brand_marketing_plan",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "high",
      reason: "frontdoor:brand-marketing-signals",
    };
  }

  if (EXTERNAL_RESEARCH_RE.test(semanticText) && !semanticContext.hasStoreContext) {
    return {
      lane: "external_research",
      domain: domain ?? "brand",
      intent: "external_research",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "high",
      reason: "frontdoor:external-research-signals",
    };
  }

  if (BOOK_KNOWLEDGE_RE.test(semanticText) && !semanticContext.hasStoreContext) {
    return {
      lane: "book_knowledge_qa",
      domain: /营销/u.test(semanticText) ? "marketing" : (domain ?? "marketing"),
      intent: "book_knowledge_qa",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "medium",
      reason: "frontdoor:book-knowledge-signals",
    };
  }

  if (
    METHODOLOGY_CONCEPT_RE.test(semanticText) &&
    !semanticContext.hasStoreContext &&
    semanticContext.metrics.supported.length === 0 &&
    semanticContext.metrics.unsupported.length === 0
  ) {
    return {
      lane: "methodology_concept",
      domain: domain ?? "store",
      intent: "methodology_concept",
      requiresStore: false,
      requiresTime: false,
      requiresMetric: false,
      confidence: "high",
      reason: "frontdoor:methodology-concept-signals",
    };
  }

  if (isConcreteStoreDataAsk({ text: semanticText, semanticContext })) {
    const capabilityId = resolveStoreDataCapabilityId({ semanticContext });
    const object = semanticContext.semanticSlots.object;
    const requiresStore = object !== "hq" && !semanticContext.allStoresRequested;
    const requiresTime =
      !semanticContext.mentionsTechCurrentKeyword &&
      object !== "customer" &&
      !/(当前|现在|此刻|实时)/u.test(semanticText);
    const requiresMetric =
      semanticContext.metrics.supported.length > 0 ||
      semanticContext.metrics.unsupported.length > 0 ||
      semanticContext.semanticSlots.action === "metric";

    return {
      lane: "store_data_query",
      domain:
        object === "customer"
          ? "customer"
          : object === "tech"
            ? "technician"
            : object === "hq"
              ? "store"
              : domain ?? "store",
      intent: semanticContext.semanticSlots.action,
      requiresStore,
      requiresTime: requiresTime || TIME_HINT_RE.test(semanticText),
      requiresMetric,
      confidence: semanticContext.hasStoreContext || semanticContext.hasDataKeyword ? "high" : "medium",
      reason: "frontdoor:store-data-signals",
      targetCapabilityId: capabilityId,
    };
  }

  return {
    lane: "unknown",
    domain,
    requiresStore: false,
    requiresTime: false,
    requiresMetric: false,
    confidence: "low",
    reason: "frontdoor:unknown",
  };
}

export function isStoreDataFrontdoorClassification(
  classification: SemanticFrontdoorClassification,
): boolean {
  return classification.lane === "store_data_query";
}
