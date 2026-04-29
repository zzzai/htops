import { describe, expect, it } from "vitest";
import {
  extractRouteCompareEvent,
  summarizeRouteCompareLog,
  summarizeRouteCompareEvents,
} from "./route-compare-summary.js";

describe("route-compare summary", () => {
  it("extracts route compare payloads from bridge log lines", () => {
    const event = extractRouteCompareEvent(
      '2026-04-14T18:00:00.000Z info hetang-ops: route-compare {"routingMode":"shadow","latencyMs":120,"legacyRoute":"meta:identity","semanticRoute":"meta:identity"}',
    );

    expect(event).toEqual({
      routingMode: "shadow",
      latencyMs: 120,
      legacyRoute: "meta:identity",
      semanticRoute: "meta:identity",
    });
  });

  it("returns null for unrelated log lines", () => {
    expect(extractRouteCompareEvent("plain log line")).toBeNull();
  });

  it("summarizes route diffs and latency percentiles", () => {
    const summary = summarizeRouteCompareEvents([
      {
        routingMode: "shadow",
        latencyMs: 100,
        legacyRoute: "meta:identity",
        semanticRoute: "meta:identity",
        legacyCapabilityId: null,
        selectedCapabilityId: null,
        selectedLane: "meta",
        clarificationNeeded: false,
      },
      {
        routingMode: "shadow",
        latencyMs: 180,
        legacyRoute: "meta:guidance_customer_missing_store",
        semanticRoute: "query:query",
        legacyCapabilityId: null,
        selectedCapabilityId: "customer_followup_list_v1",
        selectedLane: "query",
        clarificationNeeded: true,
        driftTags: ["hq_portfolio_high_confidence_route_drift"],
      },
      {
        routingMode: "shadow",
        latencyMs: 260,
        legacyRoute: "query:query",
        semanticRoute: "analysis:analysis",
        legacyCapabilityId: null,
        selectedCapabilityId: "store_review_async_v1",
        selectedLane: "analysis",
        clarificationNeeded: false,
      },
    ]);

    expect(summary.total).toBe(3);
    expect(summary.routeDiffCount).toBe(2);
    expect(summary.routeMatchCount).toBe(1);
    expect(summary.routeAccuracyPercent).toBeCloseTo(33.3, 1);
    expect(summary.capabilityAccuracyPercent).toBeCloseTo(33.3, 1);
    expect(summary.latencyP50Ms).toBe(180);
    expect(summary.latencyP95Ms).toBe(260);
    expect(summary.clarificationNeededCount).toBe(1);
    expect(summary.driftTagCounts).toEqual([
      {
        key: "hq_portfolio_high_confidence_route_drift",
        count: 1,
      },
    ]);
    expect(summary.selectedLanes).toEqual([
      { key: "analysis", count: 1 },
      { key: "meta", count: 1 },
      { key: "query", count: 1 },
    ]);
    expect(summary.selectedCapabilities).toEqual([
      { key: "customer_followup_list_v1", count: 1 },
      { key: "store_review_async_v1", count: 1 },
    ]);
    expect(summary.slowSamples).toEqual([
      {
        rawText: undefined,
        effectiveText: undefined,
        frontDoorDecision: undefined,
        selectedLane: "analysis",
        selectedCapabilityId: "store_review_async_v1",
        latencyMs: 260,
      },
      {
        rawText: undefined,
        effectiveText: undefined,
        frontDoorDecision: undefined,
        selectedLane: "query",
        selectedCapabilityId: "customer_followup_list_v1",
        latencyMs: 180,
      },
      {
        rawText: undefined,
        effectiveText: undefined,
        frontDoorDecision: undefined,
        selectedLane: "meta",
        selectedCapabilityId: null,
        latencyMs: 100,
      },
    ]);
    expect(summary.topRouteDiffs).toEqual([
      {
        key: "meta:guidance_customer_missing_store -> query:query",
        count: 1,
      },
      {
        key: "query:query -> analysis:analysis",
        count: 1,
      },
    ]);
  });

  it("summarizes route compare events directly from bridge log text", () => {
    const summary = summarizeRouteCompareLog(`
2026-04-17 09:00:00 INFO bridge: ignored
2026-04-17 09:00:01 INFO hetang-ops: route-compare {"selectedLane":"query","legacyCapabilityId":"store_day_summary_v1","selectedCapabilityId":"store_day_summary_v1","clarificationNeeded":false,"latencyMs":120,"legacyRoute":"query:query","semanticRoute":"query:query"}
2026-04-17 09:00:02 INFO hetang-ops: route-compare {"selectedLane":"analysis","legacyCapabilityId":null,"selectedCapabilityId":"store_review_async_v1","clarificationNeeded":true,"latencyMs":480,"legacyRoute":"query:query","semanticRoute":"analysis:analysis","rawText":"一号店上周问题在哪"}
`);

    expect(summary.total).toBe(2);
    expect(summary.routeAccuracyPercent).toBe(50);
    expect(summary.capabilityAccuracyPercent).toBe(50);
    expect(summary.clarificationNeededCount).toBe(1);
    expect(summary.latencyP50Ms).toBe(120);
    expect(summary.latencyP95Ms).toBe(480);
    expect(summary.selectedLanes).toEqual([
      { key: "analysis", count: 1 },
      { key: "query", count: 1 },
    ]);
    expect(summary.slowSamples[0]).toMatchObject({
      selectedLane: "analysis",
      selectedCapabilityId: "store_review_async_v1",
      latencyMs: 480,
      rawText: "一号店上周问题在哪",
    });
  });
});
