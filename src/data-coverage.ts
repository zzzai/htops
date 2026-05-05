export type HetangDataCoverageRequest = {
  orgIds: string[];
  startBizDate: string;
  endBizDate: string;
  metrics: string[];
  capabilityId?: string;
  requiredFacts: string[];
};

export type HetangDataCoverageMissingRange = {
  orgId: string;
  startBizDate: string;
  endBizDate: string;
};

export type HetangDataCoverageAssessment = {
  complete: boolean;
  coverageRate?: number;
  missingRanges?: HetangDataCoverageMissingRange[];
  missingFacts?: string[];
  reason?: string;
};

export type HetangDataCoverageAssessor = (
  request: HetangDataCoverageRequest,
) => Promise<HetangDataCoverageAssessment> | HetangDataCoverageAssessment;

function parseBizDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid biz date: ${value}`);
  }
  return parsed;
}

function formatBizDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function listBizDates(startBizDate: string, endBizDate: string): string[] {
  const start = parseBizDate(startBizDate);
  const end = parseBizDate(endBizDate);
  if (start.getTime() > end.getTime()) {
    throw new Error(`Invalid coverage range: ${startBizDate} > ${endBizDate}`);
  }

  const dates: string[] = [];
  const cursor = new Date(start);
  while (cursor.getTime() <= end.getTime()) {
    dates.push(formatBizDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function collapseMissingDates(params: {
  orgId: string;
  missingDates: string[];
}): HetangDataCoverageMissingRange[] {
  const ranges: HetangDataCoverageMissingRange[] = [];
  let rangeStart: string | null = null;
  let previousDate: string | null = null;

  for (const currentDate of params.missingDates) {
    if (!rangeStart) {
      rangeStart = currentDate;
      previousDate = currentDate;
      continue;
    }

    const expectedNext = parseBizDate(previousDate ?? currentDate);
    expectedNext.setUTCDate(expectedNext.getUTCDate() + 1);
    if (formatBizDate(expectedNext) === currentDate) {
      previousDate = currentDate;
      continue;
    }

    ranges.push({
      orgId: params.orgId,
      startBizDate: rangeStart,
      endBizDate: previousDate ?? rangeStart,
    });
    rangeStart = currentDate;
    previousDate = currentDate;
  }

  if (rangeStart) {
    ranges.push({
      orgId: params.orgId,
      startBizDate: rangeStart,
      endBizDate: previousDate ?? rangeStart,
    });
  }
  return ranges;
}

export function assessDateRangeDataCoverage(params: {
  orgIds: string[];
  startBizDate: string;
  endBizDate: string;
  presentDatesByOrg: Record<string, string[]>;
  requiredFacts: string[];
}): HetangDataCoverageAssessment {
  const requiredDates = listBizDates(params.startBizDate, params.endBizDate);
  const missingRanges: HetangDataCoverageMissingRange[] = [];
  let presentCount = 0;
  let requiredCount = 0;

  for (const orgId of params.orgIds) {
    const presentDates = new Set(params.presentDatesByOrg[orgId] ?? []);
    const missingDates: string[] = [];
    for (const bizDate of requiredDates) {
      requiredCount += 1;
      if (presentDates.has(bizDate)) {
        presentCount += 1;
      } else {
        missingDates.push(bizDate);
      }
    }
    missingRanges.push(...collapseMissingDates({ orgId, missingDates }));
  }

  const complete = missingRanges.length === 0;
  const coverageRate = requiredCount > 0 ? presentCount / requiredCount : 1;
  return {
    complete,
    coverageRate,
    missingFacts: complete ? [] : params.requiredFacts,
    missingRanges,
    reason: complete ? "data_coverage_complete" : "data_coverage_incomplete",
  };
}
