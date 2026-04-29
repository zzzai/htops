import { HetangOpsStore } from "../store.js";
import type {
  ConsumeBillRecord,
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  DailyStoreReport,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  RechargeBillRecord,
  StoreManagerDailyKpiRow,
  HetangStoreExternalContextEntry,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechLeaderboardRow,
  TechMarketRecord,
  TechProfile30dRow,
  TechUpClockRecord,
} from "../types.js";

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function percent(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function normalizeClockType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function isPointClockRecord(params: { clockType?: string; rawJson: string }): boolean {
  const normalized = normalizeClockType(params.clockType);
  if (
    normalized === "2" ||
    normalized === "point" ||
    normalized === "点钟" ||
    normalized === "pointclock"
  ) {
    return true;
  }
  try {
    const parsed = JSON.parse(params.rawJson) as { ClockType?: unknown };
    const raw = normalizeClockType(String(parsed.ClockType ?? ""));
    return raw === "2" || raw === "point" || raw === "点钟" || raw === "pointclock";
  } catch {
    return false;
  }
}

function isAddClockRecord(rawJson: string): boolean {
  try {
    const parsed = JSON.parse(rawJson) as { AddClockType?: unknown };
    const raw = String(parsed.AddClockType ?? "")
      .trim()
      .toLowerCase();
    return raw.length > 0 && raw !== "0" && raw !== "false" && raw !== "null";
  } catch {
    return false;
  }
}

type MartDerivedReadStore = {
  getDailyReport?: (orgId: string, bizDate: string) => Promise<DailyStoreReport | null>;
  listCustomerTechLinks: (orgId: string, bizDate: string) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<CustomerTechLinkRecord[]>;
  listCustomerSegments: (orgId: string, bizDate: string) => Promise<CustomerSegmentRecord[]>;
  listMemberReactivationFeatures?: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationFeatureRecord[]>;
  listMemberReactivationStrategies?: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationStrategyRecord[]>;
  listMemberReactivationQueue?: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationQueueRecord[]>;
  listMemberReactivationFeedback?: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationFeedbackRecord[]>;
  listCustomerProfile90dByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<CustomerProfile90dRow[]>;
  listStoreManagerDailyKpiByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<StoreManagerDailyKpiRow[]>;
  listTechProfile30dByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<TechProfile30dRow[]>;
  listStoreReview7dByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<StoreReview7dRow[]>;
  listStoreSummary30dByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<StoreSummary30dRow[]>;
};

export class HetangQueryReadService {
  constructor(
    private readonly deps: {
      getStore: () => Promise<HetangOpsStore>;
      getCurrentServingVersion: () => Promise<string>;
      executeCompiledServingQuery: (params: {
        sql: string;
        queryParams?: unknown[];
        cacheKey?: string;
        ttlSeconds?: number;
      }) => Promise<Record<string, unknown>[]>;
    },
  ) {}

  private async getStore() {
    return await this.deps.getStore();
  }

  private resolveMartDerivedStore(store: HetangOpsStore): MartDerivedReadStore {
    if (typeof (store as { getMartDerivedStore?: unknown }).getMartDerivedStore !== "function") {
      throw new Error("query-read-service requires store.getMartDerivedStore()");
    }
    return (
      store as {
        getMartDerivedStore: () => MartDerivedReadStore;
      }
    ).getMartDerivedStore();
  }

  async listTechLeaderboard(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechLeaderboardRow[]> {
    const store = await this.getStore();
    const [clockRows, marketRows] = await Promise.all([
      store.listTechUpClockByDateRange(params.orgId, params.startBizDate, params.endBizDate),
      store.listTechMarketByDateRange(params.orgId, params.startBizDate, params.endBizDate),
    ]);

    const leaderboard = new Map<string, TechLeaderboardRow>();
    for (const row of clockRows) {
      const key = row.personCode || row.personName;
      if (!key) {
        continue;
      }
      const current = leaderboard.get(key) ?? {
        personCode: row.personCode,
        personName: row.personName,
        totalClockCount: 0,
        upClockRecordCount: 0,
        pointClockRecordCount: 0,
        pointClockRate: null,
        addClockRecordCount: 0,
        addClockRate: null,
        turnover: 0,
        commission: 0,
        commissionRate: null,
        clockEffect: null,
        marketRevenue: 0,
        marketCommission: 0,
      };
      current.totalClockCount = round(current.totalClockCount + row.count, 4);
      current.upClockRecordCount += 1;
      if (isPointClockRecord({ clockType: row.clockType, rawJson: row.rawJson })) {
        current.pointClockRecordCount += 1;
      }
      if (isAddClockRecord(row.rawJson)) {
        current.addClockRecordCount += 1;
      }
      current.turnover = round(current.turnover + row.turnover, 4);
      current.commission = round(current.commission + row.comm, 4);
      leaderboard.set(key, current);
    }

    for (const row of marketRows) {
      const key = row.personCode || row.personName;
      if (!key) {
        continue;
      }
      const current = leaderboard.get(key) ?? {
        personCode: row.personCode ?? "",
        personName: row.personName ?? key,
        totalClockCount: 0,
        upClockRecordCount: 0,
        pointClockRecordCount: 0,
        pointClockRate: null,
        addClockRecordCount: 0,
        addClockRate: null,
        turnover: 0,
        commission: 0,
        commissionRate: null,
        clockEffect: null,
        marketRevenue: 0,
        marketCommission: 0,
      };
      current.marketRevenue = round(current.marketRevenue + row.afterDisc, 4);
      current.marketCommission = round(current.marketCommission + row.commission, 4);
      leaderboard.set(key, current);
    }

    return Array.from(leaderboard.values())
      .map((entry) => ({
        ...entry,
        pointClockRate: percent(entry.pointClockRecordCount, entry.upClockRecordCount),
        addClockRate: percent(entry.addClockRecordCount, entry.upClockRecordCount),
        commissionRate: percent(entry.commission, entry.turnover),
        clockEffect: percent(entry.turnover, entry.totalClockCount),
      }))
      .sort((left, right) => right.turnover - left.turnover);
  }

  async listCustomerTechLinks(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listCustomerTechLinks(params.orgId, params.bizDate);
  }

  async listCustomerTechLinksByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listCustomerTechLinksByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listCustomerSegments(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listCustomerSegments(params.orgId, params.bizDate);
  }

  async listMemberReactivationFeatures(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    if (typeof store.listMemberReactivationFeatures !== "function") {
      return [];
    }
    return await store.listMemberReactivationFeatures(params.orgId, params.bizDate);
  }

  async listMemberReactivationStrategies(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    if (typeof store.listMemberReactivationStrategies !== "function") {
      return [];
    }
    return await store.listMemberReactivationStrategies(params.orgId, params.bizDate);
  }

  async listMemberReactivationQueue(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    if (typeof store.listMemberReactivationQueue !== "function") {
      return [];
    }
    return await store.listMemberReactivationQueue(params.orgId, params.bizDate);
  }

  async listMemberReactivationFeedback(params: { orgId: string; bizDate: string }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    if (typeof store.listMemberReactivationFeedback !== "function") {
      return [];
    }
    return await store.listMemberReactivationFeedback(params.orgId, params.bizDate);
  }

  async listCustomerProfile90dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listCustomerProfile90dByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async getDailyReportSnapshot(params: { orgId: string; bizDate: string }): Promise<DailyStoreReport | null> {
    const store = this.resolveMartDerivedStore(await this.getStore());
    if (typeof store.getDailyReport !== "function") {
      return null;
    }
    return await store.getDailyReport(params.orgId, params.bizDate);
  }

  async getCurrentServingVersion(): Promise<string> {
    return await this.deps.getCurrentServingVersion();
  }

  async executeCompiledServingQuery(params: {
    sql: string;
    queryParams?: unknown[];
    cacheKey?: string;
    ttlSeconds?: number;
  }): Promise<Record<string, unknown>[]> {
    return await this.deps.executeCompiledServingQuery(params);
  }

  async listStoreManagerDailyKpiByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreManagerDailyKpiRow[]> {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listStoreManagerDailyKpiByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listTechProfile30dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechProfile30dRow[]> {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listTechProfile30dByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listStoreReview7dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreReview7dRow[]> {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listStoreReview7dByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listStoreSummary30dByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<StoreSummary30dRow[]> {
    const store = this.resolveMartDerivedStore(await this.getStore());
    return await store.listStoreSummary30dByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async findCurrentMembersByPhoneSuffix(params: { orgId: string; phoneSuffix: string }) {
    return await (await this.getStore()).findCurrentMembersByPhoneSuffix(
      params.orgId,
      params.phoneSuffix,
    );
  }

  async listCurrentMembers(params: { orgId: string }): Promise<MemberCurrentRecord[]> {
    return await (await this.getStore()).listCurrentMembers(params.orgId);
  }

  async listCurrentMemberCards(params: { orgId: string }): Promise<MemberCardCurrentRecord[]> {
    return await (await this.getStore()).listCurrentMemberCards(params.orgId);
  }

  async listConsumeBillsByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<ConsumeBillRecord[]> {
    return await (await this.getStore()).listConsumeBillsByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listRechargeBillsByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<RechargeBillRecord[]> {
    return await (await this.getStore()).listRechargeBillsByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listTechUpClockByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechUpClockRecord[]> {
    return await (await this.getStore()).listTechUpClockByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listTechMarketByDateRange(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }): Promise<TechMarketRecord[]> {
    return await (await this.getStore()).listTechMarketByDateRange(
      params.orgId,
      params.startBizDate,
      params.endBizDate,
    );
  }

  async listStoreExternalContextEntries(params: {
    orgId: string;
    snapshotDate?: string;
  }): Promise<HetangStoreExternalContextEntry[]> {
    const store = await this.getStore();
    return await store.listStoreExternalContextEntries(params);
  }
}
