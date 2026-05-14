import fs from "node:fs/promises";
import path from "node:path";
import type { HxyBrandMasterPlan } from "./hxy-brand-master-plan.js";
import type { HxyExecutionPlaybook, HxyExecutionSurface } from "./hxy-execution-playbook.js";
import type { HxyPilotValidationMatrix, HxyStoreModel } from "./hxy-store-model-calculator.js";

export type HxyDeliverableInputs = {
  masterPlan: HxyBrandMasterPlan;
  playbook: HxyExecutionPlaybook;
  storeModel: HxyStoreModel;
  validationMatrix: HxyPilotValidationMatrix;
};

export function buildHxyFormalBrandPlanMarkdown(inputs: HxyDeliverableInputs): string {
  const positioning = findSection(inputs.masterPlan, "positioning_strategy");
  const purchaseReasons = findSection(inputs.masterPlan, "purchase_reason_system");
  const brandAssetItems = normalizeBrandAssetItems(findSection(inputs.masterPlan, "brand_asset_system")?.content ?? []);
  const terminal = findSection(inputs.masterPlan, "terminal_execution");
  return lines(
    "# 荷小悦品牌策划全案 v1",
    "",
    "## 1. 核心判断",
    inputs.masterPlan.executive_summary,
    "",
    "当前经营定位：社区泡脚按摩小店。",
    "融资叙事：社区健康服务入口。",
    "远期愿景：银发健康科技平台 / 社区健康数字基础设施。",
    "",
    "## 2. 定位策略",
    bulletList(positioning?.content ?? []),
    "",
    "## 3. 购买理由",
    bulletList(purchaseReasons?.content ?? []),
    "",
    "## 4. 品牌资产",
    bulletList(brandAssetItems),
    "",
    "## 5. 终端执行",
    bulletList(terminal?.content ?? inputs.playbook.surfaces.map((surface) => `${surface.label}：${surface.objective}`)),
    "",
    "## 6. 样板店经营模型",
    `- 月总营收：${inputs.storeModel.monthly_revenue}`,
    `- 月净现金流：${inputs.storeModel.monthly_net_cashflow}`,
    `- 回本周期：${inputs.storeModel.payback_months ?? "待验证"} 个月`,
    bulletList(inputs.storeModel.caveats),
    "",
    "## 7. 样板店验证",
    bulletList(
      inputs.validationMatrix.items.map(
        (item) =>
          `${item.label}：${item.hypothesis} 证据：${item.evidence_source}${
            item.baseline_value === undefined ? "" : ` 当前基线：${item.baseline_value}`
          }`,
      ),
    ),
    "",
    "## 8. 风险边界",
    bulletList(inputs.masterPlan.risks),
  );
}

export function buildHxyPilotExecutionPackMarkdown(inputs: HxyDeliverableInputs): string {
  return lines(
    "# 荷小悦样板店执行包 v1",
    "",
    "## 定位护栏",
    inputs.playbook.positioning_guardrail,
    "",
    "## 四个执行面",
    inputs.playbook.surfaces.map(renderSurface).join("\n\n"),
    "",
    "## 每日检查表",
    "- 门头、海报、菜单是否统一出现核心购买理由。",
    "- 前台是否优先推荐招牌款，并记录套餐选择。",
    "- 技师是否完成服务前说明、服务中解释、服务后护理建议。",
    "- 服务结束当天是否发送护理建议，而不是只群发优惠。",
    "- 当天是否记录复购标签和健康档案字段。",
    "",
    "## 样板店验证指标",
    bulletList(inputs.validationMatrix.items.map((item) => `${item.label}：${item.evidence_source}`)),
  );
}

export async function readHxyDeliverableInputs(structuredDir: string): Promise<HxyDeliverableInputs> {
  const readJson = async <T>(fileName: string): Promise<T> =>
    JSON.parse(await fs.readFile(path.join(structuredDir, fileName), "utf8")) as T;
  return {
    masterPlan: await readJson<HxyBrandMasterPlan>("brand-master-plan.json"),
    playbook: await readJson<HxyExecutionPlaybook>("execution-playbook.json"),
    storeModel: await readJson<HxyStoreModel>("store-model.json"),
    validationMatrix: await readJson<HxyPilotValidationMatrix>("pilot-validation-matrix.json"),
  };
}

export async function writeHxyDeliverables(params: {
  inputs: HxyDeliverableInputs;
  outputDir: string;
}): Promise<void> {
  await fs.mkdir(params.outputDir, { recursive: true });
  await fs.writeFile(
    path.join(params.outputDir, "hxy-brand-plan-v1.md"),
    `${buildHxyFormalBrandPlanMarkdown(params.inputs)}\n`,
    "utf8",
  );
  await fs.writeFile(
    path.join(params.outputDir, "hxy-pilot-execution-pack-v1.md"),
    `${buildHxyPilotExecutionPackMarkdown(params.inputs)}\n`,
    "utf8",
  );
}

function renderSurface(surface: HxyExecutionSurface): string {
  return lines(
    `### ${surface.label}`,
    "",
    `目标：${surface.objective}`,
    "",
    "核心文案：",
    bulletList(surface.copy_blocks),
    "",
    "执行动作：",
    bulletList(surface.action_steps),
    "",
    "禁用表达：",
    bulletList(surface.do_not_say),
  );
}

function findSection(plan: HxyBrandMasterPlan, key: HxyBrandMasterPlan["sections"][number]["key"]) {
  return plan.sections.find((section) => section.key === key);
}

function normalizeBrandAssetItems(items: string[]): string[] {
  const brandName = items.find((item) => item.startsWith("品牌名：")) ?? "品牌名：荷小悦";
  const slogan = items.find((item) => item.startsWith("口号候选：")) ?? "口号候选：草本真现煮，按出真功夫";
  return [
    brandName,
    slogan,
    "核心表达：真实有效、社区信任、草本现煮、按出真功夫。",
    "终端主文案：草本真现煮，按出真功夫。",
  ];
}

function bulletList(items: string[]): string {
  if (items.length === 0) {
    return "- 待补充。";
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function lines(...items: Array<string | false | null | undefined>): string {
  return items.filter((item): item is string => typeof item === "string").join("\n");
}
