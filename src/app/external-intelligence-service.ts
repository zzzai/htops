import { HetangOpsStore } from "../store.js";
import { sendHetangMessage, type CommandRunner } from "../notify.js";
import { assembleTopExternalBrief } from "../external-intelligence/assemble.js";
import { classifyExternalTheme, THEME_LABELS } from "../external-intelligence/classify.js";
import {
  buildExternalEventKey,
  clusterExternalCandidates,
} from "../external-intelligence/cluster.js";
import { filterExternalCandidate } from "../external-intelligence/filter.js";
import { evaluateExternalFreshness } from "../external-intelligence/freshness.js";
import {
  buildFallbackExternalNarrative,
  enrichExternalBriefItemNarrative,
  type ExternalBriefLlmClient,
} from "../external-intelligence/llm.js";
import { renderExternalBriefIssue } from "../external-intelligence/render.js";
import { scoreExternalEvent } from "../external-intelligence/score.js";
import { resolveLocalDate } from "../time.js";
import type {
  HetangExternalBriefItem,
  HetangExternalEventCandidate,
  HetangExternalEventCard,
  HetangExternalSourceDocumentScopeType,
  HetangExternalSourceTier,
  HetangLogger,
  HetangOpsConfig,
} from "../types.js";

export type ExternalSourceDocumentInput = {
  documentId: string;
  sourceId: string;
  sourceTier: HetangExternalSourceTier;
  sourceUrl?: string;
  scopeType?: HetangExternalSourceDocumentScopeType;
  orgId?: string;
  platformStoreId?: string;
  title: string;
  summary?: string;
  contentText?: string;
  entity?: string;
  action?: string;
  object?: string;
  score?: number;
  publishedAt: string;
  eventAt?: string;
  fetchedAt?: string;
  theme?: string;
  blockedReason?: string;
  rawJson?: string;
  hasMaterialUpdate?: boolean;
};

export type BuiltExternalBriefIssue = {
  issueId: string;
  issueDate: string;
  topic: string;
  markdown: string;
  items: HetangExternalBriefItem[];
  delivered: boolean;
  itemCount: number;
  sourceDocumentCount: number;
  candidateCount: number;
  cardCount: number;
};

type ExternalIntelligenceStore = Pick<
  HetangOpsStore,
  | "insertExternalSourceDocument"
  | "listExternalSourceDocuments"
  | "upsertExternalEventCandidate"
  | "upsertExternalEventCard"
  | "createExternalBriefIssue"
  | "getExternalBriefIssue"
  | "getLatestExternalBriefIssue"
  | "getExternalEventCard"
>;

function resolveExternalSourceDisplayName(
  config: HetangOpsConfig,
  sourceId: string,
  fallback?: string,
): string {
  return (
    config.externalIntelligence.sources.find((source) => source.sourceId === sourceId)
      ?.displayName ??
    fallback ??
    sourceId
  );
}

function resolveExternalBlockedReason(reason: string): string {
  switch (reason) {
    case "stale-without-update":
      return "blocked-stale";
    case "missing-reliable-time":
      return "blocked-missing-reliable-time";
    default:
      return reason;
  }
}

function resolveExternalIssueOverview(
  items: Array<Pick<HetangExternalBriefItem, "theme">>,
): string {
  const themeLabels = Array.from(
    new Set(
      items
        .map((item) => THEME_LABELS[item.theme as keyof typeof THEME_LABELS] ?? item.theme)
        .filter(Boolean),
    ),
  ).slice(0, 3);
  if (themeLabels.length === 0) {
    return "今日未发现达到投递阈值的外部经营情报。";
  }
  return `今日外部环境的高优先变化集中在${themeLabels.join("、")}，建议总部优先判断这些信号是否需要转译为今天的价格、投放、平台或门店动作。`;
}

function resolveExternalTopic(): string {
  return "何棠 HQ 外部情报简报";
}

function resolveExternalFallbackTitle(params: {
  title?: string;
  entity: string;
  action: string;
  object?: string;
}): string {
  const title = params.title?.trim();
  if (title) {
    return title;
  }
  return `${params.entity}${params.object ? ` ${params.object}` : ""}${params.action}`;
}

export class HetangExternalIntelligenceService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      getStore: () => Promise<HetangOpsStore>;
      runCommandWithTimeout: CommandRunner;
      loadExternalSourceDocuments?: (params: {
        now: Date;
        config: HetangOpsConfig;
      }) => Promise<ExternalSourceDocumentInput[]>;
      externalBriefLlm?: ExternalBriefLlmClient;
      logger: HetangLogger;
    },
  ) {}

  private async getStore(): Promise<ExternalIntelligenceStore> {
    return (await this.deps.getStore()) as ExternalIntelligenceStore;
  }

  async ingestExternalSourceDocuments(
    documents: ExternalSourceDocumentInput[],
    now = new Date(),
  ): Promise<number> {
    const store = await this.getStore();
    for (const document of documents) {
      const theme = document.theme ?? classifyExternalTheme(document).themeKey;
      await store.insertExternalSourceDocument({
        ...document,
        theme,
        fetchedAt: document.fetchedAt ?? now.toISOString(),
        rawJson: document.rawJson ?? JSON.stringify(document),
      });
    }
    return documents.length;
  }

  async getExternalBriefIssue(issueId: string) {
    const store = await this.getStore();
    return await store.getExternalBriefIssue(issueId);
  }

  async getLatestExternalBriefIssue() {
    const store = await this.getStore();
    return await store.getLatestExternalBriefIssue();
  }

  private async renderStoredExternalBriefIssue(issue: {
    issueId: string;
    issueDate: string;
    topic: string;
    items: HetangExternalBriefItem[];
  }): Promise<string> {
    const store = await this.getStore();
    const renderItems = await Promise.all(
      issue.items.map(async (item) => {
        const card = await store.getExternalEventCard(item.cardId);
        return {
          rank: item.rank,
          title: item.title,
          theme: item.theme,
          publishedAt: card?.publishedAt ?? issue.issueDate,
          sourceLabels: card?.sources
            .map((source) => source.displayName || source.sourceId)
            .filter(Boolean) ?? ["-"],
          summary: item.summary,
          whyItMatters: item.whyItMatters,
        };
      }),
    );
    return renderExternalBriefIssue({
      issueDate: issue.issueDate,
      topic: issue.topic,
      overview: resolveExternalIssueOverview(issue.items),
      items: renderItems,
    });
  }

  async renderLatestExternalBriefIssue(): Promise<string> {
    const issue = await this.getLatestExternalBriefIssue();
    if (!issue) {
      return "暂无已生成的 HQ 外部情报简报。";
    }
    return await this.renderStoredExternalBriefIssue(issue);
  }

  async renderExternalBriefIssueById(issueId: string): Promise<string> {
    const issue = await this.getExternalBriefIssue(issueId);
    if (!issue) {
      return "未找到对应的 HQ 外部情报期次。";
    }
    return await this.renderStoredExternalBriefIssue(issue);
  }

  async deliverExternalBriefIssue(params: { message: string }): Promise<void> {
    await sendHetangMessage({
      notification: this.deps.config.externalIntelligence.hqDelivery,
      message: params.message,
      runCommandWithTimeout: this.deps.runCommandWithTimeout,
    });
  }

  async buildExternalBriefIssue(
    params: {
      now?: Date;
      deliver?: boolean;
    } = {},
  ): Promise<BuiltExternalBriefIssue | null> {
    if (!this.deps.config.externalIntelligence.enabled) {
      return null;
    }
    const now = params.now ?? new Date();
    const store = await this.getStore();
    const loadedDocuments = this.deps.loadExternalSourceDocuments
      ? await this.deps.loadExternalSourceDocuments({
          now,
          config: this.deps.config,
        })
      : [];
    if (loadedDocuments.length > 0) {
      await this.ingestExternalSourceDocuments(loadedDocuments, now);
    }

    const freshnessHours = this.deps.config.externalIntelligence.freshnessHours;
    const sincePublishedAt = new Date(
      now.getTime() - freshnessHours * 60 * 60 * 1000,
    ).toISOString();
    const documents = await store.listExternalSourceDocuments({
      publishedSince: sincePublishedAt,
      limit: Math.max(50, this.deps.config.externalIntelligence.maxItemsPerIssue * 8),
    });
    const acceptedCandidates: HetangExternalEventCandidate[] = [];
    const documentById = new Map<string, (typeof documents)[number]>();

    for (const document of documents) {
      documentById.set(document.documentId, document);
      const theme = document.theme ?? classifyExternalTheme(document).themeKey;
      const freshness = evaluateExternalFreshness(
        {
          eventAt: document.eventAt,
          publishedAt: document.publishedAt,
          hasMaterialUpdate: false,
        },
        {
          now,
          freshnessHours,
        },
      );
      const filter = filterExternalCandidate(
        {
          sourceTier: document.sourceTier,
          title: document.title,
          summary: document.summary,
          publishedAt: document.publishedAt,
          eventAt: document.eventAt,
          hasMaterialUpdate: false,
        },
        {
          now,
          freshnessHours,
        },
      );
      const blockedReason =
        document.blockedReason ??
        filter.decision.reason ??
        (!freshness.qualifies ? resolveExternalBlockedReason(freshness.reason) : undefined);
      const baseCandidate: HetangExternalEventCandidate = {
        candidateId: `candidate-${document.documentId}`,
        sourceId: document.sourceId,
        title: resolveExternalFallbackTitle({
          title: document.title,
          entity: document.entity?.trim() || document.sourceId,
          action: document.action?.trim() || "更新",
          object: document.object,
        }),
        summary: document.summary,
        entity: document.entity?.trim() || document.sourceId,
        action: document.action?.trim() || "更新",
        object: document.object,
        theme,
        publishedAt: document.publishedAt,
        eventAt: document.eventAt,
        tier: document.sourceTier,
        score: 0,
        blockedReason,
        normalizedKey: "",
      };
      baseCandidate.normalizedKey = buildExternalEventKey(baseCandidate).eventKey;
      const score = scoreExternalEvent({
        theme,
        sourceTiers: [document.sourceTier],
        freshness,
        blockedReason,
        summary: document.summary,
      });
      const candidate = {
        ...baseCandidate,
        score: score.totalScore,
      };
      await store.upsertExternalEventCandidate({
        ...candidate,
        documentId: document.documentId,
        sourceUrl: document.sourceUrl,
        rawJson: JSON.stringify(document),
      });
      if (filter.decision.accepted && filter.decision.stage === "candidate" && !blockedReason) {
        acceptedCandidates.push(candidate);
      }
    }

    const clustered = clusterExternalCandidates(acceptedCandidates);
    const cardMap = new Map<string, HetangExternalEventCard>();
    const cardTitleMap = new Map<string, string>();
    for (const cluster of clustered) {
      const clusterCandidates = cluster.candidateIds
        .map((candidateId) => acceptedCandidates.find((entry) => entry.candidateId === candidateId))
        .filter((entry): entry is HetangExternalEventCandidate => Boolean(entry));
      const representative =
        [...clusterCandidates].sort((left, right) => {
          if (right.score !== left.score) {
            return right.score - left.score;
          }
          return right.publishedAt.localeCompare(left.publishedAt);
        })[0] ?? clusterCandidates[0];
      if (!representative) {
        continue;
      }
      const cardSources = cluster.sourceIds.map((sourceId) => {
        const matchingDocument = clusterCandidates
          .map((candidate) => documentById.get(candidate.candidateId.replace(/^candidate-/u, "")))
          .find((entry) => entry?.sourceId === sourceId);
        const matchingCandidate = clusterCandidates.find(
          (candidate) => candidate.sourceId === sourceId,
        );
        return {
          sourceId,
          displayName: resolveExternalSourceDisplayName(this.deps.config, sourceId),
          tier: matchingCandidate?.tier ?? "b",
          url: matchingDocument?.sourceUrl,
        };
      });
      const card: HetangExternalEventCard = {
        ...cluster.card,
        sources: cardSources,
      };
      cardMap.set(card.cardId, card);
      cardTitleMap.set(card.cardId, representative.title);
      await store.upsertExternalEventCard({
        ...card,
        issueDate: resolveLocalDate(now, this.deps.config.timeZone),
        candidateIds: cluster.candidateIds,
        sourceDocumentIds: clusterCandidates.map((candidate) =>
          candidate.candidateId.replace(/^candidate-/u, ""),
        ),
        sourceUrls: cardSources.map((source) => source.url ?? "").filter(Boolean),
      });
    }

    const assembled = assembleTopExternalBrief(
      clustered.map((cluster) => {
        const title =
          cardTitleMap.get(cluster.card.cardId) ??
          resolveExternalFallbackTitle({
            entity: cluster.card.entity,
            action: cluster.card.action,
            object: cluster.card.object,
          });
        const fallback = buildFallbackExternalNarrative({
          item: {
            title,
            theme: cluster.card.theme,
            entity: cluster.card.entity,
            summary: cluster.card.summary,
            whyItMatters: "",
            publishedAt: cluster.card.publishedAt,
          },
          card: cluster.card,
        });
        return {
          cardId: cluster.card.cardId,
          title,
          entity: cluster.card.entity,
          theme: cluster.card.theme,
          sourceIds: cluster.sourceIds,
          score: cluster.card.score,
          summary: fallback.summary,
          whyItMatters: fallback.whyItMatters,
          publishedAt: cluster.card.publishedAt,
        };
      }),
    );
    const selectedItems = assembled.items.slice(
      0,
      this.deps.config.externalIntelligence.maxItemsPerIssue,
    );
    if (selectedItems.length === 0) {
      return null;
    }

    const issueDate = resolveLocalDate(now, this.deps.config.timeZone);
    const issueId = `ext-brief-${issueDate}`;
    const briefItems: HetangExternalBriefItem[] = [];
    const renderItems: Array<{
      rank: number;
      title: string;
      theme: string;
      publishedAt: string;
      sourceLabels: string[];
      summary: string;
      whyItMatters: string;
    }> = [];

    for (const item of selectedItems) {
      const card = cardMap.get(item.cardId);
      if (!card) {
        continue;
      }
      const narrative = await enrichExternalBriefItemNarrative({
        item,
        card,
        llm: this.deps.externalBriefLlm,
      });
      briefItems.push({
        itemId: `${issueId}-${item.rank}`,
        cardId: item.cardId,
        title: item.title,
        theme: item.theme,
        summary: narrative.summary,
        whyItMatters: narrative.whyItMatters,
        score: item.score,
        rank: item.rank,
      });
      renderItems.push({
        rank: item.rank,
        title: item.title,
        theme: item.theme,
        publishedAt: item.publishedAt,
        sourceLabels: card.sources.map((source) => source.displayName || source.sourceId),
        summary: narrative.summary,
        whyItMatters: narrative.whyItMatters,
      });
    }

    const topic = resolveExternalTopic();
    const markdown = renderExternalBriefIssue({
      issueDate,
      topic,
      overview: resolveExternalIssueOverview(briefItems),
      items: renderItems,
    });
    await store.createExternalBriefIssue({
      issueId,
      issueDate,
      topic,
      createdAt: now.toISOString(),
      items: briefItems,
    });

    let delivered = false;
    if (params.deliver) {
      await this.deliverExternalBriefIssue({ message: markdown });
      delivered = true;
    }

    return {
      issueId,
      issueDate,
      topic,
      markdown,
      items: briefItems,
      delivered,
      itemCount: briefItems.length,
      sourceDocumentCount: documents.length,
      candidateCount: acceptedCandidates.length,
      cardCount: clustered.length,
    };
  }
}
