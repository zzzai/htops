import type { HetangQueryIntent } from "./query-intent.js";
import type { ConsumeBillRecord, HetangOpsConfig } from "./types.js";

type ArrivalProfileRuntime = {
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
};

type TimeWindow = {
  startHour: number;
  endHour: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function parseHourExpression(raw: string): number | null {
  const match = raw.trim().match(
    /^(凌晨|早上|上午|中午|下午|傍晚|晚上|晚间|夜里|夜间)?\s*(\d{1,2})(?:[:：](\d{2}))?\s*(?:点半|点|时)?$/u,
  );
  if (!match?.[2]) {
    return null;
  }
  const period = match[1] ?? "";
  const hour = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    return null;
  }
  if (/下午/u.test(period)) {
    return hour < 12 ? hour + 12 : hour;
  }
  if (/中午/u.test(period)) {
    return hour < 11 ? hour + 12 : hour;
  }
  if (/(傍晚|晚上|晚间|夜里|夜间)/u.test(period)) {
    if (hour >= 6 && hour < 12) {
      return hour + 12;
    }
    return hour % 24;
  }
  return hour % 24;
}

function parseTimeWindow(text: string): TimeWindow | null {
  const direct =
    text.match(/从\s*([^，。；,\s]+(?:点半|点|时))\s*(?:到|至)\s*([^，。；,\s]+(?:点半|点|时))/u) ??
    text.match(/([^，。；,\s]+(?:点半|点|时))\s*(?:到|至)\s*([^，。；,\s]+(?:点半|点|时))/u);
  if (!direct?.[1] || !direct?.[2]) {
    return null;
  }
  const startHour = parseHourExpression(direct[1]);
  const endHour = parseHourExpression(direct[2]);
  if (startHour === null || endHour === null) {
    return null;
  }
  return {
    startHour,
    endHour: endHour <= startHour ? endHour + 24 : endHour,
  };
}

function parseCutoffHour(cutoffLocalTime: string): number {
  const hour = Number(cutoffLocalTime.split(":")[0] ?? "3");
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : 3;
}

function resolveOperationalHour(optTime: string, cutoffHour: number): number | null {
  const match = optTime.match(/\b(\d{2}):\d{2}(?::\d{2})?\b/u);
  if (!match?.[1]) {
    return null;
  }
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) {
    return null;
  }
  return hour < cutoffHour ? hour + 24 : hour;
}

function formatBucketLabel(operationalHour: number): string {
  const start = operationalHour % 24;
  const end = (operationalHour + 1) % 24;
  return `${String(start).padStart(2, "0")}:00-${String(end).padStart(2, "0")}:00`;
}

function formatWindowLabel(window: TimeWindow): string {
  return `${String(window.startHour % 24).padStart(2, "0")}:00-${String(window.endHour % 24).padStart(2, "0")}:00`;
}

function defaultWindow(): TimeWindow {
  return {
    startHour: 10,
    endHour: 24,
  };
}

function resolveFrameLabel(intent: HetangQueryIntent): string {
  if (/(过去一周|最近一周|近一周)/u.test(intent.rawText)) {
    return "过去一周";
  }
  return intent.timeFrame.label;
}

export async function executeArrivalProfileQuery(params: {
  runtime: ArrivalProfileRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string> {
  if (!params.runtime.listConsumeBillsByDateRange) {
    return "当前环境还未接通到店时段分布分析能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "到店时段分布当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const frame =
    params.intent.timeFrame.kind === "single"
      ? {
          startBizDate: params.intent.timeFrame.bizDate,
          endBizDate: params.intent.timeFrame.bizDate,
          days: 1,
        }
      : {
          startBizDate: params.intent.timeFrame.startBizDate,
          endBizDate: params.intent.timeFrame.endBizDate,
          days: params.intent.timeFrame.days,
        };
  const window = parseTimeWindow(params.intent.rawText) ?? defaultWindow();
  const cutoffHour = parseCutoffHour(params.config.sync.businessDayCutoffLocalTime);
  const rows = await params.runtime.listConsumeBillsByDateRange({
    orgId,
    startBizDate: frame.startBizDate,
    endBizDate: frame.endBizDate,
  });

  const bucketOrder: number[] = [];
  for (let hour = window.startHour; hour < window.endHour; hour += 1) {
    bucketOrder.push(hour);
  }
  const bucketCounts = new Map<number, number>(bucketOrder.map((hour) => [hour, 0]));

  let totalArrivals = 0;
  for (const row of rows) {
    if (row.antiFlag) {
      continue;
    }
    const hour = resolveOperationalHour(row.optTime, cutoffHour);
    if (hour === null || hour < window.startHour || hour >= window.endHour) {
      continue;
    }
    bucketCounts.set(hour, (bucketCounts.get(hour) ?? 0) + 1);
    totalArrivals += 1;
  }

  const lines = [`${storeName}${resolveFrameLabel(params.intent)}到店时段分布`];
  lines.push(`- 统计窗口: ${formatWindowLabel(window)}（按日均到店人数）`);
  if (totalArrivals === 0) {
    lines.push("- 当前时间段没有可用于到店时段分析的消费记录。");
    return lines.join("\n");
  }

  lines.push(
    `- 覆盖天数: ${frame.days} 天，总到店 ${totalArrivals} 人次，日均 ${round(totalArrivals / frame.days, 2).toFixed(2)} 人次`,
  );

  const rankedBuckets = bucketOrder
    .map((hour) => ({
      hour,
      count: bucketCounts.get(hour) ?? 0,
      dailyAverage: (bucketCounts.get(hour) ?? 0) / frame.days,
    }))
    .sort((left, right) => right.dailyAverage - left.dailyAverage || left.hour - right.hour);
  const topBucket = rankedBuckets[0];
  if (topBucket && topBucket.count > 0) {
    lines.push(
      `- 峰值时段: ${formatBucketLabel(topBucket.hour)} ${round(topBucket.dailyAverage, 2).toFixed(2)} 人/天（${topBucket.count} 人次）`,
    );
  }

  for (const hour of bucketOrder) {
    const count = bucketCounts.get(hour) ?? 0;
    const dailyAverage = count / frame.days;
    lines.push(
      `${formatBucketLabel(hour)} ${round(dailyAverage, 2).toFixed(2)} 人/天（${count} 人次）`,
    );
  }

  return lines.join("\n");
}
