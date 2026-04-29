import type { HetangQueryIntent } from "./query-intent.js";
import { resolveReportBizDate, shiftBizDate } from "./time.js";
import type { CustomerProfile90dRow, HetangOpsConfig, MemberCurrentRecord } from "./types.js";

type MemberMarketingRuntime = {
  listCurrentMembers?: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listCustomerProfile90dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
};

type EnrichedMember = {
  member: MemberCurrentRecord;
  profile?: CustomerProfile90dRow;
  sourceLabel: string;
  sourceResolved: boolean;
  sourceRawCode?: string;
  marketerLabel: string;
  hasMarketerAttribution: boolean;
  labels: string[];
  silentDays: number;
  highValue: boolean;
};

type AggregateRow = {
  label: string;
  count: number;
  silent30Count: number;
  silent90Count: number;
  highValueCount: number;
  totalStoredAmount: number;
  totalConsumeAmount: number;
};

type MemberCouponSnapshot = {
  memberId: string;
  memberName: string;
  couponLabel: string;
  sourceLabel: string;
  isUsed: boolean;
  expireTime?: string;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function formatPercent(value: number): string {
  return `${round(value * 100, 1).toFixed(1)}%`;
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function tryParseObject(rawJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function pickLatestProfileRows(rows: CustomerProfile90dRow[]): Map<string, CustomerProfile90dRow> {
  const map = new Map<string, CustomerProfile90dRow>();
  for (const row of rows) {
    if (!row.memberId) {
      continue;
    }
    const previous = map.get(row.memberId);
    if (!previous || previous.windowEndBizDate < row.windowEndBizDate) {
      map.set(row.memberId, row);
    }
  }
  return map;
}

function resolveSourceLabel(value: unknown): { label: string; resolved: boolean; rawCode?: string } {
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/u.test(trimmed)) {
      return {
        label: `来源编码 ${trimmed}`,
        resolved: false,
        rawCode: trimmed,
      };
    }
    return { label: trimmed, resolved: true };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return {
      label: `来源编码 ${value}`,
      resolved: false,
      rawCode: String(value),
    };
  }
  return { label: "未标注来源", resolved: false };
}

function resolveMarketerLabel(raw: Record<string, unknown> | null): {
  label: string;
  hasAttribution: boolean;
} {
  const candidates = [raw?.MarketerName, raw?.MarketerCode, raw?.MarketerId]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .filter(Boolean);
  return candidates[0]
    ? { label: candidates[0], hasAttribution: true }
    : { label: "未分配营销人", hasAttribution: false };
}

function resolveLabels(raw: Record<string, unknown> | null): string[] {
  const labels = raw?.Labels;
  if (Array.isArray(labels)) {
    return labels
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
  }
  if (typeof labels === "string") {
    return labels
      .split(/[、,，|/]/u)
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeCouponEntries(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
}

function resolveCouponBool(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "used" || normalized === "yes";
  }
  return false;
}

function resolveCouponLabel(raw: Record<string, unknown>): string {
  const candidates = [raw.Name, raw.CouponName, raw.Title, raw.TypeName]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .filter(Boolean);
  return candidates[0] || "未命名券";
}

function resolveCouponSourceLabel(raw: Record<string, unknown>): string {
  const candidates = [raw.Source, raw.Channel, raw.SourceName]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .filter(Boolean);
  return candidates[0] || "未标注来源";
}

function parseCouponExpiryTime(raw: Record<string, unknown>): string | undefined {
  const candidates = [raw.ExpireTime, raw.ExpiredAt, raw.ValidEndTime, raw.EndTime]
    .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
    .filter(Boolean);
  return candidates[0] || undefined;
}

function parseTimestampMs(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const normalized =
    /[zZ]$/u.test(value) || /[+-]\d{2}:\d{2}$/u.test(value)
      ? value.replace(" ", "T")
      : `${value.replace(" ", "T")}Z`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function collectMemberCouponSnapshots(members: MemberCurrentRecord[]): MemberCouponSnapshot[] {
  const snapshots: MemberCouponSnapshot[] = [];
  for (const member of members) {
    const raw = tryParseObject(member.rawJson);
    for (const coupon of normalizeCouponEntries(raw?.Coupons)) {
      snapshots.push({
        memberId: member.memberId,
        memberName: member.name,
        couponLabel: resolveCouponLabel(coupon),
        sourceLabel: resolveCouponSourceLabel(coupon),
        isUsed: resolveCouponBool(coupon.IsUsed ?? coupon.Used ?? coupon.Status),
        expireTime: parseCouponExpiryTime(coupon),
      });
    }
  }
  return snapshots;
}

function isHighValue(profile: CustomerProfile90dRow | undefined, member: MemberCurrentRecord): boolean {
  if (
    profile?.primarySegment === "important-value-member" ||
    profile?.primarySegment === "important-reactivation-member"
  ) {
    return true;
  }
  return member.storedAmount >= 1000 || member.consumeAmount >= 2000;
}

function aggregateRows(entries: Array<{ label: string; member: EnrichedMember }>): AggregateRow[] {
  const map = new Map<string, AggregateRow>();
  for (const entry of entries) {
    const current =
      map.get(entry.label) ??
      ({
        label: entry.label,
        count: 0,
        silent30Count: 0,
        silent90Count: 0,
        highValueCount: 0,
        totalStoredAmount: 0,
        totalConsumeAmount: 0,
      } satisfies AggregateRow);
    current.count += 1;
    current.totalStoredAmount += entry.member.member.storedAmount;
    current.totalConsumeAmount += entry.member.member.consumeAmount;
    if (entry.member.silentDays >= 30) {
      current.silent30Count += 1;
    }
    if (entry.member.silentDays >= 90) {
      current.silent90Count += 1;
    }
    if (entry.member.highValue) {
      current.highValueCount += 1;
    }
    map.set(entry.label, current);
  }
  return [...map.values()];
}

function sortSourceStats(rows: AggregateRow[]): AggregateRow[] {
  return [...rows].sort((left, right) => {
    const leftSilent90 = left.count > 0 ? left.silent90Count / left.count : 0;
    const rightSilent90 = right.count > 0 ? right.silent90Count / right.count : 0;
    const leftSilent30 = left.count > 0 ? left.silent30Count / left.count : 0;
    const rightSilent30 = right.count > 0 ? right.silent30Count / right.count : 0;
    const leftAvgStored = left.count > 0 ? left.totalStoredAmount / left.count : 0;
    const rightAvgStored = right.count > 0 ? right.totalStoredAmount / right.count : 0;
    return (
      rightSilent90 - leftSilent90 ||
      rightSilent30 - leftSilent30 ||
      right.highValueCount - left.highValueCount ||
      rightAvgStored - leftAvgStored ||
      right.count - left.count
    );
  });
}

function sortMarketerStats(rows: AggregateRow[], text: string): AggregateRow[] {
  const byAverage = /(人均|平均)/u.test(text);
  return [...rows].sort((left, right) => {
    const leftScore = byAverage && left.count > 0 ? left.totalStoredAmount / left.count : left.totalStoredAmount;
    const rightScore =
      byAverage && right.count > 0 ? right.totalStoredAmount / right.count : right.totalStoredAmount;
    return (
      rightScore - leftScore ||
      right.highValueCount - left.highValueCount ||
      right.count - left.count
    );
  });
}

function sortLabelStats(rows: AggregateRow[]): AggregateRow[] {
  return [...rows].sort((left, right) => {
    const leftAvgStored = left.count > 0 ? left.totalStoredAmount / left.count : 0;
    const rightAvgStored = right.count > 0 ? right.totalStoredAmount / right.count : 0;
    const leftSilent30 = left.count > 0 ? left.silent30Count / left.count : 0;
    const rightSilent30 = right.count > 0 ? right.silent30Count / right.count : 0;
    return (
      right.highValueCount - left.highValueCount ||
      rightAvgStored - leftAvgStored ||
      rightSilent30 - leftSilent30 ||
      right.count - left.count
    );
  });
}

function renderSourceSilentAnalysis(storeName: string, rows: EnrichedMember[]): string {
  const stats = sortSourceStats(aggregateRows(rows.map((row) => ({ label: row.sourceLabel, member: row }))));
  const lines = [`${storeName}当前会员来源沉默分析`];
  if (stats.length === 0) {
    lines.push("- 当前会员池里没有可用于来源分析的记录。");
    return lines.join("\n");
  }
  const top = stats[0]!;
  lines.push(
    `- 更容易沉默的来源: ${top.label}，沉默30天占比 ${formatPercent(top.silent30Count / top.count)}，沉默90天占比 ${formatPercent(top.silent90Count / top.count)}，高价值 ${top.highValueCount} 人`,
  );
  lines.push(
    `- 来源Top3: ${stats
      .slice(0, 3)
      .map(
        (row) =>
          `${row.label} ${row.count} 人，沉默30天占比 ${formatPercent(row.silent30Count / row.count)}，人均储值 ${formatCurrency(row.totalStoredAmount / row.count)}`,
      )
      .join("；")}`,
  );
  lines.push("- 动作建议: 先盯沉默占比高且高价值人数多的来源，再拆给店长和营销人做分层唤回。");
  return lines.join("\n");
}

function renderSourceComparisonBoundary(storeName: string, rows: EnrichedMember[]): string {
  const distinctCodes = Array.from(
    new Set(rows.map((row) => row.sourceRawCode).filter((value): value is string => Boolean(value))),
  );
  return [
    `${storeName}当前还不能严肃比较会员来源沉默`,
    distinctCodes.length > 0
      ? `- 当前会员来源字段只有单一未映射来源编码 ${distinctCodes.join("、")}，还没形成可解释的来源结构。`
      : "- 当前会员来源字段还没有稳定可解释的业务值。",
    "- 这不是计算错，而是底层 `From` 仍是枚举码，真实业务映射还没补完；现在直接比较会误导。",
    "- 当前可先问：生日会员名单、标签经营优先级、近30天哪个客服带来的充值最多。",
  ].join("\n");
}

function renderMarketerStoredAnalysis(storeName: string, rows: EnrichedMember[], text: string): string {
  const stats = sortMarketerStats(
    aggregateRows(
      rows
        .filter((row) => row.marketerLabel !== "未分配营销人")
        .map((row) => ({ label: row.marketerLabel, member: row })),
    ),
    text,
  );
  const lines = [`${storeName}当前营销人会员经营`];
  if (stats.length === 0) {
    lines.push("- 当前会员池里还没有可用于营销人归因的记录。");
    return lines.join("\n");
  }
  const top = stats[0]!;
  lines.push(
    `- 储值最高营销人: ${top.label}，总储值 ${formatCurrency(top.totalStoredAmount)}，名下 ${top.count} 人，人均 ${formatCurrency(top.totalStoredAmount / top.count)}，高价值 ${top.highValueCount} 人`,
  );
  lines.push(
    `- Top3: ${stats
      .slice(0, 3)
      .map(
        (row) =>
          `${row.label} 总储值 ${formatCurrency(row.totalStoredAmount)}，人均 ${formatCurrency(row.totalStoredAmount / row.count)}`,
      )
      .join("；")}`,
  );
  lines.push("- 动作建议: 先复盘头部营销人的带客结构和唤回节奏，再把高价值沉默会员分回对应责任人。");
  return lines.join("\n");
}

function renderMarketerBoundary(storeName: string): string {
  return [
    `${storeName}当前会员表里还没有营销归因字段`,
    "- 当前这批会员记录里的 `MarketerName / MarketerCode / MarketerId` 都是空，不能严肃比较“哪个营销人带来的会员储值更高”。",
    "- 这说明会员侧营销归因目前还没随接口稳定回传，不是模型没识别出来。",
    "- 当前可先问：哪些标签会员最值得重点经营、近30天哪个客服带来的充值最多。",
  ].join("\n");
}

function renderLabelPriorityAnalysis(storeName: string, rows: EnrichedMember[]): string {
  const stats = sortLabelStats(
    aggregateRows(
      rows.flatMap((row) => row.labels.map((label) => ({ label, member: row }))),
    ),
  );
  const lines = [`${storeName}当前标签经营优先级`];
  if (stats.length === 0) {
    lines.push("- 当前会员池里还没有稳定可用的标签数据。");
    return lines.join("\n");
  }
  const top = stats[0]!;
  lines.push(
    `- 当前最该先抓的标签: ${top.label}，覆盖 ${top.count} 人，高价值 ${top.highValueCount} 人，沉默30天占比 ${formatPercent(top.silent30Count / top.count)}，人均储值 ${formatCurrency(top.totalStoredAmount / top.count)}`,
  );
  lines.push(
    `- Top3: ${stats
      .slice(0, 3)
      .map(
        (row) =>
          `${row.label} ${row.count} 人，高价值 ${row.highValueCount} 人，人均储值 ${formatCurrency(row.totalStoredAmount / row.count)}`,
      )
      .join("；")}`,
  );
  lines.push("- 动作建议: 标签经营先按高价值人数、人均储值和沉默风险排优先级，不要只看名单规模。");
  return lines.join("\n");
}

function renderCouponBoundary(storeName: string): string {
  return [
    `${storeName}优惠券回店效果暂未接通`,
    "- 当前只有会员当前券包快照，没有发券时间、核销链路和券后回店闭环，暂时不能严肃归因“发券后谁真正回店了”。",
    "- 当前可先问：哪些标签会员最值得重点经营、哪个营销人带来的会员储值更高。",
  ].join("\n");
}

function renderCouponSnapshotBoundary(storeName: string): string {
  return [
    `${storeName}当前会员券包快照暂不可用`,
    "- 当前会员原始快照里没有稳定的 Coupons 子结构，暂时不能严肃回答已用/未用/临期券数量。",
    "- 如果后续 1.1 稳定返回 Coupons 明细，就可以补成券包快照查询。",
  ].join("\n");
}

function renderCouponUsageSnapshot(params: {
  storeName: string;
  snapshotBizDate: string;
  coupons: MemberCouponSnapshot[];
}): string {
  const used = params.coupons.filter((coupon) => coupon.isUsed);
  const unused = params.coupons.filter((coupon) => !coupon.isUsed);
  const usedMembers = new Set(used.map((coupon) => coupon.memberId));
  const unusedMembers = new Set(unused.map((coupon) => coupon.memberId));
  const usedByCoupon = new Map<string, number>();
  for (const coupon of used) {
    usedByCoupon.set(coupon.couponLabel, (usedByCoupon.get(coupon.couponLabel) ?? 0) + 1);
  }
  const topUsed = Array.from(usedByCoupon.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([label, count]) => `${label} ${count} 张`)
    .join("；");

  return [
    `${params.storeName} ${params.snapshotBizDate} 当前会员券包使用快照`,
    `- 已用券 ${used.length} 张，涉及 ${usedMembers.size} 人`,
    `- 未用券 ${unused.length} 张，涉及 ${unusedMembers.size} 人`,
    topUsed ? `- 已用券Top: ${topUsed}` : "- 当前还没有已用券记录。",
    "- 说明：这里只能回答当前券包快照，不能严肃确认“上次发的那一批券”的完整核销表现。",
  ].join("\n");
}

function renderCouponExpirySnapshot(params: {
  storeName: string;
  snapshotBizDate: string;
  coupons: MemberCouponSnapshot[];
}): string {
  const snapshotMs = parseTimestampMs(`${params.snapshotBizDate} 00:00:00`) ?? 0;
  const sevenDaysMs = 7 * 86_400_000;
  const expiring = params.coupons
    .filter((coupon) => !coupon.isUsed)
    .map((coupon) => ({
      ...coupon,
      expireMs: parseTimestampMs(coupon.expireTime),
    }))
    .filter(
      (coupon) =>
        coupon.expireMs !== null &&
        coupon.expireMs >= snapshotMs &&
        coupon.expireMs - snapshotMs <= sevenDaysMs,
    );

  const members = new Map<string, { memberName: string; count: number; earliestExpire?: string }>();
  for (const coupon of expiring) {
    const current =
      members.get(coupon.memberId) ??
      {
        memberName: coupon.memberName,
        count: 0,
        earliestExpire: coupon.expireTime,
      };
    current.count += 1;
    if (
      coupon.expireTime &&
      (!current.earliestExpire || coupon.expireTime < current.earliestExpire)
    ) {
      current.earliestExpire = coupon.expireTime;
    }
    members.set(coupon.memberId, current);
  }

  const topMembers = Array.from(members.values())
    .sort((left, right) => right.count - left.count || left.memberName.localeCompare(right.memberName))
    .slice(0, 3)
    .map((entry) => `${entry.memberName} ${entry.count} 张${entry.earliestExpire ? `，最早 ${entry.earliestExpire}` : ""}`)
    .join("；");

  return [
    `${params.storeName} ${params.snapshotBizDate} 当前会员券包临期快照`,
    `- 7天内快过期未用券 ${expiring.length} 张，涉及 ${members.size} 人`,
    topMembers ? `- 临期会员Top: ${topMembers}` : "- 当前没有7天内快过期未用券。",
    "- 说明：这里只是当前券包快照，不代表完整发券批次表现。",
  ].join("\n");
}

function renderSexBoundary(storeName: string): string {
  return [
    `${storeName}性别偏好分析暂未接通`,
    "- 当前虽然有生日/性别字段，但还没把性别和消费项目做稳定关联，暂时不能严肃下男宾/女宾项目偏好差异结论。",
    "- 当前可先问：生日会员名单、会员来源沉默、标签经营优先级。",
  ].join("\n");
}

export async function executeMemberMarketingQuery(params: {
  runtime: MemberMarketingRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  now: Date;
}): Promise<string> {
  if (!params.runtime.listCurrentMembers) {
    return "当前环境还未接通会员来源 / 标签 / 营销人分析能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "会员经营字段分析当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const isCouponAsk = /(优惠券|优惠|券)/u.test(params.intent.rawText);
  const couponEffectAsk = /(回店|复到店|核销|回来|效果)/u.test(params.intent.rawText);
  const couponSnapshotAsk = /(用了|用掉|没用|未用|过期|快过期)/u.test(params.intent.rawText);
  if (isCouponAsk && couponEffectAsk) {
    return renderCouponBoundary(storeName);
  }
  if (/(女宾|男宾|男客|女客|性别)/u.test(params.intent.rawText) && /(项目|偏好|差异)/u.test(params.intent.rawText)) {
    return renderSexBoundary(storeName);
  }

  const members = await params.runtime.listCurrentMembers({ orgId });
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const profiles = params.runtime.listCustomerProfile90dByDateRange
    ? await params.runtime.listCustomerProfile90dByDateRange({
        orgId,
        startBizDate: shiftBizDate(reportBizDate, -6),
        endBizDate: reportBizDate,
      })
    : [];
  const profileByMemberId = pickLatestProfileRows(profiles);
  if (isCouponAsk && couponSnapshotAsk) {
    const couponSnapshots = collectMemberCouponSnapshots(members);
    if (couponSnapshots.length === 0) {
      return renderCouponSnapshotBoundary(storeName);
    }
    if (/(过期|快过期)/u.test(params.intent.rawText)) {
      return renderCouponExpirySnapshot({
        storeName,
        snapshotBizDate: reportBizDate,
        coupons: couponSnapshots,
      });
    }
    return renderCouponUsageSnapshot({
      storeName,
      snapshotBizDate: reportBizDate,
      coupons: couponSnapshots,
    });
  }

  const enrichedRows: EnrichedMember[] = members.map((member) => {
    const raw = tryParseObject(member.rawJson);
    const profile = profileByMemberId.get(member.memberId);
    const source = resolveSourceLabel(raw?.From);
    const marketer = resolveMarketerLabel(raw);
    return {
      member,
      profile,
      sourceLabel: source.label,
      sourceResolved: source.resolved,
      sourceRawCode: source.rawCode,
      marketerLabel: marketer.label,
      hasMarketerAttribution: marketer.hasAttribution,
      labels: resolveLabels(raw),
      silentDays: profile?.currentSilentDays ?? member.silentDays,
      highValue: isHighValue(profile, member),
    };
  });

  if ((/(来源|渠道)/u.test(params.intent.rawText) && /(沉默|流失|唤回|没来|未到店|活跃)/u.test(params.intent.rawText))) {
    const distinctSourceLabels = new Set(enrichedRows.map((row) => row.sourceLabel));
    const hasResolvedSource = enrichedRows.some((row) => row.sourceResolved);
    if (!hasResolvedSource || distinctSourceLabels.size <= 1) {
      return renderSourceComparisonBoundary(storeName, enrichedRows);
    }
    return renderSourceSilentAnalysis(storeName, enrichedRows);
  }
  if (/(营销人|营销员|营销带来的会员|带来的会员|营销归因)/u.test(params.intent.rawText)) {
    if (!enrichedRows.some((row) => row.hasMarketerAttribution)) {
      return renderMarketerBoundary(storeName);
    }
    return renderMarketerStoredAnalysis(storeName, enrichedRows, params.intent.rawText);
  }
  if (/标签/u.test(params.intent.rawText) && /(经营|跟进|重点|值得|优先)/u.test(params.intent.rawText)) {
    return renderLabelPriorityAnalysis(storeName, enrichedRows);
  }

  return [
    `${storeName}当前会员经营字段已接通`,
    "- 已支持：会员来源沉默分析、营销人字段归因（前提是会员接口已回传）、标签经营优先级。",
    "- 边界提醒：优惠券回店效果、男宾/女宾项目偏好差异还缺稳定闭环，当前不下最终结论。",
  ].join("\n");
}
