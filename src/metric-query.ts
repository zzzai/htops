import type { DailyStoreMetrics, DailyStoreReport } from "./types.js";

export type HetangSupportedMetricKey =
  | "serviceRevenue"
  | "antiServiceRevenue"
  | "serviceOrderCount"
  | "customerCount"
  | "clockEffect"
  | "clockRevenue"
  | "averageTicket"
  | "memberPaymentAmount"
  | "memberPaymentShare"
  | "cashPaymentAmount"
  | "cashPaymentShare"
  | "wechatPaymentAmount"
  | "wechatPaymentShare"
  | "alipayPaymentAmount"
  | "alipayPaymentShare"
  | "storedConsumeAmount"
  | "rechargeCash"
  | "rechargeStoredValue"
  | "rechargeBonusValue"
  | "groupbuyOrderShare"
  | "groupbuyOrderCount"
  | "groupbuyAmount"
  | "groupbuyAmountShare"
  | "groupbuyCohortCustomerCount"
  | "groupbuyRevisitCustomerCount"
  | "groupbuyRevisitRate"
  | "groupbuyMemberPayConvertedCustomerCount"
  | "groupbuyMemberPayConversionRate"
  | "groupbuy7dRevisitCustomerCount"
  | "groupbuy7dRevisitRate"
  | "groupbuy7dCardOpenedCustomerCount"
  | "groupbuy7dCardOpenedRate"
  | "groupbuy7dStoredValueConvertedCustomerCount"
  | "groupbuy7dStoredValueConversionRate"
  | "groupbuy30dMemberPayConvertedCustomerCount"
  | "groupbuy30dMemberPayConversionRate"
  | "groupbuyFirstOrderCustomerCount"
  | "groupbuyFirstOrderHighValueMemberCustomerCount"
  | "groupbuyFirstOrderHighValueMemberRate"
  | "meituanGroupbuyOrderCount"
  | "meituanGroupbuyOrderShare"
  | "meituanGroupbuyAmount"
  | "meituanGroupbuyAmountShare"
  | "douyinGroupbuyOrderCount"
  | "douyinGroupbuyOrderShare"
  | "douyinGroupbuyAmount"
  | "douyinGroupbuyAmountShare"
  | "totalClockCount"
  | "activeTechCount"
  | "onDutyTechCount"
  | "techCommission"
  | "techCommissionRate"
  | "marketRevenue"
  | "marketCommission"
  | "sleepingMemberRate"
  | "newMembers"
  | "effectiveMembers"
  | "sleepingMembers"
  | "currentStoredBalance"
  | "pointClockRate"
  | "addClockRate"
  | "roomOccupancyRate"
  | "roomTurnoverRate"
  | "grossMarginRate"
  | "netMarginRate"
  | "breakEvenRevenue";

export type HetangUnsupportedMetricKey = "utilizationRate";

type MetricDefinition<Key extends string> = {
  key: Key;
  label: string;
  aliases: string[];
};

type MetricMatch<Key extends string> = {
  key: Key;
  label: string;
};

export type HetangMetricDefinitionRecord<Key extends string> = {
  key: Key;
  label: string;
  aliases: string[];
};

export type HetangMetricIntentResolution = {
  supported: MetricMatch<HetangSupportedMetricKey>[];
  unsupported: MetricMatch<HetangUnsupportedMetricKey>[];
};

const SUPPORTED_METRICS: Array<MetricDefinition<HetangSupportedMetricKey>> = [
  {
    key: "serviceRevenue",
    label: "服务营收",
    aliases: ["服务营收", "营业额", "营收", "收入"],
  },
  {
    key: "antiServiceRevenue",
    label: "反结金额",
    aliases: ["反结金额", "反结服务金额", "反结"],
  },
  {
    key: "serviceOrderCount",
    label: "服务单数",
    aliases: ["服务单数", "订单数", "服务单量"],
  },
  {
    key: "customerCount",
    label: "消费人数",
    aliases: ["消费人数", "消费客数", "到店客数", "到店人数", "客数", "客流", "客流量", "来客量"],
  },
  {
    key: "clockEffect",
    label: "钟效",
    aliases: ["钟效", "钟均消费", "钟均"],
  },
  {
    key: "clockRevenue",
    label: "上钟产值",
    aliases: ["上钟产值", "上钟营收", "上钟业绩"],
  },
  {
    key: "averageTicket",
    label: "客单价",
    aliases: ["客单价", "客单"],
  },
  {
    key: "memberPaymentAmount",
    label: "会员支付金额",
    aliases: ["会员支付金额", "会员消费金额", "储值消费金额", "储值支付金额"],
  },
  {
    key: "memberPaymentShare",
    label: "会员消费占比",
    aliases: ["会员消费占比", "会员支付占比", "储值消费占比", "储值支付占比", "耗卡占比"],
  },
  {
    key: "cashPaymentAmount",
    label: "现金支付金额",
    aliases: ["现金支付金额", "现金消费金额", "现金金额"],
  },
  {
    key: "cashPaymentShare",
    label: "现金消费占比",
    aliases: ["现金消费占比", "现金支付占比", "现金占比"],
  },
  {
    key: "wechatPaymentAmount",
    label: "微信支付金额",
    aliases: ["微信支付金额", "微信消费金额"],
  },
  {
    key: "wechatPaymentShare",
    label: "微信支付占比",
    aliases: ["微信支付占比", "微信消费占比", "微信占比"],
  },
  {
    key: "alipayPaymentAmount",
    label: "支付宝支付金额",
    aliases: ["支付宝支付金额", "支付宝消费金额"],
  },
  {
    key: "alipayPaymentShare",
    label: "支付宝支付占比",
    aliases: ["支付宝支付占比", "支付宝消费占比", "支付宝占比"],
  },
  {
    key: "storedConsumeAmount",
    label: "耗卡金额",
    aliases: ["耗卡金额", "会员耗卡", "划卡金额", "耗卡"],
  },
  {
    key: "rechargeCash",
    label: "充值现金",
    aliases: ["充值现金", "充值金额", "充值", "实充"],
  },
  {
    key: "rechargeStoredValue",
    label: "充值总额（含赠送）",
    aliases: ["充值总额（含赠送）", "充值总额含赠送", "充值总额", "充值入账总额", "充卡总额"],
  },
  {
    key: "rechargeBonusValue",
    label: "充值赠送金额",
    aliases: ["充值赠送金额", "充值赠送", "赠送金额", "赠送额"],
  },
  {
    key: "groupbuyOrderCount",
    label: "团购单数",
    aliases: ["团购单数", "团购订单数"],
  },
  {
    key: "groupbuyOrderShare",
    label: "团购占比",
    aliases: ["团购订单占比", "团购占比"],
  },
  {
    key: "groupbuyAmount",
    label: "团购金额",
    aliases: ["团购金额", "团购消费金额", "团购支付金额"],
  },
  {
    key: "groupbuyAmountShare",
    label: "团购消费占比",
    aliases: ["团购消费占比", "团购支付占比", "团购金额占比"],
  },
  {
    key: "groupbuyCohortCustomerCount",
    label: "团购客样本数",
    aliases: ["团购客样本数", "团购样本人数", "团购样本客户数"],
  },
  {
    key: "groupbuyRevisitCustomerCount",
    label: "团购复到店人数",
    aliases: ["团购复到店人数", "团购二次到店人数"],
  },
  {
    key: "groupbuyRevisitRate",
    label: "团购复到店率",
    aliases: ["团购复到店率", "团购二次到店率"],
  },
  {
    key: "groupbuyMemberPayConvertedCustomerCount",
    label: "团购后会员支付转化人数",
    aliases: ["团购后会员支付转化人数", "团购会员支付转化人数"],
  },
  {
    key: "groupbuyMemberPayConversionRate",
    label: "团购后会员支付转化率",
    aliases: ["团购后会员支付转化率", "团购会员支付转化率"],
  },
  {
    key: "groupbuy7dRevisitCustomerCount",
    label: "7天复到店人数",
    aliases: ["7天复到店人数", "7日复到店人数", "7天二次到店人数"],
  },
  {
    key: "groupbuy7dRevisitRate",
    label: "7天复到店率",
    aliases: ["7天复到店率", "7日复到店率", "7天二次到店率", "7日二次到店率"],
  },
  {
    key: "groupbuy7dCardOpenedCustomerCount",
    label: "7天开卡人数",
    aliases: ["7天开卡人数", "7日开卡人数", "7天办卡人数"],
  },
  {
    key: "groupbuy7dCardOpenedRate",
    label: "7天开卡率",
    aliases: ["7天开卡率", "7日开卡率", "7天办卡率", "7日办卡率"],
  },
  {
    key: "groupbuy7dStoredValueConvertedCustomerCount",
    label: "7天储值转化人数",
    aliases: ["7天储值转化人数", "7日储值转化人数", "7天充值转化人数"],
  },
  {
    key: "groupbuy7dStoredValueConversionRate",
    label: "7天储值转化率",
    aliases: ["7天储值转化率", "7日储值转化率", "7天充值转化率", "7日充值转化率"],
  },
  {
    key: "groupbuy30dMemberPayConvertedCustomerCount",
    label: "30天会员消费转化人数",
    aliases: ["30天会员消费转化人数", "30日会员消费转化人数", "30天会员支付转化人数"],
  },
  {
    key: "groupbuy30dMemberPayConversionRate",
    label: "30天会员消费转化率",
    aliases: ["30天会员消费转化率", "30日会员消费转化率", "30天会员支付转化率"],
  },
  {
    key: "groupbuyFirstOrderCustomerCount",
    label: "团购首单客数",
    aliases: ["团购首单客数", "团购首单人数", "团购首单客样本数"],
  },
  {
    key: "groupbuyFirstOrderHighValueMemberCustomerCount",
    label: "团购首单转高价值会员人数",
    aliases: ["团购首单转高价值会员人数", "团购首单高价值会员人数"],
  },
  {
    key: "groupbuyFirstOrderHighValueMemberRate",
    label: "团购首单客转高价值会员率",
    aliases: [
      "团购首单客转高价值会员率",
      "团购首单转高价值会员率",
      "首单高价值会员率",
      "高价值会员转化率",
    ],
  },
  {
    key: "meituanGroupbuyOrderCount",
    label: "美团团购单数",
    aliases: ["美团团购单数", "美团单数", "美团订单数"],
  },
  {
    key: "meituanGroupbuyOrderShare",
    label: "美团团购单数占比",
    aliases: ["美团团购单数占比", "美团订单占比", "美团单数占比"],
  },
  {
    key: "meituanGroupbuyAmount",
    label: "美团团购金额",
    aliases: ["美团团购金额", "美团金额", "美团支付金额"],
  },
  {
    key: "meituanGroupbuyAmountShare",
    label: "美团团购金额占比",
    aliases: ["美团团购金额占比", "美团金额占比", "美团支付占比"],
  },
  {
    key: "douyinGroupbuyOrderCount",
    label: "抖音团购单数",
    aliases: ["抖音团购单数", "抖音单数", "抖音订单数"],
  },
  {
    key: "douyinGroupbuyOrderShare",
    label: "抖音团购单数占比",
    aliases: ["抖音团购单数占比", "抖音订单占比", "抖音单数占比"],
  },
  {
    key: "douyinGroupbuyAmount",
    label: "抖音团购金额",
    aliases: ["抖音团购金额", "抖音金额", "抖音支付金额"],
  },
  {
    key: "douyinGroupbuyAmountShare",
    label: "抖音团购金额占比",
    aliases: ["抖音团购金额占比", "抖音金额占比", "抖音支付占比"],
  },
  {
    key: "totalClockCount",
    label: "总钟数",
    aliases: ["总上钟数", "总钟数", "钟数"],
  },
  {
    key: "activeTechCount",
    label: "活跃技师",
    aliases: ["活跃技师数", "活跃技师"],
  },
  {
    key: "onDutyTechCount",
    label: "在岗技师",
    aliases: ["在岗技师数", "在岗技师"],
  },
  {
    key: "techCommission",
    label: "技师提成金额",
    aliases: ["技师提成金额", "技师提成"],
  },
  {
    key: "techCommissionRate",
    label: "技师提成占比",
    aliases: ["技师提成占比", "提成占比"],
  },
  {
    key: "marketRevenue",
    label: "推销营收",
    aliases: ["推销营收", "推销金额", "销售营收"],
  },
  {
    key: "marketCommission",
    label: "推销提成",
    aliases: ["推销提成", "销售提成"],
  },
  {
    key: "sleepingMemberRate",
    label: "沉默率",
    aliases: ["沉默会员率", "沉默率"],
  },
  {
    key: "newMembers",
    label: "新增会员",
    aliases: ["新增会员", "新会员"],
  },
  {
    key: "effectiveMembers",
    label: "有效会员",
    aliases: ["有效会员"],
  },
  {
    key: "sleepingMembers",
    label: "沉默会员",
    aliases: ["沉默会员"],
  },
  {
    key: "currentStoredBalance",
    label: "当前储值余额",
    aliases: ["当前储值余额", "会员储值余额", "储值余额"],
  },
  {
    key: "pointClockRate",
    label: "点钟率",
    aliases: ["点钟率", "点钟最高", "点钟最好", "点钟排行", "点钟排名"],
  },
  {
    key: "addClockRate",
    label: "加钟率",
    aliases: ["加钟率", "加钟最高", "加钟最好", "加钟排行", "加钟排名"],
  },
  {
    key: "roomOccupancyRate",
    label: "包间上座率",
    aliases: ["包间上座率", "房间上座率", "上座率"],
  },
  {
    key: "roomTurnoverRate",
    label: "翻房率",
    aliases: ["翻房率", "翻台率"],
  },
  {
    key: "grossMarginRate",
    label: "毛利率",
    aliases: ["毛利率"],
  },
  {
    key: "netMarginRate",
    label: "净利率",
    aliases: ["净利率"],
  },
  {
    key: "breakEvenRevenue",
    label: "保本营收",
    aliases: ["保本营收", "盈亏平衡营收", "盈亏平衡点", "保本点"],
  },
];

const UNSUPPORTED_METRICS: Array<MetricDefinition<HetangUnsupportedMetricKey>> = [
  {
    key: "utilizationRate",
    label: "上钟率",
    aliases: ["工时利用率", "上钟率"],
  },
];

function normalizeIntentText(value: string): string {
  return value.replace(/[\s，,、；;：:。.!！？?]/gu, "");
}

function resolveMatches<Key extends string>(
  definitions: Array<MetricDefinition<Key>>,
  text: string,
): MetricMatch<Key>[] {
  const normalized = normalizeIntentText(text);
  return definitions
    .map((definition) => {
      const matches = definition.aliases
        .map((alias) => normalizeIntentText(alias))
        .map((alias) => ({
          alias,
          position: normalized.indexOf(alias),
        }))
        .filter((entry) => entry.position >= 0)
        .sort(
          (left, right) => left.position - right.position || right.alias.length - left.alias.length,
        );
      if (matches.length === 0) {
        return null;
      }
      return {
        key: definition.key,
        label: definition.label,
        position: matches[0].position,
        aliasLength: matches[0].alias.length,
      };
    })
    .filter((match) => match !== null)
    .sort((left, right) => left.position - right.position || right.aliasLength - left.aliasLength)
    .reduce<Array<{ key: Key; label: string; position: number; aliasLength: number }>>(
      (list, match) => {
        if (list.some((entry) => entry.position === match.position)) {
          return list;
        }
        list.push(match);
        return list;
      },
      [],
    )
    .map(({ key, label }) => ({ key, label }));
}

const PAYMENT_STRUCTURE_ALIASES = [
  "支付结构",
  "付款结构",
  "支付分布",
  "支付占比",
  "付款占比",
  "消费方式",
  "支付方式",
  "付款方式",
  "收款方式",
];
const PAYMENT_STRUCTURE_METRICS: HetangSupportedMetricKey[] = [
  "memberPaymentShare",
  "cashPaymentShare",
  "wechatPaymentShare",
  "alipayPaymentShare",
  "groupbuyAmountShare",
];

const PAYMENT_ENTITY_DEFINITIONS: Array<{
  patterns: string[];
  amount: HetangSupportedMetricKey;
  share: HetangSupportedMetricKey;
}> = [
  {
    patterns: ["会员", "储值支付", "储值消费"],
    amount: "memberPaymentAmount",
    share: "memberPaymentShare",
  },
  {
    patterns: ["现金"],
    amount: "cashPaymentAmount",
    share: "cashPaymentShare",
  },
  {
    patterns: ["微信"],
    amount: "wechatPaymentAmount",
    share: "wechatPaymentShare",
  },
  {
    patterns: ["支付宝"],
    amount: "alipayPaymentAmount",
    share: "alipayPaymentShare",
  },
  {
    patterns: ["团购"],
    amount: "groupbuyAmount",
    share: "groupbuyAmountShare",
  },
];

const GROUPBUY_PLATFORM_DEFINITIONS: Array<{
  patterns: string[];
  amount: HetangSupportedMetricKey;
  amountShare: HetangSupportedMetricKey;
  orderCount: HetangSupportedMetricKey;
  orderShare: HetangSupportedMetricKey;
}> = [
  {
    patterns: ["美团"],
    amount: "meituanGroupbuyAmount",
    amountShare: "meituanGroupbuyAmountShare",
    orderCount: "meituanGroupbuyOrderCount",
    orderShare: "meituanGroupbuyOrderShare",
  },
  {
    patterns: ["抖音"],
    amount: "douyinGroupbuyAmount",
    amountShare: "douyinGroupbuyAmountShare",
    orderCount: "douyinGroupbuyOrderCount",
    orderShare: "douyinGroupbuyOrderShare",
  },
];

function hasPaymentStructurePhrase(normalized: string): boolean {
  const mentionsPaymentAxis = PAYMENT_STRUCTURE_ALIASES.some((alias) =>
    normalized.includes(normalizeIntentText(alias)),
  );
  const mentionsBreakdownIntent =
    /(结构|分布|占比|比例|逐个|逐项|分别|列出|列一下|拆开|拆分)/u.test(normalized);
  return mentionsPaymentAxis && mentionsBreakdownIntent;
}

function hasAmountIntent(text: string): boolean {
  return /(金额|多少|多少钱|多少元|金额多少|分别多少|各多少|分别列|列一下|列出)/u.test(text);
}

function hasShareIntent(text: string): boolean {
  return /(占比|比例|结构|分布|份额)/u.test(text);
}

function hasOrderIntent(text: string): boolean {
  return /(单数|订单数|单量|多少单|几单|单数占比|订单占比|单量占比)/u.test(text);
}

function hasTotalClockBreakdownIntent(text: string): boolean {
  return (
    /(构成|组成|拆开|拆分|拆解|由什么构成|怎么构成|分别是多少|分别多少)/u.test(text) &&
    /(\d+\s*个?钟|总上钟数|总钟数|钟数|上钟数|几个钟|多少钟)/u.test(text)
  );
}

function pushMetric(
  target: MetricMatch<HetangSupportedMetricKey>[],
  seen: Set<HetangSupportedMetricKey>,
  key: HetangSupportedMetricKey,
) {
  if (seen.has(key)) {
    return;
  }
  const definition = SUPPORTED_METRICS.find((entry) => entry.key === key);
  if (!definition) {
    return;
  }
  target.push({ key: definition.key, label: definition.label });
  seen.add(key);
}

export function resolveMetricIntent(text: string): HetangMetricIntentResolution {
  const supported = resolveMatches(SUPPORTED_METRICS, text);
  const normalized = normalizeIntentText(text);
  const seen = new Set(supported.map((entry) => entry.key));

  if (hasPaymentStructurePhrase(normalized)) {
    for (const key of PAYMENT_STRUCTURE_METRICS) {
      pushMetric(supported, seen, key);
    }
  }

  const amountIntent = hasAmountIntent(text);
  const shareIntent = hasShareIntent(text) || hasPaymentStructurePhrase(normalized);
  const orderIntent = hasOrderIntent(text);
  const clockStatusIntent =
    /(点钟|加钟).{0,6}(情况|表现|数据|咋样|什么情况)/u.test(text) ||
    /(情况|表现|数据|咋样|什么情况).{0,6}(点钟|加钟)/u.test(text);
  const clockKpiIntent =
    amountIntent || shareIntent || /(率|如何|怎么样)/u.test(text) || clockStatusIntent;

  if (hasTotalClockBreakdownIntent(text)) {
    pushMetric(supported, seen, "totalClockCount");
  }

  if (clockKpiIntent && /点钟/u.test(text)) {
    pushMetric(supported, seen, "pointClockRate");
  }
  if (clockKpiIntent && /加钟/u.test(text)) {
    pushMetric(supported, seen, "addClockRate");
  }

  const matchedPaymentEntities = PAYMENT_ENTITY_DEFINITIONS.filter((entry) =>
    entry.patterns.some((pattern) => normalized.includes(normalizeIntentText(pattern))),
  );
  if (matchedPaymentEntities.length > 0) {
    for (const entity of matchedPaymentEntities) {
      if (amountIntent) {
        pushMetric(supported, seen, entity.amount);
      }
      if (shareIntent) {
        pushMetric(supported, seen, entity.share);
      }
    }
  }

  const mentionsGroupbuyPlatformStructure =
    /(团购平台|平台团购|团购渠道|团购平台结构|平台结构)/u.test(text) &&
    /(结构|分布|占比|比例|拆分|分别|列出|列一下|金额|单数)/u.test(text);
  const matchedGroupbuyPlatforms = GROUPBUY_PLATFORM_DEFINITIONS.filter((entry) =>
    entry.patterns.some((pattern) => normalized.includes(normalizeIntentText(pattern))),
  );
  const resolvedGroupbuyPlatforms =
    matchedGroupbuyPlatforms.length > 0 || mentionsGroupbuyPlatformStructure
      ? matchedGroupbuyPlatforms.length > 0
        ? matchedGroupbuyPlatforms
        : GROUPBUY_PLATFORM_DEFINITIONS
      : [];
  for (const platform of resolvedGroupbuyPlatforms) {
    if (orderIntent) {
      pushMetric(supported, seen, platform.orderCount);
      if (shareIntent) {
        pushMetric(supported, seen, platform.orderShare);
      }
    } else if (amountIntent && !shareIntent) {
      pushMetric(supported, seen, platform.amount);
    } else if (shareIntent && !amountIntent) {
      pushMetric(supported, seen, platform.amountShare);
    } else if (amountIntent && shareIntent) {
      pushMetric(supported, seen, platform.amount);
      pushMetric(supported, seen, platform.amountShare);
    }
  }

  return {
    supported,
    unsupported: resolveMatches(UNSUPPORTED_METRICS, text),
  };
}

export function listSupportedMetricDefinitions(): HetangMetricDefinitionRecord<HetangSupportedMetricKey>[] {
  return SUPPORTED_METRICS.map((entry) => ({
    key: entry.key,
    label: entry.label,
    aliases: [...entry.aliases],
  }));
}

export function findSupportedMetricDefinition(
  token: string,
): HetangMetricDefinitionRecord<HetangSupportedMetricKey> | null {
  const normalized = normalizeIntentText(token);
  if (!normalized) {
    return null;
  }
  const byKey = SUPPORTED_METRICS.find(
    (entry) =>
      normalizeIntentText(entry.key) === normalized ||
      normalizeIntentText(entry.label) === normalized ||
      entry.aliases.some((alias) => normalizeIntentText(alias) === normalized),
  );
  if (!byKey) {
    return null;
  }
  return {
    key: byKey.key,
    label: byKey.label,
    aliases: [...byKey.aliases],
  };
}

export function hasMetricIntent(text: string): boolean {
  const resolution = resolveMetricIntent(text);
  return resolution.supported.length > 0 || resolution.unsupported.length > 0;
}

export function buildMetricQueryArgText(resolution: HetangMetricIntentResolution): string {
  return [...resolution.supported, ...resolution.unsupported].map((entry) => entry.label).join(" ");
}

function formatCurrency(value: number | null | undefined): string {
  return `${(value ?? 0).toFixed(2)} 元`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${(value * 100).toFixed(1)}%`;
}

function formatCount(value: number | undefined, unit: string): string {
  return `${value ?? 0} ${unit}`;
}

function formatPercentWithCounts(params: {
  rate: number | null | undefined;
  numerator: number | undefined;
  denominator: number | undefined;
}): string {
  if (params.rate === null || params.rate === undefined || !params.denominator) {
    return "N/A";
  }
  return `${formatPercent(params.rate)}（${params.numerator ?? 0}/${params.denominator}）`;
}

function formatTimesPerRoom(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "N/A";
  }
  return `${value.toFixed(2)} 次/间`;
}

function getGroupbuyPlatformMetric(
  metrics: DailyStoreMetrics,
  platform: string,
): DailyStoreMetrics["groupbuyPlatformBreakdown"][number] | undefined {
  return metrics.groupbuyPlatformBreakdown.find((entry) => entry.platform === platform);
}

function formatSupportedMetricValue(
  metric: MetricMatch<HetangSupportedMetricKey>,
  metrics: DailyStoreMetrics,
): string {
  switch (metric.key) {
    case "serviceRevenue":
      return `${metric.label}: ${formatCurrency(metrics.serviceRevenue)}`;
    case "antiServiceRevenue":
      return `${metric.label}: ${formatCurrency(metrics.antiServiceRevenue)}`;
    case "serviceOrderCount":
      return `${metric.label}: ${formatCount(metrics.serviceOrderCount, "单")}`;
    case "customerCount":
      return `${metric.label}: ${formatCount(metrics.customerCount, "人")}`;
    case "clockEffect":
      return `${metric.label}: ${(metrics.clockEffect ?? 0).toFixed(2)} 元/钟`;
    case "clockRevenue":
      return `${metric.label}: ${formatCurrency(metrics.clockRevenue)}`;
    case "averageTicket":
      return `${metric.label}: ${formatCurrency(metrics.averageTicket)}`;
    case "memberPaymentAmount":
      return `${metric.label}: ${formatCurrency(metrics.memberPaymentAmount)}`;
    case "memberPaymentShare":
      return `${metric.label}: ${formatPercent(metrics.memberPaymentShare)}`;
    case "cashPaymentAmount":
      return `${metric.label}: ${formatCurrency(metrics.cashPaymentAmount)}`;
    case "cashPaymentShare":
      return `${metric.label}: ${formatPercent(metrics.cashPaymentShare)}`;
    case "wechatPaymentAmount":
      return `${metric.label}: ${formatCurrency(metrics.wechatPaymentAmount)}`;
    case "wechatPaymentShare":
      return `${metric.label}: ${formatPercent(metrics.wechatPaymentShare)}`;
    case "alipayPaymentAmount":
      return `${metric.label}: ${formatCurrency(metrics.alipayPaymentAmount)}`;
    case "alipayPaymentShare":
      return `${metric.label}: ${formatPercent(metrics.alipayPaymentShare)}`;
    case "storedConsumeAmount":
      return `${metric.label}: ${formatCurrency(metrics.storedConsumeAmount)}`;
    case "rechargeCash":
      return `${metric.label}: ${formatCurrency(metrics.rechargeCash)}`;
    case "rechargeStoredValue":
      return `${metric.label}: ${formatCurrency(metrics.rechargeStoredValue)}`;
    case "rechargeBonusValue":
      return `${metric.label}: ${formatCurrency(metrics.rechargeBonusValue)}`;
    case "groupbuyOrderCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyOrderCount, "单")}`;
    case "groupbuyOrderShare":
      return `${metric.label}: ${formatPercent(metrics.groupbuyOrderShare)}`;
    case "groupbuyAmount":
      return `${metric.label}: ${formatCurrency(metrics.groupbuyAmount)}`;
    case "groupbuyAmountShare":
      return `${metric.label}: ${formatPercent(metrics.groupbuyAmountShare)}`;
    case "groupbuyCohortCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyCohortCustomerCount, "人")}`;
    case "groupbuyRevisitCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyRevisitCustomerCount, "人")}`;
    case "groupbuyRevisitRate":
      return `${metric.label}: ${formatPercent(metrics.groupbuyRevisitRate)}`;
    case "groupbuyMemberPayConvertedCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyMemberPayConvertedCustomerCount, "人")}`;
    case "groupbuyMemberPayConversionRate":
      return `${metric.label}: ${formatPercent(metrics.groupbuyMemberPayConversionRate)}`;
    case "groupbuy7dRevisitCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuy7dRevisitCustomerCount, "人")}`;
    case "groupbuy7dRevisitRate":
      return `${metric.label}: ${formatPercentWithCounts({
        rate: metrics.groupbuy7dRevisitRate,
        numerator: metrics.groupbuy7dRevisitCustomerCount,
        denominator: metrics.groupbuyCohortCustomerCount,
      })}`;
    case "groupbuy7dCardOpenedCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuy7dCardOpenedCustomerCount, "人")}`;
    case "groupbuy7dCardOpenedRate":
      return `${metric.label}: ${formatPercentWithCounts({
        rate: metrics.groupbuy7dCardOpenedRate,
        numerator: metrics.groupbuy7dCardOpenedCustomerCount,
        denominator: metrics.groupbuyCohortCustomerCount,
      })}`;
    case "groupbuy7dStoredValueConvertedCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuy7dStoredValueConvertedCustomerCount, "人")}`;
    case "groupbuy7dStoredValueConversionRate":
      return `${metric.label}: ${formatPercentWithCounts({
        rate: metrics.groupbuy7dStoredValueConversionRate,
        numerator: metrics.groupbuy7dStoredValueConvertedCustomerCount,
        denominator: metrics.groupbuyCohortCustomerCount,
      })}`;
    case "groupbuy30dMemberPayConvertedCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuy30dMemberPayConvertedCustomerCount, "人")}`;
    case "groupbuy30dMemberPayConversionRate":
      return `${metric.label}: ${formatPercentWithCounts({
        rate: metrics.groupbuy30dMemberPayConversionRate,
        numerator: metrics.groupbuy30dMemberPayConvertedCustomerCount,
        denominator: metrics.groupbuyCohortCustomerCount,
      })}`;
    case "groupbuyFirstOrderCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyFirstOrderCustomerCount, "人")}`;
    case "groupbuyFirstOrderHighValueMemberCustomerCount":
      return `${metric.label}: ${formatCount(metrics.groupbuyFirstOrderHighValueMemberCustomerCount, "人")}`;
    case "groupbuyFirstOrderHighValueMemberRate":
      return `${metric.label}: ${formatPercentWithCounts({
        rate: metrics.groupbuyFirstOrderHighValueMemberRate,
        numerator: metrics.groupbuyFirstOrderHighValueMemberCustomerCount,
        denominator: metrics.groupbuyFirstOrderCustomerCount,
      })}`;
    case "meituanGroupbuyOrderCount":
      return `${metric.label}: ${formatCount(getGroupbuyPlatformMetric(metrics, "美团")?.orderCount, "单")}`;
    case "meituanGroupbuyOrderShare":
      return `${metric.label}: ${formatPercent(getGroupbuyPlatformMetric(metrics, "美团")?.orderShare)}`;
    case "meituanGroupbuyAmount":
      return `${metric.label}: ${formatCurrency(getGroupbuyPlatformMetric(metrics, "美团")?.amount)}`;
    case "meituanGroupbuyAmountShare":
      return `${metric.label}: ${formatPercent(getGroupbuyPlatformMetric(metrics, "美团")?.amountShare)}`;
    case "douyinGroupbuyOrderCount":
      return `${metric.label}: ${formatCount(getGroupbuyPlatformMetric(metrics, "抖音")?.orderCount, "单")}`;
    case "douyinGroupbuyOrderShare":
      return `${metric.label}: ${formatPercent(getGroupbuyPlatformMetric(metrics, "抖音")?.orderShare)}`;
    case "douyinGroupbuyAmount":
      return `${metric.label}: ${formatCurrency(getGroupbuyPlatformMetric(metrics, "抖音")?.amount)}`;
    case "douyinGroupbuyAmountShare":
      return `${metric.label}: ${formatPercent(getGroupbuyPlatformMetric(metrics, "抖音")?.amountShare)}`;
    case "totalClockCount":
      return `${metric.label}: ${formatCount(metrics.totalClockCount, "钟")}`;
    case "activeTechCount":
      return `${metric.label}: ${formatCount(metrics.activeTechCount, "人")}`;
    case "onDutyTechCount":
      return `${metric.label}: ${formatCount(metrics.onDutyTechCount, "人")}`;
    case "techCommission":
      return `${metric.label}: ${formatCurrency(metrics.techCommission)}`;
    case "techCommissionRate":
      return `${metric.label}: ${formatPercent(metrics.techCommissionRate)}`;
    case "marketRevenue":
      return `${metric.label}: ${formatCurrency(metrics.marketRevenue)}`;
    case "marketCommission":
      return `${metric.label}: ${formatCurrency(metrics.marketCommission)}`;
    case "sleepingMemberRate":
      return `${metric.label}: ${formatPercent(metrics.sleepingMemberRate)}`;
    case "newMembers":
      return `${metric.label}: ${formatCount(metrics.newMembers, "人")}`;
    case "effectiveMembers":
      return `${metric.label}: ${formatCount(metrics.effectiveMembers, "人")}`;
    case "sleepingMembers":
      return `${metric.label}: ${formatCount(metrics.sleepingMembers, "人")}`;
    case "currentStoredBalance":
      return `${metric.label}: ${formatCurrency(metrics.currentStoredBalance)}`;
    case "pointClockRate":
      return `${metric.label}: ${formatPercent(metrics.pointClockRate)}（${metrics.pointClockRecordCount ?? 0}/${metrics.upClockRecordCount ?? 0}）`;
    case "addClockRate":
      return `${metric.label}: ${formatPercent(metrics.addClockRate)}（${metrics.addClockRecordCount ?? 0}/${metrics.upClockRecordCount ?? 0}）`;
    case "roomOccupancyRate":
      return `${metric.label}: ${formatPercent(metrics.roomOccupancyRate)}`;
    case "roomTurnoverRate":
      return `${metric.label}: ${formatTimesPerRoom(metrics.roomTurnoverRate)}`;
    case "grossMarginRate":
      return `${metric.label}: ${formatPercent(metrics.grossMarginRate)}`;
    case "netMarginRate":
      return `${metric.label}: ${formatPercent(metrics.netMarginRate)}`;
    case "breakEvenRevenue":
      return `${metric.label}: ${formatCurrency(metrics.breakEvenRevenue)}`;
  }
}

export function resolvePrimarySupportedMetric(
  resolution: HetangMetricIntentResolution,
): MetricMatch<HetangSupportedMetricKey> {
  return resolution.supported[0] ?? { key: "serviceRevenue", label: "服务营收" };
}

export function formatMetricValue(
  metric: MetricMatch<HetangSupportedMetricKey>,
  metrics: DailyStoreMetrics,
): string {
  return formatSupportedMetricValue(metric, metrics);
}

export function getMetricNumericValue(
  metric: MetricMatch<HetangSupportedMetricKey>,
  metrics: DailyStoreMetrics,
): number | null {
  switch (metric.key) {
    case "serviceRevenue":
      return metrics.serviceRevenue ?? 0;
    case "antiServiceRevenue":
      return metrics.antiServiceRevenue ?? 0;
    case "serviceOrderCount":
      return metrics.serviceOrderCount ?? 0;
    case "customerCount":
      return metrics.customerCount ?? 0;
    case "clockEffect":
      return metrics.clockEffect ?? 0;
    case "clockRevenue":
      return metrics.clockRevenue ?? 0;
    case "averageTicket":
      return metrics.averageTicket ?? 0;
    case "memberPaymentAmount":
      return metrics.memberPaymentAmount ?? 0;
    case "memberPaymentShare":
      return metrics.memberPaymentShare ?? null;
    case "cashPaymentAmount":
      return metrics.cashPaymentAmount ?? 0;
    case "cashPaymentShare":
      return metrics.cashPaymentShare ?? null;
    case "wechatPaymentAmount":
      return metrics.wechatPaymentAmount ?? 0;
    case "wechatPaymentShare":
      return metrics.wechatPaymentShare ?? null;
    case "alipayPaymentAmount":
      return metrics.alipayPaymentAmount ?? 0;
    case "alipayPaymentShare":
      return metrics.alipayPaymentShare ?? null;
    case "storedConsumeAmount":
      return metrics.storedConsumeAmount ?? 0;
    case "rechargeCash":
      return metrics.rechargeCash ?? 0;
    case "rechargeStoredValue":
      return metrics.rechargeStoredValue ?? 0;
    case "rechargeBonusValue":
      return metrics.rechargeBonusValue ?? 0;
    case "groupbuyOrderCount":
      return metrics.groupbuyOrderCount ?? 0;
    case "groupbuyOrderShare":
      return metrics.groupbuyOrderShare ?? null;
    case "groupbuyAmount":
      return metrics.groupbuyAmount ?? 0;
    case "groupbuyAmountShare":
      return metrics.groupbuyAmountShare ?? null;
    case "groupbuyCohortCustomerCount":
      return metrics.groupbuyCohortCustomerCount ?? 0;
    case "groupbuyRevisitCustomerCount":
      return metrics.groupbuyRevisitCustomerCount ?? 0;
    case "groupbuyRevisitRate":
      return metrics.groupbuyRevisitRate ?? null;
    case "groupbuyMemberPayConvertedCustomerCount":
      return metrics.groupbuyMemberPayConvertedCustomerCount ?? 0;
    case "groupbuyMemberPayConversionRate":
      return metrics.groupbuyMemberPayConversionRate ?? null;
    case "groupbuy7dRevisitCustomerCount":
      return metrics.groupbuy7dRevisitCustomerCount ?? 0;
    case "groupbuy7dRevisitRate":
      return metrics.groupbuy7dRevisitRate ?? null;
    case "groupbuy7dCardOpenedCustomerCount":
      return metrics.groupbuy7dCardOpenedCustomerCount ?? 0;
    case "groupbuy7dCardOpenedRate":
      return metrics.groupbuy7dCardOpenedRate ?? null;
    case "groupbuy7dStoredValueConvertedCustomerCount":
      return metrics.groupbuy7dStoredValueConvertedCustomerCount ?? 0;
    case "groupbuy7dStoredValueConversionRate":
      return metrics.groupbuy7dStoredValueConversionRate ?? null;
    case "groupbuy30dMemberPayConvertedCustomerCount":
      return metrics.groupbuy30dMemberPayConvertedCustomerCount ?? 0;
    case "groupbuy30dMemberPayConversionRate":
      return metrics.groupbuy30dMemberPayConversionRate ?? null;
    case "groupbuyFirstOrderCustomerCount":
      return metrics.groupbuyFirstOrderCustomerCount ?? 0;
    case "groupbuyFirstOrderHighValueMemberCustomerCount":
      return metrics.groupbuyFirstOrderHighValueMemberCustomerCount ?? 0;
    case "groupbuyFirstOrderHighValueMemberRate":
      return metrics.groupbuyFirstOrderHighValueMemberRate ?? null;
    case "meituanGroupbuyOrderCount":
      return getGroupbuyPlatformMetric(metrics, "美团")?.orderCount ?? 0;
    case "meituanGroupbuyOrderShare":
      return getGroupbuyPlatformMetric(metrics, "美团")?.orderShare ?? null;
    case "meituanGroupbuyAmount":
      return getGroupbuyPlatformMetric(metrics, "美团")?.amount ?? 0;
    case "meituanGroupbuyAmountShare":
      return getGroupbuyPlatformMetric(metrics, "美团")?.amountShare ?? null;
    case "douyinGroupbuyOrderCount":
      return getGroupbuyPlatformMetric(metrics, "抖音")?.orderCount ?? 0;
    case "douyinGroupbuyOrderShare":
      return getGroupbuyPlatformMetric(metrics, "抖音")?.orderShare ?? null;
    case "douyinGroupbuyAmount":
      return getGroupbuyPlatformMetric(metrics, "抖音")?.amount ?? 0;
    case "douyinGroupbuyAmountShare":
      return getGroupbuyPlatformMetric(metrics, "抖音")?.amountShare ?? null;
    case "totalClockCount":
      return metrics.totalClockCount ?? 0;
    case "activeTechCount":
      return metrics.activeTechCount ?? 0;
    case "onDutyTechCount":
      return metrics.onDutyTechCount ?? 0;
    case "techCommission":
      return metrics.techCommission ?? 0;
    case "techCommissionRate":
      return metrics.techCommissionRate ?? 0;
    case "marketRevenue":
      return metrics.marketRevenue ?? 0;
    case "marketCommission":
      return metrics.marketCommission ?? 0;
    case "sleepingMemberRate":
      return metrics.sleepingMemberRate ?? null;
    case "newMembers":
      return metrics.newMembers ?? 0;
    case "effectiveMembers":
      return metrics.effectiveMembers ?? 0;
    case "sleepingMembers":
      return metrics.sleepingMembers ?? 0;
    case "currentStoredBalance":
      return metrics.currentStoredBalance ?? 0;
    case "pointClockRate":
      return metrics.pointClockRate ?? null;
    case "addClockRate":
      return metrics.addClockRate ?? null;
    case "roomOccupancyRate":
      return metrics.roomOccupancyRate ?? null;
    case "roomTurnoverRate":
      return metrics.roomTurnoverRate ?? null;
    case "grossMarginRate":
      return metrics.grossMarginRate ?? null;
    case "netMarginRate":
      return metrics.netMarginRate ?? null;
    case "breakEvenRevenue":
      return metrics.breakEvenRevenue ?? null;
  }
}

export function describeUnsupportedMetricResolution(
  resolution: HetangMetricIntentResolution,
): string | null {
  if (resolution.unsupported.length === 0) {
    return null;
  }

  const lines: string[] = [];
  for (const metric of resolution.unsupported) {
    if (metric.key === "utilizationRate") {
      lines.push(`${metric.label} 暂不能严肃回答，因为库里还没接入排班可上钟总数。`);
    }
  }
  if (resolution.supported.length === 0) {
    lines.push("可先查询：点钟率、加钟率、钟效、总钟数、服务营收。");
  }
  return lines.join("\n");
}

function shouldRenderDailyClockMetricBreakdown(params: {
  dailyReports?: DailyStoreReport[];
  resolution: HetangMetricIntentResolution;
}): boolean {
  return (
    (params.dailyReports?.length ?? 0) > 1 &&
    params.resolution.supported.some(
      (metric) => metric.key === "pointClockRate" || metric.key === "addClockRate",
    )
  );
}

function buildDailyClockMetricBreakdownLines(params: {
  dailyReports: DailyStoreReport[];
  resolution: HetangMetricIntentResolution;
}): string[] {
  const includePointClock = params.resolution.supported.some(
    (metric) => metric.key === "pointClockRate",
  );
  const includeAddClock = params.resolution.supported.some(
    (metric) => metric.key === "addClockRate",
  );
  const lines = ["- 分天明细:"];

  for (const report of params.dailyReports) {
    const metrics = report.metrics;
    const metricGroups: string[] = [];
    if (includePointClock) {
      metricGroups.push(
        `点钟数量 ${formatCount(metrics.pointClockRecordCount, "个")}，点钟率 ${formatPercentWithCounts({
          rate: metrics.pointClockRate,
          numerator: metrics.pointClockRecordCount,
          denominator: metrics.upClockRecordCount,
        })}`,
      );
    }
    if (includeAddClock) {
      metricGroups.push(
        `加钟数量 ${formatCount(metrics.addClockRecordCount, "个")}，加钟率 ${formatPercentWithCounts({
          rate: metrics.addClockRate,
          numerator: metrics.addClockRecordCount,
          denominator: metrics.upClockRecordCount,
        })}`,
      );
    }
    if (metricGroups.length > 0) {
      lines.push(`- ${report.bizDate}：${metricGroups.join("；")}`);
    }
  }

  return lines;
}

export function renderMetricQueryResponse(params: {
  storeName: string;
  bizDate: string;
  metrics: DailyStoreMetrics;
  complete: boolean;
  resolution: HetangMetricIntentResolution;
  dailyReports?: DailyStoreReport[];
}): string {
  const lines = [`${params.storeName} ${params.bizDate} 指标查询`];

  if (!params.complete || params.metrics.incompleteSync) {
    lines.push("注意：当前营业日同步尚未完全收口，以下指标仅供参考。");
  }

  if (
    shouldRenderDailyClockMetricBreakdown({
      dailyReports: params.dailyReports,
      resolution: params.resolution,
    })
  ) {
    lines.push(
      ...buildDailyClockMetricBreakdownLines({
        dailyReports: params.dailyReports ?? [],
        resolution: params.resolution,
      }),
    );
  }

  for (const metric of params.resolution.supported) {
    if (metric.key === "pointClockRate") {
      lines.push(`- 点钟数量: ${formatCount(params.metrics.pointClockRecordCount, "个")}`);
    }
    if (metric.key === "addClockRate") {
      lines.push(`- 加钟数量: ${formatCount(params.metrics.addClockRecordCount, "个")}`);
    }
    lines.push(`- ${formatSupportedMetricValue(metric, params.metrics)}`);
  }

  if (
    params.resolution.supported.some((metric) =>
      [
        "memberPaymentAmount",
        "memberPaymentShare",
        "cashPaymentAmount",
        "cashPaymentShare",
        "wechatPaymentAmount",
        "wechatPaymentShare",
        "alipayPaymentAmount",
        "alipayPaymentShare",
        "groupbuyAmountShare",
      ].includes(metric.key),
    )
  ) {
    lines.push(
      "注：支付金额/占比按顾客消费明细 Payments 实付拆分统计，混合支付会按各支付项金额分别计入。",
    );
  }

  if (
    params.resolution.supported.some(
      (metric) => metric.key === "pointClockRate" || metric.key === "addClockRate",
    )
  ) {
    lines.push("注：点钟率 / 加钟率当前按技师上钟明细条数口径，不等同于排班上钟率。");
  }

  if (
    params.resolution.supported.some((metric) =>
      [
        "groupbuy7dRevisitRate",
        "groupbuy7dCardOpenedRate",
        "groupbuy7dStoredValueConversionRate",
        "groupbuy30dMemberPayConversionRate",
        "groupbuyFirstOrderHighValueMemberRate",
      ].includes(metric.key),
    )
  ) {
    lines.push(
      "注：上述团购漏斗按近 30 天团购客滚动样本统计，7 天看复到店/开卡/储值，30 天看会员消费转化。",
    );
  }

  for (const metric of params.resolution.unsupported) {
    if (metric.key === "utilizationRate") {
      lines.push(`- ${metric.label}: 当前日报库未接入排班可上钟总数，暂不能严肃给出上钟率。`);
    }
  }

  if (params.resolution.supported.length === 0 && params.resolution.unsupported.length > 0) {
    lines.push("可先查询：点钟率、加钟率、钟效、总钟数、服务营收。");
  }

  return lines.join("\n");
}
