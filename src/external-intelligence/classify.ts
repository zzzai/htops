export type ExternalThemeKey =
  | "general-hot-topic"
  | "chain-brand"
  | "strategy-organization"
  | "platform-rule"
  | "pricing-competition";

export type ExternalThemeLabel = "全网热点" | "连锁品牌" | "战略组织" | "平台规则" | "价格竞争";

export type ExternalThemeInput = {
  sourceId?: string;
  sourceUrl?: string;
  title?: string;
  summary?: string;
  entity?: string;
  action?: string;
  object?: string;
};

export type ExternalThemeResult = {
  themeKey: ExternalThemeKey;
  themeLabel: ExternalThemeLabel;
  theme: ExternalThemeKey;
  label: ExternalThemeLabel;
  matchedRules: string[];
  scores: Record<ExternalThemeKey, number>;
};

export const THEME_LABELS: Record<ExternalThemeKey, ExternalThemeLabel> = {
  "general-hot-topic": "全网热点",
  "chain-brand": "连锁品牌",
  "strategy-organization": "战略组织",
  "platform-rule": "平台规则",
  "pricing-competition": "价格竞争",
};

export const THEME_SOURCE_HINTS: Record<ExternalThemeKey, string[]> = {
  "general-hot-topic": ["gov", "government", "state-council", "policy", "macro"],
  "chain-brand": ["retail", "chain", "brand", "restaurant", "consumer"],
  "strategy-organization": ["strategy", "consult", "management", "org", "transformation"],
  "platform-rule": ["platform", "meituan", "dianping", "douyin", "eleme", "kuaishou"],
  "pricing-competition": ["price", "pricing", "discount", "promotion"],
};

export const THEME_KEYWORDS: Record<ExternalThemeKey, string[]> = {
  "general-hot-topic": ["政策", "宏观", "消费趋势", "经济", "民生", "监管动态"],
  "chain-brand": ["连锁", "品牌", "开店", "闭店", "门店", "加盟", "食堂", "校园"],
  "strategy-organization": ["战略", "组织", "变革", "转型", "组织升级", "战略解码", "执行系统"],
  "platform-rule": ["平台规则", "规则", "规范", "抽佣", "佣金", "罚则", "核销", "履约"],
  "pricing-competition": ["降价", "涨价", "价格战", "调价", "低价", "补贴", "价格带", "折扣"],
};

export const CHAIN_ENTITY_HINTS = [
  "海底捞",
  "瑞幸",
  "星巴克",
  "喜茶",
  "奈雪",
  "蜜雪冰城",
  "古茗",
  "茶百道",
];

const PRIORITY: ExternalThemeKey[] = [
  "pricing-competition",
  "platform-rule",
  "strategy-organization",
  "chain-brand",
  "general-hot-topic",
];

function normalizeText(value: string | undefined): string {
  return String(value ?? "").toLowerCase();
}

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function classifyExternalTheme(input: ExternalThemeInput): ExternalThemeResult {
  const scores: Record<ExternalThemeKey, number> = {
    "general-hot-topic": 0,
    "chain-brand": 0,
    "strategy-organization": 0,
    "platform-rule": 0,
    "pricing-competition": 0,
  };
  const matchedRules: string[] = [];
  const sourceText = normalizeText(`${input.sourceId ?? ""} ${input.sourceUrl ?? ""}`);
  const contentText = normalizeText(
    `${input.title ?? ""} ${input.summary ?? ""} ${input.entity ?? ""} ${input.action ?? ""} ${input.object ?? ""}`,
  );

  for (const themeKey of Object.keys(THEME_SOURCE_HINTS) as ExternalThemeKey[]) {
    if (includesAny(sourceText, THEME_SOURCE_HINTS[themeKey])) {
      scores[themeKey] += 2;
      matchedRules.push(`source:${themeKey}`);
    }
  }

  for (const themeKey of Object.keys(THEME_KEYWORDS) as ExternalThemeKey[]) {
    if (includesAny(contentText, THEME_KEYWORDS[themeKey])) {
      scores[themeKey] += 3;
      matchedRules.push(`keyword:${themeKey}`);
    }
  }

  if (includesAny(contentText, CHAIN_ENTITY_HINTS)) {
    scores["chain-brand"] += 2;
    matchedRules.push("entity:chain-brand");
  }

  let selected: ExternalThemeKey = "general-hot-topic";
  let bestScore = -1;
  for (const themeKey of PRIORITY) {
    const score = scores[themeKey];
    if (score > bestScore) {
      selected = themeKey;
      bestScore = score;
    }
  }

  return {
    themeKey: selected,
    themeLabel: THEME_LABELS[selected],
    theme: selected,
    label: THEME_LABELS[selected],
    matchedRules,
    scores,
  };
}
