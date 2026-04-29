import type { HetangQueryIntent, HetangQueryTimeFrame } from "./query-intent.js";
import { buildTargetDateByMonthDay, resolveBirthdayMonthDay } from "./birthday-utils.js";
import { resolveReportBizDate, shiftBizDate } from "./time.js";
import type {
  CustomerProfile90dRow,
  HetangOpsConfig,
  MemberCurrentRecord,
  MemberReactivationQueueRecord,
} from "./types.js";

type BirthdayQueryRuntime = {
  listCurrentMembers?: (params: { orgId: string }) => Promise<MemberCurrentRecord[]>;
  listCustomerProfile90dByDateRange?: (params: {
    orgId: string;
    startBizDate: string;
    endBizDate: string;
  }) => Promise<CustomerProfile90dRow[]>;
  listMemberReactivationQueue?: (params: {
    orgId: string;
    bizDate: string;
  }) => Promise<MemberReactivationQueueRecord[]>;
};

type BirthdayCandidate = {
  member: MemberCurrentRecord;
  profile?: CustomerProfile90dRow;
  queue?: MemberReactivationQueueRecord;
  matchedDate: string;
  birthdayMonthDay: string;
  operatingLabel: string;
};

type PreparedBirthdayMember = {
  member: MemberCurrentRecord;
  birthdayMonthDay: string | null;
  matchedDate: string | null;
  profile?: CustomerProfile90dRow;
  queue?: MemberReactivationQueueRecord;
};

const BIRTHDAY_QUEUE_LOOKBACK_DAYS = 7;

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function formatCurrency(value: number): string {
  return `${round(value, 2).toFixed(2)} 元`;
}

function getStoreName(config: HetangOpsConfig, orgId: string): string {
  return config.stores.find((entry) => entry.orgId === orgId)?.storeName ?? orgId;
}

function enumerateDates(frame: HetangQueryTimeFrame): string[] {
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

function pickLatestProfileRows(rows: CustomerProfile90dRow[]): Map<string, CustomerProfile90dRow> {
  const map = new Map<string, CustomerProfile90dRow>();
  for (const row of rows) {
    const previous = map.get(row.memberId ?? "");
    if (!row.memberId) {
      continue;
    }
    if (!previous || previous.windowEndBizDate < row.windowEndBizDate) {
      map.set(row.memberId, row);
    }
  }
  return map;
}

async function loadBirthdayQueueSnapshot(params: {
  runtime: BirthdayQueryRuntime;
  orgId: string;
  targetBizDate: string;
}): Promise<{ bizDate: string; rows: MemberReactivationQueueRecord[] }> {
  if (!params.runtime.listMemberReactivationQueue) {
    return {
      bizDate: params.targetBizDate,
      rows: [],
    };
  }
  let bizDate = params.targetBizDate;
  for (let offset = 0; offset <= BIRTHDAY_QUEUE_LOOKBACK_DAYS; offset += 1) {
    const rows = await params.runtime.listMemberReactivationQueue({
      orgId: params.orgId,
      bizDate,
    });
    if (rows.length > 0 || offset === BIRTHDAY_QUEUE_LOOKBACK_DAYS) {
      return { bizDate, rows };
    }
    bizDate = shiftBizDate(params.targetBizDate, -(offset + 1));
  }
  return {
    bizDate: params.targetBizDate,
    rows: [],
  };
}

function isHighValue(profile: CustomerProfile90dRow | undefined, member: MemberCurrentRecord): boolean {
  if (
    profile?.primarySegment === "important-value-member" ||
    profile?.primarySegment === "important-reactivation-member"
  ) {
    return true;
  }
  return (profile?.payAmount90d ?? member.consumeAmount) >= 1000 || member.storedAmount >= 1000;
}

function daysSilent(profile: CustomerProfile90dRow | undefined, member: MemberCurrentRecord): number {
  return profile?.currentSilentDays ?? profile?.daysSinceLastVisit ?? member.silentDays;
}

function resolveOperatingLabel(
  profile: CustomerProfile90dRow | undefined,
  member: MemberCurrentRecord,
): string {
  if (profile?.primarySegment === "important-reactivation-member") {
    return "高价值待唤回";
  }
  if (profile?.primarySegment === "important-value-member") {
    return "高价值稳态";
  }
  if (profile?.primarySegment === "potential-growth-customer") {
    return "潜力成长";
  }
  if (daysSilent(profile, member) >= 90 && member.storedAmount >= 1000) {
    return "高价值待唤回";
  }
  if (member.storedAmount >= 1000 || member.consumeAmount >= 2000) {
    return "高价值稳态";
  }
  if (daysSilent(profile, member) >= 90) {
    return "沉默待唤回";
  }
  return "常规生日关怀";
}

function shouldIncludeCandidate(
  text: string,
  profile: CustomerProfile90dRow | undefined,
  member: MemberCurrentRecord,
): boolean {
  if (/高价值/u.test(text) && !isHighValue(profile, member)) {
    return false;
  }
  if (/(最近)?90天.*(没来店|未到店)|90天.*沉默/u.test(text) && daysSilent(profile, member) < 90) {
    return false;
  }
  if (/(唤回|沉默)/u.test(text) && daysSilent(profile, member) < 30) {
    return false;
  }
  return true;
}

function compareQueueOrder(
  left: MemberReactivationQueueRecord | undefined,
  right: MemberReactivationQueueRecord | undefined,
): number {
  if (left && !right) {
    return -1;
  }
  if (!left && right) {
    return 1;
  }
  if (!left || !right) {
    return 0;
  }
  return (
    left.priorityRank - right.priorityRank ||
    right.executionPriorityScore - left.executionPriorityScore ||
    right.strategyPriorityScore - left.strategyPriorityScore ||
    left.memberId.localeCompare(right.memberId)
  );
}

function sortCandidates(text: string, rows: BirthdayCandidate[]): BirthdayCandidate[] {
  return [...rows].sort((left, right) => {
    const queueOrder = compareQueueOrder(left.queue, right.queue);
    if (queueOrder !== 0) {
      return queueOrder;
    }
    if (left.matchedDate !== right.matchedDate) {
      return left.matchedDate.localeCompare(right.matchedDate);
    }
    if (/(储值高|余额高)/u.test(text)) {
      return (
        right.member.storedAmount - left.member.storedAmount ||
        daysSilent(right.profile, right.member) - daysSilent(left.profile, left.member)
      );
    }
    if (/(唤回|沉默|没来店|未到店)/u.test(text)) {
      return (
        daysSilent(right.profile, right.member) - daysSilent(left.profile, left.member) ||
        right.member.storedAmount - left.member.storedAmount
      );
    }
    return (
      right.member.storedAmount - left.member.storedAmount ||
      daysSilent(right.profile, right.member) - daysSilent(left.profile, left.member)
    );
  });
}

function formatHeader(storeName: string, intent: HetangQueryIntent, count: number): string {
  const qualifier = /高价值/u.test(intent.rawText)
    ? "（高价值优先）"
    : /(唤回|沉默)/u.test(intent.rawText)
      ? "（唤回优先）"
      : "";
  return `${storeName}${intent.timeFrame.label}生日会员名单${qualifier}（共 ${count} 人）`;
}

function describeBirthdayFilter(text: string): string | null {
  if (/(最近)?90天.*(没来店|未到店)|90天.*沉默/u.test(text)) {
    return "最近90天未到店";
  }
  if (/高价值/u.test(text)) {
    return "高价值";
  }
  if (/(唤回|沉默)/u.test(text)) {
    return "唤回/沉默";
  }
  return null;
}

function renderZeroCandidateExplanation(params: {
  storeName: string;
  intent: HetangQueryIntent;
  members: PreparedBirthdayMember[];
}): string[] {
  const parseableMembers = params.members.filter((row) => Boolean(row.birthdayMonthDay));
  const matchedWindowMembers = parseableMembers.filter((row) => Boolean(row.matchedDate));
  const missingBirthdayCount = params.members.length - parseableMembers.length;
  const filterLabel = describeBirthdayFilter(params.intent.rawText);
  const lines = ["- 当前没有符合条件的会员。"];

  if (parseableMembers.length === 0) {
    lines.push("- 当前会员资料里还没有可用的生日字段，所以这条名单暂时查不出来。");
    return lines;
  }

  lines.push(
    `- 当前生日字段已录入 ${parseableMembers.length}/${params.members.length} 位会员。`,
  );

  if (matchedWindowMembers.length === 0) {
    lines.push(`- ${params.intent.timeFrame.label}这个时间窗内，本身没有命中生日会员。`);
  } else if (filterLabel) {
    lines.push(
      `- ${params.intent.timeFrame.label}内命中 ${matchedWindowMembers.length} 位生日会员，但都不满足“${filterLabel}”条件。`,
    );
  } else {
    lines.push(
      `- ${params.intent.timeFrame.label}内命中 ${matchedWindowMembers.length} 位生日会员，但当前排序条件下没有保留可展示名单。`,
    );
  }

  if (missingBirthdayCount > 0) {
    lines.push(`- 另有 ${missingBirthdayCount} 位会员没有录入生日，名单会偏少。`);
  }
  return lines;
}

export async function executeBirthdayMemberQuery(params: {
  runtime: BirthdayQueryRuntime;
  config: HetangOpsConfig;
  intent: HetangQueryIntent;
  effectiveOrgIds: string[];
  now: Date;
}): Promise<string> {
  if (!params.runtime.listCurrentMembers) {
    return "当前环境还未接通生日会员名单查询能力。";
  }
  if (params.effectiveOrgIds.length !== 1) {
    return "生日经营查询当前先按单店执行，请在问题里带上门店名。";
  }

  const [orgId] = params.effectiveOrgIds;
  const storeName = getStoreName(params.config, orgId);
  const members = await params.runtime.listCurrentMembers({ orgId });
  const reportBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.config.timeZone,
    cutoffLocalTime: params.config.sync.businessDayCutoffLocalTime,
  });
  const targetDates = enumerateDates(params.intent.timeFrame);
  const targetDateByMonthDay = buildTargetDateByMonthDay({
    startBizDate: targetDates[0] ?? reportBizDate,
    endBizDate: targetDates[targetDates.length - 1] ?? reportBizDate,
  });
  const profiles = params.runtime.listCustomerProfile90dByDateRange
    ? await params.runtime.listCustomerProfile90dByDateRange({
        orgId,
        startBizDate: shiftBizDate(reportBizDate, -6),
        endBizDate: reportBizDate,
      })
    : [];
  const profileByMemberId = pickLatestProfileRows(profiles);
  const queueSnapshot = await loadBirthdayQueueSnapshot({
    runtime: params.runtime,
    orgId,
    targetBizDate: reportBizDate,
  });
  const queueByMemberId = new Map(queueSnapshot.rows.map((row) => [row.memberId, row] as const));
  const preparedMembers: PreparedBirthdayMember[] = members.map((member) => {
    const queue = queueByMemberId.get(member.memberId);
    const birthdayMonthDay = queue?.birthdayMonthDay ?? resolveBirthdayMonthDay(member.rawJson);
    return {
      member,
      birthdayMonthDay,
      matchedDate: birthdayMonthDay ? targetDateByMonthDay.get(birthdayMonthDay) ?? null : null,
      profile: profileByMemberId.get(member.memberId),
      queue,
    };
  });

  const birthdayCandidates: BirthdayCandidate[] = [];
  for (const row of preparedMembers) {
    if (!row.birthdayMonthDay || !row.matchedDate) {
      continue;
    }
    if (!shouldIncludeCandidate(params.intent.rawText, row.profile, row.member)) {
      continue;
    }
    birthdayCandidates.push({
      member: row.member,
      profile: row.profile,
      queue: row.queue,
      matchedDate: row.matchedDate,
      birthdayMonthDay: row.birthdayMonthDay,
      operatingLabel: resolveOperatingLabel(row.profile, row.member),
    });
  }

  const candidates = sortCandidates(params.intent.rawText, birthdayCandidates);

  const lines = [formatHeader(storeName, params.intent, candidates.length)];
  if (candidates.length === 0) {
    lines.push(...renderZeroCandidateExplanation({ storeName, intent: params.intent, members: preparedMembers }));
    return lines.join("\n");
  }

  for (const [index, row] of candidates.slice(0, 20).entries()) {
    const silentDays = daysSilent(row.profile, row.member);
    const lastConsumeTime =
      row.profile?.currentLastConsumeTime ?? row.member.lastConsumeTime ?? "暂无到店记录";
    const priorityPrefix = row.queue ? `${row.queue.priorityBand}｜` : "";
    const reasonSuffix = row.queue?.reasonSummary ? `｜原因 ${row.queue.reasonSummary}` : "";
    lines.push(
      `${index + 1}. ${row.member.name}｜${priorityPrefix}生日 ${row.matchedDate.slice(5)}｜${row.operatingLabel}｜储值 ${formatCurrency(row.member.storedAmount)}｜沉默 ${silentDays} 天｜最近到店 ${lastConsumeTime}${reasonSuffix}`,
    );
  }

  if (candidates.some((row) => row.queue)) {
    const queueTop = candidates.find((row) => row.queue)?.queue;
    if (queueTop?.touchAdviceSummary) {
      lines.push("", `动作建议：先从 ${queueTop.priorityBand} 名单开始，${queueTop.touchAdviceSummary}`);
      return lines.join("\n");
    }
  }

  if (/(唤回|沉默|没来店|未到店)/u.test(params.intent.rawText)) {
    lines.push("", "动作建议：优先按熟客技师和最近消费项目做生日关怀，再落1对1唤回。");
  } else if (/高价值/u.test(params.intent.rawText)) {
    lines.push("", "动作建议：高价值会员先做生日关怀，再结合储值余额和熟客技师安排重点回访。");
  } else {
    lines.push("", "动作建议：先做生日祝福，再按储值余额、沉默天数和技师偏好分层跟进。");
  }
  return lines.join("\n");
}
