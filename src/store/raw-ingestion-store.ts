import type {
  ConsumeBillRecord,
  EndpointCode,
  HetangHistoricalCoverageSnapshot,
  MemberCardCurrentRecord,
  MemberCurrentRecord,
  RechargeBillRecord,
  TechCommissionSnapshotRecord,
  TechCurrentRecord,
  TechMarketRecord,
  TechUpClockRecord,
  UserTradeRecord,
} from "../types.js";

type RawIngestionLegacyStore = {
  beginSyncRun: (params: { orgId: string; mode: string; startedAt: string }) => Promise<string>;
  finishSyncRun: (params: {
    syncRunId: string;
    status: string;
    finishedAt: string;
    details?: unknown;
  }) => Promise<void>;
  recordSyncError: (params: {
    syncRunId: string;
    orgId: string;
    endpoint: string;
    errorAt: string;
    errorMessage: string;
  }) => Promise<void>;
  setEndpointWatermark: (params: {
    orgId: string;
    endpoint: string;
    lastSuccessAt: string;
  }) => Promise<void>;
  getEndpointWatermark: (orgId: string, endpoint: string) => Promise<string | null>;
  getEndpointWatermarksForOrg: (orgId: string) => Promise<Record<string, string>>;
  recordRawBatch: (params: {
    syncRunId: string;
    orgId: string;
    endpoint: EndpointCode;
    fetchedAt: string;
    rowCount: number;
    requestJson?: string;
  }) => Promise<string>;
  recordRawRows: (params: {
    rawBatchId: string;
    endpoint: EndpointCode;
    orgId: string;
    rows: Array<Record<string, unknown>>;
  }) => Promise<void>;
  getRawRowSeenCount: (endpoint: string, orgId: string, rowKey: string) => Promise<number>;
  getHistoricalCoverageSnapshot: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<HetangHistoricalCoverageSnapshot>;
  upsertMemberCurrent: (rows: MemberCurrentRecord[]) => Promise<void>;
  snapshotMembers: (bizDate: string, rows: MemberCurrentRecord[]) => Promise<void>;
  replaceMemberDailySnapshots: (
    orgId: string,
    bizDate: string,
    rows: MemberCurrentRecord[],
  ) => Promise<void>;
  upsertMemberCards: (rows: MemberCardCurrentRecord[]) => Promise<void>;
  snapshotMemberCards: (bizDate: string, rows: MemberCardCurrentRecord[]) => Promise<void>;
  replaceMemberCardDailySnapshots: (
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ) => Promise<void>;
  upsertConsumeBills: (
    rows: ConsumeBillRecord[],
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  upsertRechargeBills: (
    rows: RechargeBillRecord[],
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  upsertUserTrades: (rows: UserTradeRecord[]) => Promise<void>;
  upsertTechCurrent: (rows: TechCurrentRecord[]) => Promise<void>;
  snapshotTechCurrent: (bizDate: string, rows: TechCurrentRecord[]) => Promise<void>;
  upsertTechUpClockRows: (
    rows: TechUpClockRecord[],
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  upsertTechMarketRows: (
    rows: TechMarketRecord[],
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  upsertTechCommissionSnapshots: (rows: TechCommissionSnapshotRecord[]) => Promise<void>;
  listMemberIds: (orgId: string) => Promise<string[]>;
  listMemberCardIds: (orgId: string) => Promise<string[]>;
  listCurrentMemberCards: (orgId: string) => Promise<MemberCardCurrentRecord[]>;
  listRecentUserTradeCandidateCardIds: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<string[]>;
};

export class HetangRawIngestionStore {
  constructor(private readonly legacy: RawIngestionLegacyStore) {}

  beginSyncRun(params: { orgId: string; mode: string; startedAt: string }) {
    return this.legacy.beginSyncRun(params);
  }

  finishSyncRun(params: {
    syncRunId: string;
    status: string;
    finishedAt: string;
    details?: unknown;
  }) {
    return this.legacy.finishSyncRun(params);
  }

  recordSyncError(params: {
    syncRunId: string;
    orgId: string;
    endpoint: string;
    errorAt: string;
    errorMessage: string;
  }) {
    return this.legacy.recordSyncError(params);
  }

  setEndpointWatermark(params: { orgId: string; endpoint: string; lastSuccessAt: string }) {
    return this.legacy.setEndpointWatermark(params);
  }

  getEndpointWatermark(orgId: string, endpoint: string) {
    return this.legacy.getEndpointWatermark(orgId, endpoint);
  }

  getEndpointWatermarksForOrg(orgId: string) {
    return this.legacy.getEndpointWatermarksForOrg(orgId);
  }

  recordRawBatch(params: {
    syncRunId: string;
    orgId: string;
    endpoint: EndpointCode;
    fetchedAt: string;
    rowCount: number;
    requestJson?: string;
  }) {
    return this.legacy.recordRawBatch(params);
  }

  recordRawRows(params: {
    rawBatchId: string;
    endpoint: EndpointCode;
    orgId: string;
    rows: Array<Record<string, unknown>>;
  }) {
    return this.legacy.recordRawRows(params);
  }

  getRawRowSeenCount(endpoint: string, orgId: string, rowKey: string) {
    return this.legacy.getRawRowSeenCount(endpoint, orgId, rowKey);
  }

  getHistoricalCoverageSnapshot(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return this.legacy.getHistoricalCoverageSnapshot(params);
  }

  upsertMemberCurrent(rows: MemberCurrentRecord[]) {
    return this.legacy.upsertMemberCurrent(rows);
  }

  snapshotMembers(bizDate: string, rows: MemberCurrentRecord[]) {
    return this.legacy.snapshotMembers(bizDate, rows);
  }

  replaceMemberDailySnapshots(orgId: string, bizDate: string, rows: MemberCurrentRecord[]) {
    return this.legacy.replaceMemberDailySnapshots(orgId, bizDate, rows);
  }

  upsertMemberCards(rows: MemberCardCurrentRecord[]) {
    return this.legacy.upsertMemberCards(rows);
  }

  snapshotMemberCards(bizDate: string, rows: MemberCardCurrentRecord[]) {
    return this.legacy.snapshotMemberCards(bizDate, rows);
  }

  replaceMemberCardDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ) {
    return this.legacy.replaceMemberCardDailySnapshots(orgId, bizDate, rows);
  }

  upsertConsumeBills(rows: ConsumeBillRecord[], options?: { refreshViews?: boolean }) {
    return this.legacy.upsertConsumeBills(rows, options);
  }

  upsertRechargeBills(rows: RechargeBillRecord[], options?: { refreshViews?: boolean }) {
    return this.legacy.upsertRechargeBills(rows, options);
  }

  upsertUserTrades(rows: UserTradeRecord[]) {
    return this.legacy.upsertUserTrades(rows);
  }

  upsertTechCurrent(rows: TechCurrentRecord[]) {
    return this.legacy.upsertTechCurrent(rows);
  }

  snapshotTechCurrent(bizDate: string, rows: TechCurrentRecord[]) {
    return this.legacy.snapshotTechCurrent(bizDate, rows);
  }

  upsertTechUpClockRows(rows: TechUpClockRecord[], options?: { refreshViews?: boolean }) {
    return this.legacy.upsertTechUpClockRows(rows, options);
  }

  upsertTechMarketRows(rows: TechMarketRecord[], options?: { refreshViews?: boolean }) {
    return this.legacy.upsertTechMarketRows(rows, options);
  }

  upsertTechCommissionSnapshots(rows: TechCommissionSnapshotRecord[]) {
    return this.legacy.upsertTechCommissionSnapshots(rows);
  }

  listMemberIds(orgId: string) {
    return this.legacy.listMemberIds(orgId);
  }

  listMemberCardIds(orgId: string) {
    return this.legacy.listMemberCardIds(orgId);
  }

  listCurrentMemberCards(orgId: string) {
    return this.legacy.listCurrentMemberCards(orgId);
  }

  listRecentUserTradeCandidateCardIds(params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) {
    return this.legacy.listRecentUserTradeCandidateCardIds(params);
  }
}
