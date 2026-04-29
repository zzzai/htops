import type { HetangLogger, HetangOpsConfig } from "../../types.js";
import {
  normalizeCustomerGrowthStrategyAdvisor,
  type CustomerGrowthStrategyAdvisor,
} from "./contracts.js";
import { runCustomerGrowthAiJsonTask } from "./client.js";

export async function buildCustomerGrowthStrategyAdvisor(params: {
  config: HetangOpsConfig;
  facts: Record<string, unknown>;
  logger?: HetangLogger;
}): Promise<CustomerGrowthStrategyAdvisor | null> {
  const response = await runCustomerGrowthAiJsonTask({
    config: params.config,
    module: "strategyAdvisor",
    logger: params.logger,
    systemPrompt:
      "你是荷塘悦色门店的会员召回策略建议助手。你只能给出话术和触达建议，不能改写 priorityBand、priorityScore、primarySegment 等确定性决策字段。",
    userPrompt: [
      "请严格输出一个 JSON 对象，字段只允许出现：contactAngle, talkingPoints, offerGuardrails, doNotPushFlags。",
      "要求：",
      "1. contactAngle 用一句中文说明本次联系切入点。",
      "2. talkingPoints 输出 1-4 条可对客表达的短句。",
      "3. offerGuardrails 输出 0-3 条经营边界提醒。",
      "4. doNotPushFlags 输出 0-3 条不要踩坑的提醒。",
      "5. 不要输出新的排序、不改动作标签、不编造优惠。",
      JSON.stringify(params.facts, null, 2),
    ].join("\n"),
  });
  return normalizeCustomerGrowthStrategyAdvisor(response);
}
