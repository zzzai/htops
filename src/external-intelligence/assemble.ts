export type ExternalBriefAssemblyInput = {
  cardId: string;
  title: string;
  entity: string;
  theme: string;
  sourceIds: string[];
  score: number;
  summary: string;
  whyItMatters: string;
  publishedAt: string;
};

export type AssembledExternalBriefItem = ExternalBriefAssemblyInput & {
  rank: number;
  bucket: "generalHotTopic" | "chainBrand" | "strategyPlatform";
};

export type AssembledExternalBrief = {
  items: AssembledExternalBriefItem[];
  metrics: {
    countsByBucket: {
      generalHotTopic: number;
      chainBrand: number;
      strategyPlatform: number;
    };
    skippedLowQuality: number;
  };
};

const BUCKET_TARGETS = {
  generalHotTopic: 4,
  chainBrand: 3,
  strategyPlatform: 3,
} as const;

const QUALITY_THRESHOLD = 60;
const MAX_PER_SOURCE = 2;
const MAX_PER_ENTITY = 2;

function mapThemeToBucket(theme: string): "generalHotTopic" | "chainBrand" | "strategyPlatform" {
  if (theme === "chain-brand" || theme === "pricing-competition") {
    return "chainBrand";
  }
  if (theme === "strategy-organization" || theme === "platform-rule") {
    return "strategyPlatform";
  }
  return "generalHotTopic";
}

export function assembleTopExternalBrief(
  events: ExternalBriefAssemblyInput[],
): AssembledExternalBrief {
  const countsByBucket = {
    generalHotTopic: 0,
    chainBrand: 0,
    strategyPlatform: 0,
  };
  const sourceUsage = new Map<string, number>();
  const entityUsage = new Map<string, number>();
  let skippedLowQuality = 0;

  const sorted = [...events].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return right.publishedAt.localeCompare(left.publishedAt);
  });

  const selected: AssembledExternalBriefItem[] = [];
  for (const event of sorted) {
    if (event.score < QUALITY_THRESHOLD) {
      skippedLowQuality += 1;
      continue;
    }
    const bucket = mapThemeToBucket(event.theme);
    if (countsByBucket[bucket] >= BUCKET_TARGETS[bucket]) {
      continue;
    }
    const maxSourceUsage = Math.max(
      0,
      ...event.sourceIds.map((sourceId) => sourceUsage.get(sourceId) ?? 0),
    );
    if (maxSourceUsage >= MAX_PER_SOURCE) {
      continue;
    }
    if ((entityUsage.get(event.entity) ?? 0) >= MAX_PER_ENTITY) {
      continue;
    }

    countsByBucket[bucket] += 1;
    entityUsage.set(event.entity, (entityUsage.get(event.entity) ?? 0) + 1);
    for (const sourceId of event.sourceIds) {
      sourceUsage.set(sourceId, (sourceUsage.get(sourceId) ?? 0) + 1);
    }
    selected.push({
      ...event,
      bucket,
      rank: selected.length + 1,
    });
  }

  return {
    items: selected,
    metrics: {
      countsByBucket,
      skippedLowQuality,
    },
  };
}
