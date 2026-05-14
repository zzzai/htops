import { BUSINESS_PAIN_SIGNAL_CONTRACTS } from "./business-pain-signal.js";
import { buildCapabilityGraphSnapshot } from "./capability-graph.js";
import {
  listOperatingAnalysisRecipes,
  listOperatingAnswerTemplates,
  listOperatingDependencyContracts,
  listOperatingMetricContracts,
  listOperatingSegmentContracts,
  listProactiveDiagnosisContracts,
} from "./semantic-operating-contract.js";
import { listSemanticOsiContracts } from "./semantic-osi-contracts.js";
import { listSemanticQuestionBindings } from "./semantic-question-bindings.js";

export type SemanticLayerId = "data" | "metric" | "question" | "action" | "quality";
export type SemanticLayerStatus = "implemented_v1" | "partial" | "planned";

export type SemanticLayerStatusItem = {
  id: SemanticLayerId;
  label: string;
  status: SemanticLayerStatus;
  implementedSignals: string[];
  remainingGaps: string[];
  counts: Record<string, number>;
};

export type SemanticLayerStatusSnapshot = {
  generatedAt: string;
  layers: SemanticLayerStatusItem[];
};

function sum<T>(items: T[], selector: (item: T) => number): number {
  return items.reduce((total, item) => total + selector(item), 0);
}

export function buildSemanticLayerStatusSnapshot(params?: {
  now?: Date;
}): SemanticLayerStatusSnapshot {
  const now = params?.now ?? new Date();
  const osiContracts = listSemanticOsiContracts();
  const questionBindings = listSemanticQuestionBindings();
  const metricContracts = listOperatingMetricContracts();
  const segmentContracts = listOperatingSegmentContracts();
  const recipes = listOperatingAnalysisRecipes();
  const templates = listOperatingAnswerTemplates();
  const dependencyContracts = listOperatingDependencyContracts();
  const proactiveDiagnoses = listProactiveDiagnosisContracts();
  const capabilityGraph = buildCapabilityGraphSnapshot();
  const actionLoopBindingCount = questionBindings.filter(
    (binding) => binding.answer_mode === "action_loop",
  ).length;

  return {
    generatedAt: now.toISOString(),
    layers: [
      {
        id: "data",
        label: "数据语义层",
        status: "partial",
        implementedSignals: [
          "customer/technician/store OSI 已建模",
          "data coverage gate 已接入问答/doctor",
          "raw ingestion progress 与水位可观测",
        ],
        remainingGaps: [
          "字段级血缘还没有统一注册为 table -> field -> entity -> metric",
          "外部环境字段与经营事实的关系仍需补成正式 registry",
        ],
        counts: {
          osiDomains: osiContracts.length,
          osiBaseFields: sum(osiContracts, (contract) => contract.base_fields.length),
          osiRelationships: sum(osiContracts, (contract) => contract.relationships.length),
        },
      },
      {
        id: "metric",
        label: "指标语义层",
        status: "implemented_v1",
        implementedSignals: [
          "metric contract / segment contract / answer template 已形成主口径",
          "answerability gate 能识别不可答边界",
          "dependency contract 明确成本、实时状态、外部研究等缺口",
        ],
        remainingGaps: [
          "需要把每个指标的依赖字段和 serving surface 血缘进一步结构化",
          "新增指标 contract 注册流程还需要产品化",
        ],
        counts: {
          metricContracts: metricContracts.length,
          segmentContracts: segmentContracts.length,
          answerTemplates: templates.length,
          dependencyContracts: dependencyContracts.length,
        },
      },
      {
        id: "question",
        label: "问题语义层",
        status: "implemented_v1",
        implementedSignals: [
          "semantic frontdoor 已先判别问题类型，再进入门店查询",
          "100 个高频问题已绑定 capability / metric / segment / recipe",
          "capability graph 承接槽位、执行模式和安全边界",
        ],
        remainingGaps: [
          "还需要把真实对话失败样本持续灌入验收集",
          "后续可引入 embedding/LLM classifier 作为 frontdoor 的二级判断",
        ],
        counts: {
          questionBindings: questionBindings.length,
          capabilityNodes: capabilityGraph.node_count,
          servingCapabilities: capabilityGraph.serving_node_count,
          runtimeCapabilities: capabilityGraph.runtime_render_node_count,
          asyncCapabilities: capabilityGraph.async_analysis_node_count,
        },
      },
      {
        id: "action",
        label: "动作语义层",
        status: "partial",
        implementedSignals: [
          "diagnosis recipe 与主动 pain signal 已可生成经营问题和动作建议",
          "客户/技师/门店 action_loop 问题族已进入 binding",
          "高余额沉睡、团购二访、技师依赖等动作方向已成 contract",
        ],
        remainingGaps: [
          "名单 -> 负责人 -> 执行状态 -> 到店/消费/充值结果 尚未全部表结构化",
          "多数动作还停留在建议层，未全部形成可追踪任务闭环",
        ],
        counts: {
          analysisRecipes: recipes.length,
          proactiveDiagnoses: proactiveDiagnoses.length,
          painSignals: BUSINESS_PAIN_SIGNAL_CONTRACTS.length,
          actionLoopBindings: actionLoopBindingCount,
        },
      },
      {
        id: "quality",
        label: "质量语义层",
        status: "partial",
        implementedSignals: [
          "semantic execution audit / semantic quality service 已存在",
          "doctor 已能提示 data coverage 与 nightly review input=0",
          "optimization playbook 已能把失败样本映射到 owner module",
        ],
        remainingGaps: [
          "夜间复盘样本流需要持续证明 input > 0",
          "失败样本到 contract/template 自动演进仍是半自动流程",
        ],
        counts: {
          auditedLayers: 5,
          qualitySurfaces: 3,
        },
      },
    ],
  };
}

export function formatSemanticLayerStatusLines(
  snapshot: SemanticLayerStatusSnapshot = buildSemanticLayerStatusSnapshot(),
): string[] {
  return snapshot.layers.map((layer) => {
    const counts = Object.entries(layer.counts)
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    const gap = layer.remainingGaps[0] ?? "none";
    return `Semantic layer ${layer.id}: ${layer.status} | ${counts} | next=${gap}`;
  });
}
