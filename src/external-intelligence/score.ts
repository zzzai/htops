import type { HetangExternalSourceTier } from "../types.js";

export type ExternalScoreInput = {
  theme: string;
  sourceTiers: HetangExternalSourceTier[];
  freshness: {
    qualifies: boolean;
    reason: string;
  };
  blockedReason?: string;
  summary?: string;
};

export type ExternalScoreResult = {
  totalScore: number;
  threshold: number;
  passesThreshold: boolean;
  breakdown: {
    freshness: number;
    sourceCredibility: number;
    themeRelevance: number;
    summaryCompleteness: number;
    penalties: number;
  };
};

const SCORE_THRESHOLD = 60;

function strongestTier(sourceTiers: HetangExternalSourceTier[]): HetangExternalSourceTier {
  if (sourceTiers.includes("s")) {
    return "s";
  }
  if (sourceTiers.includes("a")) {
    return "a";
  }
  if (sourceTiers.includes("b")) {
    return "b";
  }
  return "blocked";
}

function scoreThemeRelevance(theme: string): number {
  switch (theme) {
    case "pricing-competition":
      return 15;
    case "chain-brand":
      return 13;
    case "platform-rule":
      return 12;
    case "strategy-organization":
      return 10;
    default:
      return 8;
  }
}

function scoreSourceCredibility(tier: HetangExternalSourceTier): number {
  switch (tier) {
    case "s":
      return 20;
    case "a":
      return 16;
    case "b":
      return 8;
    default:
      return 0;
  }
}

function scoreFreshness(reason: string, qualifies: boolean): number {
  if (!qualifies) {
    return 0;
  }
  if (reason === "stale-but-material-update") {
    return 18;
  }
  if (reason === "within-window") {
    return 25;
  }
  return 20;
}

function scorePenalties(blockedReason: string | undefined): number {
  switch (blockedReason) {
    case "blocked-soft-article":
      return -40;
    case "blocked-old-news-resurfacing":
      return -30;
    case "needs-source-confirmation":
      return -25;
    default:
      return 0;
  }
}

export function scoreExternalEvent(input: ExternalScoreInput): ExternalScoreResult {
  const tier = strongestTier(input.sourceTiers);
  const freshness = scoreFreshness(input.freshness.reason, input.freshness.qualifies);
  const sourceCredibility = scoreSourceCredibility(tier);
  const themeRelevance = scoreThemeRelevance(input.theme);
  const summaryCompleteness = input.summary && input.summary.trim().length >= 12 ? 10 : 4;
  const penalties = scorePenalties(input.blockedReason);
  const totalScore =
    freshness + sourceCredibility + themeRelevance + summaryCompleteness + penalties;

  return {
    totalScore,
    threshold: SCORE_THRESHOLD,
    passesThreshold: totalScore >= SCORE_THRESHOLD,
    breakdown: {
      freshness,
      sourceCredibility,
      themeRelevance,
      summaryCompleteness,
      penalties,
    },
  };
}
