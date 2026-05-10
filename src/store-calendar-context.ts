import type { HetangStoreExternalContextEntry } from "./types.js";

type HolidayContextEntryWrite = {
  orgId: string;
  snapshotDate: string;
  contextKind: HetangStoreExternalContextEntry["contextKind"];
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  truthLevel: HetangStoreExternalContextEntry["truthLevel"];
  confidence: HetangStoreExternalContextEntry["confidence"];
  sourceType: string;
  sourceLabel?: string;
  sourceUri?: string;
  applicableModules?: string[];
  notForScoring?: boolean;
  note?: string;
  rawJson?: string;
  updatedAt: string;
};

export type HolidayOverrides = {
  holidayDates: Map<string, string>;
  workdayDates: Map<string, string>;
};

export type ChineseHolidayClassification = {
  date: string;
  dayType: "workday" | "weekend" | "holiday" | "adjusted_workday";
  isPublicHoliday: boolean;
  isWeekend: boolean;
  holidayName?: string;
};

const AI_CONTEXT_MODULES = ["analysis_explanation", "store_advice", "daily_report", "pain_signal_diagnosis"];

const FIXED_HOLIDAYS = new Map<string, string>([
  ["01-01", "元旦"],
  ["05-01", "劳动节"],
  ["10-01", "国庆节"],
  ["10-02", "国庆节"],
  ["10-03", "国庆节"],
]);

function parseDate(date: string): Date {
  const parsed = new Date(`${date}T00:00:00+08:00`);
  if (Number.isNaN(parsed.getTime()) || !/^\d{4}-\d{2}-\d{2}$/u.test(date)) {
    throw new Error(`Invalid date: ${date}`);
  }
  return parsed;
}

function parseDateMap(value?: string): Map<string, string> {
  const result = new Map<string, string>();
  if (!value?.trim()) {
    return result;
  }
  for (const token of value.split(",")) {
    const [date, label] = token.split(":");
    const normalizedDate = date?.trim();
    if (!normalizedDate) {
      continue;
    }
    parseDate(normalizedDate);
    result.set(normalizedDate, label?.trim() || "手动维护");
  }
  return result;
}

export function parseManualHolidayOverrides(params: {
  holidayDates?: string;
  workdayDates?: string;
}): HolidayOverrides {
  return {
    holidayDates: parseDateMap(params.holidayDates),
    workdayDates: parseDateMap(params.workdayDates),
  };
}

export function classifyChineseHolidayDate(
  date: string,
  overrides: HolidayOverrides = { holidayDates: new Map(), workdayDates: new Map() },
): ChineseHolidayClassification {
  const parsed = parseDate(date);
  const manualWorkday = overrides.workdayDates.get(date);
  if (manualWorkday) {
    return {
      date,
      dayType: "adjusted_workday",
      isPublicHoliday: false,
      isWeekend: false,
      holidayName: manualWorkday,
    };
  }
  const manualHoliday = overrides.holidayDates.get(date);
  if (manualHoliday) {
    return {
      date,
      dayType: "holiday",
      isPublicHoliday: true,
      isWeekend: false,
      holidayName: manualHoliday,
    };
  }
  const monthDay = date.slice(5);
  const fixedHoliday = FIXED_HOLIDAYS.get(monthDay);
  if (fixedHoliday) {
    return {
      date,
      dayType: "holiday",
      isPublicHoliday: true,
      isWeekend: false,
      holidayName: fixedHoliday,
    };
  }
  const day = parsed.getDay();
  const isWeekend = day === 0 || day === 6;
  return {
    date,
    dayType: isWeekend ? "weekend" : "workday",
    isPublicHoliday: false,
    isWeekend,
  };
}

function makeEntry(params: {
  orgId: string;
  snapshotDate: string;
  metricKey: string;
  valueText?: string;
  valueNum?: number;
  valueJson?: unknown;
  unit?: string;
  updatedAt: string;
  classification: ChineseHolidayClassification;
}): HolidayContextEntryWrite {
  return {
    orgId: params.orgId,
    snapshotDate: params.snapshotDate,
    contextKind: "estimated_market_context",
    metricKey: params.metricKey,
    valueText: params.valueText,
    valueNum: params.valueNum,
    valueJson: params.valueJson,
    unit: params.unit,
    truthLevel: "estimated",
    confidence: "medium",
    sourceType: "chinese_calendar_rules",
    sourceLabel: "China Calendar Rules + Manual Overrides",
    applicableModules: AI_CONTEXT_MODULES,
    notForScoring: true,
    note: "中国节假日/周末/调休上下文。法定节假日以手动覆盖优先，固定节日和周末规则兜底。",
    rawJson: JSON.stringify({
      provider: "manual_calendar_rules",
      classification: params.classification,
    }),
    updatedAt: params.updatedAt,
  };
}

export function buildHolidayContextEntries(params: {
  stores: Array<{ orgId: string; storeName: string }>;
  snapshotDate: string;
  updatedAt: string;
  overrides?: HolidayOverrides;
}): HolidayContextEntryWrite[] {
  const classification = classifyChineseHolidayDate(params.snapshotDate, params.overrides);
  const rows: HolidayContextEntryWrite[] = [];
  for (const store of params.stores) {
    rows.push(
      makeEntry({
        orgId: store.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "calendar_day_type",
        valueText: classification.dayType,
        unit: "text",
        updatedAt: params.updatedAt,
        classification,
      }),
      makeEntry({
        orgId: store.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "is_public_holiday",
        valueNum: classification.isPublicHoliday ? 1 : 0,
        unit: "boolean",
        updatedAt: params.updatedAt,
        classification,
      }),
      makeEntry({
        orgId: store.orgId,
        snapshotDate: params.snapshotDate,
        metricKey: "is_weekend",
        valueNum: classification.isWeekend ? 1 : 0,
        unit: "boolean",
        updatedAt: params.updatedAt,
        classification,
      }),
    );
    if (classification.holidayName) {
      rows.push(
        makeEntry({
          orgId: store.orgId,
          snapshotDate: params.snapshotDate,
          metricKey: "holiday_name",
          valueText: classification.holidayName,
          unit: "text",
          updatedAt: params.updatedAt,
          classification,
        }),
      );
    }
  }
  return rows;
}
