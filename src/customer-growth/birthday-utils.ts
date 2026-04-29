import { shiftBizDate } from "../time.js";
import type { CustomerPrimarySegment } from "../types.js";

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

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function resolveBirthdayMonthDay(rawJson: string): string | null {
  const parsed = tryParseObject(rawJson);
  const birthday = String(parsed?.Birthday ?? "").trim();
  if (!birthday) {
    return null;
  }
  const compact = birthday.replace(/\s+/gu, "");
  const numericMatch =
    compact.match(/(?:\d{4}[-/])?(\d{1,2})[-/](\d{1,2})/u) ??
    compact.match(/(\d{1,2})月(\d{1,2})日?/u);
  if (!numericMatch?.[1] || !numericMatch?.[2]) {
    return null;
  }
  const month = Number(numericMatch[1]);
  const day = Number(numericMatch[2]);
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return `${pad2(month)}-${pad2(day)}`;
}

function buildBirthdayDate(year: number, birthdayMonthDay: string): Date | null {
  const [monthRaw, dayRaw] = birthdayMonthDay.split("-");
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return candidate;
}

export function resolveNextBirthdayOccurrence(params: {
  bizDate: string;
  birthdayMonthDay: string | null;
}): {
  nextBirthdayBizDate: string | null;
  birthdayWindowDays: number | null;
} {
  if (!params.birthdayMonthDay) {
    return {
      nextBirthdayBizDate: null,
      birthdayWindowDays: null,
    };
  }
  const year = Number(params.bizDate.slice(0, 4));
  const baseDate = new Date(`${params.bizDate}T00:00:00Z`);
  let candidate = buildBirthdayDate(year, params.birthdayMonthDay);
  if (!candidate) {
    return {
      nextBirthdayBizDate: null,
      birthdayWindowDays: null,
    };
  }
  if (toIsoDate(candidate) < params.bizDate) {
    candidate = buildBirthdayDate(year + 1, params.birthdayMonthDay);
  }
  if (!candidate) {
    return {
      nextBirthdayBizDate: null,
      birthdayWindowDays: null,
    };
  }
  return {
    nextBirthdayBizDate: toIsoDate(candidate),
    birthdayWindowDays: Math.round((candidate.getTime() - baseDate.getTime()) / 86_400_000),
  };
}

export function resolveBirthdayBoostScore(params: {
  primarySegment: CustomerPrimarySegment;
  birthdayWindowDays: number | null;
}): number {
  const days = params.birthdayWindowDays;
  if (days === null || days < 0 || days > 7) {
    return 0;
  }
  let base = 0;
  if (days === 0) {
    base = 75;
  } else if (days <= 3) {
    base = 60;
  } else {
    base = 35;
  }
  if (params.primarySegment === "important-reactivation-member") {
    return base + 10;
  }
  if (params.primarySegment === "important-value-member") {
    return base + 5;
  }
  if (params.primarySegment === "potential-growth-customer") {
    return base + 3;
  }
  return base;
}

export function resolveBirthdayReasonLabel(birthdayWindowDays: number | null): string | null {
  if (birthdayWindowDays === null || birthdayWindowDays < 0 || birthdayWindowDays > 7) {
    return null;
  }
  if (birthdayWindowDays === 0) {
    return "今天生日";
  }
  return `${birthdayWindowDays}天后生日`;
}

export function buildTargetDateByMonthDay(params: {
  startBizDate: string;
  endBizDate: string;
}): Map<string, string> {
  const map = new Map<string, string>();
  for (let cursor = params.startBizDate; cursor <= params.endBizDate; cursor = shiftBizDate(cursor, 1)) {
    const monthDay = cursor.slice(5, 10);
    if (!map.has(monthDay)) {
      map.set(monthDay, cursor);
    }
  }
  return map;
}
