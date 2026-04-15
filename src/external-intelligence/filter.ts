import type { HetangExternalSourceTier } from "../types.js";

export type ExternalFilterReason =
  | "blocked-source-tier"
  | "needs-source-confirmation"
  | "blocked-course-promo"
  | "blocked-soft-article"
  | "blocked-old-news-resurfacing"
  | "blocked-missing-reliable-time"
  | "blocked-stale";

export type ExternalFilterDecision = {
  accepted: boolean;
  reason?: ExternalFilterReason;
  stage?: "lead" | "candidate";
};

export type ExternalFilterInput = {
  sourceTier: HetangExternalSourceTier;
  sourceId?: string;
  title?: string;
  summary?: string;
  contentText?: string;
  publishedAt?: string;
  eventAt?: string;
  fetchedAt?: string;
  hasMaterialUpdate?: boolean;
};

export type ExternalFilterOptions = {
  now?: Date;
  freshnessHours?: number;
};

export type ExternalFilterResult = {
  decision: ExternalFilterDecision;
  referenceTimeIso?: string;
  ageHours?: number;
};

export const COURSE_PROMO_KEYWORDS = ["开班", "大课", "训练营", "赋能课", "招生", "报名", "课程"];

export const SOFT_ARTICLE_KEYWORDS = [
  "咨询",
  "方法论",
  "深度服务",
  "论坛演讲实录",
  "战略合伙人",
  "管理升级之道",
  "驻场",
];

function includesAny(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}

function parseReliableTime(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

export function filterExternalCandidate(
  input: ExternalFilterInput,
  options: ExternalFilterOptions = {},
): ExternalFilterResult {
  const now = options.now ?? new Date();
  const freshnessHours = Math.max(1, Math.floor(options.freshnessHours ?? 72));
  const sourceTier = input.sourceTier;
  const publishedAt = parseReliableTime(input.publishedAt);
  const eventAt = parseReliableTime(input.eventAt);
  const text =
    `${input.title ?? ""} ${input.summary ?? ""} ${input.contentText ?? ""}`.toLowerCase();

  if (sourceTier === "blocked") {
    return {
      decision: {
        accepted: false,
        reason: "blocked-source-tier",
      },
    };
  }

  if (includesAny(text, COURSE_PROMO_KEYWORDS)) {
    return {
      decision: {
        accepted: false,
        reason: "blocked-course-promo",
      },
    };
  }

  if (includesAny(text, SOFT_ARTICLE_KEYWORDS)) {
    return {
      decision: {
        accepted: false,
        reason: "blocked-soft-article",
      },
    };
  }

  if (!publishedAt && !eventAt) {
    return {
      decision: {
        accepted: false,
        reason: "blocked-missing-reliable-time",
      },
    };
  }

  const referenceTime = eventAt ?? publishedAt ?? now;
  const ageHours = (now.getTime() - referenceTime.getTime()) / (60 * 60 * 1000);

  if (
    eventAt &&
    publishedAt &&
    ageHours > freshnessHours &&
    (now.getTime() - publishedAt.getTime()) / (60 * 60 * 1000) <= freshnessHours &&
    !input.hasMaterialUpdate
  ) {
    return {
      decision: {
        accepted: false,
        reason: "blocked-old-news-resurfacing",
      },
      referenceTimeIso: referenceTime.toISOString(),
      ageHours,
    };
  }

  if (ageHours > freshnessHours && !input.hasMaterialUpdate) {
    return {
      decision: {
        accepted: false,
        reason: "blocked-stale",
      },
      referenceTimeIso: referenceTime.toISOString(),
      ageHours,
    };
  }

  if (sourceTier === "b") {
    return {
      decision: {
        accepted: true,
        stage: "lead",
        reason: "needs-source-confirmation",
      },
      referenceTimeIso: referenceTime.toISOString(),
      ageHours,
    };
  }

  return {
    decision: {
      accepted: true,
      stage: "candidate",
    },
    referenceTimeIso: referenceTime.toISOString(),
    ageHours,
  };
}
