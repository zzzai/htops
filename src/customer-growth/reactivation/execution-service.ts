import type {
  ConsumeBillRecord,
  HetangLogger,
  HetangOpsConfig,
  MemberReactivationActionLoopSummary,
  MemberReactivationActionLoopTask,
  MemberReactivationExecutionSummary,
  MemberReactivationExecutionTaskRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationFeedbackStatus,
  MemberReactivationFollowupBucket,
  MemberReactivationOutcomeSnapshotRecord,
  MemberReactivationPriorityBand,
  MemberReactivationQueueRecord,
  RechargeBillRecord,
} from "../../types.js";
import { shiftBizDate } from "../../time.js";
import { buildCustomerGrowthFollowupSummary } from "../ai/followup-summarizer.js";
import { extractConsumeCustomerIdentityKeys } from "../intelligence.js";
import { buildMemberReactivationOutcomeSnapshot } from "./learning.js";

type ReactivationExecutionStore = {
  listMemberReactivationQueue: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationQueueRecord[]>;
  listMemberReactivationFeedback: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationFeedbackRecord[]>;
  upsertMemberReactivationFeedback: (row: MemberReactivationFeedbackRecord) => Promise<void>;
  upsertMemberReactivationOutcomeSnapshot: (
    row: MemberReactivationOutcomeSnapshotRecord,
  ) => Promise<void>;
  listConsumeBillsByDateRange?: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<ConsumeBillRecord[]>;
  listRechargeBillsByDateRange?: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<RechargeBillRecord[]>;
};

function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function compareByCountThenKey<T extends string>(
  left: { key: T; count: number },
  right: { key: T; count: number },
): number {
  if (right.count !== left.count) {
    return right.count - left.count;
  }
  return left.key.localeCompare(right.key);
}

function buildExecutionTasks(params: {
  queueRows: MemberReactivationQueueRecord[];
  feedbackRows: MemberReactivationFeedbackRecord[];
}): MemberReactivationExecutionTaskRecord[] {
  const feedbackByMemberId = new Map(
    params.feedbackRows.map((row) => [row.memberId, row] as const),
  );
  return params.queueRows.map((row) => {
    const feedback = feedbackByMemberId.get(row.memberId);
    return {
      ...row,
      feedbackStatus: feedback?.feedbackStatus ?? "pending",
      followedBy: feedback?.followedBy,
      followedAt: feedback?.followedAt,
      contacted: feedback?.contacted ?? false,
      replied: feedback?.replied ?? false,
      booked: feedback?.booked ?? false,
      arrived: feedback?.arrived ?? false,
      note: feedback?.note,
      feedbackUpdatedAt: feedback?.updatedAt,
    };
  });
}

function buildHighBalanceSleepingTouchScript(task: MemberReactivationExecutionTaskRecord): string {
  const name = task.customerDisplayName || "姐";
  const techHint = task.topTechName ? `，${task.topTechName}这边我也帮您看下档期` : "";
  const bookedHint = /已约|周[一二三四五六日天]|明天|下午|晚上|上午/u.test(task.note ?? "")
    ? `您这边${task.note?.replace(/[。.]$/u, "") ?? "已确认时间"}`
    : "";
  if (task.feedbackStatus === "booked" || task.booked) {
    return `${name}，${bookedHint || "您这边已经约好到店时间"}${techHint}，到店前我再提醒您一次。`;
  }
  if (task.topTechName) {
    return `${name}，您有一段时间没来了，卡里还有余额。我先按您熟悉的${task.topTechName}帮您看一个合适档期，您这两天哪天方便？`;
  }
  return `${name}，您有一段时间没来了，卡里还有余额。我先帮您留一个舒服的时间段，您这两天哪天方便到店？`;
}

function normalizeIdentityValue(value: unknown): string | undefined {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function parseRawJsonRecord(rawJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildActionLoopIdentityKeys(task: MemberReactivationExecutionTaskRecord): Set<string> {
  const keys = new Set<string>();
  keys.add(task.customerIdentityKey);
  keys.add(`member:${task.memberId}`);
  for (const value of [task.memberCardNo, task.referenceCode]) {
    const normalized = normalizeIdentityValue(value);
    if (normalized) {
      keys.add(`customer-ref:${normalized}`);
    }
  }
  const displayName = normalizeIdentityValue(task.customerDisplayName);
  if (displayName) {
    keys.add(`display-name:${displayName}`);
  }
  return keys;
}

function buildRawIdentityTokens(task: MemberReactivationExecutionTaskRecord): string[] {
  return [task.memberId, task.memberCardNo, task.referenceCode]
    .map((value) => normalizeIdentityValue(value))
    .filter((value): value is string => Boolean(value && value.length >= 4));
}

function rawJsonContainsIdentityToken(rawJson: string, task: MemberReactivationExecutionTaskRecord): boolean {
  const normalizedRaw = rawJson.toLowerCase();
  return buildRawIdentityTokens(task).some((token) => normalizedRaw.includes(token));
}

function rechargeIdentityKeys(rawJson: string): Set<string> {
  const parsed = parseRawJsonRecord(rawJson);
  const keys = new Set<string>();
  for (const field of ["MemberId", "memberId", "MemberID", "CustomerId", "customerId"]) {
    const normalized = normalizeIdentityValue(parsed[field]);
    if (normalized) {
      keys.add(`member:${normalized}`);
    }
  }
  for (const field of [
    "CardNo",
    "CCode",
    "MemberPhone",
    "Phone",
    "MemberCardNo",
    "ReferenceCode",
  ]) {
    const normalized = normalizeIdentityValue(parsed[field]);
    if (normalized) {
      keys.add(`customer-ref:${normalized}`);
    }
  }
  for (const field of ["MemberName", "Name", "CustomerName"]) {
    const normalized = normalizeIdentityValue(parsed[field]);
    if (normalized) {
      keys.add(`display-name:${normalized}`);
    }
  }
  return keys;
}

function intersects(left: Set<string>, right: Iterable<string>): boolean {
  for (const key of right) {
    if (left.has(key)) {
      return true;
    }
  }
  return false;
}

type ActionLoopFactResult = {
  consumeAmount: number;
  rechargeAmount: number;
};

function buildActionLoopFactResults(params: {
  tasks: MemberReactivationExecutionTaskRecord[];
  consumeBills: ConsumeBillRecord[];
  rechargeBills: RechargeBillRecord[];
}): Map<string, ActionLoopFactResult> {
  const results = new Map<string, ActionLoopFactResult>();
  for (const task of params.tasks) {
    const taskKeys = buildActionLoopIdentityKeys(task);
    let consumeAmount = 0;
    let rechargeAmount = 0;

    for (const bill of params.consumeBills) {
      if (bill.antiFlag) {
        continue;
      }
      const billKeys = new Set(extractConsumeCustomerIdentityKeys(bill.rawJson));
      if (intersects(taskKeys, billKeys) || rawJsonContainsIdentityToken(bill.rawJson, task)) {
        consumeAmount += Math.max(bill.payAmount, 0);
      }
    }

    for (const bill of params.rechargeBills) {
      if (bill.antiFlag) {
        continue;
      }
      const billKeys = rechargeIdentityKeys(bill.rawJson);
      if (intersects(taskKeys, billKeys) || rawJsonContainsIdentityToken(bill.rawJson, task)) {
        rechargeAmount += Math.max(bill.realityAmount, 0);
      }
    }

    results.set(task.memberId, {
      consumeAmount: Math.round((consumeAmount + Number.EPSILON) * 100) / 100,
      rechargeAmount: Math.round((rechargeAmount + Number.EPSILON) * 100) / 100,
    });
  }
  return results;
}

function toActionLoopTask(params: {
  task: MemberReactivationExecutionTaskRecord;
  ownerFallback?: string;
  factResult?: ActionLoopFactResult;
}): MemberReactivationActionLoopTask {
  const owner = params.task.followedBy?.trim() || params.ownerFallback?.trim() || "待分配";
  const closed = params.task.feedbackStatus === "closed";
  const consumeAmount = params.factResult?.consumeAmount ?? 0;
  const rechargeAmount = params.factResult?.rechargeAmount ?? 0;
  return {
    memberId: params.task.memberId,
    customerDisplayName: params.task.customerDisplayName,
    priorityBand: params.task.priorityBand,
    selectionReason: params.task.reasonSummary,
    touchScript: buildHighBalanceSleepingTouchScript(params.task),
    owner,
    executionStatus: params.task.feedbackStatus,
    arrivalResult: params.task.arrived ? "done" : closed ? "not_applicable" : "pending",
    consumeResult: consumeAmount > 0 ? "done" : closed ? "not_applicable" : "pending",
    rechargeResult: rechargeAmount > 0 ? "done" : closed ? "not_applicable" : "pending",
    consumeAmount: consumeAmount > 0 ? consumeAmount : undefined,
    rechargeAmount: rechargeAmount > 0 ? rechargeAmount : undefined,
    note: params.task.note,
  };
}

export class HetangReactivationExecutionService {
  constructor(
    private readonly deps: {
      config?: HetangOpsConfig;
      getStore: () => Promise<ReactivationExecutionStore>;
      logger?: HetangLogger;
    },
  ) {}

  async listExecutionTasks(params: {
    orgId: string;
    bizDate: string;
    limit?: number;
    includeAiAdvisory?: boolean;
    feedbackStatus?: MemberReactivationFeedbackStatus;
    priorityBand?: MemberReactivationPriorityBand;
    followupBucket?: MemberReactivationFollowupBucket;
  }): Promise<MemberReactivationExecutionTaskRecord[]> {
    const store = await this.deps.getStore();
    const [queueRows, feedbackRows] = await Promise.all([
      store.listMemberReactivationQueue(params.orgId, params.bizDate),
      store.listMemberReactivationFeedback(params.orgId, params.bizDate),
    ]);
    const merged = buildExecutionTasks({ queueRows, feedbackRows }).filter((row) => {
      if (params.feedbackStatus && row.feedbackStatus !== params.feedbackStatus) {
        return false;
      }
      if (params.priorityBand && row.priorityBand !== params.priorityBand) {
        return false;
      }
      if (params.followupBucket && row.followupBucket !== params.followupBucket) {
        return false;
      }
      return true;
    });
    const limit = Math.max(1, Math.trunc(params.limit ?? merged.length ?? 20));
    const limited = merged.slice(0, limit);
    const config = this.deps.config;
    if (!config || params.includeAiAdvisory === false) {
      return limited;
    }
    return await Promise.all(
      limited.map(async (task) => {
        if (!task.note?.trim()) {
          return task;
        }
        const summary = await buildCustomerGrowthFollowupSummary({
          config,
          logger: this.deps.logger,
          facts: {
            orgId: params.orgId,
            bizDate: params.bizDate,
            memberId: task.memberId,
            customerName: task.customerDisplayName,
            feedbackStatus: task.feedbackStatus,
            note: task.note,
            task: {
              priorityBand: task.priorityBand,
              followupBucket: task.followupBucket,
              recommendedActionLabel: task.recommendedActionLabel,
              recommendedTouchWeekday: task.recommendedTouchWeekday,
              recommendedTouchDaypart: task.recommendedTouchDaypart,
            },
          },
        });
        return summary
          ? {
              ...task,
              aiAdvisory: {
                followupSummary: summary,
              },
            }
          : task;
      }),
    );
  }

  async getExecutionSummary(params: {
    orgId: string;
    bizDate: string;
    pendingLimit?: number;
  }): Promise<MemberReactivationExecutionSummary> {
    const tasks = await this.listExecutionTasks({
      orgId: params.orgId,
      bizDate: params.bizDate,
      includeAiAdvisory: false,
    });
    const statusCounts = new Map<MemberReactivationFeedbackStatus, number>();
    const priorityCounts = new Map<MemberReactivationPriorityBand, number>();
    const bucketCounts = new Map<MemberReactivationFollowupBucket, number>();

    for (const task of tasks) {
      statusCounts.set(task.feedbackStatus, (statusCounts.get(task.feedbackStatus) ?? 0) + 1);
      priorityCounts.set(task.priorityBand, (priorityCounts.get(task.priorityBand) ?? 0) + 1);
      bucketCounts.set(task.followupBucket, (bucketCounts.get(task.followupBucket) ?? 0) + 1);
    }

    const totalTaskCount = tasks.length;
    const pendingCount = statusCounts.get("pending") ?? 0;
    const contactedCount = statusCounts.get("contacted") ?? 0;
    const repliedCount = statusCounts.get("replied") ?? 0;
    const bookedCount = statusCounts.get("booked") ?? 0;
    const arrivedCount = statusCounts.get("arrived") ?? 0;
    const closedCount = statusCounts.get("closed") ?? 0;

    return {
      orgId: params.orgId,
      bizDate: params.bizDate,
      totalTaskCount,
      pendingCount,
      contactedCount,
      repliedCount,
      bookedCount,
      arrivedCount,
      closedCount,
      contactRate: percent(contactedCount + repliedCount + bookedCount + arrivedCount + closedCount, totalTaskCount),
      bookingRate: percent(bookedCount + arrivedCount, totalTaskCount),
      arrivalRate: percent(arrivedCount, totalTaskCount),
      priorityBandCounts: Array.from(priorityCounts.entries())
        .map(([priorityBand, count]) => ({ priorityBand, count }))
        .sort((left, right) =>
          compareByCountThenKey(
            { key: left.priorityBand, count: left.count },
            { key: right.priorityBand, count: right.count },
          ),
        ),
      followupBucketCounts: Array.from(bucketCounts.entries())
        .map(([followupBucket, count]) => ({ followupBucket, count }))
        .sort((left, right) =>
          compareByCountThenKey(
            { key: left.followupBucket, count: left.count },
            { key: right.followupBucket, count: right.count },
          ),
        ),
      topPendingTasks: tasks
        .filter((task) => task.feedbackStatus === "pending")
        .slice(0, Math.max(1, Math.trunc(params.pendingLimit ?? 5))),
    };
  }

  async getHighBalanceSleepingMemberActionLoop(params: {
    orgId: string;
    bizDate: string;
    limit?: number;
    ownerFallback?: string;
    resultWindowDays?: number;
  }): Promise<MemberReactivationActionLoopSummary> {
    const tasks = await this.listExecutionTasks({
      orgId: params.orgId,
      bizDate: params.bizDate,
      includeAiAdvisory: false,
      followupBucket: "high-value-reactivation",
      limit: params.limit,
    });
    const factResults = await this.loadActionLoopFactResults({
      orgId: params.orgId,
      bizDate: params.bizDate,
      tasks,
      resultWindowDays: params.resultWindowDays,
    });
    const actionTasks = tasks.map((task) =>
      toActionLoopTask({
        task,
        ownerFallback: params.ownerFallback,
        factResult: factResults.get(task.memberId),
      }),
    );
    const assignedCount = actionTasks.filter((task) => task.owner !== "待分配").length;
    return {
      orgId: params.orgId,
      bizDate: params.bizDate,
      theme: "high-balance-sleeping-member-reactivation",
      totalTaskCount: actionTasks.length,
      ownerCoverage: {
        assignedCount,
        unassignedCount: actionTasks.length - assignedCount,
      },
      results: {
        arrivedCount: actionTasks.filter((task) => task.arrivalResult === "done").length,
        consumedCount: actionTasks.filter((task) => task.consumeResult === "done").length,
        rechargedCount: actionTasks.filter((task) => task.rechargeResult === "done").length,
      },
      tasks: actionTasks,
    };
  }

  private async loadActionLoopFactResults(params: {
    orgId: string;
    bizDate: string;
    tasks: MemberReactivationExecutionTaskRecord[];
    resultWindowDays?: number;
  }): Promise<Map<string, ActionLoopFactResult>> {
    if (params.tasks.length === 0) {
      return new Map();
    }
    const store = await this.deps.getStore();
    if (!store.listConsumeBillsByDateRange || !store.listRechargeBillsByDateRange) {
      return new Map();
    }
    const resultWindowDays = Math.max(1, Math.trunc(params.resultWindowDays ?? 14));
    const endBizDate = shiftBizDate(params.bizDate, resultWindowDays - 1);
    try {
      const [consumeBills, rechargeBills] = await Promise.all([
        store.listConsumeBillsByDateRange(params.orgId, params.bizDate, endBizDate),
        store.listRechargeBillsByDateRange(params.orgId, params.bizDate, endBizDate),
      ]);
      return buildActionLoopFactResults({
        tasks: params.tasks,
        consumeBills,
        rechargeBills,
      });
    } catch (error) {
      this.deps.logger?.warn("failed to load reactivation action-loop result facts", {
        orgId: params.orgId,
        bizDate: params.bizDate,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  async upsertExecutionFeedback(row: MemberReactivationFeedbackRecord): Promise<void> {
    const store = await this.deps.getStore();
    await store.upsertMemberReactivationFeedback(row);
    const queueRows = await store.listMemberReactivationQueue(row.orgId, row.bizDate);
    const queueRow = queueRows.find((entry) => entry.memberId === row.memberId);
    if (!queueRow) {
      return;
    }
    const task = buildExecutionTasks({
      queueRows: [queueRow],
      feedbackRows: [row],
    })[0];
    if (!task) {
      return;
    }
    const aiSummary =
      this.deps.config && row.note?.trim()
        ? await buildCustomerGrowthFollowupSummary({
            config: this.deps.config,
            logger: this.deps.logger,
            facts: {
              orgId: row.orgId,
              bizDate: row.bizDate,
              memberId: row.memberId,
              customerName: task.customerDisplayName,
              feedbackStatus: row.feedbackStatus,
              note: row.note,
              task: {
                priorityBand: task.priorityBand,
                followupBucket: task.followupBucket,
                recommendedActionLabel: task.recommendedActionLabel,
                recommendedTouchWeekday: task.recommendedTouchWeekday,
                recommendedTouchDaypart: task.recommendedTouchDaypart,
              },
            },
          })
        : null;
    await store.upsertMemberReactivationOutcomeSnapshot(
      buildMemberReactivationOutcomeSnapshot({
        task,
        aiSummary,
      }),
    );
  }
}
