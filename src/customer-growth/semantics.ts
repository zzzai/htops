import type {
  CustomerIdentityType,
  HetangCustomerGrowthPrimarySegmentThresholds,
} from "../types.js";

export const HIGH_VALUE_MEMBER_VISIT_COUNT_90D = 4;
export const HIGH_VALUE_MEMBER_PAY_AMOUNT_90D = 1000;
export const HIGH_VALUE_MEMBER_ACTIVE_MAX_SILENT_DAYS = 30;
export const POTENTIAL_GROWTH_PAY_AMOUNT_90D = 500;
export const POTENTIAL_GROWTH_MAX_VISIT_COUNT_90D = 2;
export const GROUPBUY_CONVERSION_WINDOW_7D = 7;
export const GROUPBUY_CONVERSION_WINDOW_30D = 30;

export type ResolvedCustomerGrowthPrimarySegmentThresholds = {
  highValueMemberVisitCount90d: number;
  highValueMemberPayAmount90d: number;
  highValueMemberActiveMaxSilentDays: number;
  potentialGrowthPayAmount90d: number;
  potentialGrowthMaxVisitCount90d: number;
};

export const DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS: ResolvedCustomerGrowthPrimarySegmentThresholds =
  {
    highValueMemberVisitCount90d: HIGH_VALUE_MEMBER_VISIT_COUNT_90D,
    highValueMemberPayAmount90d: HIGH_VALUE_MEMBER_PAY_AMOUNT_90D,
    highValueMemberActiveMaxSilentDays: HIGH_VALUE_MEMBER_ACTIVE_MAX_SILENT_DAYS,
    potentialGrowthPayAmount90d: POTENTIAL_GROWTH_PAY_AMOUNT_90D,
    potentialGrowthMaxVisitCount90d: POTENTIAL_GROWTH_MAX_VISIT_COUNT_90D,
  };

export function resolveCustomerGrowthPrimarySegmentThresholds(
  overrides?: HetangCustomerGrowthPrimarySegmentThresholds,
): ResolvedCustomerGrowthPrimarySegmentThresholds {
  return {
    highValueMemberVisitCount90d:
      overrides?.highValueMemberVisitCount90d ??
      DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS.highValueMemberVisitCount90d,
    highValueMemberPayAmount90d:
      overrides?.highValueMemberPayAmount90d ??
      DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS.highValueMemberPayAmount90d,
    highValueMemberActiveMaxSilentDays:
      overrides?.highValueMemberActiveMaxSilentDays ??
      DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS.highValueMemberActiveMaxSilentDays,
    potentialGrowthPayAmount90d:
      overrides?.potentialGrowthPayAmount90d ??
      DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS.potentialGrowthPayAmount90d,
    potentialGrowthMaxVisitCount90d:
      overrides?.potentialGrowthMaxVisitCount90d ??
      DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS.potentialGrowthMaxVisitCount90d,
  };
}

export function isStableCustomerIdentityType(
  identityType: CustomerIdentityType | string | undefined,
): boolean {
  return identityType === "member" || identityType === "customer-ref";
}

export function qualifiesHighValueMemberWindow(params: {
  visitCount90d: number;
  payAmount90d: number;
  memberPayAmount90d: number;
  thresholds?: ResolvedCustomerGrowthPrimarySegmentThresholds;
}): boolean {
  const thresholds = params.thresholds ?? DEFAULT_CUSTOMER_GROWTH_PRIMARY_SEGMENT_THRESHOLDS;
  return (
    params.visitCount90d >= thresholds.highValueMemberVisitCount90d &&
    params.payAmount90d >= thresholds.highValueMemberPayAmount90d &&
    params.memberPayAmount90d > 0
  );
}
