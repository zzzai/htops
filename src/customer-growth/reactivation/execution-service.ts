import type {
  HetangLogger,
  HetangOpsConfig,
  MemberReactivationExecutionSummary,
  MemberReactivationExecutionTaskRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationFeedbackStatus,
  MemberReactivationFollowupBucket,
  MemberReactivationOutcomeSnapshotRecord,
  MemberReactivationPriorityBand,
  MemberReactivationQueueRecord,
} from "../../types.js";
import { buildCustomerGrowthFollowupSummary } from "../ai/followup-summarizer.js";
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
