import type { SyncWindow } from "./types.js";

const DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME = "03:00";

function padNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function getDateTimeParts(date: Date, timeZone: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
}

export function formatDateTimeInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = getDateTimeParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function shiftBizDate(dateString: string, days: number): string {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseCutoffLocalTime(cutoffLocalTime: string): { hour: number; minute: number } {
  const match = cutoffLocalTime.match(/^(\d{2}):(\d{2})$/u);
  if (!match) {
    throw new Error(`Invalid cutoffLocalTime: ${cutoffLocalTime}`);
  }
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function formatUtcDateTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function parseLocalTimestamp(
  value: string,
): { date: string; hour?: number; minute?: number; second?: number } | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/u);
  if (!match) {
    return null;
  }
  return {
    date: match[1],
    hour: match[2] === undefined ? undefined : Number(match[2]),
    minute: match[3] === undefined ? undefined : Number(match[3]),
    second: match[4] === undefined ? undefined : Number(match[4]),
  };
}

export function resolveIncrementalWindow(params: {
  now: Date;
  timeZone: string;
  lastSuccessAt?: string | null;
  overlapDays: number;
  initialBackfillDays: number;
}): SyncWindow {
  const end = new Date(params.now);
  const start = params.lastSuccessAt
    ? addDays(new Date(params.lastSuccessAt), -params.overlapDays)
    : addDays(new Date(params.now), -params.initialBackfillDays);

  return {
    start,
    end,
    startTime: formatDateTimeInTimeZone(start, params.timeZone),
    endTime: formatDateTimeInTimeZone(end, params.timeZone),
  };
}

export function resolveReportBizDate(params: {
  now: Date;
  timeZone: string;
  cutoffLocalTime?: string;
}): string {
  return resolvePreviousOperationalBizDate(params);
}

export function resolveOperationalBizDateWindow(params: {
  bizDate: string;
  cutoffLocalTime?: string;
}): Pick<SyncWindow, "startTime" | "endTime"> {
  const cutoff = parseCutoffLocalTime(
    params.cutoffLocalTime ?? DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
  );
  const cutoffWithSeconds = `${padNumber(cutoff.hour)}:${padNumber(cutoff.minute)}:00`;
  const nextBizDate = shiftBizDate(params.bizDate, 1);
  const end = new Date(`${nextBizDate}T${cutoffWithSeconds}Z`);
  end.setUTCSeconds(end.getUTCSeconds() - 1);

  return {
    startTime: `${params.bizDate} ${cutoffWithSeconds}`,
    endTime: formatUtcDateTime(end),
  };
}

export function resolveOperationalBizDateCompletionIso(params: {
  bizDate: string;
  timeZone: string;
  cutoffLocalTime?: string;
}): string {
  const cutoff = parseCutoffLocalTime(
    params.cutoffLocalTime ?? DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
  );
  const nextBizDate = shiftBizDate(params.bizDate, 1);
  const offset = resolveOffsetForTimeZone(new Date(`${nextBizDate}T00:00:00Z`), params.timeZone);
  return `${nextBizDate}T${padNumber(cutoff.hour)}:${padNumber(cutoff.minute)}:00${offset}`;
}

export function resolveOperationalBizDateRangeWindow(params: {
  startBizDate: string;
  endBizDate: string;
  cutoffLocalTime?: string;
}): Pick<SyncWindow, "startTime" | "endTime"> {
  if (params.startBizDate > params.endBizDate) {
    throw new Error("startBizDate must be on or before endBizDate");
  }
  const startWindow = resolveOperationalBizDateWindow({
    bizDate: params.startBizDate,
    cutoffLocalTime: params.cutoffLocalTime,
  });
  const nextBizDate = shiftBizDate(params.endBizDate, 1);
  const endWindow = resolveOperationalBizDateWindow({
    bizDate: nextBizDate,
    cutoffLocalTime: params.cutoffLocalTime,
  });
  const exclusiveEnd = new Date(`${endWindow.startTime.replace(" ", "T")}Z`);
  exclusiveEnd.setUTCSeconds(exclusiveEnd.getUTCSeconds() - 1);

  return {
    startTime: startWindow.startTime,
    endTime: formatUtcDateTime(exclusiveEnd),
  };
}

export function resolvePreviousOperationalBizDate(params: {
  now: Date;
  timeZone: string;
  cutoffLocalTime?: string;
}): string {
  return shiftBizDate(
    resolveOperationalBizDate({
      now: params.now,
      timeZone: params.timeZone,
      cutoffLocalTime: params.cutoffLocalTime ?? DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
    }),
    -1,
  );
}

export function resolveLocalTime(date: Date, timeZone: string): string {
  const parts = getDateTimeParts(date, timeZone);
  return `${parts.hour}:${parts.minute}`;
}

export function resolveLocalDate(date: Date, timeZone: string): string {
  return formatDateInTimeZone(date, timeZone);
}

function resolveOffsetForTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  });
  const timeZoneName = formatter
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;
  const match = timeZoneName?.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/u);
  if (!match) {
    return "Z";
  }
  const hours = match[1].replace(/([+-])(\d)$/u, "$10$2");
  const minutes = match[2] ?? "00";
  return `${hours}:${minutes}`;
}

export function resolveLocalDayStartIso(date: Date, timeZone: string): string {
  return `${formatDateInTimeZone(date, timeZone)}T00:00:00${resolveOffsetForTimeZone(date, timeZone)}`;
}

export function extractBizDate(
  value: string | undefined,
  timeZone: string,
  fallbackNow: Date,
  cutoffLocalTime = DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
): string {
  if (typeof value === "string" && value.trim().length >= 10) {
    return resolveOperationalBizDateFromTimestamp(value, timeZone, cutoffLocalTime);
  }
  return resolveOperationalBizDate({
    now: fallbackNow,
    timeZone,
    cutoffLocalTime,
  });
}

export function resolveOperationalBizDateFromTimestamp(
  value: string,
  timeZone: string,
  cutoffLocalTime = DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
): string {
  void timeZone;
  const parsed = parseLocalTimestamp(value);
  if (!parsed) {
    return value.trim().slice(0, 10);
  }
  if (parsed.hour === undefined || parsed.minute === undefined) {
    return parsed.date;
  }
  const cutoff = parseCutoffLocalTime(cutoffLocalTime);
  if (parsed.hour < cutoff.hour || (parsed.hour === cutoff.hour && parsed.minute < cutoff.minute)) {
    return shiftBizDate(parsed.date, -1);
  }
  return parsed.date;
}

export function resolveOperationalBizDate(params: {
  now: Date;
  timeZone: string;
  cutoffLocalTime?: string;
}): string {
  return resolveOperationalBizDateFromTimestamp(
    formatDateTimeInTimeZone(params.now, params.timeZone),
    params.timeZone,
    params.cutoffLocalTime ?? DEFAULT_BUSINESS_DAY_CUTOFF_LOCAL_TIME,
  );
}
