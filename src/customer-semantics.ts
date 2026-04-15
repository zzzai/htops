import type { CustomerIdentityType } from "./types.js";

export const HIGH_VALUE_MEMBER_VISIT_COUNT_90D = 4;
export const HIGH_VALUE_MEMBER_PAY_AMOUNT_90D = 1000;
export const HIGH_VALUE_MEMBER_ACTIVE_MAX_SILENT_DAYS = 30;
export const POTENTIAL_GROWTH_PAY_AMOUNT_90D = 500;
export const POTENTIAL_GROWTH_MAX_VISIT_COUNT_90D = 2;
export const GROUPBUY_CONVERSION_WINDOW_7D = 7;
export const GROUPBUY_CONVERSION_WINDOW_30D = 30;

export function isStableCustomerIdentityType(
  identityType: CustomerIdentityType | string | undefined,
): boolean {
  return identityType === "member" || identityType === "customer-ref";
}

export function qualifiesHighValueMemberWindow(params: {
  visitCount90d: number;
  payAmount90d: number;
  memberPayAmount90d: number;
}): boolean {
  return (
    params.visitCount90d >= HIGH_VALUE_MEMBER_VISIT_COUNT_90D &&
    params.payAmount90d >= HIGH_VALUE_MEMBER_PAY_AMOUNT_90D &&
    params.memberPayAmount90d > 0
  );
}
