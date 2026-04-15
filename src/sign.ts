import { createHash } from "node:crypto";

function compareParamKeys(left: string, right: string): number {
  const lowerCompare = left.toLowerCase().localeCompare(right.toLowerCase());
  if (lowerCompare !== 0) {
    return lowerCompare;
  }
  return left.localeCompare(right);
}

export function buildSignBaseString(params: Record<string, unknown>, appSecret: string): string {
  const pairs = Object.entries(params)
    .filter(([key, value]) => key !== "Sign" && value !== undefined && value !== null)
    .sort(([left], [right]) => compareParamKeys(left, right))
    .map(([key, value]) => `${key}=${String(value)}`);
  pairs.push(`AppSecret=${appSecret}`);
  return pairs.join("&");
}

export function createApiSign(params: Record<string, unknown>, appSecret: string): string {
  return createHash("md5").update(buildSignBaseString(params, appSecret)).digest("hex");
}
