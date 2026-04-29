import type { HetangLogger, HetangOpsConfig } from "../../types.js";
import {
  normalizeCustomerGrowthProfileInsight,
  type CustomerGrowthProfileInsight,
} from "./contracts.js";
import { runCustomerGrowthAiJsonTask } from "./client.js";

export async function buildCustomerGrowthProfileInsight(params: {
  config: HetangOpsConfig;
  facts: Record<string, unknown>;
  logger?: HetangLogger;
}): Promise<CustomerGrowthProfileInsight | null> {
  const response = await runCustomerGrowthAiJsonTask({
    config: params.config,
    module: "profileInsight",
    logger: params.logger,
    systemPrompt:
      "你是荷塘悦色门店的会员画像分析助手。你只能基于输入事实生成克制、可执行的结构化画像补充，不能改写任何确定性分层和分数。",
    userPrompt: [
      "请严格输出一个 JSON 对象，字段只允许出现：profileNarrative, highValueSignals, riskSignals, missingFacts。",
      "要求：",
      "1. profileNarrative 用一句中文概括客户状态。",
      "2. highValueSignals / riskSignals / missingFacts 各输出 0-4 条短句。",
      "3. 不要编造消费事实、余额、天气、节气、分层标签。",
      "4. 不要输出 markdown，不要解释。",
      JSON.stringify(params.facts, null, 2),
    ].join("\n"),
  });
  return normalizeCustomerGrowthProfileInsight(response);
}
