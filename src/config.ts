import type {
  HetangExternalIntelligenceConfig,
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

function optionalStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
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

export function resolveHetangOpsConfig(value: unknown): HetangOpsConfig {
  const raw = asRecord(value ?? {}, "hetang-ops config");
  const api = asRecord(raw.api, "hetang-ops config.api");
  const sync = raw.sync ? asRecord(raw.sync, "hetang-ops config.sync") : {};
  const reporting = raw.reporting ? asRecord(raw.reporting, "hetang-ops config.reporting") : {};
  const analysis = raw.analysis ? asRecord(raw.analysis, "hetang-ops config.analysis") : {};
  const semanticFallback = raw.semanticFallback
    ? asRecord(raw.semanticFallback, "hetang-ops config.semanticFallback")
    : null;
  const conversationQuality = raw.conversationQuality
    ? asRecord(raw.conversationQuality, "hetang-ops config.conversationQuality")
    : {};
  const service = raw.service ? asRecord(raw.service, "hetang-ops config.service") : {};
  const queue = raw.queue ? asRecord(raw.queue, "hetang-ops config.queue") : {};
  const database = raw.database ? asRecord(raw.database, "hetang-ops config.database") : {};
  const externalIntelligence = resolveExternalIntelligenceConfig(raw.externalIntelligence);

  const stores = Array.isArray(raw.stores) ? raw.stores.map(resolveStore) : [];
  const syncEnabled = sync.enabled !== false;
  const reportingEnabled = reporting.enabled !== false;
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
      accessWindowEndLocalTime: optionalString(sync.accessWindowEndLocalTime) ?? "04:00",
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
      sendAtLocalTime: optionalString(reporting.sendAtLocalTime) ?? "09:00",
      middayBriefAtLocalTime: optionalString(reporting.middayBriefAtLocalTime) ?? "12:00",
      reactivationPushAtLocalTime: optionalString(reporting.reactivationPushAtLocalTime) ?? "15:00",
      sharedDelivery: resolveNotificationTarget(
        reporting.sharedDelivery,
        "reporting.sharedDelivery",
      ),
      sendReportEnabled: reporting.sendReportEnabled !== false,
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
    semanticFallback: semanticFallbackConfig,
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
