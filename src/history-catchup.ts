import type { HetangOpsConfig } from "./types.js";
import { resolveReportBizDate, shiftBizDate } from "./time.js";

export function resolveHistoryCatchupRange(params: {
  now: Date;
  timeZone: string;
  cutoffLocalTime?: string;
  historyBackfillDays: number;
}): {
  startBizDate: string;
  endBizDate: string;
} {
  const endBizDate = resolveReportBizDate({
    now: params.now,
    timeZone: params.timeZone,
    cutoffLocalTime: params.cutoffLocalTime,
  });
  const startBizDate = shiftBizDate(endBizDate, -(params.historyBackfillDays - 1));
  return {
    startBizDate,
    endBizDate,
  };
}

export function resolveHistoryCatchupOrgIds(
  config: HetangOpsConfig,
  orgIds?: string[],
): string[] {
  if (orgIds && orgIds.length > 0) {
    return orgIds;
  }
  return config.stores.filter((entry) => entry.isActive).map((entry) => entry.orgId);
}
