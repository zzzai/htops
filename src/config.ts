import type {
  HetangAiLaneConfig,
  HetangAiLaneFallbackBehavior,
  HetangAiLaneId,
  HetangAiLaneReasoningMode,
  HetangAiLaneRegistryConfig,
  HetangAiLaneResponseMode,
  HetangExternalIntelligenceConfig,
  HetangInboundLinkReadersConfig,
  HetangExternalSourceConfig,
  HetangExternalSourceTier,
  HetangNotificationTarget,
  HetangOpsConfig,
  HetangStoreConfig,
} from "./types.js";

const DEFAULT_BASE_URL = "http://rept.qqinsoft.cn/api/thirdparty";
const DEFAULT_PAGE_SIZE = 200;
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_SEMANTIC_FALLBACK_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_SEMANTIC_FALLBACK_TIMEOUT_MS = 5_000;
const DEFAULT_SEMANTIC_FALLBACK_AUTO_ACCEPT_CONFIDENCE = 0.85;
const DEFAULT_SEMANTIC_FALLBACK_CLARIFY_CONFIDENCE = 0.7;
const DEFAULT_CUSTOMER_GROWTH_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_CUSTOMER_GROWTH_AI_TIMEOUT_MS = 5_000;
const DEFAULT_XIAOHONGSHU_LINK_TIMEOUT_MS = 45_000;
const DEFAULT_XIAOHONGSHU_LINK_BROWSER_TIMEOUT_MS = 45_000;
const DEFAULT_XIAOHONGSHU_LINK_ACCEPT_TEXT = "收到，正在读取。";
const DEFAULT_XIAOHONGSHU_LINK_MAX_CONTENT_CHARS = 1200;
const DEFAULT_CONVERSATION_QUALITY_INTENT_CLARIFIER_ENABLED = true;
const DEFAULT_CONVERSATION_QUALITY_INTENT_CLARIFIER_MAX_QUESTIONS_PER_TURN = 1;
const DEFAULT_CONVERSATION_QUALITY_REPLY_GUARD_ENABLED = true;
const DEFAULT_CONVERSATION_QUALITY_REPLY_GUARD_ALLOW_ONE_REPAIR_ATTEMPT = true;
const DEFAULT_CONVERSATION_QUALITY_CORRECTION_INTERRUPT_ENABLED = true;
const DEFAULT_CONVERSATION_QUALITY_CORRECTION_INTERRUPT_RECENT_TURN_TTL_MS = 180_000;
const DEFAULT_QUERY_POOL_MAX = 8;
const DEFAULT_SYNC_POOL_MAX = 4;
const DEFAULT_ANALYSIS_POOL_MAX = 4;
const DEFAULT_SERVICE_SCHEDULED_POLL_INTERVAL_MS = 60_000;
const DEFAULT_SERVICE_ANALYSIS_POLL_INTERVAL_MS = 10_000;
const DEFAULT_QUEUE_MAX_PENDING_ANALYSIS_JOBS_PER_ORG = 20;
const DEFAULT_INTEL_FRESHNESS_HOURS = 72;
const DEFAULT_INTEL_MAX_ITEMS_PER_ISSUE = 10;
const DEFAULT_INTEL_HQ_CHANNEL = "wecom";
const DEFAULT_INTEL_HQ_TARGET = "hetang-hq-intel";
const DEFAULT_INTEL_BRIEF_COMPOSITION = {
  generalHotTopic: 4,
  chainBrand: 3,
  strategyPlatform: 3,
};
const SUPPORTED_AI_LANE_IDS: readonly HetangAiLaneId[] = [
  "general-lite",
  "semantic-fallback",
  "customer-growth-json",
  "cheap-summary",
  "analysis-premium",
  "offline-review",
  "hq-premium",
  "world-model-explanation",
  "doctor-review",
];
const SUPPORTED_AI_LANE_REASONING_MODES: readonly HetangAiLaneReasoningMode[] = [
  "off",
  "low",
  "medium",
  "high",
];
const SUPPORTED_AI_LANE_RESPONSE_MODES: readonly HetangAiLaneResponseMode[] = ["text", "json"];
const SUPPORTED_AI_LANE_FALLBACK_BEHAVIORS: readonly HetangAiLaneFallbackBehavior[] = [
  "none",
  "lane",
  "deterministic",
  "legacy",
];

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, envName: string) => {
    const resolved = process.env[envName];
    if (!resolved) {
      throw new Error(`Environment variable ${envName} is not set`);
    }
    return resolved;
  });
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return resolveEnvVars(value.trim());
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return resolveEnvVars(value.trim());
}

function optionalLocalDate(value: unknown, label: string): string | undefined {
  const resolved = optionalString(value);
  if (!resolved) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(resolved)) {
    throw new Error(`${label} must be in YYYY-MM-DD format`);
  }
  return resolved;
}

function optionalMonthKey(value: unknown, label: string): string | undefined {
  const resolved = optionalString(value);
  if (!resolved) {
    return undefined;
  }
  if (!/^\d{4}-\d{2}$/u.test(resolved)) {
    throw new Error(`${label} must be in YYYY-MM format`);
  }
  return resolved;
}

function optionalCredentialString(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  try {
    return resolveEnvVars(value.trim());
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Environment variable ") &&
      error.message.endsWith(" is not set")
    ) {
      return undefined;
    }
    throw error;
  }
}

function optionalEnumValue<T extends string>(
  value: unknown,
  label: string,
  allowedValues: readonly T[],
): T | undefined {
  const resolved = optionalString(value);
  if (!resolved) {
    return undefined;
  }
  if (!allowedValues.includes(resolved as T)) {
    throw new Error(`${label} must be one of ${allowedValues.join(", ")}`);
  }
  return resolved as T;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new Error(`Expected a finite number, got ${String(value)}`);
  }
  return numeric;
}

function ensurePositiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

function ensureUnitInterval(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return value;
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  const numeric = optionalNumber(value);
  if (numeric === undefined) {
    return undefined;
  }
  return ensurePositiveInteger(numeric, label);
}

function addMinutesToLocalTime(localTime: string, minutes: number): string {
  const match = /^(\d{2}):(\d{2})$/u.exec(localTime);
  if (!match) {
    return localTime;
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const totalMinutes = ((hour * 60 + minute + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  const nextHour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const nextMinute = String(totalMinutes % 60).padStart(2, "0");
  return `${nextHour}:${nextMinute}`;
}

function optionalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function resolveStoreCustomerGrowthConfig(value: unknown): HetangStoreConfig["customerGrowth"] {
  if (!value) {
    return undefined;
  }
  const raw = asRecord(value, "store.customerGrowth");
  const primarySegmentThresholds = raw.primarySegmentThresholds
    ? asRecord(raw.primarySegmentThresholds, "store.customerGrowth.primarySegmentThresholds")
    : undefined;
  const reactivationCapacity = raw.reactivationCapacity
    ? asRecord(raw.reactivationCapacity, "store.customerGrowth.reactivationCapacity")
    : undefined;
  const config = {
    primarySegmentThresholds: primarySegmentThresholds
      ? {
          highValueMemberVisitCount90d: optionalNumber(
            primarySegmentThresholds.highValueMemberVisitCount90d,
          ),
          highValueMemberPayAmount90d: optionalNumber(
            primarySegmentThresholds.highValueMemberPayAmount90d,
          ),
          highValueMemberActiveMaxSilentDays: optionalNumber(
            primarySegmentThresholds.highValueMemberActiveMaxSilentDays,
          ),
          potentialGrowthPayAmount90d: optionalNumber(
            primarySegmentThresholds.potentialGrowthPayAmount90d,
          ),
          potentialGrowthMaxVisitCount90d: optionalNumber(
            primarySegmentThresholds.potentialGrowthMaxVisitCount90d,
          ),
        }
      : undefined,
    reactivationCapacity: reactivationCapacity
      ? {
          dailyTouchCapacity: optionalNumber(reactivationCapacity.dailyTouchCapacity),
        }
      : undefined,
  };
  if (!config.primarySegmentThresholds && !config.reactivationCapacity) {
    return undefined;
  }
  return config;
}

function requireTier(value: unknown, label: string): HetangExternalSourceTier {
  const normalized = requireString(value, label);
  if (!["s", "a", "b", "blocked"].includes(normalized)) {
    throw new Error(`${label} must be one of s, a, b, or blocked`);
  }
  return normalized as HetangExternalSourceTier;
}

function resolveExternalSource(entry: unknown, index: number): HetangExternalSourceConfig {
  const label = `externalIntelligence.sources[${index}]`;
  const source = asRecord(entry, label);
  return {
    sourceId: requireString(source.sourceId, `${label}.sourceId`),
    displayName: optionalString(source.displayName),
    tier: requireTier(source.tier, `${label}.tier`),
    url: optionalString(source.url),
    notes: optionalString(source.notes),
  };
}

function resolveStore(entry: unknown): HetangStoreConfig {
  const store = asRecord(entry, "store");
  const notification = resolveNotificationTarget(store.notification, "store.notification");

  return {
    orgId: requireString(store.orgId, "store.orgId"),
    storeName: requireString(store.storeName, "store.storeName"),
    rawAliases: optionalStringList(store.rawAliases),
    isActive: store.isActive !== false,
    notification,
    customerGrowth: resolveStoreCustomerGrowthConfig(store.customerGrowth),
    roomCount: optionalNumber(store.roomCount),
    operatingHoursPerDay: optionalNumber(store.operatingHoursPerDay),
    fixedMonthlyCost: optionalNumber(store.fixedMonthlyCost),
    variableCostRate: optionalNumber(store.variableCostRate),
    materialCostRate: optionalNumber(store.materialCostRate),
  };
}

function resolveNotificationTarget(
  value: unknown,
  label: string,
): HetangNotificationTarget | undefined {
  if (!value) {
    return undefined;
  }
  const raw = asRecord(value, label);
  return {
    channel: requireString(raw.channel, `${label}.channel`),
    target: requireString(raw.target, `${label}.target`),
    accountId: optionalString(raw.accountId),
    threadId: optionalString(raw.threadId),
    enabled: raw.enabled !== false,
  };
}

function resolveExternalIntelligenceConfig(value: unknown): HetangExternalIntelligenceConfig {
  const raw = asRecord(value ?? {}, "hetang-ops config.externalIntelligence");
  const brief = raw.briefComposition
    ? asRecord(raw.briefComposition, "externalIntelligence.briefComposition")
    : {};
  const hqDelivery = raw.hqDelivery
    ? asRecord(raw.hqDelivery, "externalIntelligence.hqDelivery")
    : {};
  const sources = Array.isArray(raw.sources)
    ? raw.sources.map((entry, index) => resolveExternalSource(entry, index))
    : [];

  const briefCounts = {
    generalHotTopic: ensurePositiveInteger(
      optionalNumber(brief.generalHotTopic) ?? DEFAULT_INTEL_BRIEF_COMPOSITION.generalHotTopic,
      "externalIntelligence.briefComposition.generalHotTopic",
    ),
    chainBrand: ensurePositiveInteger(
      optionalNumber(brief.chainBrand) ?? DEFAULT_INTEL_BRIEF_COMPOSITION.chainBrand,
      "externalIntelligence.briefComposition.chainBrand",
    ),
    strategyPlatform: ensurePositiveInteger(
      optionalNumber(brief.strategyPlatform) ?? DEFAULT_INTEL_BRIEF_COMPOSITION.strategyPlatform,
      "externalIntelligence.briefComposition.strategyPlatform",
    ),
  };
  const briefTotal =
    briefCounts.generalHotTopic + briefCounts.chainBrand + briefCounts.strategyPlatform;
  const validatedMaxItemsPerIssue = ensurePositiveInteger(
    optionalNumber(raw.maxItemsPerIssue) ?? DEFAULT_INTEL_MAX_ITEMS_PER_ISSUE,
    "externalIntelligence.maxItemsPerIssue",
  );
  if (validatedMaxItemsPerIssue < briefTotal) {
    throw new Error(
      "externalIntelligence.maxItemsPerIssue must be at least the sum of brief composition counts (generalHotTopic + chainBrand + strategyPlatform)",
    );
  }

  return {
    enabled: raw.enabled === true,
    freshnessHours: optionalNumber(raw.freshnessHours) ?? DEFAULT_INTEL_FRESHNESS_HOURS,
    maxItemsPerIssue: validatedMaxItemsPerIssue,
    briefComposition: briefCounts,
    hqDelivery: {
      channel: optionalString(hqDelivery.channel) ?? DEFAULT_INTEL_HQ_CHANNEL,
      target: optionalString(hqDelivery.target) ?? DEFAULT_INTEL_HQ_TARGET,
      accountId: optionalString(hqDelivery.accountId),
      threadId: optionalString(hqDelivery.threadId),
    },
    sources,
  };
}

function resolveInboundLinkReadersConfig(value: unknown): HetangInboundLinkReadersConfig {
  const raw = asRecord(value ?? {}, "hetang-ops config.inboundLinkReaders");
  const xiaohongshu = raw.xiaohongshu
    ? asRecord(raw.xiaohongshu, "hetang-ops config.inboundLinkReaders.xiaohongshu")
    : {};
  return {
    xiaohongshu: {
      enabled: xiaohongshu.enabled === true,
      autocliBin: optionalString(xiaohongshu.autocliBin),
      timeoutMs: ensurePositiveInteger(
        optionalNumber(xiaohongshu.timeoutMs) ?? DEFAULT_XIAOHONGSHU_LINK_TIMEOUT_MS,
        "inboundLinkReaders.xiaohongshu.timeoutMs",
      ),
      browserTimeoutMs: ensurePositiveInteger(
        optionalNumber(xiaohongshu.browserTimeoutMs) ??
          DEFAULT_XIAOHONGSHU_LINK_BROWSER_TIMEOUT_MS,
        "inboundLinkReaders.xiaohongshu.browserTimeoutMs",
      ),
      acceptText:
        optionalString(xiaohongshu.acceptText) ?? DEFAULT_XIAOHONGSHU_LINK_ACCEPT_TEXT,
      maxContentChars: ensurePositiveInteger(
        optionalNumber(xiaohongshu.maxContentChars) ??
          DEFAULT_XIAOHONGSHU_LINK_MAX_CONTENT_CHARS,
        "inboundLinkReaders.xiaohongshu.maxContentChars",
      ),
    },
  };
}

function ensureAiLaneId(value: string, label: string): HetangAiLaneId {
  if (!SUPPORTED_AI_LANE_IDS.includes(value as HetangAiLaneId)) {
    throw new Error(`${label} must be one of ${SUPPORTED_AI_LANE_IDS.join(", ")}`);
  }
  return value as HetangAiLaneId;
}

function resolveAiLaneConfig(value: unknown, laneId: HetangAiLaneId): HetangAiLaneConfig {
  const label = `hetang-ops config.aiLanes.${laneId}`;
  const raw = asRecord(value, label);
  const reasoningMode = optionalEnumValue(
    raw.reasoningMode,
    `aiLanes.${laneId}.reasoningMode`,
    SUPPORTED_AI_LANE_REASONING_MODES,
  );
  const timeoutMs = optionalPositiveInteger(raw.timeoutMs, `aiLanes.${laneId}.timeoutMs`);
  const responseMode = optionalEnumValue(
    raw.responseMode,
    `aiLanes.${laneId}.responseMode`,
    SUPPORTED_AI_LANE_RESPONSE_MODES,
  );
  const fallbackBehavior = optionalEnumValue(
    raw.fallbackBehavior,
    `aiLanes.${laneId}.fallbackBehavior`,
    SUPPORTED_AI_LANE_FALLBACK_BEHAVIORS,
  );
  const fallbackLaneId = raw.fallbackLaneId
    ? ensureAiLaneId(
        requireString(raw.fallbackLaneId, `aiLanes.${laneId}.fallbackLaneId`),
        `aiLanes.${laneId}.fallbackLaneId`,
      )
    : undefined;

  if (fallbackBehavior === "lane" && !fallbackLaneId) {
    throw new Error(`aiLanes.${laneId}.fallbackLaneId is required when fallbackBehavior=lane`);
  }
  if (fallbackLaneId && fallbackBehavior !== "lane") {
    throw new Error(
      `aiLanes.${laneId}.fallbackBehavior must be lane when fallbackLaneId is configured`,
    );
  }
  if (fallbackLaneId === laneId) {
    throw new Error(`aiLanes.${laneId}.fallbackLaneId cannot reference itself`);
  }

  const config: HetangAiLaneConfig = {};
  const baseUrl = optionalString(raw.baseUrl);
  const apiKey = optionalCredentialString(raw.apiKey);
  const model = optionalString(raw.model);
  if (baseUrl) {
    config.baseUrl = baseUrl;
  }
  if (apiKey) {
    config.apiKey = apiKey;
  }
  if (model) {
    config.model = model;
  }
  if (reasoningMode) {
    config.reasoningMode = reasoningMode;
  }
  if (timeoutMs !== undefined) {
    config.timeoutMs = timeoutMs;
  }
  if (responseMode) {
    config.responseMode = responseMode;
  }
  if (fallbackBehavior) {
    config.fallbackBehavior = fallbackBehavior;
  }
  if (fallbackLaneId) {
    config.fallbackLaneId = fallbackLaneId;
  }
  return config;
}

function resolveAiLaneRegistryConfig(value: unknown): HetangAiLaneRegistryConfig {
  if (!value) {
    return {};
  }
  const raw = asRecord(value, "hetang-ops config.aiLanes");
  const aiLanes: HetangAiLaneRegistryConfig = {};

  for (const [laneKey, laneValue] of Object.entries(raw)) {
    const laneId = ensureAiLaneId(laneKey, `aiLanes.${laneKey}`);
    aiLanes[laneId] = resolveAiLaneConfig(laneValue, laneId);
  }

  return aiLanes;
}

export function resolveHetangOpsConfig(value: unknown): HetangOpsConfig {
  const raw = asRecord(value ?? {}, "hetang-ops config");
  const api = asRecord(raw.api, "hetang-ops config.api");
  const sync = raw.sync ? asRecord(raw.sync, "hetang-ops config.sync") : {};
  const reporting = raw.reporting ? asRecord(raw.reporting, "hetang-ops config.reporting") : {};
  const analysis = raw.analysis ? asRecord(raw.analysis, "hetang-ops config.analysis") : {};
  const aiLanes = resolveAiLaneRegistryConfig(raw.aiLanes);
  const semanticFallback = raw.semanticFallback
    ? asRecord(raw.semanticFallback, "hetang-ops config.semanticFallback")
    : null;
  const customerGrowthAi = raw.customerGrowthAi
    ? asRecord(raw.customerGrowthAi, "hetang-ops config.customerGrowthAi")
    : null;
  const conversationQuality = raw.conversationQuality
    ? asRecord(raw.conversationQuality, "hetang-ops config.conversationQuality")
    : {};
  const service = raw.service ? asRecord(raw.service, "hetang-ops config.service") : {};
  const queue = raw.queue ? asRecord(raw.queue, "hetang-ops config.queue") : {};
  const database = raw.database ? asRecord(raw.database, "hetang-ops config.database") : {};
  const externalIntelligence = resolveExternalIntelligenceConfig(raw.externalIntelligence);
  const inboundLinkReaders = resolveInboundLinkReadersConfig(raw.inboundLinkReaders);

  const stores = Array.isArray(raw.stores) ? raw.stores.map(resolveStore) : [];
  const syncEnabled = sync.enabled !== false;
  const reportingEnabled = reporting.enabled !== false;
  const sendAtLocalTime = optionalString(reporting.sendAtLocalTime) ?? "09:00";
  const weeklyReportAtLocalTime = optionalString(reporting.weeklyReportAtLocalTime) ?? "09:15";
  const monthlyReportAtLocalTime =
    optionalString(reporting.monthlyReportAtLocalTime) ?? "09:25";
  const accessOnlyBootstrap = !syncEnabled && !reportingEnabled;
  if (stores.length < 1) {
    throw new Error("hetang-ops requires at least one store");
  }
  const duplicateOrgIds = stores.reduce<string[]>((dupes, store, index) => {
    if (stores.findIndex((entry) => entry.orgId === store.orgId) !== index) {
      dupes.push(store.orgId);
    }
    return dupes;
  }, []);
  if (duplicateOrgIds.length > 0) {
    throw new Error(`Duplicate OrgId detected: ${Array.from(new Set(duplicateOrgIds)).join(", ")}`);
  }

  const semanticFallbackConfig = {
    enabled: semanticFallback ? semanticFallback.enabled !== false : false,
    baseUrl: semanticFallback
      ? (optionalString(semanticFallback.baseUrl) ??
        process.env.OPENAI_BASE_URL?.trim() ??
        DEFAULT_SEMANTIC_FALLBACK_BASE_URL)
      : undefined,
    apiKey: semanticFallback
      ? (optionalCredentialString(semanticFallback.apiKey) ?? process.env.OPENAI_API_KEY?.trim())
      : undefined,
    model: semanticFallback
      ? (optionalString(semanticFallback.model) ?? process.env.OPENAI_MODEL?.trim())
      : undefined,
    timeoutMs: ensurePositiveInteger(
      optionalNumber(semanticFallback?.timeoutMs) ?? DEFAULT_SEMANTIC_FALLBACK_TIMEOUT_MS,
      "semanticFallback.timeoutMs",
    ),
    autoAcceptConfidence: ensureUnitInterval(
      optionalNumber(semanticFallback?.autoAcceptConfidence) ??
        DEFAULT_SEMANTIC_FALLBACK_AUTO_ACCEPT_CONFIDENCE,
      "semanticFallback.autoAcceptConfidence",
    ),
    clarifyConfidence: ensureUnitInterval(
      optionalNumber(semanticFallback?.clarifyConfidence) ??
        DEFAULT_SEMANTIC_FALLBACK_CLARIFY_CONFIDENCE,
      "semanticFallback.clarifyConfidence",
    ),
  };
  if (semanticFallbackConfig.clarifyConfidence > semanticFallbackConfig.autoAcceptConfidence) {
    throw new Error(
      "semanticFallback.clarifyConfidence must be less than or equal to semanticFallback.autoAcceptConfidence",
    );
  }

  const customerGrowthAiProfileInsight = customerGrowthAi?.profileInsight
    ? asRecord(customerGrowthAi.profileInsight, "hetang-ops config.customerGrowthAi.profileInsight")
    : {};
  const customerGrowthAiTagAdvisor = customerGrowthAi?.tagAdvisor
    ? asRecord(customerGrowthAi.tagAdvisor, "hetang-ops config.customerGrowthAi.tagAdvisor")
    : {};
  const customerGrowthAiStrategyAdvisor = customerGrowthAi?.strategyAdvisor
    ? asRecord(customerGrowthAi.strategyAdvisor, "hetang-ops config.customerGrowthAi.strategyAdvisor")
    : {};
  const customerGrowthAiFollowupSummarizer = customerGrowthAi?.followupSummarizer
    ? asRecord(
        customerGrowthAi.followupSummarizer,
        "hetang-ops config.customerGrowthAi.followupSummarizer",
      )
    : {};
  const customerGrowthAiConfig = {
    enabled: customerGrowthAi ? customerGrowthAi.enabled !== false : false,
    baseUrl: customerGrowthAi
      ? (optionalString(customerGrowthAi.baseUrl) ??
        process.env.HETANG_CUSTOMER_GROWTH_AI_BASE_URL?.trim() ??
        process.env.OPENAI_BASE_URL?.trim() ??
        DEFAULT_CUSTOMER_GROWTH_AI_BASE_URL)
      : undefined,
    apiKey: customerGrowthAi
      ? (optionalCredentialString(customerGrowthAi.apiKey) ??
        process.env.HETANG_CUSTOMER_GROWTH_AI_API_KEY?.trim() ??
        process.env.OPENAI_API_KEY?.trim())
      : undefined,
    model: customerGrowthAi
      ? (optionalString(customerGrowthAi.model) ??
        process.env.HETANG_CUSTOMER_GROWTH_AI_MODEL?.trim() ??
        process.env.OPENAI_MODEL?.trim())
      : undefined,
    timeoutMs: ensurePositiveInteger(
      optionalNumber(customerGrowthAi?.timeoutMs) ?? DEFAULT_CUSTOMER_GROWTH_AI_TIMEOUT_MS,
      "customerGrowthAi.timeoutMs",
    ),
    profileInsight: {
      enabled: customerGrowthAiProfileInsight.enabled === true,
    },
    tagAdvisor: {
      enabled: customerGrowthAiTagAdvisor.enabled === true,
    },
    strategyAdvisor: {
      enabled: customerGrowthAiStrategyAdvisor.enabled === true,
    },
    followupSummarizer: {
      enabled: customerGrowthAiFollowupSummarizer.enabled === true,
    },
  };

  const intentClarifier = conversationQuality.intentClarifier
    ? asRecord(
        conversationQuality.intentClarifier,
        "hetang-ops config.conversationQuality.intentClarifier",
      )
    : {};
  const replyGuard = conversationQuality.replyGuard
    ? asRecord(conversationQuality.replyGuard, "hetang-ops config.conversationQuality.replyGuard")
    : {};
  const correctionInterrupt = conversationQuality.correctionInterrupt
    ? asRecord(
        conversationQuality.correctionInterrupt,
        "hetang-ops config.conversationQuality.correctionInterrupt",
      )
    : {};

  return {
    timeZone: optionalString(raw.timeZone) ?? DEFAULT_TIME_ZONE,
    api: {
      appKey: optionalCredentialString(api.appKey),
      appSecret: optionalCredentialString(api.appSecret),
      baseUrl: optionalString(api.baseUrl) ?? DEFAULT_BASE_URL,
      pageSize: optionalNumber(api.pageSize) ?? DEFAULT_PAGE_SIZE,
      timeoutMs: optionalNumber(api.timeoutMs) ?? DEFAULT_TIMEOUT_MS,
      maxRetries: optionalNumber(api.maxRetries) ?? DEFAULT_MAX_RETRIES,
    },
    sync: {
      enabled: syncEnabled,
      initialBackfillDays: ensurePositiveInteger(
        optionalNumber(sync.initialBackfillDays) ?? 90,
        "sync.initialBackfillDays",
      ),
      overlapDays: ensurePositiveInteger(optionalNumber(sync.overlapDays) ?? 7, "sync.overlapDays"),
      runAtLocalTime: optionalString(sync.runAtLocalTime) ?? "03:10",
      accessWindowStartLocalTime: optionalString(sync.accessWindowStartLocalTime) ?? "03:00",
      accessWindowEndLocalTime: optionalString(sync.accessWindowEndLocalTime) ?? "18:00",
      businessDayCutoffLocalTime: optionalString(sync.businessDayCutoffLocalTime) ?? "03:00",
      historyCatchupAtLocalTime: optionalString(sync.historyCatchupAtLocalTime) ?? "04:05",
      historyBackfillEnabled: sync.historyBackfillEnabled !== false,
      historyBackfillDays: ensurePositiveInteger(
        optionalNumber(sync.historyBackfillDays) ?? 180,
        "sync.historyBackfillDays",
      ),
      historyBackfillSliceDays: ensurePositiveInteger(
        optionalNumber(sync.historyBackfillSliceDays) ?? 7,
        "sync.historyBackfillSliceDays",
      ),
    },
    reporting: {
      enabled: reportingEnabled,
      buildAtLocalTime: optionalString(reporting.buildAtLocalTime) ?? "08:50",
      sendAtLocalTime,
      fiveStoreDailyOverviewAtLocalTime:
        optionalString(reporting.fiveStoreDailyOverviewAtLocalTime) ??
        addMinutesToLocalTime(sendAtLocalTime, 5),
      weeklyReportAtLocalTime,
      weeklyReportStartDate: optionalLocalDate(
        reporting.weeklyReportStartDate,
        "reporting.weeklyReportStartDate",
      ),
      monthlyReportAtLocalTime,
      monthlyReportStartMonth: optionalMonthKey(
        reporting.monthlyReportStartMonth,
        "reporting.monthlyReportStartMonth",
      ),
      weeklyChartAtLocalTime:
        optionalString(reporting.weeklyChartAtLocalTime) ??
        addMinutesToLocalTime(weeklyReportAtLocalTime, 3),
      weeklyChartStartDate: optionalLocalDate(
        reporting.weeklyChartStartDate,
        "reporting.weeklyChartStartDate",
      ),
      middayBriefAtLocalTime: optionalString(reporting.middayBriefAtLocalTime) ?? "12:00",
      reactivationPushAtLocalTime: optionalString(reporting.reactivationPushAtLocalTime) ?? "15:00",
      sharedDelivery: resolveNotificationTarget(
        reporting.sharedDelivery,
        "reporting.sharedDelivery",
      ),
      sendReportEnabled: reporting.sendReportEnabled !== false,
      sendFiveStoreDailyOverviewEnabled:
        reporting.sendFiveStoreDailyOverviewEnabled !== false,
      sendWeeklyReportEnabled: reporting.sendWeeklyReportEnabled !== false,
      sendMonthlyReportEnabled: reporting.sendMonthlyReportEnabled !== false,
      sendWeeklyChartEnabled: reporting.sendWeeklyChartEnabled !== false,
      sendMiddayBriefEnabled: reporting.sendMiddayBriefEnabled !== false,
      sendReactivationPushEnabled: reporting.sendReactivationPushEnabled !== false,
    },
    analysis: {
      revenueDropAlertThreshold: optionalNumber(analysis.revenueDropAlertThreshold) ?? 0.2,
      clockDropAlertThreshold: optionalNumber(analysis.clockDropAlertThreshold) ?? 0.2,
      antiRatioAlertThreshold: optionalNumber(analysis.antiRatioAlertThreshold) ?? 0.1,
      lowTechActiveCountThreshold: optionalNumber(analysis.lowTechActiveCountThreshold) ?? 1,
      lowStoredConsumeRateThreshold: optionalNumber(analysis.lowStoredConsumeRateThreshold) ?? 0.8,
      sleepingMemberRateAlertThreshold:
        optionalNumber(analysis.sleepingMemberRateAlertThreshold) ?? 0.2,
      highTechCommissionRateThreshold:
        optionalNumber(analysis.highTechCommissionRateThreshold) ?? 0.45,
      defaultVariableCostRate: optionalNumber(analysis.defaultVariableCostRate),
      defaultMaterialCostRate: optionalNumber(analysis.defaultMaterialCostRate),
      defaultFixedMonthlyCost: optionalNumber(analysis.defaultFixedMonthlyCost),
    },
    aiLanes,
    semanticFallback: semanticFallbackConfig,
    customerGrowthAi: customerGrowthAiConfig,
    inboundLinkReaders,
    conversationQuality: {
      intentClarifier: {
        enabled:
          intentClarifier.enabled === undefined
            ? DEFAULT_CONVERSATION_QUALITY_INTENT_CLARIFIER_ENABLED
            : intentClarifier.enabled !== false,
        maxQuestionsPerTurn: ensurePositiveInteger(
          optionalNumber(intentClarifier.maxQuestionsPerTurn) ??
            DEFAULT_CONVERSATION_QUALITY_INTENT_CLARIFIER_MAX_QUESTIONS_PER_TURN,
          "conversationQuality.intentClarifier.maxQuestionsPerTurn",
        ),
      },
      replyGuard: {
        enabled:
          replyGuard.enabled === undefined
            ? DEFAULT_CONVERSATION_QUALITY_REPLY_GUARD_ENABLED
            : replyGuard.enabled !== false,
        allowOneRepairAttempt:
          replyGuard.allowOneRepairAttempt === undefined
            ? DEFAULT_CONVERSATION_QUALITY_REPLY_GUARD_ALLOW_ONE_REPAIR_ATTEMPT
            : replyGuard.allowOneRepairAttempt !== false,
      },
      correctionInterrupt: {
        enabled:
          correctionInterrupt.enabled === undefined
            ? DEFAULT_CONVERSATION_QUALITY_CORRECTION_INTERRUPT_ENABLED
            : correctionInterrupt.enabled !== false,
        recentTurnTtlMs: ensurePositiveInteger(
          optionalNumber(correctionInterrupt.recentTurnTtlMs) ??
            DEFAULT_CONVERSATION_QUALITY_CORRECTION_INTERRUPT_RECENT_TURN_TTL_MS,
          "conversationQuality.correctionInterrupt.recentTurnTtlMs",
        ),
      },
    },
    service: {
      enableInGateway: service.enableInGateway !== false,
      scheduledPollIntervalMs: ensurePositiveInteger(
        optionalNumber(service.scheduledPollIntervalMs) ??
          DEFAULT_SERVICE_SCHEDULED_POLL_INTERVAL_MS,
        "service.scheduledPollIntervalMs",
      ),
      analysisPollIntervalMs: ensurePositiveInteger(
        optionalNumber(service.analysisPollIntervalMs) ?? DEFAULT_SERVICE_ANALYSIS_POLL_INTERVAL_MS,
        "service.analysisPollIntervalMs",
      ),
    },
    queue: {
      maxPendingAnalysisJobsPerOrg: ensurePositiveInteger(
        optionalNumber(queue.maxPendingAnalysisJobsPerOrg) ??
          DEFAULT_QUEUE_MAX_PENDING_ANALYSIS_JOBS_PER_ORG,
        "queue.maxPendingAnalysisJobsPerOrg",
      ),
      deadLetterEnabled: queue.deadLetterEnabled !== false,
    },
    database: {
      url: requireString(database.url, "database.url"),
      queryUrl: optionalString(database.queryUrl),
      syncUrl: optionalString(database.syncUrl),
      analysisUrl: optionalString(database.analysisUrl),
      queryPoolMax: ensurePositiveInteger(
        optionalNumber(database.queryPoolMax) ?? DEFAULT_QUERY_POOL_MAX,
        "database.queryPoolMax",
      ),
      syncPoolMax: ensurePositiveInteger(
        optionalNumber(database.syncPoolMax) ?? DEFAULT_SYNC_POOL_MAX,
        "database.syncPoolMax",
      ),
      analysisPoolMax: ensurePositiveInteger(
        optionalNumber(database.analysisPoolMax) ?? DEFAULT_ANALYSIS_POOL_MAX,
        "database.analysisPoolMax",
      ),
    },
    stores,
    externalIntelligence,
  };
}

export function hasHetangApiCredentials(config: HetangOpsConfig): boolean {
  return Boolean(config.api.appSecret);
}

export function getStoreByOrgId(config: HetangOpsConfig, orgId: string): HetangStoreConfig {
  const store = config.stores.find((entry) => entry.orgId === orgId);
  if (!store) {
    throw new Error(`Unknown OrgId: ${orgId}`);
  }
  return store;
}

export function resolveStoreOrgId(config: HetangOpsConfig, token: string): string | undefined {
  const normalized = token.trim();
  if (!normalized) {
    return undefined;
  }
  return config.stores.find(
    (entry) =>
      entry.orgId === normalized ||
      entry.storeName === normalized ||
      entry.rawAliases.includes(normalized),
  )?.orgId;
}

export const hetangOpsConfigSchema = {
  parse: resolveHetangOpsConfig,
  uiHints: {
    "api.appKey": {
      label: "Hetang App Key",
      sensitive: true,
    },
    "api.appSecret": {
      label: "Hetang App Secret",
      sensitive: true,
    },
    "api.baseUrl": {
      label: "API Base URL",
      placeholder: DEFAULT_BASE_URL,
      advanced: true,
    },
    "database.url": {
      label: "PostgreSQL URL",
      placeholder: "postgresql://user:password@127.0.0.1:5432/hetang_ops",
      advanced: true,
    },
    "sync.runAtLocalTime": {
      label: "Daily Sync Time",
      placeholder: "03:10",
    },
    "sync.businessDayCutoffLocalTime": {
      label: "Business Day Cutoff",
      placeholder: "03:00",
    },
    "sync.historyCatchupAtLocalTime": {
      label: "History Catchup Time",
      placeholder: "04:05",
    },
    "reporting.buildAtLocalTime": {
      label: "Report Build Time",
      placeholder: "08:50",
    },
    "reporting.sendAtLocalTime": {
      label: "Report Send Time",
      placeholder: "09:00",
    },
    "reporting.fiveStoreDailyOverviewAtLocalTime": {
      label: "Five-Store Overview Time",
      placeholder: "09:05",
    },
    "reporting.weeklyReportAtLocalTime": {
      label: "Weekly Report Time",
      placeholder: "09:15",
    },
    "reporting.weeklyReportStartDate": {
      label: "Weekly Report Start Date",
      placeholder: "2026-04-27",
    },
    "reporting.monthlyReportAtLocalTime": {
      label: "Monthly Report Time",
      placeholder: "09:25",
    },
    "reporting.monthlyReportStartMonth": {
      label: "Monthly Report Start Month",
      placeholder: "2026-04",
    },
    "reporting.weeklyChartAtLocalTime": {
      label: "Weekly Chart Time",
      placeholder: "09:18",
    },
    "reporting.weeklyChartStartDate": {
      label: "Weekly Chart Start Date",
      placeholder: "2026-04-27",
    },
    "reporting.middayBriefAtLocalTime": {
      label: "Midday Brief Time",
      placeholder: "12:00",
    },
    "reporting.reactivationPushAtLocalTime": {
      label: "Reactivation Push Time",
      placeholder: "15:00",
    },
    "semanticFallback.enabled": {
      label: "Semantic Fallback Enabled",
      placeholder: "false",
      advanced: true,
    },
    "semanticFallback.baseUrl": {
      label: "Semantic Fallback Base URL",
      placeholder: DEFAULT_SEMANTIC_FALLBACK_BASE_URL,
      advanced: true,
    },
    "semanticFallback.apiKey": {
      label: "Semantic Fallback API Key",
      sensitive: true,
      advanced: true,
    },
    "semanticFallback.model": {
      label: "Semantic Fallback Model",
      placeholder: "gpt-4.1-mini",
      advanced: true,
    },
    "semanticFallback.timeoutMs": {
      label: "Semantic Fallback Timeout",
      placeholder: String(DEFAULT_SEMANTIC_FALLBACK_TIMEOUT_MS),
      advanced: true,
    },
    "conversationQuality.intentClarifier.enabled": {
      label: "Intent Clarifier Enabled",
      placeholder: "true",
      advanced: true,
    },
    "conversationQuality.intentClarifier.maxQuestionsPerTurn": {
      label: "Intent Clarifier Max Questions Per Turn",
      placeholder: String(DEFAULT_CONVERSATION_QUALITY_INTENT_CLARIFIER_MAX_QUESTIONS_PER_TURN),
      advanced: true,
    },
    "conversationQuality.replyGuard.enabled": {
      label: "Reply Guard Enabled",
      placeholder: "true",
      advanced: true,
    },
    "conversationQuality.replyGuard.allowOneRepairAttempt": {
      label: "Reply Guard Allow One Repair Attempt",
      placeholder: "true",
      advanced: true,
    },
    "conversationQuality.correctionInterrupt.enabled": {
      label: "Correction Interrupt Enabled",
      placeholder: "true",
      advanced: true,
    },
    "conversationQuality.correctionInterrupt.recentTurnTtlMs": {
      label: "Correction Interrupt Recent Turn TTL",
      placeholder: String(
        DEFAULT_CONVERSATION_QUALITY_CORRECTION_INTERRUPT_RECENT_TURN_TTL_MS,
      ),
      advanced: true,
    },
    "reporting.sharedDelivery.channel": {
      label: "Shared Delivery Channel",
      placeholder: "wecom",
    },
    "reporting.sharedDelivery.target": {
      label: "Shared Delivery Target",
      placeholder: "REPLACE_WITH_SHARED_DELIVERY_TARGET",
    },
    "reporting.sendReportEnabled": {
      label: "Daily Report Send Enabled",
      placeholder: "true",
    },
    "reporting.sendFiveStoreDailyOverviewEnabled": {
      label: "Five-Store Overview Send Enabled",
      placeholder: "true",
    },
    "reporting.sendWeeklyReportEnabled": {
      label: "Weekly Report Send Enabled",
      placeholder: "true",
    },
    "reporting.sendMonthlyReportEnabled": {
      label: "Monthly Report Send Enabled",
      placeholder: "true",
    },
    "reporting.sendWeeklyChartEnabled": {
      label: "Weekly Chart Send Enabled",
      placeholder: "true",
    },
    "reporting.sendMiddayBriefEnabled": {
      label: "Midday Brief Send Enabled",
      placeholder: "true",
    },
    "reporting.sendReactivationPushEnabled": {
      label: "Reactivation Push Send Enabled",
      placeholder: "true",
    },
  },
};
