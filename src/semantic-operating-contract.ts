import semanticOperatingContractJson from "./semantic-operating-contract.json" with { type: "json" };

export type SemanticQuestionFamilyRole = "boss" | "manager" | "crm";
export type SemanticFamilySupportStatus =
  | "implemented"
  | "capability_gap"
  | "data_gap_realtime"
  | "data_gap_model"
  | "planned";

export type SemanticQuestionFamilyMapping = {
  id: string;
  label: string;
  capability_id?: string | null;
  recipe_refs: string[];
  support_status: SemanticFamilySupportStatus;
};

export type SemanticQuestionFamily = {
  id: string;
  role: SemanticQuestionFamilyRole;
  family: string;
  question_count: number;
  sample_questions: string[];
  source_api_tags: string[];
  mappings: SemanticQuestionFamilyMapping[];
};

export type OperatingMetricContract = {
  id: string;
  label: string;
  metric_key: string | null;
  current_capability_id?: string | null;
  local_truth_surface: string;
  upstream_apis: string[];
  upstream_fields: string[];
  calculation_logic: string;
  human_definition: string;
  compare_baseline?: string;
};

export type OperatingSegmentContract = {
  id: string;
  label: string;
  current_segment_key?: string | null;
  current_capability_id?: string | null;
  upstream_apis: string[];
  upstream_fields: string[];
  filter_logic: string;
  human_definition: string;
};

export type OperatingAnalysisRecipe = {
  id: string;
  label: string;
  current_capability_id?: string | null;
  supporting_metric_keys: string[];
  decomposition_logic: string[];
};

export type ProactiveDiagnosisContract = {
  id: string;
  label: string;
  recipe_refs: string[];
  execution: {
    mode: "scheduled_diagnosis" | "interactive_capability";
    scheduler_hook?: string;
    capability_id?: string;
    delivery_surface: string;
  };
  objective: string;
};

export type OperatingKnowledgeDomain =
  | "metric_definition"
  | "report_scope_definition"
  | "store_sop"
  | "service_sop"
  | "membership_policy"
  | "refund_rule"
  | "coupon_rule"
  | "training_manual"
  | "policy_rule";

export type OperatingKnowledgeDocument = {
  id: string;
  title: string;
  domain: OperatingKnowledgeDomain;
  doc_path: string;
  tags: string[];
  summary: string;
};

type SemanticOperatingContract = {
  version: string;
  sources: Record<string, string>;
  question_families: SemanticQuestionFamily[];
  operating_contracts: {
    metrics: OperatingMetricContract[];
    segments: OperatingSegmentContract[];
    analysis_recipes: OperatingAnalysisRecipe[];
  };
  proactive_diagnoses: ProactiveDiagnosisContract[];
  knowledge_registry: {
    boundary: {
      allowed_domains: OperatingKnowledgeDomain[];
      blocked_fact_classes: string[];
      current_meta_tools: string[];
      notes: string[];
    };
    documents: OperatingKnowledgeDocument[];
  };
};

const semanticOperatingContract = semanticOperatingContractJson as SemanticOperatingContract;

export const SEMANTIC_OPERATING_CONTRACT_VERSION = semanticOperatingContract.version;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, "").trim().toLowerCase();
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function scoreKnowledgeDocument(doc: OperatingKnowledgeDocument, normalizedQuery: string): number {
  if (!normalizedQuery) {
    return 1;
  }
  const title = normalizeText(doc.title);
  const summary = normalizeText(doc.summary);
  const domain = normalizeText(doc.domain);
  const tags = doc.tags.map((tag) => normalizeText(tag));

  let score = 0;
  if (title.includes(normalizedQuery)) {
    score += 5;
  }
  if (summary.includes(normalizedQuery)) {
    score += 4;
  }
  if (tags.some((tag) => tag.includes(normalizedQuery) || normalizedQuery.includes(tag))) {
    score += 6;
  }
  if (domain.includes(normalizedQuery)) {
    score += 3;
  }
  return score;
}

function resolveKnowledgeMatchReason(doc: OperatingKnowledgeDocument, normalizedQuery: string): string {
  if (!normalizedQuery) {
    return "default_catalog";
  }
  const title = normalizeText(doc.title);
  if (title.includes(normalizedQuery)) {
    return "title";
  }
  const tag = doc.tags.find((entry) => {
    const normalizedTag = normalizeText(entry);
    return normalizedTag.includes(normalizedQuery) || normalizedQuery.includes(normalizedTag);
  });
  if (tag) {
    return `tag:${tag}`;
  }
  if (normalizeText(doc.summary).includes(normalizedQuery)) {
    return "summary";
  }
  return "domain";
}

export function listSemanticQuestionFamilies(): SemanticQuestionFamily[] {
  return clone(semanticOperatingContract.question_families);
}

export function listOperatingMetricContracts(): OperatingMetricContract[] {
  return clone(semanticOperatingContract.operating_contracts.metrics);
}

export function listOperatingSegmentContracts(): OperatingSegmentContract[] {
  return clone(semanticOperatingContract.operating_contracts.segments);
}

export function listOperatingAnalysisRecipes(): OperatingAnalysisRecipe[] {
  return clone(semanticOperatingContract.operating_contracts.analysis_recipes);
}

export function listProactiveDiagnosisContracts(): ProactiveDiagnosisContract[] {
  return clone(semanticOperatingContract.proactive_diagnoses);
}

export function listOperatingKnowledgeDocuments(): OperatingKnowledgeDocument[] {
  return clone(semanticOperatingContract.knowledge_registry.documents);
}

export function searchOperatingKnowledgeCatalog(params: {
  query: string;
  domain?: OperatingKnowledgeDomain | string;
  limit?: number;
}): {
  scope: "knowledge_only";
  query: string;
  boundary: SemanticOperatingContract["knowledge_registry"]["boundary"];
  documents: Array<OperatingKnowledgeDocument & { reason: string }>;
} {
  const normalizedQuery = normalizeText(params.query);
  const limit = clamp(params.limit ?? 5, 1, 20);
  const domainFilter = params.domain?.trim();

  const documents = semanticOperatingContract.knowledge_registry.documents
    .filter((doc) => !domainFilter || doc.domain === domainFilter)
    .map((doc) => ({
      doc,
      score: scoreKnowledgeDocument(doc, normalizedQuery),
    }))
    .filter((entry) => !normalizedQuery || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.doc.title.localeCompare(right.doc.title, "zh-Hans-CN"))
    .slice(0, limit)
    .map((entry) => ({
      ...clone(entry.doc),
      reason: resolveKnowledgeMatchReason(entry.doc, normalizedQuery),
    }));

  return {
    scope: "knowledge_only",
    query: params.query,
    boundary: clone(semanticOperatingContract.knowledge_registry.boundary),
    documents,
  };
}
