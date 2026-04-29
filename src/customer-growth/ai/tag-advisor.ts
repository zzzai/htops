import type { HetangLogger, HetangOpsConfig } from "../../types.js";
import {
  normalizeCustomerGrowthTagAdvisor,
  type CustomerGrowthTagAdvisor,
} from "./contracts.js";
import { runCustomerGrowthAiJsonTask } from "./client.js";

export async function buildCustomerGrowthTagAdvisor(params: {
  config: HetangOpsConfig;
  facts: Record<string, unknown>;
  logger?: HetangLogger;
}): Promise<CustomerGrowthTagAdvisor | null> {
  const response = await runCustomerGrowthAiJsonTask({
    config: params.config,
    module: "tagAdvisor",
    logger: params.logger,
    systemPrompt:
      "你是荷塘悦色门店的会员标签建议助手。你只能补充软标签建议和理由，不能覆盖现有标签、不能改写客户主分层。",
    userPrompt: [
      "请严格输出一个 JSON 对象，字段只允许出现：softTags, tagHypotheses, tagReasons。",
      "要求：",
      "1. softTags 输出 0-4 个短标签，偏好使用经营视角表述。",
      "2. tagHypotheses 输出 0-3 条标签假设。",
      "3. tagReasons 输出 0-3 条对应依据。",
      "4. 不要输出既有确定性标签的重复抄写，不要捏造事实。",
      JSON.stringify(params.facts, null, 2),
    ].join("\n"),
  });
  return normalizeCustomerGrowthTagAdvisor(response);
}
