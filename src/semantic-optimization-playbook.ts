import semanticOptimizationPlaybookJson from "./semantic-optimization-playbook.json" with { type: "json" };
import type { HetangSemanticOptimizationBacklogPriority } from "./types.js";

type SemanticOptimizationPlaybookSample = {
  sampleTag: string;
  prompt: string;
};

export type SemanticOptimizationPlaybookEntry = {
  ownerModule: string;
  recommendedAction: string;
  priority: HetangSemanticOptimizationBacklogPriority;
  samples: SemanticOptimizationPlaybookSample[];
};

type SemanticOptimizationPlaybookJsonPayload = {
  default: {
    owner_module: string;
    recommended_action: string;
    priority: HetangSemanticOptimizationBacklogPriority;
    samples: Array<{
      sample_tag: string;
      prompt: string;
    }>;
  };
  entries: Record<
    string,
    {
      owner_module: string;
      recommended_action: string;
      priority: HetangSemanticOptimizationBacklogPriority;
      samples: Array<{
        sample_tag: string;
        prompt: string;
      }>;
    }
  >;
};

function normalizeEntry(
  entry: SemanticOptimizationPlaybookJsonPayload["default"],
): SemanticOptimizationPlaybookEntry {
  return {
    ownerModule: entry.owner_module,
    recommendedAction: entry.recommended_action,
    priority: entry.priority,
    samples: entry.samples.map((sample) => ({
      sampleTag: sample.sample_tag,
      prompt: sample.prompt,
    })),
  };
}

const semanticOptimizationPlaybookPayload =
  semanticOptimizationPlaybookJson as SemanticOptimizationPlaybookJsonPayload;

const DEFAULT_SEMANTIC_OPTIMIZATION_PLAYBOOK_ENTRY = normalizeEntry(
  semanticOptimizationPlaybookPayload.default,
);

const SEMANTIC_OPTIMIZATION_PLAYBOOK: Record<string, SemanticOptimizationPlaybookEntry> =
  Object.fromEntries(
    Object.entries(semanticOptimizationPlaybookPayload.entries).map(([failureClass, entry]) => [
      failureClass,
      normalizeEntry(entry),
    ]),
  );

export function getDefaultSemanticOptimizationPlaybookEntry(): SemanticOptimizationPlaybookEntry {
  return DEFAULT_SEMANTIC_OPTIMIZATION_PLAYBOOK_ENTRY;
}

export function resolveSemanticOptimizationPlaybookEntry(
  failureClass: string,
): SemanticOptimizationPlaybookEntry {
  return (
    SEMANTIC_OPTIMIZATION_PLAYBOOK[failureClass] ??
    DEFAULT_SEMANTIC_OPTIMIZATION_PLAYBOOK_ENTRY
  );
}
