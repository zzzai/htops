import type {
  CustomerOperatingProfileDailyRecord,
  MemberReactivationTouchWindowLabel,
} from "../types.js";

export type MemberActionProfileBridge = {
  memberId?: string;
  customerIdentityKey: string;
  serviceNeed?: string;
  interactionStyle?: string;
  preferredTouchDaypart: string | null;
  preferredChannel?: string;
  preferredTechName?: string;
  confidenceDiscount: number;
  confidenceFactor: number;
  actionBoostScore: number;
  reasonTags: string[];
  touchHints: string[];
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readText(value: Record<string, unknown>, key: string): string | undefined {
  const raw = value[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
}

function readNumber(value: Record<string, unknown>, key: string): number | undefined {
  const raw = value[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function normalizeTouchDaypart(value?: string): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return null;
  }
  if (
    normalized === "late-night" ||
    normalized === "night" ||
    normalized.includes("夜") ||
    normalized.includes("深夜")
  ) {
    return "late-night";
  }
  if (
    normalized === "after-work" ||
    normalized.includes("晚") ||
    normalized.includes("下班")
  ) {
    return "after-work";
  }
  if (
    normalized === "afternoon" ||
    normalized.includes("午") ||
    normalized.includes("下午")
  ) {
    return "afternoon";
  }
  if (normalized === "overnight" || normalized.includes("凌晨")) {
    return "overnight";
  }
  return normalized;
}

function normalizeChannel(value?: string): string | undefined {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    return undefined;
  }
  if (/(企微|微信)/u.test(normalized)) {
    return "企微";
  }
  if (/电话|致电/u.test(normalized)) {
    return "电话";
  }
  if (/短信/u.test(normalized)) {
    return "短信";
  }
  return normalized;
}

export function buildMemberActionProfileBridge(
  profile: CustomerOperatingProfileDailyRecord | undefined,
): MemberActionProfileBridge | null {
  if (!profile) {
    return null;
  }

  const serviceNeedProfile = asObject(profile.serviceNeedProfileJson);
  const interactionProfile = asObject(profile.interactionProfileJson);
  const preferenceProfile = asObject(profile.preferenceProfileJson);
  const scenarioProfile = asObject(profile.scenarioProfileJson);
  const relationshipProfile = asObject(profile.relationshipProfileJson);

  const serviceNeed = readText(serviceNeedProfile, "primary_need");
  const interactionStyle = readText(interactionProfile, "communication_style");
  const preferredTouchDaypart = normalizeTouchDaypart(
    readText(preferenceProfile, "preferred_daypart") ??
      readText(scenarioProfile, "dominant_visit_daypart"),
  );
  const preferredChannel = normalizeChannel(readText(preferenceProfile, "preferred_channel"));
  const preferredTechName =
    readText(preferenceProfile, "preferred_tech_name") ??
    readText(relationshipProfile, "top_tech_name");

  const confidenceDiscounts = [
    readNumber(serviceNeedProfile, "confidence_discount"),
    readNumber(interactionProfile, "confidence_discount"),
    readNumber(preferenceProfile, "confidence_discount"),
    readNumber(preferenceProfile, "preferred_channel_confidence_discount"),
  ].filter((value): value is number => value !== undefined);
  const confidenceDiscount = round(
    clamp(confidenceDiscounts.length > 0 ? Math.max(...confidenceDiscounts) : 0, 0, 0.85),
    4,
  );
  const confidenceFactor = round(clamp(1 - confidenceDiscount, 0.15, 1), 4);

  const reasonTags: string[] = [];
  const touchHints: string[] = [];
  let boostScore = 0;

  if (serviceNeed) {
    reasonTags.push("服务诉求:" + serviceNeed);
    touchHints.push("话术先围绕" + serviceNeed);
    boostScore += 6 * confidenceFactor;
  }
  if (preferredTouchDaypart) {
    touchHints.push("优先" + preferredTouchDaypart + "时段触达");
    boostScore += 4 * confidenceFactor;
  }
  if (preferredTechName) {
    reasonTags.push("技师关系:" + preferredTechName);
    touchHints.push("优先从" + preferredTechName + "切回");
    boostScore += 5 * confidenceFactor;
  }
  if (preferredChannel) {
    touchHints.push("优先" + preferredChannel + "1对1");
    boostScore += 3 * confidenceFactor;
  }
  if (interactionStyle) {
    reasonTags.push("互动风格:" + interactionStyle);
  }

  if (boostScore <= 0) {
    return null;
  }

  return {
    memberId: profile.memberId,
    customerIdentityKey: profile.customerIdentityKey,
    serviceNeed,
    interactionStyle,
    preferredTouchDaypart,
    preferredChannel,
    preferredTechName,
    confidenceDiscount,
    confidenceFactor,
    actionBoostScore: round(clamp(boostScore, 0, 18), 1),
    reasonTags,
    touchHints,
  };
}

export function buildMemberActionProfileBridgeIndex(
  rows: CustomerOperatingProfileDailyRecord[],
): Map<string, MemberActionProfileBridge> {
  const index = new Map<string, MemberActionProfileBridge>();
  for (const row of rows) {
    const bridge = buildMemberActionProfileBridge(row);
    if (!bridge) {
      continue;
    }
    if (row.memberId) {
      index.set("member:" + row.memberId, bridge);
    }
    index.set("identity:" + row.customerIdentityKey, bridge);
  }
  return index;
}

export function resolveMemberActionProfileBridge(params: {
  bridgeIndex: Map<string, MemberActionProfileBridge>;
  memberId: string;
  customerIdentityKey: string;
}): MemberActionProfileBridge | null {
  return (
    params.bridgeIndex.get("member:" + params.memberId) ??
    params.bridgeIndex.get("identity:" + params.customerIdentityKey) ??
    null
  );
}

function resolveBizWeekday(bizDate: string): string {
  const weekday = new Date(bizDate + "T00:00:00Z").getUTCDay();
  switch (weekday) {
    case 0:
      return "sunday";
    case 1:
      return "monday";
    case 2:
      return "tuesday";
    case 3:
      return "wednesday";
    case 4:
      return "thursday";
    case 5:
      return "friday";
    default:
      return "saturday";
  }
}

export function applyMemberActionProfileBridgeToStrategy(params: {
  bizDate: string;
  recommendedTouchWeekday: string | null;
  recommendedTouchDaypart: string | null;
  touchWindowMatchScore: number;
  touchWindowLabel: MemberReactivationTouchWindowLabel;
  baseStrategyPriorityScore: number;
  bridge: MemberActionProfileBridge | null;
}): {
  recommendedTouchDaypart: string | null;
  touchWindowMatchScore: number;
  touchWindowLabel: MemberReactivationTouchWindowLabel;
  strategyPriorityScore: number;
} {
  if (!params.bridge) {
    return {
      recommendedTouchDaypart: params.recommendedTouchDaypart,
      touchWindowMatchScore: params.touchWindowMatchScore,
      touchWindowLabel: params.touchWindowLabel,
      strategyPriorityScore: params.baseStrategyPriorityScore,
    };
  }

  let recommendedTouchDaypart = params.recommendedTouchDaypart;
  let touchWindowMatchScore = params.touchWindowMatchScore;
  let touchWindowLabel = params.touchWindowLabel;

  const touchBoost = round(clamp(params.bridge.actionBoostScore / 60, 0, 0.3), 4);
  if (params.bridge.preferredTouchDaypart) {
    if (!recommendedTouchDaypart) {
      recommendedTouchDaypart = params.bridge.preferredTouchDaypart;
      touchWindowMatchScore = round(clamp(touchWindowMatchScore + touchBoost, 0, 1), 4);
      if (params.recommendedTouchWeekday) {
        touchWindowLabel =
          params.recommendedTouchWeekday === resolveBizWeekday(params.bizDate)
            ? "best-today"
            : "best-this-week";
      }
    } else if (recommendedTouchDaypart === params.bridge.preferredTouchDaypart) {
      touchWindowMatchScore = round(clamp(touchWindowMatchScore + touchBoost * 0.6, 0, 1), 4);
    }
  }

  return {
    recommendedTouchDaypart,
    touchWindowMatchScore,
    touchWindowLabel,
    strategyPriorityScore: round(params.baseStrategyPriorityScore + params.bridge.actionBoostScore, 1),
  };
}
