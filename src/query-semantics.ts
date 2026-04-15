import { resolveMetricIntent, type HetangMetricIntentResolution } from "./metric-query.js";
import type { HetangOpsConfig } from "./types.js";

export type HetangSemanticObject =
  | "store"
  | "customer"
  | "tech"
  | "hq"
  | "recharge"
  | "wait_experience"
  | "unknown";

export type HetangSemanticAction =
  | "metric"
  | "report"
  | "compare"
  | "ranking"
  | "trend"
  | "anomaly"
  | "risk"
  | "advice"
  | "followup"
  | "profile"
  | "portfolio"
  | "unknown";

const SEMANTIC_EXPANSION_RULES: Array<{
  pattern: RegExp;
  inject: string[];
}> = [
  {
    pattern:
      /(晚场有没有接住|午场有没有接住|哪个班次没接住|哪个时段没接住|哪个班次承接弱|哪个时段承接弱|晚场接没接住|晚场没接住)/u,
    inject: ["等待时长", "时段", "晚场"],
  },
  {
    pattern: /(盘子稳不稳|盘子怎么样|基本盘稳不稳|基本盘怎么样|盘子如何)/u,
    inject: ["经营复盘", "经营情况"],
  },
  {
    pattern: /(盘子有没有问题|盘子有问题吗|盘子出问题没|盘子出问题了吗|盘子行不行)/u,
    inject: ["经营复盘", "经营情况", "风险"],
  },
  {
    pattern:
      /(团购客接没接住|团购接没接住|团购客有没有接住|团购有没有接住|团购客接住没有|团购接住没有|团购接住了没|承接偏弱|二转怎么样|二次转化怎么样)/u,
    inject: ["7天复到店率", "7天储值转化率", "团购首单客转高价值会员率"],
  },
  {
    pattern: /(团购客回来了没有|团购客回来没有|团购客有回来吗|团购回来了没有)/u,
    inject: ["7天复到店率", "7天复到店人数"],
  },
  {
    pattern: /(团购有没有转会员|团购客有没有转会员|团购有没有转成会员|团购转会员怎么样)/u,
    inject: ["7天开卡率", "7天储值转化率", "30天会员消费转化率"],
  },
  {
    pattern: /(高价值沉淀|高价值会员沉淀|高价值转化)/u,
    inject: ["团购首单客转高价值会员率"],
  },
  {
    pattern: /(指定客承接|点钟承接|点钟强不强|指定客推荐)/u,
    inject: ["点钟率"],
  },
  {
    pattern: /(服务后半程收口|加钟收口|加钟强不强|二次成交)/u,
    inject: ["加钟率"],
  },
  {
    pattern: /(老客变冷|老客冷了没|老客回头怎么样|老会员回头怎么样|会员回头怎么样)/u,
    inject: ["会员", "风险", "经营情况"],
  },
  {
    pattern: /(老客回流|老会员回流|老客回流怎么样|老会员回流怎么样)/u,
    inject: ["会员", "复购", "风险", "经营情况"],
  },
  {
    pattern: /(续费压力|储值承压|会员与储值风险)/u,
    inject: ["充值", "耗卡", "风险", "经营情况"],
  },
  {
    pattern:
      /(先抓复购还是储值|先抓储值还是复购|复购还是储值先抓哪个|复购还是续费先抓哪个|该先抓复购还是储值|该先抓储值还是复购)/u,
    inject: ["建议", "会员", "充值", "耗卡"],
  },
];

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim();
}

export function normalizeHetangSemanticText(text: string): string {
  const normalized = text.trim();
  if (!normalized) {
    return normalized;
  }
  const injected = SEMANTIC_EXPANSION_RULES.flatMap((rule) =>
    rule.pattern.test(normalized) ? rule.inject : [],
  );
  if (injected.length === 0) {
    return normalized;
  }
  return `${normalized} ${Array.from(new Set(injected)).join(" ")}`.trim();
}

function resolveMatchedOrgIds(config: HetangOpsConfig, text: string): string[] {
  const normalized = normalizeText(text);
  const matches = config.stores
    .map((store) => {
      const aliases = [store.storeName, ...store.rawAliases].filter(Boolean);
      const found = aliases
        .map((alias) => ({
          alias,
          position: normalized.indexOf(normalizeText(alias)),
        }))
        .filter((entry) => entry.position >= 0)
        .sort(
          (left, right) => left.position - right.position || right.alias.length - left.alias.length,
        )[0];
      return found
        ? {
            orgId: store.orgId,
            position: found.position,
            length: found.alias.length,
          }
        : null;
    })
    .filter((entry) => entry !== null)
    .sort((left, right) => left.position - right.position || right.length - left.length);

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const match of matches) {
    if (seen.has(match.orgId)) {
      continue;
    }
    seen.add(match.orgId);
    ordered.push(match.orgId);
  }
  return ordered;
}

export type HetangQuerySemanticContext = {
  rawText: string;
  semanticText: string;
  metrics: HetangMetricIntentResolution;
  explicitOrgIds: string[];
  allStoresRequested: boolean;
  hasStoreContext: boolean;
  hasDataKeyword: boolean;
  mentionsCompareKeyword: boolean;
  mentionsRankingKeyword: boolean;
  mentionsTrendKeyword: boolean;
  mentionsAnomalyKeyword: boolean;
  mentionsRiskKeyword: boolean;
  mentionsAdviceKeyword: boolean;
  mentionsReportKeyword: boolean;
  mentionsCustomerSegmentKeyword: boolean;
  mentionsCustomerSegmentListStyle: boolean;
  mentionsCustomerSegmentAnalysisStyle: boolean;
  mentionsSilentMemberMetric: boolean;
  mentionsCustomerRelationKeyword: boolean;
  mentionsPhoneSuffixKeyword: boolean;
  mentionsBirthdayKeyword: boolean;
  mentionsArrivalProfileKeyword: boolean;
  mentionsWaitExperienceKeyword: boolean;
  mentionsMemberMarketingKeyword: boolean;
  mentionsRechargeAttributionKeyword: boolean;
  mentionsTechProfileKeyword: boolean;
  mentionsHqPortfolioKeyword: boolean;
  customerSegmentShouldYieldToMetric: boolean;
  routeSignals: {
    birthdayFollowupHybrid: boolean;
    rechargeCustomerHybrid: boolean;
    compareNeedsAttribution: boolean;
    reportAdviceHybrid: boolean;
    hqStoreMixedScope: boolean;
  };
  semanticSlots: {
    store: {
      scope: "single" | "multi" | "all" | "implicit";
      orgIds: string[];
    };
    object: HetangSemanticObject;
    secondaryObject?: HetangSemanticObject;
    action: HetangSemanticAction;
    secondaryAction?: HetangSemanticAction;
    metricKeys: string[];
  };
};

export function resolveHetangQuerySemanticContext(params: {
  config: HetangOpsConfig;
  text: string;
}): HetangQuerySemanticContext {
  const rawText = params.text.trim();
  const semanticText = normalizeHetangSemanticText(rawText);
  const metrics = resolveMetricIntent(semanticText);
  const explicitOrgIds = resolveMatchedOrgIds(params.config, rawText);
  const allStoresRequested =
    /(五店|5店|全部门店|所有门店|各店|所有店|全部店|五家店|五个店|哪家店|哪一家店|哪个店|哪家门店|哪一家门店|哪个门店)/u.test(
      rawText,
    );
  const text = semanticText;
  const mentionsRankingKeyword =
    /(排名|排行|top|TOP|最高|最低|最多|最少|倒数|最好|最差|末位)/u.test(text);
  const mentionsCompareKeyword =
    /(对比|比较|相比|对照|差异|vs|VS|比昨天|比昨日|比上周|比上月|较昨天|较昨日|较上周|较上月|环比|比前\d+(?:天|日|周|月)|较前\d+(?:天|日|周|月)|比前[一二三四五六七八九十]+(?:天|日|周|月)|较前[一二三四五六七八九十]+(?:天|日|周|月)|(?:谁|哪家|哪个店).{0,8}更(?:高|低|好|差|强|弱))/u.test(
      text,
    );
  const mentionsAnomalyKeyword = /(异常|原因|为什么|为何|归因|怎么回事|下滑原因|波动原因)/u.test(
    text,
  );
  const mentionsRiskKeyword = /(风险|预警|告警|红线|危险|最危险)/u.test(text);
  const mentionsAdviceKeyword =
    /(建议|怎么办|怎么做|该怎么抓|怎么抓经营|怎么抓业绩|怎么抓门店|咋抓经营|动作|优化|提升|先抓|优先抓|优先做|先做|先盯|先管|该抓|抓什么|先救)/u.test(
      text,
    );
  const mentionsReportKeyword =
    /(日报|报表|报告|复盘|总结|经营情况|经营怎么样|经营如何|经营咋样|业绩怎么样|业绩如何|业绩咋样|业绩情况|生意怎么样|生意如何|生意咋样|整体怎么样|整体情况|整体表现|整体如何|盘子怎么样|盘子如何|盘子咋样|盘子稳不稳|盘子有没有问题|盘子有问题吗|盘子出问题)/u.test(
      text,
    );
  const mentionsTrendKeyword = /(趋势|走势|变化|波动|环比|同比)/u.test(text);
  const mentionsCustomerSegmentKeyword =
    /(重要价值(?:会员|客户|顾客)|高价值(?:会员|客户|顾客)|重要唤回(?:会员|客户|顾客)|重要召回(?:会员|客户|顾客)|高价值待唤回|高价值沉睡(?:会员|客户|顾客)|待唤回(?:会员|客户|顾客)|待召回(?:会员|客户|顾客)|潜力发展(?:会员|客户|顾客)|潜力成长|潜力(?:会员|客户|顾客)|团购留存(?:候选)?|活跃(?:会员|客户|顾客)|(?:沉睡|睡眠|沉默)(?:会员|客户|顾客)|(?:标准|普通|常规)(?:会员|客户|顾客)|标签|客群|分层|层级|(?:最需要|最值得|值得|优先|重点|最该).{0,6}(?:跟进|唤回|召回).*(?:会员|客户|顾客)|(?:跟进|唤回|召回)(?:名单|对象).*(?:会员|客户|顾客)|(?:会员|客户|顾客).{0,12}(?:最需要|最值得|值得|优先|重点|最该).{0,6}(?:跟进|唤回|召回)|(?:会员|客户|顾客).*(?:跟进|唤回|召回)名单)/u.test(
      text,
    );
  const mentionsCustomerSegmentListStyle =
    /(名单|列表|明细|有哪些|哪些人|都是谁|列一下|逐个列一下)/u.test(text);
  const mentionsCustomerSegmentAnalysisStyle = /(标签|客群|分层|层级|跟进|唤回|召回)/u.test(text);
  const mentionsSilentMemberMetric =
    metrics.supported.some((metric) => metric.key === "sleepingMembers") &&
    !mentionsCustomerSegmentListStyle &&
    !mentionsCustomerSegmentAnalysisStyle;
  const mentionsCustomerRelationKeyword =
    /(被哪些技师服务|被哪位技师服务|哪些技师服务过|服务过哪些技师|找过哪些技师|(服务了哪些|接待了哪些|带了哪些).*(会员|顾客|客户|客人))/u.test(
      text,
    );
  const mentionsPhoneSuffixKeyword =
    /((尾号|后四位|手机后四位|手机号后四位)\D*\d{4}|\d{4}\D*(尾号|后四位))/u.test(text);
  const mentionsBirthdayKeyword = /(生日|生辰)/u.test(text) && /(会员|客户|顾客)/u.test(text);
  const mentionsArrivalProfileKeyword =
    (/(时段|时间段|各时段|各个时段|分时|小时)/u.test(text) &&
      /(到店|客流|来客|客数|人数)/u.test(text) &&
      /(平均|分布|统计|分析|人数|客数)/u.test(text)) ||
    (/(到店|客流|来客)/u.test(text) &&
      /(从|按|按时段|按小时|各时段|各个时段)/u.test(text) &&
      /(点|时)/u.test(text)) ||
    (/(客人|顾客|客户|来客|到店|客流)/u.test(text) &&
      /(几点来|几点钟来|什么时候来|啥时候来)/u.test(text));
  const mentionsWaitExperienceKeyword =
    /(等待时间|等待时长|排队时间|等位时间|候钟时间|候钟|等钟|空档)/u.test(text) ||
    (/(等待|等位|候钟)/u.test(text) &&
      /(时段|最长|最高|偏长|差异|房间|技师|多久|分钟)/u.test(text)) ||
    (/(班次|时段|晚场|午场)/u.test(text) &&
      /(没接住|接不住|承接弱|承接不住|最容易等|最容易排队|最容易候钟)/u.test(text));
  const mentionsMemberMarketingKeyword =
    ((/(来源|渠道)/u.test(text) && /(会员|客户|顾客)/u.test(text)) ||
      /营销人|营销员|营销带来的会员|带来的会员|营销归因/u.test(text) ||
      (/标签/u.test(text) && /(会员|客户|顾客|经营|跟进|重点|值得|优先)/u.test(text)) ||
      (/(优惠券|优惠|券)/u.test(text) &&
        /(会员|客户|顾客|回店|复到店|核销|回来|效果)/u.test(text)) ||
      (/(女宾|男宾|男客|女客|性别)/u.test(text) &&
        /(会员|客户|顾客|项目|偏好|差异)/u.test(text))) &&
    /(会员|客户|顾客|标签|营销|来源|渠道|优惠券|女宾|男宾|性别)/u.test(text);
  const mentionsRechargeAttributionKeyword =
    (/(卡型|卡种|卡类|充值卡|储值卡)/u.test(text) &&
      /(充值|储值|实充|赠送|最好|最高|结构|最多)/u.test(text)) ||
    (/(销售|前台|客服)/u.test(text) && /(充值|储值|实充|业绩|最多|最高)/u.test(text));
  const mentionsTechProfileKeyword =
    /((技师|老师).*(画像|档案|侧写)|((画像|档案|侧写).*(技师|老师))|((技师|老师).*(表现|情况|分析)))/u.test(
      text,
    );
  const customerSegmentShouldYieldToMetric =
    metrics.supported.some((metric) =>
      [
        "groupbuy7dRevisitRate",
        "groupbuy7dCardOpenedRate",
        "groupbuy7dStoredValueConversionRate",
        "groupbuy30dMemberPayConversionRate",
        "groupbuyFirstOrderHighValueMemberRate",
      ].includes(metric.key),
    ) ||
    /(率|占比|比例|转化|指标)/u.test(text) ||
    mentionsSilentMemberMetric;
  const rawHqPortfolioKeyword =
    /(整体怎么样|整体情况|整体表现|哪家.*拉升|哪家.*危险|哪家.*最差|哪家.*最好|哪家.*掉|总部.*先抓|总部.*重点|总部.*关注|下周.*先抓|下周.*重点|下周.*关注|先盯什么|先抓什么|先管什么|全局|全盘|大盘|经营复盘|经营分析|经营诊断|深度复盘|深度分析)/u.test(
      text,
    );
  const mentionsHqPortfolioKeyword =
    rawHqPortfolioKeyword &&
    (allStoresRequested || explicitOrgIds.length > 1 || /(总部|全局|全盘|大盘|哪家)/u.test(text));
  const hasStoreContext = explicitOrgIds.length > 0 || allStoresRequested;
  const hasDataKeyword =
    metrics.supported.length > 0 ||
    metrics.unsupported.length > 0 ||
    /(营收|收入|营业额|流水|日报|报表|钟效|客单|耗卡|充值|团购|会员|技师|提成|钟数|风险|预警|排名|对比|趋势|复盘|经营数据|经营情况|经营怎么样|经营如何|经营咋样|业绩怎么样|业绩如何|业绩咋样|业绩情况|生意怎么样|生意如何|生意咋样|整体怎么样|整体情况|整体表现|整体如何|盘子怎么样|盘子如何|盘子咋样|盘子稳不稳|复购|回流|老客|续费)/u.test(
      text,
    );
  const birthdayFollowupHybrid = mentionsBirthdayKeyword && mentionsCustomerSegmentKeyword;
  const rechargeCustomerHybrid =
    mentionsRechargeAttributionKeyword && mentionsMemberMarketingKeyword;
  const compareNeedsAttribution = mentionsCompareKeyword && mentionsAnomalyKeyword;
  const reportAdviceHybrid =
    mentionsReportKeyword && mentionsAdviceKeyword && !mentionsHqPortfolioKeyword;
  const hqStoreMixedScope =
    mentionsHqPortfolioKeyword &&
    explicitOrgIds.length === 1 &&
    (allStoresRequested || /(总部|全局|全盘|大盘)/u.test(text));
  const semanticObject: HetangSemanticObject = mentionsHqPortfolioKeyword
    ? "hq"
    : mentionsWaitExperienceKeyword
      ? "wait_experience"
      : mentionsRechargeAttributionKeyword
        ? "recharge"
        : mentionsTechProfileKeyword || /技师|老师/u.test(text)
          ? "tech"
          : mentionsCustomerSegmentKeyword ||
              mentionsCustomerRelationKeyword ||
              mentionsPhoneSuffixKeyword ||
              mentionsBirthdayKeyword ||
              mentionsMemberMarketingKeyword
            ? "customer"
            : hasStoreContext || hasDataKeyword
              ? "store"
              : "unknown";
  const secondaryObject: HetangSemanticObject | undefined = hqStoreMixedScope
    ? "store"
    : rechargeCustomerHybrid
      ? "customer"
      : undefined;
  const semanticAction: HetangSemanticAction = mentionsHqPortfolioKeyword
    ? "portfolio"
    : mentionsCustomerSegmentKeyword
      ? "followup"
      : mentionsPhoneSuffixKeyword || mentionsTechProfileKeyword
        ? "profile"
        : reportAdviceHybrid
          ? "report"
          : compareNeedsAttribution
            ? "anomaly"
            : mentionsAdviceKeyword
              ? "advice"
              : mentionsRankingKeyword
                ? "ranking"
                : mentionsCompareKeyword
                  ? "compare"
                  : mentionsTrendKeyword
                    ? "trend"
                    : mentionsAnomalyKeyword
                      ? "anomaly"
                      : mentionsRiskKeyword
                        ? "risk"
                        : mentionsReportKeyword
                          ? "report"
                          : metrics.supported.length > 0 || metrics.unsupported.length > 0
                            ? "metric"
                            : "unknown";
  const secondaryAction: HetangSemanticAction | undefined = reportAdviceHybrid
    ? "advice"
    : compareNeedsAttribution
      ? "compare"
      : undefined;
  const semanticSlots: HetangQuerySemanticContext["semanticSlots"] = {
    store: {
      scope:
        explicitOrgIds.length > 1
          ? "multi"
          : allStoresRequested
            ? "all"
            : explicitOrgIds.length === 1
              ? "single"
              : "implicit",
      orgIds: explicitOrgIds,
    },
    object: semanticObject,
    secondaryObject,
    action: semanticAction,
    secondaryAction,
    metricKeys: metrics.supported.map((metric) => metric.key),
  };

  return {
    rawText,
    semanticText,
    metrics,
    explicitOrgIds,
    allStoresRequested,
    hasStoreContext,
    hasDataKeyword,
    mentionsCompareKeyword,
    mentionsRankingKeyword,
    mentionsTrendKeyword,
    mentionsAnomalyKeyword,
    mentionsRiskKeyword,
    mentionsAdviceKeyword,
    mentionsReportKeyword,
    mentionsCustomerSegmentKeyword,
    mentionsCustomerSegmentListStyle,
    mentionsCustomerSegmentAnalysisStyle,
    mentionsSilentMemberMetric,
    mentionsCustomerRelationKeyword,
    mentionsPhoneSuffixKeyword,
    mentionsBirthdayKeyword,
    mentionsArrivalProfileKeyword,
    mentionsWaitExperienceKeyword,
    mentionsMemberMarketingKeyword,
    mentionsRechargeAttributionKeyword,
    mentionsTechProfileKeyword,
    mentionsHqPortfolioKeyword,
    customerSegmentShouldYieldToMetric,
    routeSignals: {
      birthdayFollowupHybrid,
      rechargeCustomerHybrid,
      compareNeedsAttribution,
      reportAdviceHybrid,
      hqStoreMixedScope,
    },
    semanticSlots,
  };
}
