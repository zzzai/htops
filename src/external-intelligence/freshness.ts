export type ExternalFreshnessInput = {
  eventAt?: string;
  publishedAt?: string;
  hasMaterialUpdate?: boolean;
};

export type ExternalFreshnessOptions = {
  now?: string | Date;
  freshnessHours?: number;
};

export type ExternalFreshnessResult = {
  qualifies: boolean;
  reason:
    | "within-window"
    | "stale-without-update"
    | "stale-but-material-update"
    | "missing-reliable-time";
  referenceTimeIso?: string;
  ageHours?: number;
};

function parseTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

function resolveNow(value?: string | Date): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return new Date();
}

export function evaluateExternalFreshness(
  input: ExternalFreshnessInput,
  options: ExternalFreshnessOptions = {},
): ExternalFreshnessResult {
  const now = resolveNow(options.now);
  const freshnessHours = Math.max(1, Math.floor(options.freshnessHours ?? 72));
  const eventTime = parseTime(input.eventAt);
  const publishedTime = parseTime(input.publishedAt);
  const referenceTime = eventTime ?? publishedTime;

  if (!now || !referenceTime) {
    return {
      qualifies: false,
      reason: "missing-reliable-time",
    };
  }

  const ageHours = (now.getTime() - referenceTime.getTime()) / (60 * 60 * 1000);
  if (ageHours <= freshnessHours) {
    return {
      qualifies: true,
      reason: "within-window",
      referenceTimeIso: referenceTime.toISOString(),
      ageHours,
    };
  }

  const publishedAgeHours = publishedTime
    ? (now.getTime() - publishedTime.getTime()) / (60 * 60 * 1000)
    : Number.POSITIVE_INFINITY;
  if (input.hasMaterialUpdate && publishedAgeHours <= freshnessHours) {
    return {
      qualifies: true,
      reason: "stale-but-material-update",
      referenceTimeIso: referenceTime.toISOString(),
      ageHours,
    };
  }

  return {
    qualifies: false,
    reason: "stale-without-update",
    referenceTimeIso: referenceTime.toISOString(),
    ageHours,
  };
}
