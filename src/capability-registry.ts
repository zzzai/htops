import type { QueryPlan } from "./query-plan.js";
import {
  isServingCapabilityNode,
  listCapabilityGraphNodes,
  resolveCapabilityGraphSelection,
  type ServingCapabilityNode,
} from "./capability-graph.js";

export type ServingCapability = ServingCapabilityNode;

export function listServingCapabilities(): ServingCapability[] {
  return listCapabilityGraphNodes().filter(isServingCapabilityNode);
}

export function resolveServingCapability(plan: QueryPlan): ServingCapability | null {
  const selection = resolveCapabilityGraphSelection({
    plan,
    executionMode: "serving_sql",
  });
  return selection.node && isServingCapabilityNode(selection.node) ? selection.node : null;
}
