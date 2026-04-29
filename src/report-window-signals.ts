import type { DailyStoreMetrics, StoreReview7dRow, StoreSummary30dRow } from "./types.js";

export function resolveDailyMetricWindowSignals(params: {
  metrics: DailyStoreMetrics;
  review?: Pick<
    StoreReview7dRow,
    | "memberRepurchaseBaseCustomerCount7d"
    | "memberRepurchaseReturnedCustomerCount7d"
    | "memberRepurchaseRate7d"
  > | null;
  summary?: Pick<
    StoreSummary30dRow,
    | "memberRepurchaseBaseCustomerCount7d"
    | "memberRepurchaseReturnedCustomerCount7d"
    | "memberRepurchaseRate7d"
  > | null;
}): DailyStoreMetrics {
  const memberRepurchaseBase =
    params.review?.memberRepurchaseBaseCustomerCount7d ??
    params.summary?.memberRepurchaseBaseCustomerCount7d ??
    params.metrics.memberRepurchaseBaseCustomerCount7d;
  const memberRepurchaseReturned =
    params.review?.memberRepurchaseReturnedCustomerCount7d ??
    params.summary?.memberRepurchaseReturnedCustomerCount7d ??
    params.metrics.memberRepurchaseReturnedCustomerCount7d;
  const memberRepurchaseRate =
    params.review?.memberRepurchaseRate7d ??
    params.summary?.memberRepurchaseRate7d ??
    params.metrics.memberRepurchaseRate7d;

  return {
    ...params.metrics,
    memberRepurchaseBaseCustomerCount7d: memberRepurchaseBase,
    memberRepurchaseReturnedCustomerCount7d: memberRepurchaseReturned,
    memberRepurchaseRate7d: memberRepurchaseRate,
  };
}
