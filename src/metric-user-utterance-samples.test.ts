import { describe, expect, it } from "vitest";
import { listSupportedMetricDefinitions, resolveMetricIntent } from "./metric-query.js";
import { normalizeHetangSemanticText } from "./query-semantics.js";
import samples from "./metric-user-utterance-samples.json" with { type: "json" };

type MetricUserUtteranceSample = {
  metricKey: string;
  label: string;
  category: string;
  primary: string;
  similars: string[];
  notes?: string;
};

describe("metric user utterance samples", () => {
  const typedSamples = samples as MetricUserUtteranceSample[];
  const supportedDefinitions = listSupportedMetricDefinitions();

  it("covers every supported metric exactly once", () => {
    const sampleKeys = typedSamples.map((entry) => entry.metricKey).sort();
    const definitionKeys = supportedDefinitions.map((entry) => entry.key).sort();

    expect(sampleKeys).toEqual(definitionKeys);
  });

  it.each(typedSamples)(
    "maps primary and similar asks for $metricKey",
    ({ metricKey, label, category, primary, similars }) => {
      expect(label).not.toHaveLength(0);
      expect(category).not.toHaveLength(0);
      expect(primary).not.toHaveLength(0);
      expect(similars.length).toBeGreaterThan(0);

      for (const utterance of [primary, ...similars]) {
        const resolution = resolveMetricIntent(normalizeHetangSemanticText(utterance));
        expect(resolution.supported.map((entry) => entry.key), utterance).toContain(metricKey);
      }
    },
  );
});
