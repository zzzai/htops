import type { HetangQueryIntent } from "./query-intent.js";
import type { HetangOpsConfig, TechUpClockRecord } from "./types.js";

type WaitExperienceRuntime = {
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
};

type WaitRecord = {
  techName: string;
  waitTime: number;
  roomCode?: string;
  clockKind: "point" | "queue" | "other";
  timeBucket: string;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
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

function resolveHour(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\b(\d{2}):\d{2}(?::\d{2})?\b/u);
  if (!match?.[1]) {
    return null;
  }
  const hour = Number(match[1]);
  return Number.isFinite(hour) ? hour : null;
}

function classifyTimeBucket(hour: number | null): string {
  if (hour === null) {
    return "未知时段";
  }
  if (hour < 12) {
    return "上午";
  }
  if (hour < 18) {
    return "午场";
  }
  return "晚场";
}

function parseDateTimeLike(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/u,
  );
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second = "00"] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
}

function resolveWaitMinutes(row: TechUpClockRecord, raw: Record<string, unknown> | null): number | null {
  const direct = Number(raw?.WaitTime);
  if (Number.isFinite(direct) && direct >= 0) {
    return direct;
  }

  const waitStart = parseDateTimeLike(raw?.WaitTime);
  const serviceStart = parseDateTimeLike(raw?.STime) ?? parseDateTimeLike(row.ctime);
  if (waitStart === null || serviceStart === null) {
    return null;
  }
  const minutes = (serviceStart - waitStart) / 60_000;
  if (!Number.isFinite(minutes) || minutes < 0) {
    return null;
  }
  return minutes;
}

function resolveClockKind(row: TechUpClockRecord, raw: Record<string, unknown> | null): "point" | "queue" | "other" {
  const source = String(raw?.ClockType ?? row.clockType ?? "")
    .trim()
    .toLowerCase();
  if (source === "2" || source === "点钟" || source === "point" || source === "pointclock") {
    return "point";
  }
  if (source === "1" || source === "排钟" || source === "轮钟" || source === "wheel" || source === "wheelclock") {
    return "queue";
  }
  return "other";
}

function collectWaitRows(rows: TechUpClockRecord[]): WaitRecord[] {
  const waitRows: WaitRecord[] = [];
  for (const row of rows) {
    const parsed = tryParseObject(row.rawJson);
    const waitTime = resolveWaitMinutes(row, parsed);
    if (waitTime === null || !Number.isFinite(waitTime) || waitTime < 0) {
      continue;
    }
    waitRows.push({
      techName: row.personName,
      waitTime,
      roomCode: typeof parsed?.RoomCode === "string" ? parsed.RoomCode : undefined,
      clockKind: resolveClockKind(row, parsed),
      timeBucket: classifyTimeBucket(resolveHour(row.settleTime ?? row.ctime)),
    });
  }
  return waitRows;
}

function summarizeAverage(records: WaitRecord[]): number {
  if (records.length === 0) {
    return 0;
  }
  return records.reduce((sum, row) => sum + row.waitTime, 0) / records.length;
}

function rankAverageByKey<T extends string>(records: WaitRecord[], keyOf: (row: WaitRecord) => T): Array<{
  key: T;
  averageWait: number;
  count: number;
}> {
  const stats = new Map<T, { total: number; count: number }>();
  for (const row of records) {
    const key = keyOf(row);
    const entry = stats.get(key) ?? { total: 0, count: 0 };
    entry.total += row.waitTime;
    entry.count += 1;
    stats.set(key, entry);
  }
  return [...stats.entries()]
    .map(([key, value]) => ({
      key,
      averageWait: value.count > 0 ? value.total / value.count : 0,
      count: value.count,
    }))
    .sort((left, right) => right.averageWait - left.averageWait || right.count - left.count);
}

export async function executeWaitExperienceQuery(params: {
  runtime: WaitExperienceRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string> {
  if (!params.runtime.listTechUpClockByDateRange) {
    return "当前环境还未接通等待体验分析能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "等待体验分析当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const frame =
    params.intent.timeFrame.kind === "single"
      ? {
          startBizDate: params.intent.timeFrame.bizDate,
          endBizDate: params.intent.timeFrame.bizDate,
        }
      : {
          startBizDate: params.intent.timeFrame.startBizDate,
          endBizDate: params.intent.timeFrame.endBizDate,
        };
  const rawRows = await params.runtime.listTechUpClockByDateRange({
    orgId,
    startBizDate: frame.startBizDate,
    endBizDate: frame.endBizDate,
  });
  const waitRows = collectWaitRows(rawRows);
  const lines = [`${storeName}${params.intent.timeFrame.label}等待体验`];

  if (waitRows.length === 0) {
    lines.push("- 当前没有可用于等待体验分析的候钟记录。");
    return lines.join("\n");
  }

  const overallAverage = summarizeAverage(waitRows);
  const timeBucketRanking = rankAverageByKey(waitRows, (row) => row.timeBucket);
  const techRanking = rankAverageByKey(waitRows, (row) => row.techName);
  const roomRanking = rankAverageByKey(waitRows.filter((row) => row.roomCode), (row) => row.roomCode!);
  const clockRanking = rankAverageByKey(waitRows, (row) =>
    row.clockKind === "point" ? "点钟" : row.clockKind === "queue" ? "排钟" : "其他",
  );

  const topBucket = timeBucketRanking[0];
  const topTech = techRanking[0];
  const topRoom = roomRanking[0];
  const pointWait = clockRanking.find((row) => row.key === "点钟");
  const queueWait = clockRanking.find((row) => row.key === "排钟");

  lines.push(`- 平均等待时长: ${round(overallAverage, 1).toFixed(1)} 分钟（${waitRows.length} 单）`);
  if (topBucket) {
    lines.push(`- 最长等待时段: ${topBucket.key}，均值 ${round(topBucket.averageWait, 1).toFixed(1)} 分钟`);
  }
  if (topTech) {
    lines.push(`- 等待最高技师: ${topTech.key}，均值 ${round(topTech.averageWait, 1).toFixed(1)} 分钟`);
  }
  if (topRoom) {
    lines.push(`- 等待异常房间: ${topRoom.key}，均值 ${round(topRoom.averageWait, 1).toFixed(1)} 分钟`);
  }
  if (pointWait || queueWait) {
    lines.push(
      `- 点钟/排钟等待: ${pointWait ? `${round(pointWait.averageWait, 1).toFixed(1)} 分钟` : "N/A"} / ${queueWait ? `${round(queueWait.averageWait, 1).toFixed(1)} 分钟` : "N/A"}`,
    );
  }

  if (/晚场/u.test(params.intent.rawText) && topBucket) {
    lines.push(
      topBucket.key === "晚场" && topBucket.averageWait > overallAverage
        ? "- 判断: 晚场等待偏长，建议优先检查晚场技师承接和房间切换节奏。"
        : "- 判断: 晚场等待没有明显高于全日均值。"
    );
  } else if (/(哪位技师|空档)/u.test(params.intent.rawText) && techRanking.length > 0) {
    lines.push(
      `- 技师等待Top3: ${techRanking
        .slice(0, 3)
        .map((row) => `${row.key} ${round(row.averageWait, 1).toFixed(1)} 分钟`)
        .join("；")}`,
    );
  } else if (/房间|包间/u.test(params.intent.rawText) && roomRanking.length > 0) {
    lines.push(
      `- 房间等待Top3: ${roomRanking
        .slice(0, 3)
        .map((row) => `${row.key} ${round(row.averageWait, 1).toFixed(1)} 分钟`)
        .join("；")}`,
    );
  }

  lines.push("- 动作建议: 先盯最长等待时段、等待最高技师和异常房间，再回看排钟节奏是否偏慢。");
  return lines.join("\n");
}
