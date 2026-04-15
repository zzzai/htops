import type { HetangControlTowerSettingValue } from "./types.js";

type TowerSettingKind = "boolean" | "number" | "enum";

export type HetangControlTowerSettingDefinition = {
  key: string;
  kind: TowerSettingKind;
  description: string;
  allowedValues?: readonly string[];
  min?: number;
  max?: number;
};

export const ANALYSIS_REVIEW_MODES = ["direct", "single", "sequential"] as const;
export const ROUTING_MODES = ["legacy", "shadow", "semantic"] as const;

const CONTROL_TOWER_SETTING_DEFINITIONS: HetangControlTowerSettingDefinition[] = [
  {
    key: "routing.mode",
    kind: "enum",
    description: "实时路由模式",
    allowedValues: ROUTING_MODES,
  },
  {
    key: "quota.hourlyLimit",
    kind: "number",
    description: "单人每小时可用命令数",
    min: 1,
    max: 500,
  },
  {
    key: "quota.dailyLimit",
    kind: "number",
    description: "单人每天可用命令数",
    min: 1,
    max: 5000,
  },
  {
    key: "notification.enabled",
    kind: "boolean",
    description: "是否允许自动发送日报或回推消息",
  },
  {
    key: "alert.revenueDropThreshold",
    kind: "number",
    description: "营收下滑预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "alert.clockDropThreshold",
    kind: "number",
    description: "钟数下滑预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "alert.antiRatioThreshold",
    kind: "number",
    description: "反结算占比预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "alert.lowTechActiveCountThreshold",
    kind: "number",
    description: "低活跃技师人数阈值",
    min: 0,
    max: 100,
  },
  {
    key: "alert.lowStoredConsumeRateThreshold",
    kind: "number",
    description: "低耗卡率预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "alert.sleepingMemberRateThreshold",
    kind: "number",
    description: "沉睡会员占比预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "alert.highTechCommissionRateThreshold",
    kind: "number",
    description: "高提成占比预警阈值",
    min: 0,
    max: 1,
  },
  {
    key: "analysis.reviewMode",
    kind: "enum",
    description: "深度复盘模式",
    allowedValues: ANALYSIS_REVIEW_MODES,
  },
  {
    key: "analysis.autoCreateActions",
    kind: "boolean",
    description: "分析完成后是否自动生成动作单",
  },
  {
    key: "analysis.retryEnabled",
    kind: "boolean",
    description: "是否允许手动重试失败分析",
  },
  {
    key: "analysis.notifyOnFailure",
    kind: "boolean",
    description: "分析失败后是否自动回推失败通知",
  },
  {
    key: "analysis.maxActionItems",
    kind: "number",
    description: "单次分析最多自动生成多少条动作单",
    min: 1,
    max: 10,
  },
];

const CONTROL_TOWER_SETTING_MAP = new Map(
  CONTROL_TOWER_SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

export function getControlTowerSettingDefinition(
  key: string,
): HetangControlTowerSettingDefinition | undefined {
  return CONTROL_TOWER_SETTING_MAP.get(key);
}

export function validateControlTowerSettingValue(params: {
  key: string;
  value: HetangControlTowerSettingValue;
}): { ok: true; value: HetangControlTowerSettingValue } | { ok: false; message: string } {
  const definition = getControlTowerSettingDefinition(params.key);
  if (!definition) {
    return {
      ok: false,
      message: [
        `未识别 Control Tower 配置项：${params.key}`,
        "当前支持的 key：",
        ...CONTROL_TOWER_SETTING_DEFINITIONS.map((item) => `- ${item.key}`),
      ].join("\n"),
    };
  }

  if (definition.kind === "boolean") {
    if (typeof params.value === "boolean") {
      return { ok: true, value: params.value };
    }
    return {
      ok: false,
      message: `${definition.key} 仅支持 true / false，当前收到：${String(params.value)}`,
    };
  }

  if (definition.kind === "enum") {
    if (typeof params.value === "string" && definition.allowedValues?.includes(params.value)) {
      return { ok: true, value: params.value };
    }
    return {
      ok: false,
      message: `${definition.key} 仅支持：${definition.allowedValues?.join(" | ") ?? ""}`,
    };
  }

  if (typeof params.value !== "number" || !Number.isFinite(params.value)) {
    return {
      ok: false,
      message: `${definition.key} 仅支持数字，当前收到：${String(params.value)}`,
    };
  }
  if (definition.min !== undefined && params.value < definition.min) {
    return {
      ok: false,
      message: `${definition.key} 不可小于 ${definition.min}，当前收到：${String(params.value)}`,
    };
  }
  if (definition.max !== undefined && params.value > definition.max) {
    return {
      ok: false,
      message: `${definition.key} 不可大于 ${definition.max}，当前收到：${String(params.value)}`,
    };
  }
  return { ok: true, value: params.value };
}

function formatDefinitionHint(definition: HetangControlTowerSettingDefinition): string {
  if (definition.kind === "enum") {
    return definition.allowedValues?.join(" | ") ?? "枚举值";
  }
  if (definition.kind === "boolean") {
    return "true | false";
  }
  if (definition.min !== undefined || definition.max !== undefined) {
    return `${definition.min ?? "-inf"} ~ ${definition.max ?? "+inf"}`;
  }
  return "number";
}

export function formatControlTowerSettings(
  scopeLabel: string,
  settings: Record<string, boolean | number | string>,
): string {
  const overrides = Object.entries(settings).sort(([left], [right]) => left.localeCompare(right));
  const routingDefinitions = CONTROL_TOWER_SETTING_DEFINITIONS.filter((definition) =>
    definition.key.startsWith("routing."),
  );
  const analysisDefinitions = CONTROL_TOWER_SETTING_DEFINITIONS.filter((definition) =>
    definition.key.startsWith("analysis."),
  );

  return [
    `Control Tower ${scopeLabel}`,
    "当前覆盖：",
    ...(overrides.length > 0
      ? overrides.map(([key, value]) => `- ${key} = ${String(value)}`)
      : ["- 当前无覆盖配置"]),
    "",
    "路由策略可控项：",
    ...routingDefinitions.map(
      (definition) =>
        `- ${definition.key} (${formatDefinitionHint(definition)}): ${definition.description}`,
    ),
    "",
    "分析策略可控项：",
    ...analysisDefinitions.map(
      (definition) =>
        `- ${definition.key} (${formatDefinitionHint(definition)}): ${definition.description}`,
    ),
  ].join("\n");
}
