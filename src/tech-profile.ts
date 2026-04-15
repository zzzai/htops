import {
  evaluateTechBusinessScore,
  type TechCustomerBindingState,
} from "./business-score.js";
import { buildCustomerTechServiceLinks } from "./customer-intelligence.js";
import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import { shiftBizDate } from "./time.js";
import type {
  ConsumeBillRecord,
  CustomerPrimarySegment,
  CustomerSegmentRecord,
  CustomerTechLinkRecord,
  HetangOpsConfig,
  MemberCardCurrentRecord,
  TechProfile30dRow,
  TechMarketRecord,
  TechUpClockRecord,
} from "./types.js";

type TechProfileRuntime = {
  listTechProfile30dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechProfile30dRow[]>;
  listTechUpClockByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechUpClockRecord[]>;
  listTechMarketByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<TechMarketRecord[]>;
  listCustomerTechLinks?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerTechLinkRecord[]>;
  listCurrentMemberCards?: (params: { orgId: string }) => Promise<MemberCardCurrentRecord[]>;
  listConsumeBillsByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<ConsumeBillRecord[]>;
  listCustomerSegments?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<CustomerSegmentRecord[]>;
};

type RankedRow = {
  name: string;
  count: number;
  amount: number;
};

type CustomerSummaryRow = {
  identityKey: string;
  displayName: string;
  count: number;
  amount: number;
  memberBound: boolean;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function formatCount(value: number, digits = 1): string {
  return round(value, digits).toFixed(digits);
}

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/gu, "").trim().toLowerCase() ?? "";
}

function maskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "*";
  }
  if (trimmed.length === 1) {
    return "*";
  }
  return `${trimmed.slice(0, 1)}${"*".repeat(Math.min(trimmed.length - 1, 2))}`;
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

function rankPreferences(source: Map<string, { count: number; amount: number }>): RankedRow[] {
  return Array.from(source.entries())
    .map(([name, value]) => ({
      name,
      count: value.count,
      amount: value.amount,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.amount - left.amount ||
        left.name.localeCompare(right.name),
    );
}

function pushPreference(
  source: Map<string, { count: number; amount: number }>,
  name: string | undefined,
  amount: number,
): void {
  const normalizedName = name?.trim();
  if (!normalizedName) {
    return;
  }
  const current = source.get(normalizedName) ?? { count: 0, amount: 0 };
  current.count += 1;
  current.amount = round(current.amount + amount, 4);
  source.set(normalizedName, current);
}

function findContainedNames(text: string, names: string[]): string[] {
  const normalizedText = normalizeText(text);
  return Array.from(
    new Map(
      names
        .filter(Boolean)
        .map((name) => ({
          name,
          position: normalizedText.indexOf(normalizeText(name)),
        }))
        .filter((entry) => entry.position >= 0)
        .sort(
          (left, right) => left.position - right.position || right.name.length - left.name.length,
        )
        .map((entry) => [normalizeText(entry.name), entry.name]),
    ).values(),
  );
}

function isPointClockRecord(row: TechUpClockRecord): boolean {
  const raw = row.clockType?.trim().toLowerCase() ?? "";
  if (raw === "2" || raw === "point" || raw === "点钟" || raw === "pointclock") {
    return true;
  }
  try {
    const parsed = JSON.parse(row.rawJson) as { ClockType?: unknown };
    const value = String(parsed.ClockType ?? "")
      .trim()
      .toLowerCase();
    return value === "2" || value === "point" || value === "点钟" || value === "pointclock";
  } catch {
    return false;
  }
}

function isAddClockRecord(row: TechUpClockRecord): boolean {
  try {
    const parsed = JSON.parse(row.rawJson) as { AddClockType?: unknown };
    const value = String(parsed.AddClockType ?? "")
      .trim()
      .toLowerCase();
    return value.length > 0 && value !== "0" && value !== "false" && value !== "null";
  } catch {
    return false;
  }
}

function classifyTechArchetype(params: {
  pointClockRate: number | null;
  addClockRate: number | null;
  marketRevenue: number;
  importantValueCustomerCount: number;
}): string {
  const pointClockRate = params.pointClockRate ?? 0;
  const addClockRate = params.addClockRate ?? 0;
  const parts: string[] = [
    pointClockRate >= 0.5
      ? "点钟型技师"
      : pointClockRate >= 0.3
        ? "混合承接型技师"
        : "排钟承接型技师",
  ];
  if (addClockRate >= 0.2) {
    parts.push("带一定加钟转化");
  }
  if (params.marketRevenue > 0) {
    parts.push("有副项推销能力");
  }
  if (params.importantValueCustomerCount >= 2) {
    parts.push("高价值会员绑定较强");
  }
  return parts.join("，");
}

function resolveTechName(text: string, candidateNames: string[]): string | undefined {
  const matched = findContainedNames(text, candidateNames)[0];
  if (matched) {
    return matched;
  }
  const regexMatch = text.match(/(?:技师|老师)\s*([^\s，。,的]{2,12})/u)?.[1]?.trim();
  return regexMatch || undefined;
}

function resolveIdentityKey(link: CustomerTechLinkRecord): string {
  return link.customerIdentityKey || link.memberId || link.customerDisplayName;
}

function resolveSegmentMap(rows: CustomerSegmentRecord[]): Map<string, CustomerPrimarySegment> {
  const map = new Map<string, CustomerPrimarySegment>();
  for (const row of rows) {
    if (row.customerIdentityKey) {
      map.set(row.customerIdentityKey, row.primarySegment);
    }
    if (row.memberId) {
      map.set(`member:${row.memberId}`, row.primarySegment);
      map.set(row.memberId, row.primarySegment);
    }
  }
  return map;
}

function resolveServiceOrderKey(
  row: Pick<TechUpClockRecord, "settleNo" | "rowFingerprint" | "bizDate">,
): string {
  const settleNo = row.settleNo?.trim();
  return settleNo && settleNo.length > 0 ? settleNo : `${row.bizDate}:${row.rowFingerprint}`;
}

function resolveLinkOrderKey(
  row: Pick<CustomerTechLinkRecord, "settleNo" | "settleId" | "bizDate">,
): string {
  const settleNo = row.settleNo?.trim();
  return settleNo && settleNo.length > 0 ? settleNo : `${row.bizDate}:${row.settleId}`;
}

function resolveCustomerBindingState(params: {
  techClockRows: TechUpClockRecord[];
  techLinks: CustomerTechLinkRecord[];
}): {
  state: TechCustomerBindingState;
  linkedServiceOrderCount: number;
  totalServiceOrderCount: number;
} {
  const serviceOrderKeys = new Set(params.techClockRows.map(resolveServiceOrderKey));
  const linkedServiceOrderKeys = new Set(params.techLinks.map(resolveLinkOrderKey));
  const totalServiceOrderCount = serviceOrderKeys.size;
  const linkedServiceOrderCount = linkedServiceOrderKeys.size;

  if (linkedServiceOrderCount === 0) {
    return {
      state: "missing",
      linkedServiceOrderCount,
      totalServiceOrderCount,
    };
  }

  if (totalServiceOrderCount === 0) {
    return {
      state: "ready",
      linkedServiceOrderCount,
      totalServiceOrderCount,
    };
  }

  const requiredOrderCoverage = Math.max(3, Math.ceil(totalServiceOrderCount * 0.6));
  return {
    state: linkedServiceOrderCount >= requiredOrderCoverage ? "ready" : "partial",
    linkedServiceOrderCount,
    totalServiceOrderCount,
  };
}

function dedupeCustomerTechLinks(rows: CustomerTechLinkRecord[]): CustomerTechLinkRecord[] {
  return Array.from(
    new Map(
      rows.map((row) => [
        [
          row.bizDate,
          row.settleNo?.trim() || row.settleId,
          row.customerIdentityKey,
          row.techCode,
        ].join("|"),
        row,
      ]),
    ).values(),
  );
}

function formatRate(value: number | null): string {
  return value === null ? "N/A" : `${round(value * 100, 1).toFixed(1)}%`;
}

function countWheelClockRecord(row: TechUpClockRecord): boolean {
  const raw = row.clockType?.trim().toLowerCase() ?? "";
  if (raw === "1" || raw === "wheel" || raw === "轮钟" || raw === "wheelclock") {
    return true;
  }
  try {
    const parsed = JSON.parse(row.rawJson) as { ClockType?: unknown };
    const value = String(parsed.ClockType ?? "")
      .trim()
      .toLowerCase();
    return value === "1" || value === "wheel" || value === "轮钟" || value === "wheelclock";
  } catch {
    return false;
  }
}

function resolveHourFromTime(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = value.match(/\b(\d{2}):\d{2}(?::\d{2})?\b/u);
  if (!match?.[1]) {
    return null;
  }
  const hour = Number(match[1]);
  return Number.isFinite(hour) ? hour : null;
}

function classifyTimeBucket(hour: number | null): string {
  if (hour === null) {
    return "未知时段";
  }
  if (hour >= 23 || hour < 5) {
    return "夜场";
  }
  if (hour >= 17) {
    return "晚场";
  }
  return "午场";
}

function buildTechStrengths(params: {
  pointClockRate: number | null;
  addClockRate: number | null;
  marketRevenue: number;
  importantValueCustomerCount: number;
  upClockRecordCount: number;
}): string[] {
  const strengths: string[] = [];
  if ((params.pointClockRate ?? 0) >= 0.5) {
    strengths.push("点钟吸引力强");
  } else if ((params.pointClockRate ?? 0) >= 0.3) {
    strengths.push("点排承接较均衡");
  } else if (params.upClockRecordCount >= 10) {
    strengths.push("排钟承接稳定");
  }
  if ((params.addClockRate ?? 0) >= 0.2) {
    strengths.push("加钟承接不错");
  }
  if (params.marketRevenue > 0) {
    strengths.push("有副项推销能力");
  }
  if (params.importantValueCustomerCount > 0) {
    strengths.push("能承接高价值会员");
  }
  return strengths.length > 0 ? strengths : ["基础承接稳定"];
}

function buildTechWeaknesses(params: {
  customerBindingState: TechCustomerBindingState;
  uniqueCustomerCount: number;
  upClockRecordCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  marketRevenue: number;
}): string[] {
  const weaknesses: string[] = [];
  if (params.customerBindingState === "missing") {
    weaknesses.push("客户-技师绑定链路待补，暂时无法判断留客能力");
  } else if (params.customerBindingState === "partial") {
    weaknesses.push("客户-技师绑定覆盖不足，当前不下留客与总服务顾客结论");
  } else if (params.uniqueCustomerCount <= 2 && params.upClockRecordCount >= 3) {
    weaknesses.push(`当前稳定顾客池偏窄，仅沉淀 ${params.uniqueCustomerCount} 位顾客`);
  }
  if ((params.pointClockRate ?? 0) < 0.3) {
    weaknesses.push("点钟占比偏低");
  }
  if ((params.addClockRate ?? 0) < 0.15) {
    weaknesses.push("加钟转化偏弱");
  }
  if (params.marketRevenue <= 0) {
    weaknesses.push("副项推销偏弱");
  }
  return weaknesses.length > 0 ? weaknesses : ["当前未见明显短板"];
}

function buildTechManagerSuggestions(params: {
  techName: string;
  topProjectName?: string;
  preferredTimeBucket?: string;
  customerBindingState: TechCustomerBindingState;
  uniqueCustomerCount: number;
  pointClockRate: number | null;
  addClockRate: number | null;
  marketRevenue: number;
}): string[] {
  const preferredTimeBucket = params.preferredTimeBucket ?? "晚场";
  const topProjectName = params.topProjectName ?? "主力项目";

  let trainingFocus: string;
  if (params.customerBindingState !== "ready") {
    trainingFocus = "先补客户绑定，再判断留客和复购归属。";
  } else if ((params.pointClockRate ?? 0) < 0.3 && (params.addClockRate ?? 0) < 0.15) {
    trainingFocus = "补点钟展示和加钟收口话术。";
  } else if ((params.pointClockRate ?? 0) < 0.3) {
    trainingFocus = "加强点钟展示和指定客维护。";
  } else if ((params.addClockRate ?? 0) < 0.15) {
    trainingFocus = "把加钟收口话术固定到服务后半程。";
  } else if (params.marketRevenue <= 0) {
    trainingFocus = "补副项推荐时机和收口话术。";
  } else {
    trainingFocus = "继续放大点钟优势，顺手把副项和加钟联动话术固定下来。";
  }

  let managerAction: string;
  if (params.customerBindingState === "missing") {
    managerAction = "先补客户-技师绑定数据，再看留客与复购归属。";
  } else if (params.customerBindingState === "partial") {
    managerAction = "先补客户-技师绑定覆盖，再看留客与复购归属。";
  } else if (params.uniqueCustomerCount <= 2) {
    managerAction = `继续稳住${params.techName}的${preferredTimeBucket}承接，同时扩充稳定顾客池。`;
  } else {
    managerAction = `把${params.techName}继续放在${preferredTimeBucket}主接${topProjectName}，放大稳定复购。`;
  }

  return [
    `建议重点排班: ${preferredTimeBucket}优先，主接${topProjectName}`,
    `建议训练重点: ${trainingFocus}`,
    `建议管理动作: ${managerAction}`,
  ];
}

export async function executeTechProfileQuery(params: {
  runtime: TechProfileRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
}): Promise<string> {
  if (!params.runtime.listTechUpClockByDateRange || !params.runtime.listTechMarketByDateRange) {
    return "当前环境还未接通技师画像查询能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "技师画像查询当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const startBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.startBizDate;
  const endBizDate =
    params.intent.timeFrame.kind === "single"
      ? params.intent.timeFrame.bizDate
      : params.intent.timeFrame.endBizDate;
  const queryBizDates = enumerateBizDates(params.intent.timeFrame);

  const clockRowsPromise = params.runtime.listTechUpClockByDateRange({
    orgId,
    startBizDate,
    endBizDate,
  });
  const techProfileRowsPromise = params.runtime.listTechProfile30dByDateRange
    ? params.runtime.listTechProfile30dByDateRange({
        orgId,
        startBizDate: endBizDate,
        endBizDate,
      })
    : Promise.resolve([] as TechProfile30dRow[]);
  const marketRowsPromise = params.runtime.listTechMarketByDateRange({
    orgId,
    startBizDate,
    endBizDate,
  });
  const segmentRowsPromise = params.runtime.listCustomerSegments
    ? params.runtime.listCustomerSegments({
        orgId,
        bizDate: endBizDate,
      })
    : Promise.resolve([] as CustomerSegmentRecord[]);
  const linkRowsNestedPromise = params.runtime.listCustomerTechLinks
    ? Promise.all(
        queryBizDates.map((bizDate) =>
          params.runtime.listCustomerTechLinks!({
            orgId,
            bizDate,
          }),
        ),
      )
    : Promise.resolve([] as CustomerTechLinkRecord[][]);

  const [clockRows, marketRows, segmentRows, linkRowsNested, techProfileRows] = await Promise.all([
    clockRowsPromise,
    marketRowsPromise,
    segmentRowsPromise,
    linkRowsNestedPromise,
    techProfileRowsPromise,
  ]);

  const fallbackLinks = params.runtime.listConsumeBillsByDateRange
    ? buildCustomerTechServiceLinks({
        orgId,
        bizDate: endBizDate,
        consumeBills: await params.runtime.listConsumeBillsByDateRange({
          orgId,
          startBizDate,
          endBizDate,
        }),
        techUpClockRows: clockRows,
        currentMembers: [],
        currentMemberCards: params.runtime.listCurrentMemberCards
          ? await params.runtime.listCurrentMemberCards({ orgId })
          : ([] as MemberCardCurrentRecord[]),
      })
    : [];

  const allLinks = dedupeCustomerTechLinks([...linkRowsNested.flat(), ...fallbackLinks]);
  const candidateNames = Array.from(
    new Set(
      [
        ...clockRows.map((row) => row.personName),
        ...marketRows
          .map((row) => row.personName)
          .filter((value): value is string => Boolean(value)),
        ...allLinks.map((row) => row.techName),
        ...techProfileRows.map((row) => row.techName),
      ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const techName = resolveTechName(params.intent.rawText, candidateNames);
  if (!techName) {
    return `未识别到具体技师姓名，请按“${storeName} 技师 白慧慧 的画像”提问。`;
  }

  const normalizedTechName = normalizeText(techName);
  const techClockRows = clockRows.filter(
    (row) => normalizeText(row.personName) === normalizedTechName,
  );
  const techMarketRows = marketRows.filter(
    (row) => normalizeText(row.personName) === normalizedTechName,
  );
  const matchedTechCodes = new Set(
    [...techClockRows.map((row) => row.personCode), ...techMarketRows.map((row) => row.personCode)]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value)),
  );
  const techProfileRow = techProfileRows.find(
    (row) =>
      normalizeText(row.techName) === normalizedTechName ||
      (row.techCode ? matchedTechCodes.has(row.techCode) : false),
  );
  const techLinks = allLinks.filter(
    (row) =>
      normalizeText(row.techName) === normalizedTechName ||
      (row.techCode ? matchedTechCodes.has(row.techCode) : false),
  );
  const stableTechLinks = techLinks.filter((row) => row.identityStable);

  if (
    techClockRows.length === 0 &&
    techMarketRows.length === 0 &&
    techLinks.length === 0 &&
    !techProfileRow
  ) {
    return `${storeName} 技师 ${techName} 在 ${params.intent.timeFrame.label} 暂无可用画像数据。`;
  }

  const runtimeTotalClockCount = round(
    techClockRows.reduce((sum, row) => sum + row.count, 0),
    2,
  );
  const upClockRecordCount = techClockRows.length;
  const pointClockRecordCount = techClockRows.filter(isPointClockRecord).length;
  const addClockRecordCount = techClockRows.filter(isAddClockRecord).length;
  const runtimePointClockRate =
    upClockRecordCount > 0 ? pointClockRecordCount / upClockRecordCount : null;
  const runtimeAddClockRate =
    upClockRecordCount > 0 ? addClockRecordCount / upClockRecordCount : null;
  const wheelClockRecordCount = techClockRows.filter(countWheelClockRecord).length;
  const runtimeTurnover = round(
    techClockRows.reduce((sum, row) => sum + row.turnover, 0),
    2,
  );
  const runtimeCommission = round(
    techClockRows.reduce((sum, row) => sum + row.comm, 0),
    2,
  );
  const runtimeMarketRevenue = round(
    techMarketRows.reduce((sum, row) => sum + row.afterDisc, 0),
    2,
  );
  const totalClockCount = techProfileRow
    ? round(techProfileRow.totalClockCount30d, 2)
    : runtimeTotalClockCount;
  const pointClockRate = techProfileRow?.pointClockRate30d ?? runtimePointClockRate;
  const addClockRate = techProfileRow?.addClockRate30d ?? runtimeAddClockRate;
  const turnover = techProfileRow ? round(techProfileRow.turnover30d, 2) : runtimeTurnover;
  const commission = techProfileRow ? round(techProfileRow.commission30d, 2) : runtimeCommission;
  const marketRevenue = techProfileRow
    ? round(techProfileRow.marketRevenue30d, 2)
    : runtimeMarketRevenue;
  const marketPenetrationRate = turnover > 0 ? marketRevenue / turnover : null;

  const projectMap = new Map<string, { count: number; amount: number }>();
  for (const row of techClockRows) {
    pushPreference(projectMap, row.itemName, row.turnover);
  }
  const rankedProjects = rankPreferences(projectMap);
  const timeBucketMap = new Map<string, { count: number; amount: number }>();
  for (const row of techClockRows) {
    const timeBucket = classifyTimeBucket(resolveHourFromTime(row.settleTime ?? row.ctime));
    pushPreference(timeBucketMap, timeBucket, row.turnover);
  }
  const preferredTimeBucket = rankPreferences(timeBucketMap)[0]?.name;
  const preferredTimeBucketStats = rankPreferences(timeBucketMap)[0];
  const runtimeServiceDayCount = new Set(techClockRows.map((row) => row.bizDate)).size;
  const serviceDayCount = techProfileRow?.serviceDayCount30d ?? runtimeServiceDayCount;
  const averageOrdersPerServiceDay = serviceDayCount > 0 ? upClockRecordCount / serviceDayCount : 0;
  const averageTurnoverPerServiceDay = serviceDayCount > 0 ? turnover / serviceDayCount : 0;
  const averageTurnoverPerClock = totalClockCount > 0 ? turnover / totalClockCount : 0;

  const customerSummaryMap = new Map<string, CustomerSummaryRow>();
  for (const row of stableTechLinks) {
    const identityKey = resolveIdentityKey(row);
    const displayName = row.customerDisplayName?.trim() || "未实名客户";
    const current = customerSummaryMap.get(identityKey) ?? {
      identityKey,
      displayName,
      count: 0,
      amount: 0,
      memberBound: Boolean(row.memberId),
    };
    current.count += 1;
    current.amount = round(current.amount + row.techTurnover, 4);
    current.memberBound = current.memberBound || Boolean(row.memberId);
    customerSummaryMap.set(identityKey, current);
  }
  const uniqueCustomerIds = new Set(customerSummaryMap.keys());
  const customerBinding = resolveCustomerBindingState({
    techClockRows,
    techLinks: stableTechLinks,
  });
  const hasReadyCustomerBinding = customerBinding.state === "ready";

  const segmentMap = resolveSegmentMap(segmentRows);
  let importantValueCustomerCount = 0;
  let importantReactivationCustomerCount = 0;
  if (hasReadyCustomerBinding) {
    importantValueCustomerCount = new Set(
      techLinks
        .filter((row) => row.identityStable)
        .filter((row) => {
          const segment =
            segmentMap.get(row.customerIdentityKey) ??
            (row.memberId ? segmentMap.get(`member:${row.memberId}`) : undefined) ??
            (row.memberId ? segmentMap.get(row.memberId) : undefined);
          return segment === "important-value-member";
        })
        .map((row) => resolveIdentityKey(row)),
    ).size;
    importantReactivationCustomerCount = new Set(
      techLinks
        .filter((row) => row.identityStable)
        .filter((row) => {
          const segment =
            segmentMap.get(row.customerIdentityKey) ??
            (row.memberId ? segmentMap.get(`member:${row.memberId}`) : undefined) ??
            (row.memberId ? segmentMap.get(row.memberId) : undefined);
          return segment === "important-reactivation-member";
        })
        .map((row) => resolveIdentityKey(row)),
    ).size;
  }

  const rankedCustomers = Array.from(customerSummaryMap.values())
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.amount - left.amount ||
        left.displayName.localeCompare(right.displayName),
    )
    .slice(0, 3);
  const repeatCustomerCount = Array.from(customerSummaryMap.values()).filter(
    (row) => row.count >= 2,
  ).length;
  const memberCustomerCount = Array.from(customerSummaryMap.values()).filter(
    (row) => row.memberBound,
  ).length;
  const averageOrdersPerCustomer =
    uniqueCustomerIds.size > 0 ? stableTechLinks.length / uniqueCustomerIds.size : 0;
  const archetype = classifyTechArchetype({
    pointClockRate,
    addClockRate,
    marketRevenue,
    importantValueCustomerCount,
  });
  const strengths = buildTechStrengths({
    pointClockRate,
    addClockRate,
    marketRevenue,
    importantValueCustomerCount,
    upClockRecordCount,
  });
  const weaknesses = buildTechWeaknesses({
    customerBindingState: customerBinding.state,
    uniqueCustomerCount: uniqueCustomerIds.size,
    upClockRecordCount,
    pointClockRate,
    addClockRate,
    marketRevenue,
  });
  const managerSuggestions = buildTechManagerSuggestions({
    techName,
    topProjectName: rankedProjects[0]?.name,
    preferredTimeBucket,
    customerBindingState: customerBinding.state,
    uniqueCustomerCount: uniqueCustomerIds.size,
    pointClockRate,
    addClockRate,
    marketRevenue,
  });
  const businessSignal = evaluateTechBusinessScore({
    customerBindingState: customerBinding.state,
    uniqueCustomerCount: uniqueCustomerIds.size,
    pointClockRate,
    addClockRate,
    marketRevenue,
    importantValueCustomerCount,
  });

  const lines = [
    `${storeName} 技师 ${techName} 画像`,
    `- 查询窗口: ${params.intent.timeFrame.label}`,
    `- 核心画像: ${archetype}`,
    `- 上钟: ${round(totalClockCount, 1)} 钟 / ${upClockRecordCount} 单，点钟率 ${formatRate(pointClockRate)}，加钟率 ${formatRate(addClockRate)}`,
    `- 业绩: 服务营收 ${formatCurrency(turnover)}，提成 ${formatCurrency(commission)}，推销营收 ${formatCurrency(marketRevenue)}`,
    `- 30天经营节奏: 服务 ${serviceDayCount} 天，日均 ${formatCount(averageOrdersPerServiceDay)} 单，日均营收 ${formatCurrency(averageTurnoverPerServiceDay)}，单钟产出 ${formatCurrency(averageTurnoverPerClock)}`,
    `- 经营等级: ${businessSignal.levelLabel}`,
    `- 经营标签: ${businessSignal.tags.join("、")}`,
    `- 当前带教优先级: ${businessSignal.actionPriority}`,
    `- 承接结构: 点钟 ${pointClockRecordCount} 单，轮钟 ${wheelClockRecordCount} 单，加钟 ${addClockRecordCount} 单，副项渗透 ${formatRate(marketPenetrationRate)}`,
  ];
  if (preferredTimeBucketStats) {
    lines.push(
      `- 高峰时段: ${preferredTimeBucketStats.name} ${preferredTimeBucketStats.count} 单 / ${formatCurrency(preferredTimeBucketStats.amount)}`,
    );
  }
  if (hasReadyCustomerBinding) {
    lines.push(
      `- 顾客经营: 30天真实服务顾客 ${uniqueCustomerIds.size} 位，复购顾客 ${repeatCustomerCount} 位，户均服务 ${formatCount(averageOrdersPerCustomer)} 次，顾客识别覆盖 ${customerBinding.linkedServiceOrderCount}/${customerBinding.totalServiceOrderCount} 单服务单${memberCustomerCount > 0 ? `，会员顾客 ${memberCustomerCount} 位` : ""}`,
    );
    lines.push(
      `- 服务顾客: ${uniqueCustomerIds.size} 位，其中重要价值会员 ${importantValueCustomerCount} 位、重要唤回会员 ${importantReactivationCustomerCount} 位`,
    );
  } else if (customerBinding.state === "partial") {
    const repeatSampleCount = Array.from(customerSummaryMap.values()).filter(
      (row) => row.count >= 2,
    ).length;
    lines.push(
      `- 顾客经营: 已识别 ${uniqueCustomerIds.size} 位顾客，复购样本 ${repeatSampleCount} 位，当前覆盖 ${customerBinding.linkedServiceOrderCount}/${customerBinding.totalServiceOrderCount} 单服务单，先补绑定再下完整顾客盘结论`,
    );
    lines.push(
      `- 顾客识别覆盖: 已识别 ${uniqueCustomerIds.size} 位顾客，覆盖 ${customerBinding.linkedServiceOrderCount}/${customerBinding.totalServiceOrderCount} 单服务单`,
    );
    lines.push("- 服务顾客: 顾客识别覆盖不足，当前不把已识别样本当作30天总服务顾客数");
  } else {
    lines.push("- 顾客经营: 待补客户-技师绑定数据，当前无法判断真实服务顾客与复购顾客。");
    lines.push("- 服务顾客: 待补客户技师绑定数据，当前不下客户归属判断");
  }

  if (rankedProjects.length > 0) {
    const topProject = rankedProjects[0];
    lines.push(
      `- 主打项目: ${topProject.name} ${topProject.count} 次 ${formatCurrency(topProject.amount)}`,
    );
    if (rankedProjects[1]) {
      lines.push(
        `  ${rankedProjects[1].name} ${rankedProjects[1].count} 次 ${formatCurrency(rankedProjects[1].amount)}`,
      );
    }
  } else {
    lines.push("- 主打项目: 暂无稳定项目记录");
  }

  if (hasReadyCustomerBinding && rankedCustomers.length > 0) {
    lines.push(
      `- 常服务顾客: ${rankedCustomers
        .map((row) => `${maskName(row.displayName)} ${row.count} 次`)
        .join("，")}`,
    );
  } else if (customerBinding.state === "partial") {
    lines.push("- 常服务顾客: 顾客识别覆盖不足，暂不输出");
  } else if (!hasReadyCustomerBinding) {
    lines.push("- 常服务顾客: 待补客户技师绑定数据");
  } else {
    lines.push("- 常服务顾客: 暂无稳定客户绑定记录");
  }

  lines.push("优劣势诊断");
  lines.push(`- 优势: ${strengths.join("、")}`);
  lines.push(`- 短板: ${weaknesses.join("、")}`);

  lines.push("店长动作建议");
  lines.push(...managerSuggestions.map((line) => `- ${line}`));

  return lines.join("\n");
}
