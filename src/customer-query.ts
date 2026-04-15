import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import { shiftBizDate } from "./time.js";
import type {
  CustomerPrimarySegment,
  MemberReactivationQueueRecord,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  HetangOpsConfig,
} from "./types.js";

type CustomerQueryRuntime = {
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
  listMemberReactivationQueue?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationQueueRecord[]>;
};

type SegmentDefinition = {
  key: CustomerPrimarySegment;
  label: string;
  aliases: RegExp[];
};

export type CustomerSegmentMatch = Pick<SegmentDefinition, "key" | "label">;

const SEGMENT_DEFINITIONS: SegmentDefinition[] = [
  {
    key: "important-value-member",
    label: "重要价值会员",
    aliases: [
      /重要价值(?:会员|客户|顾客)/u,
      /高价值(?:会员|客户|顾客)/u,
      /核心会员/u,
      /高净值(?:会员|客户|顾客)/u,
    ],
  },
  {
    key: "important-reactivation-member",
    label: "重要唤回会员",
    aliases: [
      /重要唤回(?:会员|客户|顾客)/u,
      /重要召回(?:会员|客户|顾客)/u,
      /高价值待唤回/u,
      /高价值沉睡(?:会员|客户|顾客)/u,
      /待唤回(?:会员|客户|顾客)/u,
      /待召回(?:会员|客户|顾客)/u,
      /唤回会员/u,
      /召回会员/u,
    ],
  },
  {
    key: "potential-growth-customer",
    label: "潜力发展客户",
    aliases: [/潜力发展(?:会员|客户|顾客)/u, /潜力成长/u, /潜力(?:会员|客户|顾客)/u],
  },
  {
    key: "groupbuy-retain-candidate",
    label: "团购留存候选",
    aliases: [/团购留存(?:候选)?/u, /团购客留存/u, /团购留存客户/u],
  },
  {
    key: "active-member",
    label: "活跃会员",
    aliases: [/活跃(?:会员|客户|顾客)/u],
  },
  {
    key: "sleeping-customer",
    label: "沉睡会员",
    aliases: [/(?:沉睡|睡眠|沉默)(?:会员|客户|顾客)/u],
  },
  {
    key: "standard-customer",
    label: "标准客户",
    aliases: [/(?:标准|普通|常规)(?:会员|客户|顾客)/u],
  },
  {
    key: "unstable-identity",
    label: "待确认身份客户",
    aliases: [/待确认身份/u, /身份不稳定/u],
  },
];

const LIST_LIMIT = 20;
const FOLLOW_UP_LIMIT = 12;
const FOLLOW_UP_GROUP_LIMIT = 6;
const CUSTOMER_SNAPSHOT_LOOKBACK_DAYS = 7;

export type FollowUpBucketKey =
  | "high-value-reactivation"
  | "potential-growth"
  | "groupbuy-retention";

type FollowUpBucketDefinition = {
  key: FollowUpBucketKey;
  label: string;
};

const FOLLOW_UP_BUCKETS: FollowUpBucketDefinition[] = [
  { key: "high-value-reactivation", label: "高价值待唤回" },
  { key: "potential-growth", label: "潜力成长" },
  { key: "groupbuy-retention", label: "团购留存" },
];

export function resolveFollowUpBucketLabel(bucketKey: FollowUpBucketKey): string {
  return FOLLOW_UP_BUCKETS.find((bucket) => bucket.key === bucketKey)?.label ?? bucketKey;
}

export function resolveFollowUpBucketAlias(text: string): FollowUpBucketKey | null {
  if (/高价值待唤回/u.test(text)) {
    return "high-value-reactivation";
  }
  if (/潜力成长/u.test(text)) {
    return "potential-growth";
  }
  if (/团购留存/u.test(text)) {
    return "groupbuy-retention";
  }
  return null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim().toLowerCase();
}

function uniqueBy<T>(values: T[], keyOf: (value: T) => string): T[] {
  const seen = new Set<string>();
  const list: T[] = [];
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push(value);
  }
  return list;
}

function enumerateBizDates(frame: HetangQueryTimeFrame): string[] {
  if (frame.kind === "single") {
    return [frame.bizDate];
  }
  const values: string[] = [];
  let cursor = frame.startBizDate;
  while (cursor <= frame.endBizDate) {
    values.push(cursor);
    cursor = shiftBizDate(cursor, 1);
  }
  return values;
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function resolveSegmentDefinition(text: string): SegmentDefinition | null {
  for (const definition of SEGMENT_DEFINITIONS) {
    if (definition.aliases.some((alias) => alias.test(text))) {
      return definition;
    }
  }
  return null;
}

export function resolveCustomerSegmentMatch(text: string): CustomerSegmentMatch | null {
  const definition = resolveSegmentDefinition(text);
  return definition ? { key: definition.key, label: definition.label } : null;
}

export function resolveServingCustomerSegmentListMatch(
  text: string,
): CustomerSegmentMatch | null {
  const segment = resolveCustomerSegmentMatch(text);
  if (!segment) {
    return null;
  }
  if (
    asksCount(text) ||
    asksProfile(text) ||
    asksTechBindingRanking(text) ||
    asksFollowUpCandidates(text)
  ) {
    return null;
  }
  return segment;
}

export function resolveServingCustomerSegmentCountMatch(
  text: string,
): CustomerSegmentMatch | null {
  const segment = resolveCustomerSegmentMatch(text);
  if (!segment) {
    return null;
  }
  if (
    !asksCount(text) ||
    asksProfile(text) ||
    asksTechBindingRanking(text) ||
    asksFollowUpCandidates(text)
  ) {
    return null;
  }
  return segment;
}

export function resolveServingCustomerSegmentTechBindingRankingMatch(
  text: string,
): CustomerSegmentMatch | null {
  const segment = resolveCustomerSegmentMatch(text);
  if (!segment) {
    return null;
  }
  if (!asksTechBindingRanking(text)) {
    return null;
  }
  return segment;
}

function asksList(text: string): boolean {
  return /(名单|列表|明细|有哪些|哪些人|都是谁|列一下|逐个列一下)/u.test(text);
}

function asksCount(text: string): boolean {
  return /(多少|几位|几人|人数|数量|总数)/u.test(text);
}

function asksProfile(text: string): boolean {
  return /(什么标签|什么客群|什么分层|什么层级|属于什么|现在是什么标签|是什么类型)/u.test(text);
}

function asksTechBindingRanking(text: string): boolean {
  return (
    /(哪个技师|技师.*(?:最多|排名|排行|top|TOP)|绑定)/u.test(text) &&
    /(绑定|留住|对应|高价值会员|重要价值会员|重要唤回会员|潜力会员|沉睡会员)/u.test(text)
  );
}

function asksFollowUpCandidates(text: string): boolean {
  return (
    /(?:最需要|最值得|值得|优先|重点|最该).{0,6}(?:跟进|唤回|召回)|(?:跟进|唤回|召回)(?:名单|对象)|先联系谁|先跟进谁|先唤回谁|先召回谁/u.test(
      text,
    ) && /(会员|客户|顾客|客人)/u.test(text)
  );
}

function resolveSegmentLabel(key: CustomerPrimarySegment): string {
  return SEGMENT_DEFINITIONS.find((entry) => entry.key === key)?.label ?? key;
}

function resolveRecencyLabel(row: CustomerSegmentRecord): string {
  switch (row.recencySegment) {
    case "active-7d":
      return "近 7 天活跃";
    case "active-30d":
      return "近 30 天活跃";
    case "silent-31-90d":
      return "31-90 天未到店";
    case "sleeping-91-180d":
      return "91-180 天未到店";
    case "lost-180d-plus":
      return "180 天以上未到店";
    default:
      return row.recencySegment;
  }
}

function containsSegmentWords(text: string): boolean {
  return /(会员|客户|顾客|客群|标签|分层|层级)/u.test(text);
}

function findContainedNames(text: string, names: string[]): string[] {
  const normalizedText = normalizeText(text);
  return uniqueBy(
    names
      .filter(Boolean)
      .map((name) => ({
        name,
        normalizedName: normalizeText(name),
        position: normalizedText.indexOf(normalizeText(name)),
      }))
      .filter((entry) => entry.position >= 0)
      .sort((left, right) => left.position - right.position || right.name.length - left.name.length)
      .map((entry) => entry.name),
    (value) => normalizeText(value),
  );
}

function resolveCustomerName(
  text: string,
  rows: CustomerSegmentRecord[],
  links: CustomerTechLinkRecord[],
): string | null {
  return (
    findContainedNames(
      text,
      uniqueBy(
        [
          ...rows.map((row) => row.customerDisplayName),
          ...links.map((row) => row.customerDisplayName),
        ],
        (value) => normalizeText(value),
      ),
    )[0] ?? null
  );
}

function resolveTechName(
  text: string,
  rows: CustomerSegmentRecord[],
  links: CustomerTechLinkRecord[],
): string | null {
  return (
    findContainedNames(
      text,
      uniqueBy(
        [
          ...rows
            .filter((row) => row.identityStable)
            .map((row) => row.topTechName)
            .filter((value): value is string => Boolean(value)),
          ...links.map((row) => row.techName),
        ],
        (value) => normalizeText(value),
      ),
    )[0] ?? null
  );
}

async function loadSegmentsSnapshot(params: {
  runtime: CustomerQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
}): Promise<{ bizDate: string; rows: CustomerSegmentRecord[] }> {
  if (!params.runtime.listCustomerSegments) {
    throw new Error("missing-customer-segments");
  }
  const targetBizDate =
    params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate;
  let bizDate = targetBizDate;
  for (let offset = 0; offset <= CUSTOMER_SNAPSHOT_LOOKBACK_DAYS; offset += 1) {
    const rows = await params.runtime.listCustomerSegments({
      orgId: params.orgId,
      bizDate,
    });
    if (rows.length > 0 || offset === CUSTOMER_SNAPSHOT_LOOKBACK_DAYS) {
      return { bizDate, rows };
    }
    bizDate = shiftBizDate(targetBizDate, -(offset + 1));
  }
  return { bizDate: targetBizDate, rows: [] };
}

async function loadReactivationQueueSnapshot(params: {
  runtime: CustomerQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
}): Promise<{ bizDate: string; rows: MemberReactivationQueueRecord[] }> {
  if (!params.runtime.listMemberReactivationQueue) {
    return {
      bizDate: params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate,
      rows: [],
    };
  }
  const targetBizDate =
    params.frame.kind === "single" ? params.frame.bizDate : params.frame.endBizDate;
  let bizDate = targetBizDate;
  for (let offset = 0; offset <= CUSTOMER_SNAPSHOT_LOOKBACK_DAYS; offset += 1) {
    const rows = await params.runtime.listMemberReactivationQueue({
      orgId: params.orgId,
      bizDate,
    });
    if (rows.length > 0 || offset === CUSTOMER_SNAPSHOT_LOOKBACK_DAYS) {
      return { bizDate, rows };
    }
    bizDate = shiftBizDate(targetBizDate, -(offset + 1));
  }
  return { bizDate: targetBizDate, rows: [] };
}

async function loadCustomerTechLinks(params: {
  runtime: CustomerQueryRuntime;
  orgId: string;
  frame: HetangQueryTimeFrame;
}): Promise<CustomerTechLinkRecord[]> {
  if (!params.runtime.listCustomerTechLinks) {
    throw new Error("missing-customer-tech-links");
  }
  const rows = await Promise.all(
    enumerateBizDates(params.frame).map((bizDate) =>
      params.runtime.listCustomerTechLinks!({
        orgId: params.orgId,
        bizDate,
      }),
    ),
  );
  return uniqueBy(
    rows.flat().filter((row) => row.identityStable),
    (row) => `${row.bizDate}:${row.settleId}:${row.customerIdentityKey}:${row.techCode}`,
  );
}

function renderSegmentCount(params: {
  storeName: string;
  snapshotBizDate: string;
  segmentLabel: string;
  rows: CustomerSegmentRecord[];
}): string {
  const loyalCount = params.rows.filter(
    (row) => row.techLoyaltySegment === "single-tech-loyal",
  ).length;
  return [
    `${params.storeName} ${params.snapshotBizDate} ${params.segmentLabel} ${params.rows.length} 人`,
    `- 单技师忠诚客户: ${loyalCount} 人`,
    `- 近 90 天累计支付: ${formatCurrency(
      params.rows.reduce((sum, row) => sum + row.payAmount90d, 0),
    )}`,
  ].join("\n");
}

function renderSegmentList(params: {
  storeName: string;
  snapshotBizDate: string;
  segmentLabel: string;
  rows: CustomerSegmentRecord[];
}): string {
  const lines = [
    `${params.storeName} ${params.snapshotBizDate} ${params.segmentLabel}名单（共 ${params.rows.length} 人）`,
  ];
  if (params.rows.length === 0) {
    lines.push("- 当前没有符合条件的客户。");
    return lines.join("\n");
  }
  params.rows.slice(0, LIST_LIMIT).forEach((row, index) => {
    const techSuffix =
      row.identityStable && row.topTechName ? ` | 主服务技师 ${row.topTechName}` : "";
    lines.push(
      `${index + 1}. ${row.customerDisplayName} | 近 90 天支付 ${formatCurrency(row.payAmount90d)} | 最近到店 ${row.lastBizDate ?? "N/A"}${techSuffix}`,
    );
  });
  if (params.rows.length > LIST_LIMIT) {
    lines.push(`- 其余 ${params.rows.length - LIST_LIMIT} 人未展开。`);
  }
  return lines.join("\n");
}

function renderCustomerProfile(params: {
  storeName: string;
  snapshotBizDate: string;
  row: CustomerSegmentRecord;
}): string {
  const techLine = params.row.identityStable
    ? `- 主服务技师: ${params.row.topTechName ?? "N/A"}${params.row.topTechVisitCount90d > 0 ? `（${params.row.topTechVisitCount90d} 次）` : ""}`
    : "- 主服务技师辅助信息: 已收紧（身份未稳定）";
  return [
    `${params.storeName} ${params.snapshotBizDate} ${params.row.customerDisplayName} 客群标签`,
    `- 主标签: ${resolveSegmentLabel(params.row.primarySegment)}`,
    `- 活跃状态: ${resolveRecencyLabel(params.row)}`,
    `- 近 30 天到店: ${params.row.visitCount30d} 次`,
    `- 近 90 天到店: ${params.row.visitCount90d} 次`,
    `- 近 90 天支付: ${formatCurrency(params.row.payAmount90d)}`,
    techLine,
  ].join("\n");
}

function renderCustomerToTechHistory(params: {
  storeName: string;
  frameLabel: string;
  customerName: string;
  rows: CustomerTechLinkRecord[];
}): string {
  const byTech = new Map<
    string,
    {
      techName: string;
      count: number;
      turnover: number;
      latestBizDate?: string;
      itemNames: Set<string>;
    }
  >();
  for (const row of params.rows) {
    const key = row.techCode || row.techName;
    const current = byTech.get(key) ?? {
      techName: row.techName,
      count: 0,
      turnover: 0,
      latestBizDate: undefined,
      itemNames: new Set<string>(),
    };
    current.count += 1;
    current.turnover = round(current.turnover + row.techTurnover, 2);
    current.latestBizDate =
      !current.latestBizDate || row.bizDate > current.latestBizDate
        ? row.bizDate
        : current.latestBizDate;
    row.itemNames.forEach((itemName) => current.itemNames.add(itemName));
    byTech.set(key, current);
  }
  const lines = [
    `${params.storeName} ${params.frameLabel} ${params.customerName}被以下技师服务过`,
    `- 共服务 ${params.rows.length} 次，涉及 ${byTech.size} 位技师`,
  ];
  Array.from(byTech.values())
    .sort((left, right) => right.count - left.count || right.turnover - left.turnover)
    .forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.techName} | ${entry.count} 次 | ${formatCurrency(entry.turnover)} | 最近 ${entry.latestBizDate ?? "N/A"} | 项目 ${Array.from(entry.itemNames).join("、") || "N/A"}`,
      );
    });
  return lines.join("\n");
}

function renderTechToCustomerList(params: {
  storeName: string;
  frameLabel: string;
  techName: string;
  rows: CustomerTechLinkRecord[];
  segmentMap: Map<string, CustomerSegmentRecord>;
  segmentLabel?: string;
}): string {
  const byCustomer = new Map<
    string,
    {
      customerName: string;
      count: number;
      latestBizDate?: string;
      turnover: number;
      segmentLabel?: string;
    }
  >();
  for (const row of params.rows) {
    const key = row.customerIdentityKey;
    const segment = params.segmentMap.get(key);
    const current = byCustomer.get(key) ?? {
      customerName: row.customerDisplayName,
      count: 0,
      latestBizDate: undefined,
      turnover: 0,
      segmentLabel: segment ? resolveSegmentLabel(segment.primarySegment) : undefined,
    };
    current.count += 1;
    current.turnover = round(current.turnover + row.techTurnover, 2);
    current.latestBizDate =
      !current.latestBizDate || row.bizDate > current.latestBizDate
        ? row.bizDate
        : current.latestBizDate;
    byCustomer.set(key, current);
  }
  const lines = [
    `${params.storeName} ${params.frameLabel} ${params.techName}服务的${params.segmentLabel ?? "顾客"}`,
    `- 共覆盖 ${byCustomer.size} 人，累计服务 ${params.rows.length} 次`,
  ];
  Array.from(byCustomer.values())
    .sort((left, right) => right.count - left.count || right.turnover - left.turnover)
    .slice(0, LIST_LIMIT)
    .forEach((entry, index) => {
      lines.push(
        `${index + 1}. ${entry.customerName}${entry.segmentLabel ? ` | ${entry.segmentLabel}` : ""} | ${entry.count} 次 | 最近 ${entry.latestBizDate ?? "N/A"} | ${formatCurrency(entry.turnover)}`,
      );
    });
  return lines.join("\n");
}

function renderTechBindingRanking(params: {
  storeName: string;
  snapshotBizDate: string;
  segmentLabel: string;
  rows: CustomerSegmentRecord[];
}): string {
  const ranking = new Map<string, { techName: string; count: number }>();
  for (const row of params.rows) {
    if (!row.identityStable || !row.topTechName) {
      continue;
    }
    const key = row.topTechCode || row.topTechName;
    const current = ranking.get(key) ?? { techName: row.topTechName, count: 0 };
    current.count += 1;
    ranking.set(key, current);
  }
  const lines = [
    `${params.storeName} ${params.snapshotBizDate} ${params.segmentLabel}绑定技师排名`,
  ];
  Array.from(ranking.values())
    .sort((left, right) => right.count - left.count || left.techName.localeCompare(right.techName))
    .forEach((entry, index) => {
      lines.push(`${index + 1}. ${entry.techName} ${entry.count} 位`);
    });
  return lines.join("\n");
}

export function shouldIncludeFollowUpCandidate(row: CustomerSegmentRecord): boolean {
  if (!row.segmentEligible || !row.identityStable) {
    return false;
  }

  switch (row.primarySegment) {
    case "important-reactivation-member":
    case "potential-growth-customer":
    case "groupbuy-retain-candidate":
      return true;
    case "sleeping-customer":
      return row.payAmount90d >= 300 || row.visitCount90d >= 2;
    case "important-value-member":
      return row.daysSinceLastVisit >= 14;
    default:
      return false;
  }
}

export function resolveFollowUpPriorityScore(row: CustomerSegmentRecord): number {
  let baseScore = 0;
  switch (row.primarySegment) {
    case "important-reactivation-member":
      baseScore = 500;
      break;
    case "potential-growth-customer":
      baseScore = 420;
      break;
    case "groupbuy-retain-candidate":
      baseScore = 360;
      break;
    case "sleeping-customer":
      baseScore = 300;
      break;
    case "important-value-member":
      baseScore = 240;
      break;
    default:
      baseScore = 0;
      break;
  }

  return round(
    baseScore +
      Math.min(row.payAmount90d, 3_000) / 20 +
      Math.min(row.visitCount90d, 12) * 4 +
      Math.min(row.daysSinceLastVisit, 120) * 0.6 +
      (row.topTechVisitShare90d ?? 0) * 30,
    1,
  );
}

export function resolveFollowUpReason(row: CustomerSegmentRecord): string {
  switch (row.primarySegment) {
    case "important-reactivation-member":
      return `高价值但已 ${row.daysSinceLastVisit} 天未到店，近90天支付 ${formatCurrency(row.payAmount90d)}。`;
    case "potential-growth-customer":
      return `近90天到店 ${row.visitCount90d} 次、支付 ${formatCurrency(row.payAmount90d)}，再跟一次有机会往高价值走。`;
    case "groupbuy-retain-candidate":
      return `团购承接客户，近90天支付 ${formatCurrency(row.payAmount90d)}，适合趁热推进开卡或储值。`;
    case "sleeping-customer":
      return `已沉默 ${row.daysSinceLastVisit} 天，但近90天仍贡献 ${formatCurrency(row.payAmount90d)}，适合回访唤醒。`;
    case "important-value-member":
      return `原本就是高价值客户，最近 ${row.daysSinceLastVisit} 天未到店，要提前防流失。`;
    default:
      return `近90天支付 ${formatCurrency(row.payAmount90d)}，可安排人工回访确认下一步机会。`;
  }
}

export function resolveFollowUpBucket(row: CustomerSegmentRecord): FollowUpBucketKey | null {
  switch (row.primarySegment) {
    case "important-reactivation-member":
    case "important-value-member":
    case "sleeping-customer":
      return "high-value-reactivation";
    case "potential-growth-customer":
      return "potential-growth";
    case "groupbuy-retain-candidate":
      return "groupbuy-retention";
    default:
      return null;
  }
}

function renderFollowUpCandidateList(params: {
  storeName: string;
  frameLabel: string;
  snapshotBizDate: string;
  rows: CustomerSegmentRecord[];
}): string {
  const buildEntries = (rows: CustomerSegmentRecord[]) =>
    rows
    .map((row) => ({
      row,
      score: resolveFollowUpPriorityScore(row),
      reason: resolveFollowUpReason(row),
      bucket: resolveFollowUpBucket(row),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.row.payAmount90d - left.row.payAmount90d ||
        right.row.daysSinceLastVisit - left.row.daysSinceLastVisit ||
        left.row.customerDisplayName.localeCompare(right.row.customerDisplayName),
    )
    .slice(0, FOLLOW_UP_LIMIT)
    .filter(
      (
        entry,
      ): entry is typeof entry & {
        bucket: FollowUpBucketKey;
      } => entry.bucket !== null,
    );

  const candidates = buildEntries(params.rows.filter(shouldIncludeFollowUpCandidate));
  const fallbackCandidates = candidates.length > 0 ? candidates : buildEntries(params.rows);

  if (fallbackCandidates.length === 0) {
    return [
      `${params.storeName} ${params.frameLabel} 跟进顾客分层名单（按 ${params.snapshotBizDate} 客群快照）`,
      "当前客群快照里还没有可直接展开的重点跟进对象。",
      "你可以继续问：重要唤回会员名单、潜力成长名单、团购留存名单。",
    ].join("\n");
  }

  const lines = [
    `${params.storeName} ${params.frameLabel} 跟进顾客分层名单（按 ${params.snapshotBizDate} 客群快照）`,
    "跟进顺序建议：先高价值待唤回，再潜力成长，最后团购留存。",
  ];
  if (candidates.length === 0) {
    lines.push("当前严格跟进阈值未命中，先按现有客群快照给你列出优先名单。");
  }

  for (const bucket of FOLLOW_UP_BUCKETS) {
    const bucketEntries = fallbackCandidates.filter((entry) => entry.bucket === bucket.key);
    if (bucketEntries.length === 0) {
      continue;
    }
    lines.push("");
    lines.push(`${bucket.label}（${bucketEntries.length} 人）`);
      bucketEntries.slice(0, FOLLOW_UP_GROUP_LIMIT).forEach((entry, index) => {
        lines.push(
        `${index + 1}. ${entry.row.customerDisplayName} | ${entry.reason}${entry.row.identityStable && entry.row.topTechName ? ` 主服务技师 ${entry.row.topTechName}。` : ""}`,
        );
      });
    if (bucketEntries.length > FOLLOW_UP_GROUP_LIMIT) {
      lines.push(`- 其余 ${bucketEntries.length - FOLLOW_UP_GROUP_LIMIT} 人未展开。`);
    }
  }

  return lines.join("\n");
}

function renderReactivationQueueList(params: {
  storeName: string;
  frameLabel: string;
  snapshotBizDate: string;
  rows: MemberReactivationQueueRecord[];
}): string {
  const lines = [
    `${params.storeName} ${params.frameLabel} 召回执行名单（按 ${params.snapshotBizDate} 执行快照）`,
    "优先看 P0/P1，再安排本周触达窗口。",
  ];
  if (params.rows.length === 0) {
    lines.push("当前执行快照里还没有可直接展开的召回对象。");
    return lines.join("\n");
  }
  params.rows.slice(0, FOLLOW_UP_LIMIT).forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.customerDisplayName} | ${row.priorityBand} | ${resolveFollowUpBucketLabel(row.followupBucket)} | ${row.reasonSummary} ${row.touchAdviceSummary}`,
    );
  });
  if (params.rows.length > FOLLOW_UP_LIMIT) {
    lines.push(`- 其余 ${params.rows.length - FOLLOW_UP_LIMIT} 人未展开。`);
  }
  return lines.join("\n");
}

function renderReactivationQueueBucketList(params: {
  storeName: string;
  snapshotBizDate: string;
  bucketKey: FollowUpBucketKey;
  rows: MemberReactivationQueueRecord[];
}): string {
  const bucketRows = params.rows
    .filter((row) => row.followupBucket === params.bucketKey)
    .slice(0, LIST_LIMIT);
  const bucketLabel = resolveFollowUpBucketLabel(params.bucketKey);
  const lines = [`${params.storeName} ${params.snapshotBizDate} ${bucketLabel}执行名单（共 ${bucketRows.length} 人）`];
  if (bucketRows.length === 0) {
    lines.push("- 当前没有符合条件的客户。");
    return lines.join("\n");
  }
  bucketRows.forEach((row, index) => {
    lines.push(
      `${index + 1}. ${row.customerDisplayName} | ${row.priorityBand} | ${row.reasonSummary} ${row.touchAdviceSummary}`,
    );
  });
  return lines.join("\n");
}

function renderFollowUpBucketList(params: {
  storeName: string;
  snapshotBizDate: string;
  bucketKey: FollowUpBucketKey;
  rows: CustomerSegmentRecord[];
}): string {
  const buildEntries = (rows: CustomerSegmentRecord[]) =>
    rows
      .map((row) => ({
        row,
        score: resolveFollowUpPriorityScore(row),
        reason: resolveFollowUpReason(row),
        bucket: resolveFollowUpBucket(row),
      }))
      .filter(
        (
          entry,
        ): entry is typeof entry & {
          bucket: FollowUpBucketKey;
        } => entry.bucket === params.bucketKey,
      )
      .sort(
        (left, right) =>
          right.score - left.score ||
          right.row.payAmount90d - left.row.payAmount90d ||
          right.row.daysSinceLastVisit - left.row.daysSinceLastVisit ||
          left.row.customerDisplayName.localeCompare(right.row.customerDisplayName),
      )
      .slice(0, LIST_LIMIT);

  const candidates = buildEntries(params.rows.filter(shouldIncludeFollowUpCandidate));
  const fallbackCandidates = candidates.length > 0 ? candidates : buildEntries(params.rows);
  const bucketLabel =
    FOLLOW_UP_BUCKETS.find((bucket) => bucket.key === params.bucketKey)?.label ?? params.bucketKey;
  const lines = [`${params.storeName} ${params.snapshotBizDate} ${bucketLabel}名单（共 ${fallbackCandidates.length} 人）`];
  if (fallbackCandidates.length === 0) {
    lines.push("- 当前没有符合条件的客户。");
    return lines.join("\n");
  }
  if (candidates.length === 0) {
    lines.push("- 当前严格跟进阈值未命中，先按现有客群快照给你列出可优先关注的人。");
  }
  fallbackCandidates.forEach((entry, index) => {
    lines.push(
      `${index + 1}. ${entry.row.customerDisplayName} | ${entry.reason}${entry.row.identityStable && entry.row.topTechName ? ` 主服务技师 ${entry.row.topTechName}。` : ""}`,
    );
  });
  return lines.join("\n");
}

function resolveRelationDirection(text: string): "customer-to-tech" | "tech-to-customer" | null {
  if (/(被哪些技师服务|被哪位技师服务|哪些技师服务过|服务过哪些技师|找过哪些技师)/u.test(text)) {
    return "customer-to-tech";
  }
  if (/(服务了哪些|接待了哪些|带了哪些).*(会员|顾客|客户|客人)/u.test(text)) {
    return "tech-to-customer";
  }
  return null;
}

export async function executeCustomerQuery(params: {
  runtime: CustomerQueryRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string> {
  if (params.intent.kind === "customer_segment") {
    if (!params.runtime.listCustomerSegments) {
      return "当前环境还未接通会员分层查询能力。";
    }

    if (params.effectiveOrgIds.length !== 1) {
      return "当前这类会员分层查询先按单店执行，请在问题里带上门店名。";
    }

    const [orgId] = params.effectiveOrgIds;
    const storeName = getStoreName(params.config, orgId);
    const { bizDate, rows } = await loadSegmentsSnapshot({
      runtime: params.runtime,
      orgId,
      frame: params.intent.timeFrame,
    });
    const reactivationQueueSnapshot = await loadReactivationQueueSnapshot({
      runtime: params.runtime,
      orgId,
      frame: params.intent.timeFrame,
    });
    const followUpBucket = resolveFollowUpBucketAlias(params.intent.rawText);
    if (followUpBucket) {
      if (reactivationQueueSnapshot.rows.length > 0) {
        return renderReactivationQueueBucketList({
          storeName,
          snapshotBizDate: reactivationQueueSnapshot.bizDate,
          bucketKey: followUpBucket,
          rows: reactivationQueueSnapshot.rows,
        });
      }
      return renderFollowUpBucketList({
        storeName,
        snapshotBizDate: bizDate,
        bucketKey: followUpBucket,
        rows,
      });
    }
    const customerName = resolveCustomerName(params.intent.rawText, rows, []);
    if (asksProfile(params.intent.rawText) && customerName) {
      const row = rows.find(
        (entry) => normalizeText(entry.customerDisplayName) === normalizeText(customerName),
      );
      if (!row) {
        return `${storeName} ${bizDate} 未找到 ${customerName} 的分层快照。`;
      }
      return renderCustomerProfile({ storeName, snapshotBizDate: bizDate, row });
    }

    const segment = resolveSegmentDefinition(params.intent.rawText);
    if (!segment && asksFollowUpCandidates(params.intent.rawText)) {
      if (reactivationQueueSnapshot.rows.length > 0) {
        return renderReactivationQueueList({
          storeName,
          frameLabel: params.intent.timeFrame.label,
          snapshotBizDate: reactivationQueueSnapshot.bizDate,
          rows: reactivationQueueSnapshot.rows,
        });
      }
      return renderFollowUpCandidateList({
        storeName,
        frameLabel: params.intent.timeFrame.label,
        snapshotBizDate: bizDate,
        rows,
      });
    }
    if (!segment) {
      return "请明确要查的客群，例如：重要价值会员、沉睡会员、潜力会员。";
    }
    const filtered = rows
      .filter((row) => row.primarySegment === segment.key)
      .sort(
        (left, right) =>
          right.payAmount90d - left.payAmount90d ||
          left.customerDisplayName.localeCompare(right.customerDisplayName),
      );

    if (asksTechBindingRanking(params.intent.rawText)) {
      return renderTechBindingRanking({
        storeName,
        snapshotBizDate: bizDate,
        segmentLabel: segment.label,
        rows: filtered,
      });
    }

    if (!asksCount(params.intent.rawText)) {
      return renderSegmentList({
        storeName,
        snapshotBizDate: bizDate,
        segmentLabel: segment.label,
        rows: filtered,
      });
    }

    return renderSegmentCount({
      storeName,
      snapshotBizDate: bizDate,
      segmentLabel: segment.label,
      rows: filtered,
    });
  }

  if (!params.runtime.listCustomerTechLinks) {
    return "当前环境还未接通顾客-技师关系查询能力。";
  }

  if (params.effectiveOrgIds.length !== 1) {
    return "当前这类顾客-技师关系查询先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const [links, segmentSnapshot] = await Promise.all([
    loadCustomerTechLinks({
      runtime: params.runtime,
      orgId,
      frame: params.intent.timeFrame,
    }),
    params.runtime.listCustomerSegments
      ? loadSegmentsSnapshot({
          runtime: params.runtime,
          orgId,
          frame: params.intent.timeFrame,
        })
      : Promise.resolve({
          bizDate:
            params.intent.timeFrame.kind === "single"
              ? params.intent.timeFrame.bizDate
              : params.intent.timeFrame.endBizDate,
          rows: [],
        }),
  ]);

  const direction = resolveRelationDirection(params.intent.rawText);
  const segment = resolveSegmentDefinition(params.intent.rawText);
  const segmentMap = new Map(
    segmentSnapshot.rows.map((row) => [row.customerIdentityKey, row] as const),
  );
  if (
    direction === "customer-to-tech" ||
    (!direction && !/(服务了哪些|接待了哪些|带了哪些)/u.test(params.intent.rawText))
  ) {
    const customerName = resolveCustomerName(params.intent.rawText, segmentSnapshot.rows, links);
    if (!customerName) {
      return `${storeName} ${params.intent.timeFrame.label} 未匹配到顾客名称。`;
    }
    const rows = links.filter(
      (row) => normalizeText(row.customerDisplayName) === normalizeText(customerName),
    );
    if (rows.length === 0) {
      return `${storeName} ${params.intent.timeFrame.label} 未找到 ${customerName} 的服务记录。`;
    }
    return renderCustomerToTechHistory({
      storeName,
      frameLabel: params.intent.timeFrame.label,
      customerName,
      rows,
    });
  }

  const techName = resolveTechName(params.intent.rawText, segmentSnapshot.rows, links);
  if (!techName) {
    return `${storeName} ${params.intent.timeFrame.label} 未匹配到技师名称。`;
  }
  let rows = links.filter((row) => normalizeText(row.techName) === normalizeText(techName));
  if (segment) {
    const allowedKeys = new Set(
      segmentSnapshot.rows
        .filter((row) => row.primarySegment === segment.key)
        .map((row) => row.customerIdentityKey),
    );
    rows = rows.filter((row) => allowedKeys.has(row.customerIdentityKey));
  } else if (containsSegmentWords(params.intent.rawText)) {
    rows = rows.filter((row) => segmentMap.has(row.customerIdentityKey));
  }
  if (rows.length === 0) {
    return `${storeName} ${params.intent.timeFrame.label} 未找到 ${techName} 的匹配顾客记录。`;
  }
  return renderTechToCustomerList({
    storeName,
    frameLabel: params.intent.timeFrame.label,
    techName,
    rows,
    segmentMap,
    segmentLabel: segment?.label,
  });
}
