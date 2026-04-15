import type {
  CustomerProfile90dRow,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  DailyStoreAlert,
  DailyStoreMetrics,
  DailyStoreReport,
  MemberCurrentRecord,
  MemberReactivationFeatureRecord,
  MemberReactivationFeedbackRecord,
  MemberReactivationQueueRecord,
  MemberReactivationStrategyRecord,
  MemberCardCurrentRecord,
  RechargeBillRecord,
  StoreManagerDailyKpiRow,
  StoreReview7dRow,
  StoreSummary30dRow,
  TechProfile30dRow,
} from "../types.js";

type MartDerivedLegacyStore = {
  replaceMemberDailySnapshots: (
    orgId: string,
    bizDate: string,
    rows: MemberCurrentRecord[],
  ) => Promise<void>;
  replaceMemberCardDailySnapshots: (
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ) => Promise<void>;
  saveDailyMetrics: (
    metrics: DailyStoreMetrics,
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  getDailyMetrics: (orgId: string, bizDate: string) => Promise<DailyStoreMetrics | null>;
  replaceDailyAlerts: (orgId: string, bizDate: string, alerts: DailyStoreAlert[]) => Promise<void>;
  getDailyAlerts: (orgId: string, bizDate: string) => Promise<DailyStoreAlert[]>;
  replaceCustomerTechLinks: (
    orgId: string,
    bizDate: string,
    rows: CustomerTechLinkRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  listCustomerTechLinks: (orgId: string, bizDate: string) => Promise<CustomerTechLinkRecord[]>;
  listCustomerTechLinksByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<CustomerTechLinkRecord[]>;
  replaceCustomerSegments: (
    orgId: string,
    bizDate: string,
    rows: CustomerSegmentRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  listCustomerSegments: (orgId: string, bizDate: string) => Promise<CustomerSegmentRecord[]>;
  replaceMemberReactivationFeatures: (
    orgId: string,
    bizDate: string,
    rows: MemberReactivationFeatureRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  listMemberReactivationFeatures: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationFeatureRecord[]>;
  replaceMemberReactivationStrategies: (
    orgId: string,
    bizDate: string,
    rows: MemberReactivationStrategyRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  listMemberReactivationStrategies: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationStrategyRecord[]>;
  replaceMemberReactivationQueue: (
    orgId: string,
    bizDate: string,
    rows: MemberReactivationQueueRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) => Promise<void>;
  listMemberReactivationQueue: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationQueueRecord[]>;
  upsertMemberReactivationFeedback: (row: MemberReactivationFeedbackRecord) => Promise<void>;
  listMemberReactivationFeedback: (
    orgId: string,
    bizDate: string,
  ) => Promise<MemberReactivationFeedbackRecord[]>;
  listCustomerProfile90dByDateRange: (
    orgId: string,
    startBizDate: string,
    endBizDate: string,
  ) => Promise<CustomerProfile90dRow[]>;
  saveDailyReport: (report: DailyStoreReport, generatedAt: string) => Promise<void>;
  markReportSent: (params: {
    orgId: string;
    bizDate: string;
    sentAt: string;
    sendStatus: string;
  }) => Promise<void>;
  getDailyReport: (
    orgId: string,
    bizDate: string,
  ) => Promise<(DailyStoreReport & { sentAt?: string | null; sendStatus?: string | null }) | null>;
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

export class HetangMartDerivedStore {
  constructor(private readonly legacy: MartDerivedLegacyStore) {}

  replaceMemberDailySnapshots(orgId: string, bizDate: string, rows: MemberCurrentRecord[]) {
    return this.legacy.replaceMemberDailySnapshots(orgId, bizDate, rows);
  }

  replaceMemberCardDailySnapshots(
    orgId: string,
    bizDate: string,
    rows: MemberCardCurrentRecord[],
  ) {
    return this.legacy.replaceMemberCardDailySnapshots(orgId, bizDate, rows);
  }

  saveDailyMetrics(
    metrics: DailyStoreMetrics,
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.saveDailyMetrics(metrics, updatedAt, options);
  }

  getDailyMetrics(orgId: string, bizDate: string) {
    return this.legacy.getDailyMetrics(orgId, bizDate);
  }

  replaceDailyAlerts(orgId: string, bizDate: string, alerts: DailyStoreAlert[]) {
    return this.legacy.replaceDailyAlerts(orgId, bizDate, alerts);
  }

  getDailyAlerts(orgId: string, bizDate: string) {
    return this.legacy.getDailyAlerts(orgId, bizDate);
  }

  replaceCustomerTechLinks(
    orgId: string,
    bizDate: string,
    rows: CustomerTechLinkRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.replaceCustomerTechLinks(orgId, bizDate, rows, updatedAt, options);
  }

  listCustomerTechLinks(orgId: string, bizDate: string) {
    return this.legacy.listCustomerTechLinks(orgId, bizDate);
  }

  listCustomerTechLinksByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listCustomerTechLinksByDateRange(orgId, startBizDate, endBizDate);
  }

  replaceCustomerSegments(
    orgId: string,
    bizDate: string,
    rows: CustomerSegmentRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.replaceCustomerSegments(orgId, bizDate, rows, updatedAt, options);
  }

  listCustomerSegments(orgId: string, bizDate: string) {
    return this.legacy.listCustomerSegments(orgId, bizDate);
  }

  replaceMemberReactivationFeatures(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationFeatureRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.replaceMemberReactivationFeatures(orgId, bizDate, rows, updatedAt, options);
  }

  listMemberReactivationFeatures(orgId: string, bizDate: string) {
    return this.legacy.listMemberReactivationFeatures(orgId, bizDate);
  }

  replaceMemberReactivationStrategies(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationStrategyRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.replaceMemberReactivationStrategies(
      orgId,
      bizDate,
      rows,
      updatedAt,
      options,
    );
  }

  listMemberReactivationStrategies(orgId: string, bizDate: string) {
    return this.legacy.listMemberReactivationStrategies(orgId, bizDate);
  }

  replaceMemberReactivationQueue(
    orgId: string,
    bizDate: string,
    rows: MemberReactivationQueueRecord[],
    updatedAt: string,
    options?: { refreshViews?: boolean },
  ) {
    return this.legacy.replaceMemberReactivationQueue(orgId, bizDate, rows, updatedAt, options);
  }

  listMemberReactivationQueue(orgId: string, bizDate: string) {
    return this.legacy.listMemberReactivationQueue(orgId, bizDate);
  }

  upsertMemberReactivationFeedback(row: MemberReactivationFeedbackRecord) {
    return this.legacy.upsertMemberReactivationFeedback(row);
  }

  listMemberReactivationFeedback(orgId: string, bizDate: string) {
    return this.legacy.listMemberReactivationFeedback(orgId, bizDate);
  }

  listCustomerProfile90dByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listCustomerProfile90dByDateRange(orgId, startBizDate, endBizDate);
  }

  saveDailyReport(report: DailyStoreReport, generatedAt: string) {
    return this.legacy.saveDailyReport(report, generatedAt);
  }

  markReportSent(params: { orgId: string; bizDate: string; sentAt: string; sendStatus: string }) {
    return this.legacy.markReportSent(params);
  }

  getDailyReport(orgId: string, bizDate: string) {
    return this.legacy.getDailyReport(orgId, bizDate);
  }

  listStoreManagerDailyKpiByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listStoreManagerDailyKpiByDateRange(orgId, startBizDate, endBizDate);
  }

  listTechProfile30dByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listTechProfile30dByDateRange(orgId, startBizDate, endBizDate);
  }

  listStoreReview7dByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listStoreReview7dByDateRange(orgId, startBizDate, endBizDate);
  }

  listStoreSummary30dByDateRange(orgId: string, startBizDate: string, endBizDate: string) {
    return this.legacy.listStoreSummary30dByDateRange(orgId, startBizDate, endBizDate);
  }
}
