import {
  decodeHetangAnalysisScopeOrgId,
  resolveHetangAnalysisStoreName,
} from "../analysis-router.js";
import { executeHetangQuery } from "../query-engine.js";
import { HetangOpsStore } from "../store.js";
import { resolveOperationalBizDateCompletionIso } from "../time.js";
import type {
  DailyStoreReport,
  HetangAnalysisEvidencePack,
  HetangAnalysisJob,
  HetangEmployeeBinding,
  HetangOpsConfig,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechLeaderboardRow,
} from "../types.js";

type HetangAnalysisExecutionQueryRuntime = Parameters<typeof executeHetangQuery>[0]["runtime"];

export class HetangAnalysisExecutionService {
  constructor(
    private readonly deps: {
      config: HetangOpsConfig;
      getStore: () => Promise<HetangOpsStore>;
      queryRuntime: HetangAnalysisExecutionQueryRuntime;
    },
  ) {}

  private resolveBindingScopeOrgIds(binding: HetangEmployeeBinding | null | undefined): string[] {
    if (!binding || binding.isActive === false || binding.role === "disabled") {
      return [];
    }
    if (binding.scopeOrgIds && binding.scopeOrgIds.length > 0) {
      return Array.from(new Set(binding.scopeOrgIds));
    }
    if (binding.orgId) {
      return [binding.orgId];
    }
    if (binding.role === "hq") {
      return this.deps.config.stores
        .filter((entry) => entry.isActive)
        .map((entry) => entry.orgId);
    }
    return [];
  }

  private async resolveAnalysisBinding(
    job: Pick<HetangAnalysisJob, "orgId" | "channel" | "senderId">,
  ): Promise<HetangEmployeeBinding> {
    const store = await this.deps.getStore();
    const binding =
      job.senderId &&
      job.channel &&
      typeof (store as { getEmployeeBinding?: unknown }).getEmployeeBinding === "function"
        ? await (
            store as {
              getEmployeeBinding: (params: {
                channel: string;
                senderId: string;
              }) => Promise<HetangEmployeeBinding | null>;
            }
          ).getEmployeeBinding({
            channel: job.channel,
            senderId: job.senderId,
          })
        : null;
    const decodedScopeOrgIds = decodeHetangAnalysisScopeOrgId(job.orgId);
    const scopeOrgIds =
      decodedScopeOrgIds !== null && decodedScopeOrgIds.length > 0
        ? decodedScopeOrgIds
        : this.resolveBindingScopeOrgIds(binding);

    if (binding) {
      return {
        ...binding,
        orgId: scopeOrgIds.length === 1 ? scopeOrgIds[0] : binding.orgId,
        scopeOrgIds: scopeOrgIds.length > 0 ? scopeOrgIds : binding.scopeOrgIds,
      };
    }

    const fallbackScopeOrgIds =
      scopeOrgIds.length > 0
        ? scopeOrgIds
        : this.deps.config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
    return {
      channel: job.channel,
      senderId: job.senderId ?? "analysis-runtime",
      employeeName: "AI 经营复盘",
      role: "hq",
      isActive: true,
      orgId: fallbackScopeOrgIds.length === 1 ? fallbackScopeOrgIds[0] : undefined,
      scopeOrgIds: fallbackScopeOrgIds,
      hourlyQuota: 999,
      dailyQuota: 9_999,
    };
  }

  private async resolveAnalysisStoreName(
    job: Pick<HetangAnalysisJob, "orgId" | "channel" | "senderId">,
  ): Promise<string> {
    const binding = await this.resolveAnalysisBinding(job);
    if (decodeHetangAnalysisScopeOrgId(job.orgId) === null && job.orgId !== "all") {
      const store = await this.deps.getStore();
      if (typeof (store as { getStoreName?: unknown }).getStoreName === "function") {
        return await (
          store as {
            getStoreName: (orgId: string) => Promise<string>;
          }
        ).getStoreName(job.orgId);
      }
    }
    return resolveHetangAnalysisStoreName({
      config: this.deps.config,
      orgId: job.orgId,
      fallbackScopeOrgIds: this.resolveBindingScopeOrgIds(binding),
    });
  }

  async decorateAnalysisJob(job: HetangAnalysisJob): Promise<HetangAnalysisJob> {
    return {
      ...job,
      storeName: await this.resolveAnalysisStoreName(job),
    };
  }

  private resolveAnalysisScopeOrgIds(
    job: Pick<HetangAnalysisJob, "orgId">,
    binding: HetangEmployeeBinding,
  ): string[] {
    const decodedScopeOrgIds = decodeHetangAnalysisScopeOrgId(job.orgId);
    if (decodedScopeOrgIds !== null && decodedScopeOrgIds.length > 0) {
      return decodedScopeOrgIds;
    }
    if (job.orgId === "all") {
      return this.deps.config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
    }
    if (job.orgId) {
      return [job.orgId];
    }
    return this.resolveBindingScopeOrgIds(binding);
  }

  private resolveAnchoredNow(job: Pick<HetangAnalysisJob, "endBizDate">): Date {
    return new Date(
      resolveOperationalBizDateCompletionIso({
        bizDate: job.endBizDate,
        timeZone: this.deps.config.timeZone,
        cutoffLocalTime: this.deps.config.sync.businessDayCutoffLocalTime,
      }),
    );
  }

  private formatCurrency(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "N/A";
    }
    return `${value.toFixed(2)} 元`;
  }

  private formatCount(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "N/A";
    }
    return `${value.toFixed(1)} 个`;
  }

  private formatPercent(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return "N/A";
    }
    return `${(value * 100).toFixed(1)}%`;
  }

  private summarizeLatestReport(report: DailyStoreReport | null): string | null {
    if (!report) {
      return null;
    }
    return [
      `营收 ${this.formatCurrency(report.metrics.serviceRevenue)}`,
      `总钟数 ${this.formatCount(report.metrics.totalClockCount)}`,
      `钟效 ${this.formatCurrency(report.metrics.clockEffect).replace(" 元", "")}/钟`,
      `点钟率 ${this.formatPercent(report.metrics.pointClockRate)}`,
      `加钟率 ${this.formatPercent(report.metrics.addClockRate)}`,
      `完整度 ${report.complete && !report.metrics.incompleteSync ? "完整" : "待补齐"}`,
    ].join("；");
  }

  private summarizeReview7d(review: StoreReview7dRow | null): string | null {
    if (!review) {
      return null;
    }
    return [
      `营收 ${this.formatCurrency(review.revenue7d)}`,
      `总钟数 ${this.formatCount(review.totalClocks7d)}`,
      `钟效 ${this.formatCurrency(review.clockEffect7d).replace(" 元", "")}/钟`,
      `点钟率 ${this.formatPercent(review.pointClockRate7d)}`,
      `加钟率 ${this.formatPercent(review.addClockRate7d)}`,
      `沉默会员率 ${this.formatPercent(review.sleepingMemberRate)}`,
    ].join("；");
  }

  private summarizeSummary30d(summary: StoreSummary30dRow | null): string | null {
    if (!summary) {
      return null;
    }
    return [
      `营收 ${this.formatCurrency(summary.revenue30d)}`,
      `总钟数 ${this.formatCount(summary.totalClocks30d)}`,
      `钟效 ${this.formatCurrency(summary.clockEffect30d).replace(" 元", "")}/钟`,
      `点钟率 ${this.formatPercent(summary.pointClockRate30d)}`,
      `加钟率 ${this.formatPercent(summary.addClockRate30d)}`,
      `储值余额 ${this.formatCurrency(summary.currentStoredBalance)}`,
    ].join("；");
  }

  private summarizeTopTechs(rows: TechLeaderboardRow[]): string | null {
    if (rows.length === 0) {
      return null;
    }
    return rows
      .slice(0, 3)
      .map(
        (row) =>
          `${row.personName} ${this.formatCurrency(row.turnover)} / 点钟率 ${this.formatPercent(row.pointClockRate)} / 加钟率 ${this.formatPercent(row.addClockRate)}`,
      )
      .join("；");
  }

  private summarizePortfolioSnapshot(params: {
    storeName: string;
    review7d: StoreReview7dRow | null;
    summary30d: StoreSummary30dRow | null;
  }): string | null {
    if (params.summary30d) {
      return [
        `${params.storeName}: 30日营收 ${this.formatCurrency(params.summary30d.revenue30d)}`,
        `钟效 ${this.formatCurrency(params.summary30d.clockEffect30d).replace(" 元", "")}/钟`,
        `沉默会员率 ${this.formatPercent(params.summary30d.sleepingMemberRate)}`,
        `续充压力 ${typeof params.summary30d.renewalPressureIndex30d === "number" ? params.summary30d.renewalPressureIndex30d.toFixed(2) : "N/A"}`,
      ].join("；");
    }
    if (params.review7d) {
      return [
        `${params.storeName}: 7日营收 ${this.formatCurrency(params.review7d.revenue7d)}`,
        `钟效 ${this.formatCurrency(params.review7d.clockEffect7d).replace(" 元", "")}/钟`,
        `沉默会员率 ${this.formatPercent(params.review7d.sleepingMemberRate)}`,
        `续充压力 ${typeof params.review7d.renewalPressureIndex30d === "number" ? params.review7d.renewalPressureIndex30d.toFixed(2) : "N/A"}`,
      ].join("；");
    }
    return null;
  }

  async buildAnalysisEvidencePack(job: HetangAnalysisJob): Promise<HetangAnalysisEvidencePack> {
    const binding = await this.resolveAnalysisBinding(job);
    const scopeOrgIds = this.resolveAnalysisScopeOrgIds(job, binding);
    const storeName = await this.resolveAnalysisStoreName(job);
    const anchoredNow = this.resolveAnchoredNow(job);

    if (scopeOrgIds.length <= 1) {
      const [orgId] = scopeOrgIds;
      if (!orgId) {
        return {
          packVersion: "v1",
          scopeType: "single_store",
          orgIds: [],
          storeName,
          question: job.rawText,
          timeFrameLabel: job.timeFrameLabel,
          startBizDate: job.startBizDate,
          endBizDate: job.endBizDate,
          markdown: [
            "证据包",
            `- 门店: ${storeName}`,
            `- 周期: ${job.startBizDate} 至 ${job.endBizDate}（${job.timeFrameLabel}）`,
            "- 当前未能解析有效门店范围。",
          ].join("\n"),
          facts: {},
        };
      }

      const [report, reviewRows, summaryRows, techRows] = await Promise.all([
        this.deps.queryRuntime.buildReport({
          orgId,
          bizDate: job.endBizDate,
          now: anchoredNow,
        }),
        this.deps.queryRuntime.listStoreReview7dByDateRange?.({
          orgId,
          startBizDate: job.endBizDate,
          endBizDate: job.endBizDate,
        }) ?? Promise.resolve([]),
        this.deps.queryRuntime.listStoreSummary30dByDateRange?.({
          orgId,
          startBizDate: job.endBizDate,
          endBizDate: job.endBizDate,
        }) ?? Promise.resolve([]),
        this.deps.queryRuntime.listTechLeaderboard?.({
          orgId,
          startBizDate: job.startBizDate,
          endBizDate: job.endBizDate,
        }) ?? Promise.resolve([]),
      ]);

      const review = reviewRows[0] ?? null;
      const summary30d = summaryRows[0] ?? null;
      const lines = [
        "证据包",
        `- 门店: ${storeName}`,
        `- 周期: ${job.startBizDate} 至 ${job.endBizDate}（${job.timeFrameLabel}）`,
        `- 问题: ${job.rawText}`,
      ];
      const latestReportSummary = this.summarizeLatestReport(report);
      if (latestReportSummary) {
        lines.push(`- 最新日报: ${latestReportSummary}`);
      }
      const reviewSummary = this.summarizeReview7d(review);
      if (reviewSummary) {
        lines.push(`- 7日复盘: ${reviewSummary}`);
      }
      const summary30dText = this.summarizeSummary30d(summary30d);
      if (summary30dText) {
        lines.push(`- 30日摘要: ${summary30dText}`);
      }
      const techSummary = this.summarizeTopTechs(techRows);
      if (techSummary) {
        lines.push(`- 技师样本: ${techSummary}`);
      }

      return {
        packVersion: "v1",
        scopeType: "single_store",
        orgIds: [orgId],
        storeName,
        question: job.rawText,
        timeFrameLabel: job.timeFrameLabel,
        startBizDate: job.startBizDate,
        endBizDate: job.endBizDate,
        markdown: lines.join("\n"),
        facts: {
          latestReport: report,
          review7d: review,
          summary30d,
          topTechs: techRows.slice(0, 3),
        },
      };
    }

    const portfolioSnapshots = await Promise.all(
      scopeOrgIds.map(async (orgId) => {
        const [report, reviewRows, summaryRows] = await Promise.all([
          this.deps.queryRuntime.buildReport({
            orgId,
            bizDate: job.endBizDate,
            now: anchoredNow,
          }),
          this.deps.queryRuntime.listStoreReview7dByDateRange?.({
            orgId,
            startBizDate: job.endBizDate,
            endBizDate: job.endBizDate,
          }) ?? Promise.resolve([]),
          this.deps.queryRuntime.listStoreSummary30dByDateRange?.({
            orgId,
            startBizDate: job.endBizDate,
            endBizDate: job.endBizDate,
          }) ?? Promise.resolve([]),
        ]);
        return {
          orgId,
          storeName: report.storeName,
          latestReport: report,
          review7d: reviewRows[0] ?? null,
          summary30d: summaryRows[0] ?? null,
        };
      }),
    );
    const lines = [
      "证据包",
      `- 范围: ${storeName}`,
      `- 周期: ${job.startBizDate} 至 ${job.endBizDate}（${job.timeFrameLabel}）`,
      `- 问题: ${job.rawText}`,
      "- 最新日报样本:",
      ...portfolioSnapshots
        .sort(
          (left, right) =>
            right.latestReport.metrics.serviceRevenue - left.latestReport.metrics.serviceRevenue,
        )
        .slice(0, 5)
        .map(
          ({ storeName: currentStoreName, latestReport }) =>
            `  - ${currentStoreName}: 营收 ${this.formatCurrency(latestReport.metrics.serviceRevenue)}；总钟数 ${this.formatCount(latestReport.metrics.totalClockCount)}；钟效 ${this.formatCurrency(latestReport.metrics.clockEffect).replace(" 元", "")}/钟；沉默会员率 ${this.formatPercent(latestReport.metrics.sleepingMemberRate)}`,
        ),
    ];
    const stableSnapshotLines = portfolioSnapshots
      .map((entry) =>
        this.summarizePortfolioSnapshot({
          storeName: entry.storeName,
          review7d: entry.review7d,
          summary30d: entry.summary30d,
        }),
      )
      .filter((entry): entry is string => Boolean(entry));
    if (stableSnapshotLines.length > 0) {
      lines.push("- 稳定摘要样本:", ...stableSnapshotLines.slice(0, 5).map((entry) => `  - ${entry}`));
    }

    return {
      packVersion: "v1",
      scopeType: "portfolio",
      orgIds: scopeOrgIds,
      storeName,
      question: job.rawText,
      timeFrameLabel: job.timeFrameLabel,
      startBizDate: job.startBizDate,
      endBizDate: job.endBizDate,
      markdown: lines.join("\n"),
      facts: {
        latestReports: portfolioSnapshots.map((entry) => entry.latestReport),
        portfolioSnapshots,
      },
    };
  }

  async runScopedQueryAnalysis(job: HetangAnalysisJob): Promise<string> {
    const binding = await this.resolveAnalysisBinding(job);
    const anchoredNow = this.resolveAnchoredNow(job);
    const result = await executeHetangQuery({
      runtime: this.deps.queryRuntime,
      config: this.deps.config,
      binding,
      text: job.rawText,
      now: anchoredNow,
    });
    return result.text;
  }
}
