import type { HetangLogger, HetangOpsConfig } from "../../types.js";
import {
  normalizeCustomerGrowthFollowupSummary,
  type CustomerGrowthFollowupSummary,
} from "./contracts.js";
import { runCustomerGrowthAiJsonTask } from "./client.js";

export async function buildCustomerGrowthFollowupSummary(params: {
  config: HetangOpsConfig;
  facts: Record<string, unknown>;
  logger?: HetangLogger;
}): Promise<CustomerGrowthFollowupSummary | null> {
  const response = await runCustomerGrowthAiJsonTask({
    config: params.config,
    module: "followupSummarizer",
    logger: params.logger,
    systemPrompt:
      "你是荷塘悦色门店的召回执行复盘助手。你只能把员工回写备注整理成结构化复盘结果，不能编造客户承诺，不能改执行状态。",
    userPrompt: [
      "请严格输出一个 JSON 对象，字段只允许出现：outcomeSummary, objectionLabels, nextBestAction, followupDraft。",
      "要求：",
      "1. outcomeSummary 用一句中文总结当前进展。",
      "2. objectionLabels 输出 0-4 条阻力或待确认点。",
      "3. nextBestAction 输出一句下一步建议。",
      "4. followupDraft 输出一段克制、自然、适合店员继续跟进的中文草稿。",
      "5. 不要改 booked/arrived 等事实状态，不要捏造优惠承诺。",
      JSON.stringify(params.facts, null, 2),
    ].join("\n"),
  });
  return normalizeCustomerGrowthFollowupSummary(response);
}
