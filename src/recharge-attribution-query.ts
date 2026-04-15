import type { HetangQueryIntent } from "./query-intent.js";
import type { HetangOpsConfig, RechargeBillRecord } from "./types.js";

type RechargeAttributionRuntime = {
  listRechargeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<RechargeBillRecord[]>;
};

type AggregateRow = {
  label: string;
  count: number;
  totalRealityAmount: number;
  totalStoredAmount: number;
  totalDonateAmount: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function tryParseObject(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function resolveCardTypeLabel(raw: Record<string, unknown> | null): string {
  if (typeof raw?.CardTypeName === "string" && raw.CardTypeName.trim()) {
    return raw.CardTypeName.trim();
  }
  if (typeof raw?.CardTypeId === "string" && raw.CardTypeId.trim()) {
    return `卡型${raw.CardTypeId.trim()}`;
  }
  if (typeof raw?.Type === "number" && Number.isFinite(raw.Type)) {
    return `充值类型${raw.Type}`;
  }
  return "未标注卡型";
}

function resolveNameish(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    const keys = ["Name", "SalesName", "UserName", "RealName", "NickName", "Label"];
    for (const key of keys) {
      const candidate = object[key];
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return null;
}

function resolveSalesLabel(raw: Record<string, unknown> | null): string {
  const sales = raw?.Sales;
  if (Array.isArray(sales)) {
    const names = sales.map((entry) => resolveNameish(entry)).filter((value): value is string => Boolean(value));
    if (names.length > 0) {
      return names.join(" / ");
    }
  }
  return resolveNameish(sales) ?? "未标注客服";
}

function aggregateRows(
  rows: RechargeBillRecord[],
  labelOf: (raw: Record<string, unknown> | null) => string,
): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const row of rows) {
    if (row.antiFlag) {
      continue;
    }
    const label = labelOf(tryParseObject(row.rawJson));
    const current =
      map.get(label) ??
      ({
        label,
        count: 0,
        totalRealityAmount: 0,
        totalStoredAmount: 0,
        totalDonateAmount: 0,
      } satisfies AggregateRow);
    current.count += 1;
    current.totalRealityAmount += row.realityAmount;
    current.totalStoredAmount += row.totalAmount;
    current.totalDonateAmount += row.donateAmount;
    map.set(label, current);
  }
  return [...map.values()];
}

function sortRows(rows: AggregateRow[], text: string): AggregateRow[] {
  const byAverage = /(人均|平均|客单)/u.test(text);
  return [...rows].sort((left, right) => {
    const leftScore =
      byAverage && left.count > 0 ? left.totalRealityAmount / left.count : left.totalRealityAmount;
    const rightScore =
      byAverage && right.count > 0 ? right.totalRealityAmount / right.count : right.totalRealityAmount;
    return (
      rightScore - leftScore ||
      right.totalStoredAmount - left.totalStoredAmount ||
      right.count - left.count
    );
  });
}

function renderCardTypeAnalysis(storeName: string, label: string, rows: RechargeBillRecord[], text: string): string {
  const stats = sortRows(aggregateRows(rows, resolveCardTypeLabel), text);
  const lines = [`${storeName}${label}充值卡型结构`];
  if (stats.length === 0) {
    lines.push("- 当前时间段没有可用于卡型充值分析的记录。");
    return lines.join("\n");
  }
  const top = stats[0]!;
  lines.push(
    `- 充值最高卡型: ${top.label}，实充 ${formatCurrency(top.totalRealityAmount)}，赠送 ${formatCurrency(top.totalDonateAmount)}，共 ${top.count} 笔`,
  );
  lines.push(
    `- Top3: ${stats
      .slice(0, 3)
      .map(
        (row) =>
          `${row.label} 实充 ${formatCurrency(row.totalRealityAmount)}，人均 ${formatCurrency(row.totalRealityAmount / row.count)}`,
      )
      .join("；")}`,
  );
  lines.push("- 动作建议: 先看头部卡型是否过度依赖单一客服，再结合赠送金额判断促销力度是否偏高。");
  return lines.join("\n");
}

function renderSalesAnalysis(storeName: string, label: string, rows: RechargeBillRecord[], text: string): string {
  const stats = sortRows(
    aggregateRows(rows, resolveSalesLabel).filter((row) => row.label !== "未标注客服"),
    text,
  );
  const lines = [`${storeName}${label}充值客服归因`];
  if (stats.length === 0) {
    lines.push("- 当前时间段没有可用于客服充值归因的记录。");
    return lines.join("\n");
  }
  const top = stats[0]!;
  lines.push(
    `- 充值最高客服: ${top.label}，实充 ${formatCurrency(top.totalRealityAmount)}，赠送 ${formatCurrency(top.totalDonateAmount)}，共 ${top.count} 笔`,
  );
  lines.push(
    `- Top3: ${stats
      .slice(0, 3)
      .map(
        (row) =>
          `${row.label} 实充 ${formatCurrency(row.totalRealityAmount)}，人均 ${formatCurrency(row.totalRealityAmount / row.count)}`,
      )
      .join("；")}`,
  );
  lines.push("- 动作建议: 先对比头部客服的卡型结构和赠送强度，再复盘前台接待和储值收口话术是否可复制。");
  return lines.join("\n");
}

export async function executeRechargeAttributionQuery(params: {
  runtime: RechargeAttributionRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string> {
  if (!params.runtime.listRechargeBillsByDateRange) {
    return "当前环境还未接通充值卡型 / 客服归因分析能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "充值归因分析当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const frame =
    params.intent.timeFrame.kind === "single"
      ? {
          startBizDate: params.intent.timeFrame.bizDate,
          endBizDate: params.intent.timeFrame.bizDate,
          label: params.intent.timeFrame.label,
        }
      : {
          startBizDate: params.intent.timeFrame.startBizDate,
          endBizDate: params.intent.timeFrame.endBizDate,
          label: params.intent.timeFrame.label,
        };
  const rows = await params.runtime.listRechargeBillsByDateRange({
    orgId,
    startBizDate: frame.startBizDate,
    endBizDate: frame.endBizDate,
  });

  if (/(销售|前台|客服)/u.test(params.intent.rawText)) {
    return renderSalesAnalysis(storeName, frame.label, rows, params.intent.rawText);
  }
  return renderCardTypeAnalysis(storeName, frame.label, rows, params.intent.rawText);
}
