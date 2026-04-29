import { resolveMetricIntent, type HetangMetricIntentResolution } from "./metric-query.js";
import { resolveMatchedStores } from "./store-aliases.js";
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
      /(盘子哪里不对|盘子出什么问题了|盘子卡在哪|盘子到底卡在哪|整体哪里不对|整体怎么回事|整体卡在哪|整体到底卡在哪|经营哪块有毛病|经营哪里有毛病)/u,
    inject: ["经营诊断", "经营情况", "异常"],
  },
  {
    pattern:
      /(((近|最近|过去).{0,8}(天|日|周|月)).{0,12}(到底)?卡在哪|((盘子|整体|经营|五店|总部).{0,12}(到底)?卡在哪))/u,
    inject: ["经营诊断", "经营情况", "异常"],
  },
  {
    pattern: /((帮我)?捋一下问题|((帮我)?做个诊断))/u,
    inject: ["经营诊断", "经营情况", "异常"],
  },
  {
    pattern:
      /((营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值).*(涨还是掉|升还是降|在涨还是在掉|在升还是在降|有没有在掉|有没有往下掉)|((涨还是掉|升还是降|在涨还是在掉|在升还是在降).*(营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值)))/u,
    inject: ["趋势", "变化"],
  },
  {
    pattern:
      /((营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值).*(走弱了吗|走弱了没|回落了吗|回落了没|下滑了吗|下滑了没|下跌了吗|下跌了没|走低了吗|走低了没|承压吗|变弱了吗|变差了吗)|((走弱了吗|走弱了没|回落了吗|回落了没|下滑了吗|下滑了没|下跌了吗|下跌了没|走低了吗|走低了没|承压吗|变弱了吗|变差了吗).*(营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值)))/u,
    inject: ["趋势", "变化"],
  },
  {
    pattern:
      /((营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值).*(回暖了吗|回暖了没|走高了吗|走高了没|拉升了吗|拉升了没|变强了吗|变好了没|变好了吗)|((回暖了吗|回暖了没|走高了吗|走高了没|拉升了吗|拉升了没|变强了吗|变好了没|变好了吗).*(营收|营业额|营业收入|客流|客数|消费人数|钟效|客单价|客单|团购|耗卡|充值)))/u,
    inject: ["趋势", "变化"],
  },
  {
    pattern:
      /((储值).*(涨还是掉|升还是降|在涨还是在掉|在升还是在降|有没有在掉|有没有往下掉)|((涨还是掉|升还是降|在涨还是在掉|在升还是在降).*(储值)))/u,
    inject: ["充值总额", "趋势", "变化"],
  },
  {
    pattern:
      /((储值).*(走弱了吗|走弱了没|回落了吗|回落了没|下滑了吗|下滑了没|下跌了吗|下跌了没|走低了吗|走低了没|承压吗|变弱了吗|变差了吗)|((走弱了吗|走弱了没|回落了吗|回落了没|下滑了吗|下滑了没|下跌了吗|下跌了没|走低了吗|走低了没|承压吗|变弱了吗|变差了吗).*(储值)))/u,
    inject: ["充值总额", "趋势", "变化"],
  },
  {
    pattern:
      /((储值).*(回暖了吗|回暖了没|走高了吗|走高了没|拉升了吗|拉升了没|变强了吗|变好了没|变好了吗)|((回暖了吗|回暖了没|走高了吗|走高了没|拉升了吗|拉升了没|变强了吗|变好了没|变好了吗).*(储值)))/u,
    inject: ["充值总额", "趋势", "变化"],
  },
  {
    pattern: /(哪里最危险|哪块最危险|哪方面最危险|最危险的是哪里|哪里风险最大|哪块风险最大|哪方面风险最大)/u,
    inject: ["风险", "经营情况"],
  },
  {
    pattern: /(哪块最?扛不住|哪项最?扛不住|哪块最?拖后腿了?|哪项最?拖后腿了?|最扛不住的是哪块|最拖后腿的是哪项)/u,
    inject: ["风险", "经营情况"],
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
  {
    pattern: /(生意好不好|生意行不行|生意还行吗)/u,
    inject: ["经营情况"],
  },
  {
    pattern:
      /(客人跟得怎么样|客人跟进怎么样|客户跟得怎么样|客户跟进怎么样|客人跟进情况|客户跟进情况)/u,
    inject: ["顾客", "跟进", "经营情况"],
  },
  {
    pattern: /(技师状态怎么样|技师状态如何|技师表现怎么样|技师表现如何)/u,
    inject: ["技师", "经营情况"],
  },
  {
    pattern: /(哪个技师最能赚|谁最赚钱|哪个技师赚钱最多|谁赚钱最多)/u,
    inject: ["技师", "排行", "服务营收"],
  },
  {
    pattern: /(人效最高的技师是谁|哪个技师人效最高)/u,
    inject: ["技师", "排行", "钟效"],
  },
  {
    pattern: /(帮我看看|帮我瞧瞧|帮忙看看|帮忙瞧瞧)/u,
    inject: ["经营情况"],
  },
  {
    pattern: /(复盘一下|盘一下|盘一盘)/u,
    inject: ["经营复盘", "经营情况"],
  },
  {
    pattern: /(哪些会员快跑了|哪些老客最近突然不来了|很久没来了的客人|很久没来的客人|客人很久没来了|客户很久没来了|顾客很久没来了)/u,
    inject: ["沉睡会员", "沉默会员", "唤回"],
  },
  {
    pattern:
      /(谁充了钱还没来过|充了钱还没来过的客人有哪些|充了钱还没来过的会员有哪些|充值了还没来过|充卡了还没来过|充了值还没来过|充了钱还没来消费过)/u,
    inject: ["充值未到店会员", "待唤回会员", "会员", "唤回"],
  },
  {
    pattern:
      /(上次发的券有多少人用了|还有多少券快过期了没用|领了券但没用的有多少|多少券快过期了还没用|券用了没|券核销得怎么样)/u,
    inject: ["优惠券", "会员", "营销"],
  },
  {
    pattern:
      /(今天卖出什么副项了|今天卖了什么副项|副项卖了几单|茶饮卖了几单|饮品卖了几单|精油卖了几单|今天什么副项卖出去了)/u,
    inject: ["推销营收", "副项"],
  },
  {
    pattern:
      /(谁推销做得好|谁今天推销做得好|哪个技师今天推销做得好|谁副项卖得最好|谁副项卖得最多)/u,
    inject: ["技师", "排行", "推销营收"],
  },
  {
    pattern: /(美团来的客人回头了吗|抖音来的客人回头了吗|团购客人回头了吗|团购来的客人回头了吗)/u,
    inject: ["7天复到店率", "团购"],
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
  return resolveMatchedStores(config, text).map((match) => match.orgId);
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
  mentionsTechCurrentKeyword: boolean;
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
    /(五店|5店|5个店|5家店|全部门店|所有门店|各店|所有店|全部店|五家店|五个店|哪家店|哪一家店|哪个店|哪家门店|哪一家门店|哪个门店)/u.test(
      rawText,
    );
  const text = semanticText;
  const mentionsRankingKeyword =
    /(排名|排行|top|TOP|最高|最低|最多|最少|倒数|最好|最差|末位)/u.test(text);
  const mentionsCompareKeyword =
    /(对比|比较|相比|对照|差异|vs|VS|比昨天|比昨日|比上周|比上月|较昨天|较昨日|较上周|较上月|环比|比前\d+(?:天|日|周|月)|较前\d+(?:天|日|周|月)|比前[一二三四五六七八九十]+(?:天|日|周|月)|较前[一二三四五六七八九十]+(?:天|日|周|月)|(?:和|跟)(?:昨天|昨日|上周|上月|前\d+(?:天|日|周|月)|前[一二三四五六七八九十]+(?:天|日|周|月))比|(?:谁|哪家|哪个店).{0,8}更(?:高|低|好|差|强|弱))/u.test(
      text,
    );
  const mentionsAnomalyKeyword = /(异常|原因|为什么|为何|归因|怎么回事|下滑原因|波动原因)/u.test(
    text,
  );
  const mentionsRiskKeyword = /(风险|预警|告警|红线|危险|最危险|扛不住|拖后腿)/u.test(text);
  const mentionsAdviceKeyword =
    /(建议|怎么办|怎么做|该怎么抓|怎么抓经营|怎么抓业绩|怎么抓门店|咋抓经营|动作|优化|提升|先抓|优先抓|优先做|先做|先盯|先管|该抓|抓什么|先救|先补|补什么)/u.test(
      text,
    );
  const mentionsReportKeyword =
    /(日报|报表|报告|复盘|总结|经营情况|经营怎么样|经营如何|经营咋样|业绩怎么样|业绩如何|业绩咋样|业绩情况|生意怎么样|生意如何|生意咋样|整体怎么样|整体情况|整体表现|整体如何|盘子怎么样|盘子如何|盘子咋样|盘子稳不稳|盘子有没有问题|盘子有问题吗|盘子出问题)/u.test(
      text,
    );
  const mentionsTrendKeyword = /(趋势|走势|变化|波动|环比|同比)/u.test(text);
  const mentionsCustomerSegmentKeyword =
    /(重要价值(?:会员|客户|顾客|客人)|高价值(?:会员|客户|顾客|客人)|重要唤回(?:会员|客户|顾客|客人)|重要召回(?:会员|客户|顾客|客人)|高价值待唤回|高价值沉睡(?:会员|客户|顾客|客人)|待唤回(?:会员|客户|顾客|客人)|待召回(?:会员|客户|顾客|客人)|潜力发展(?:会员|客户|顾客|客人)|潜力成长|潜力(?:会员|客户|顾客|客人)|团购留存(?:候选)?|活跃(?:会员|客户|顾客|客人)|(?:沉睡|睡眠|沉默)(?:会员|客户|顾客|客人)|(?:标准|普通|常规)(?:会员|客户|顾客|客人)|标签|客群|分层|层级|(?:最需要|最值得|值得|优先|重点|最该).{0,6}(?:跟进|唤回|召回).*(?:会员|客户|顾客|客人)|(?:跟进|唤回|召回)(?:名单|对象).*(?:会员|客户|顾客|客人)|(?:会员|客户|顾客|客人).{0,12}(?:最需要|最值得|值得|优先|重点|最该).{0,6}(?:跟进|唤回|召回)|(?:会员|客户|顾客|客人).*(?:跟进|唤回|召回)名单)/u.test(
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
  const mentionsTechCurrentKeyword =
    /(现在几个人在上钟|当前几个人在上钟|还有几个技师是空的|还有几个技师是空闲的|谁现在没事干|谁现在有空|哪些技师现在有空|哪些技师现在有空可以接客|现在有空的技师有哪些)/u.test(
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
    /(整体怎么样|整体情况|整体表现|哪家.*拉升|哪家.*危险|哪家.*最差|哪家.*最好|哪家.*最低|哪家.*最高|哪家.*最多|哪家.*最少|哪家.*掉|哪家.*拖后腿|(?:哪家|哪个(?:门店|店)|哪一个(?:门店|店)|哪一家(?:门店|店)).*(?:重点关注|优先关注|重点盯|优先盯|最该盯|风险最大|风险最高|最危险|拖后腿|掉得最厉害|最不稳|最需要总部介入|最需要总部出手)|(?:重点关注|优先关注|重点盯|优先盯).*(?:哪家|哪个(?:门店|店)|哪一个(?:门店|店)|哪一家(?:门店|店))|(?:五店|5店|各店|全部店|所有店|五家店|五个店|总部).*(?:先救哪家|先补哪家|哪家最扛不住|哪项最拖后腿|风险在哪|风险排序|风险雷达)|总部.*先抓|总部.*重点|总部.*关注|下周.*先抓|下周.*重点|下周.*关注|先盯什么|先抓什么|先管什么|全局|全盘|大盘|经营复盘|经营分析|经营诊断|深度复盘|深度分析)/u.test(
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
        : mentionsTechCurrentKeyword || mentionsTechProfileKeyword || /技师|老师/u.test(text)
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
    mentionsTechCurrentKeyword,
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
