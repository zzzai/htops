import { describe, expect, it } from "vitest";
import {
  extractHetangAnalysisActionItems,
  extractHetangAnalysisOrchestrationMetadata,
  extractHetangAnalysisSuggestions,
  parseHetangAnalysisResult,
  summarizeHetangAnalysisOrchestration,
  summarizeHetangAnalysisResult,
} from "./analysis-result.js";

describe("parseHetangAnalysisResult", () => {
  it("normalizes summary arrays from structured sidecar output", () => {
    const parsed = parseHetangAnalysisResult(`
      {
        "summary": ["近7天钟效走弱。", "晚场承接不足。"],
        "risks": ["晚场高峰接单能力不足。"],
        "suggestions": ["1. 面向近7天未复购会员，今天完成20人回访。"],
        "markdown": "结论摘要：近7天钟效走弱。"
      }
    `);

    expect(parsed.summary).toBe("近7天钟效走弱。 晚场承接不足。");
    expect(parsed.suggestions).toEqual(["面向近7天未复购会员，今天完成20人回访。"]);
    expect(parsed.risks).toEqual(["晚场高峰接单能力不足。"]);
  });

  it("keeps operating judgment lines in the extracted summary for async completion replies", () => {
    const parsed = parseHetangAnalysisResult(`
      义乌店 近7天 经营复盘
      结论摘要
      - 本周整体基本盘还在，但转化承接和人员产能需要一起盯。
      - 门店经营判断: 承压（储值承接弱、点钟偏弱、加钟偏弱、高价值沉淀慢）
      - 当前经营优先级: 先补前台和技师的开卡储值收口，再看高价值沉淀。

      会员经营
      - 近7天新增会员 28 人。
    `);

    expect(parsed.summary).toBe(
      "本周整体基本盘还在，但转化承接和人员产能需要一起盯。 门店经营判断: 承压（储值承接弱、点钟偏弱、加钟偏弱、高价值沉淀慢） 当前经营优先级: 先补前台和技师的开卡储值收口，再看高价值沉淀。",
    );
  });

  it("extracts action priorities as fallback suggestions when no explicit suggestion section exists", () => {
    const suggestions = extractHetangAnalysisSuggestions(`
      华美店 近7天 经营复盘
      结论摘要
      - 本周营收走弱，核心不是一句“客流不好”就能糊弄过去。
      - 门店经营判断: 承压（复到店偏弱、沉默会员偏高）
      - 当前经营优先级: 先抓团购首单7天承接，别让二次到店继续流失。
    `);

    expect(suggestions).toEqual(["先抓团购首单7天承接，别让二次到店继续流失。"]);
  });

  it("builds a boss-style HQ summary from portfolio sections", () => {
    const summary = summarizeHetangAnalysisResult(`
      5店 近30天 总部经营全景
      整体概览
      - 5店合计服务营收 99850.00 元，综合钟效 79.06 元/钟，整体盘子承压。

      最危险门店
      - 锦苑店，风险分 72.0（高风险）。
        经营判断：承压（复到店偏弱、沉默会员偏高）。

      下周总部优先动作
      1. 优先处理 锦苑店：风险分 72.0，先把团购首单承接和沉默会员召回抓起来。
      2. 义乌店、华美店继续盯储值承接。
    `);

    expect(summary).toBe(
      "5店整体看，5店合计服务营收 99850.00 元，综合钟效 79.06 元/钟，整体盘子承压。当前最危险的是锦苑店，风险分 72.0（高风险）。下周总部先抓：优先处理 锦苑店：风险分 72.0，先把团购首单承接和沉默会员召回抓起来。",
    );
  });

  it("extracts structured action items from sidecar json output", () => {
    const parsed = parseHetangAnalysisResult(`
      {
        "summary": "近7天钟效走弱。",
        "risks": ["晚场承接不足。"],
        "suggestions": ["旧的纯文本建议。"],
        "actionItems": [
          {
            "title": "针对近7天未复购会员，今天完成20人回访，目标把复购率提升5个点。",
            "category": "会员运营",
            "priority": "high"
          },
          {
            "title": "针对晚场承接偏弱班次，本周补1名可承接点钟技师，目标把流失钟数压降10%。"
          }
        ]
      }
    `);

    expect(parsed.actionItems).toEqual([
      {
        title: "针对近7天未复购会员，今天完成20人回访，目标把复购率提升5个点。",
        category: "会员运营",
        priority: "high",
      },
      {
        title: "针对晚场承接偏弱班次，本周补1名可承接点钟技师，目标把流失钟数压降10%。",
      },
    ]);
    expect(extractHetangAnalysisActionItems(parsed.rawText)).toHaveLength(2);
  });

  it("parses orchestration metadata and summarizes stage traces", () => {
    const rawText = `
      {
        "summary": "近7天钟效走弱。",
        "markdown": "结论摘要：近7天钟效走弱。",
        "risks": [],
        "suggestions": [],
        "orchestration": {
          "version": "v1",
          "completedStages": ["evidence_pack", "diagnostic_signals", "action_items"],
          "fallbackStage": "bounded_synthesis",
          "signalCount": 3,
          "stageTrace": [
            {
              "stage": "evidence_pack",
              "status": "completed",
              "detail": "scope=single_store; orgs=1"
            },
            {
              "stage": "diagnostic_signals",
              "status": "completed",
              "detail": "signals=3; ids=point_clock_risk,add_clock_weakness"
            },
            {
              "stage": "bounded_synthesis",
              "status": "fallback",
              "detail": "mode=scoped_query_fallback; reason=sidecar_missing"
            },
            {
              "stage": "action_items",
              "status": "completed",
              "detail": "derived_from_suggestions=2"
            }
          ]
        }
      }
    `;

    const parsed = parseHetangAnalysisResult(rawText);

    expect(parsed.orchestration).toEqual(
      expect.objectContaining({
        version: "v1",
        fallbackStage: "bounded_synthesis",
        signalCount: 3,
        stageTrace: expect.arrayContaining([
          expect.objectContaining({
            stage: "bounded_synthesis",
            status: "fallback",
          }),
        ]),
      }),
    );
    expect(extractHetangAnalysisOrchestrationMetadata(rawText)).toEqual(parsed.orchestration);
    expect(summarizeHetangAnalysisOrchestration(rawText)).toBe(
      "evidence_pack -> diagnostic_signals -> bounded_synthesis(fallback: sidecar_missing) -> action_items",
    );
  });
});
