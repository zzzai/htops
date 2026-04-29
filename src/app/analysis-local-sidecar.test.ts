import { createServer } from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const localSidecarScript = path.resolve(process.cwd(), "tools/crewai-sidecar/store_review.py");
const itLocalhost =
  process.env.HTOPS_ENABLE_LOCALHOST_TESTS === "1" ? it : it.skip;

const evidencePack = {
  packVersion: "v1",
  scopeType: "single_store",
  orgIds: ["1001"],
  storeName: "迎宾店",
  question: "迎宾店近7天经营复盘",
  timeFrameLabel: "近7天",
  startBizDate: "2026-04-05",
  endBizDate: "2026-04-11",
  markdown: [
    "证据包",
    "- 门店: 迎宾店",
    "- 周期: 2026-04-05 至 2026-04-11（近7天）",
    "- 问题: 迎宾店近7天经营复盘",
    "- 最新日报: 营收 3200.00 元；总钟数 40.0 个；钟效 80.00 元/钟；点钟率 32.0%；加钟率 14.0%；完整度 完整",
    "- 7日复盘: 营收 23000.00 元；总钟数 280.0 个；钟效 82.00 元/钟；点钟率 31.0%；加钟率 13.0%；沉默会员率 18.0%",
  ].join("\n"),
  facts: {
    latestReport: {
      storeName: "迎宾店",
      complete: true,
      metrics: {
        serviceRevenue: 3200,
        customerCount: 55,
        totalClockCount: 40,
        clockEffect: 80,
        pointClockRate: 0.32,
        addClockRate: 0.14,
        effectiveMembers: 420,
        sleepingMembers: 76,
        sleepingMemberRate: 0.18,
        currentStoredBalance: 128000,
        groupbuy7dRevisitRate: 0.21,
        groupbuy7dCardOpenedRate: 0.06,
        groupbuy7dStoredValueConversionRate: 0.03,
        groupbuy30dMemberPayConversionRate: 0.08,
        groupbuyFirstOrderHighValueMemberRate: 0.01,
      },
    },
    review7d: {
      revenue7d: 23000,
      totalClocks7d: 280,
      clockEffect7d: 82,
      pointClockRate7d: 0.31,
      addClockRate7d: 0.13,
      sleepingMemberRate: 0.18,
    },
    summary30d: {
      revenue30d: 98000,
      totalClocks30d: 1160,
      clockEffect30d: 84.5,
      pointClockRate30d: 0.29,
      addClockRate30d: 0.12,
      currentStoredBalance: 128000,
    },
    topTechs: [
      {
        personName: "技师甲",
        turnover: 9800,
        pointClockRate: 0.46,
        addClockRate: 0.18,
      },
    ],
  },
};

const diagnosticBundle = {
  version: "v1",
  scopeType: "single_store",
  storeName: "迎宾店",
  orgIds: ["1001"],
  question: "迎宾店近7天经营复盘",
  signals: [
    {
      signalId: "point_clock_risk",
      severity: "high",
      title: "点钟集中风险",
      finding: "门店点钟结构偏高，存在客流向头部技师集中的结构风险。",
      evidence: ["门店点钟率 32.0%", "技师甲 点钟率 46.0%"],
      recommendedFocus: "优先检查点钟集中、班次承接和头部技师依赖。",
    },
  ],
};

const orchestrationPlan = {
  version: "v1",
  focusAreas: ["点钟集中风险", "会员沉默回流"],
  priorityActions: [
    "优先检查点钟集中、班次承接和头部技师依赖。",
    "先追回近7天未复购会员，锁定回店动作。",
  ],
  decisionSteps: [
    "先确认营收、客数、钟数、钟效等事实，不改写证据包。",
    "再按诊断信号判断问题优先级，优先解释点钟/加钟/会员承接。",
    "最后输出店长动作，动作必须带目标对象和目标变化。",
  ],
  outputContract: ["结论摘要", "风险与建议", "店长动作建议"],
};

const portfolioEvidencePack = {
  packVersion: "v1",
  scopeType: "portfolio",
  orgIds: ["1001", "1002"],
  storeName: "五店",
  question: "五店近15天整体哪里不对",
  timeFrameLabel: "近15天",
  startBizDate: "2026-04-01",
  endBizDate: "2026-04-15",
  markdown: [
    "证据包",
    "- 范围: 五店",
    "- 周期: 2026-04-01 至 2026-04-15（近15天）",
    "- 问题: 五店近15天整体哪里不对",
  ].join("\n"),
  facts: {
    portfolioSnapshots: [
      {
        orgId: "1001",
        storeName: "义乌店",
        latestReport: {
          metrics: {
            serviceRevenue: 4200,
            totalClockCount: 56,
            clockEffect: 75,
            sleepingMemberRate: 0.12,
          },
        },
        review7d: {
          revenue7d: 26500,
          totalClocks7d: 360,
          clockEffect7d: 73.6,
        },
        summary30d: {
          revenue30d: 98000,
          clockEffect30d: 72.1,
          sleepingMemberRate: 0.12,
          renewalPressureIndex30d: 0.94,
        },
      },
      {
        orgId: "1002",
        storeName: "华美店",
        latestReport: {
          metrics: {
            serviceRevenue: 2600,
            totalClockCount: 41,
            clockEffect: 63,
            sleepingMemberRate: 0.24,
          },
        },
        review7d: {
          revenue7d: 16800,
          totalClocks7d: 280,
          clockEffect7d: 60,
        },
        summary30d: {
          revenue30d: 64000,
          clockEffect30d: 61.3,
          sleepingMemberRate: 0.24,
          renewalPressureIndex30d: 1.46,
        },
      },
    ],
  },
};

const portfolioDiagnosticBundle = {
  version: "v1",
  scopeType: "portfolio",
  storeName: "五店",
  orgIds: ["1001", "1002"],
  question: "五店近15天整体哪里不对",
  signals: [
    {
      signalId: "portfolio_store_risk",
      severity: "high",
      title: "重点门店风险",
      finding: "华美店沉默会员率最高且续费压力最大，当前最需要总部优先盯。",
      evidence: ["华美店 沉默会员率 24.0%", "华美店 续费压力 1.46"],
      recommendedFocus: "总部先盯华美店的会员回流和班次承接，先止住风险扩散。",
    },
  ],
};

describe("repo-local crewai sidecar wrapper", () => {
  it("prints evidence-backed context when the evidence pack is provided", async () => {
    const { stdout } = await execFileAsync(
      "python3",
      [localSidecarScript, "--org", "1001", "--start", "2026-04-05", "--end", "2026-04-11", "--print-context"],
      {
        env: {
          ...process.env,
          HETANG_ANALYSIS_EVIDENCE_JSON: JSON.stringify(evidencePack),
          HETANG_ANALYSIS_EVIDENCE_MARKDOWN: evidencePack.markdown,
          HETANG_ANALYSIS_DIAGNOSTIC_JSON: JSON.stringify(diagnosticBundle),
          HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON: JSON.stringify(orchestrationPlan),
        },
      },
    );

    const parsed = JSON.parse(stdout);

    expect(parsed).toEqual(
      expect.objectContaining({
        org_id: "1001",
        start_biz_date: "2026-04-05",
        end_biz_date: "2026-04-11",
        evidence_pack: expect.objectContaining({
          storeName: "迎宾店",
          scopeType: "single_store",
        }),
      }),
    );
    expect(String(parsed.evidence_markdown)).toContain("证据包");
    expect(parsed.evidence_pack.facts.topTechs[0].personName).toBe("技师甲");
    expect(parsed.diagnostic_bundle).toEqual(
      expect.objectContaining({
        signals: expect.arrayContaining([
          expect.objectContaining({
            signalId: "point_clock_risk",
          }),
        ]),
      }),
    );
    expect(parsed.orchestration_plan).toEqual(
      expect.objectContaining({
        focusAreas: expect.arrayContaining(["点钟集中风险"]),
      }),
    );
  });

  it("returns an evidence-backed deterministic review when no model credentials are configured", async () => {
    const { stdout } = await execFileAsync(
      "python3",
      [localSidecarScript, "--org", "1001", "--start", "2026-04-05", "--end", "2026-04-11"],
      {
        env: {
          ...process.env,
          HETANG_ANALYSIS_EVIDENCE_JSON: JSON.stringify(evidencePack),
          HETANG_ANALYSIS_EVIDENCE_MARKDOWN: evidencePack.markdown,
          HETANG_ANALYSIS_DIAGNOSTIC_JSON: JSON.stringify(diagnosticBundle),
          HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON: JSON.stringify(orchestrationPlan),
          CREWAI_MODEL: "",
          CREWAI_API_KEY: "",
          OPENAI_API_KEY: "",
        },
      },
    );

    const parsed = JSON.parse(stdout);

    expect(parsed.summary).toContain("迎宾店");
    expect(parsed.markdown).toContain("证据包");
    expect(parsed.markdown).toContain("点钟集中风险");
    expect(parsed.markdown).toContain("店长动作建议");
    expect(parsed.risks).toEqual(expect.any(Array));
    expect(parsed.suggestions).toEqual(expect.any(Array));
  });

  it("uses portfolio snapshots for local fallback even when latestReports is absent", async () => {
    const { stdout } = await execFileAsync(
      "python3",
      [localSidecarScript, "--org", "scope:1001,1002", "--start", "2026-04-01", "--end", "2026-04-15"],
      {
        env: {
          ...process.env,
          HETANG_ANALYSIS_EVIDENCE_JSON: JSON.stringify(portfolioEvidencePack),
          HETANG_ANALYSIS_EVIDENCE_MARKDOWN: portfolioEvidencePack.markdown,
          HETANG_ANALYSIS_DIAGNOSTIC_JSON: JSON.stringify(portfolioDiagnosticBundle),
          CREWAI_MODEL: "",
          CREWAI_API_KEY: "",
          OPENAI_API_KEY: "",
        },
      },
    );

    const parsed = JSON.parse(stdout);

    expect(parsed.summary).toContain("2 家门店");
    expect(parsed.summary).toContain("华美店");
    expect(parsed.markdown).toContain("华美店");
    expect(parsed.markdown).toContain("续费压力");
    expect(parsed.suggestions.join("\n")).toContain("华美店");
  });

  itLocalhost("injects diagnostic signals into the model prompt during bounded synthesis", async () => {
    let requestBody = "";
    const server = createServer((req, res) => {
      req.setEncoding("utf8");
      req.on("data", (chunk) => {
        requestBody += chunk;
      });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: "模型已接收诊断信号。",
                    markdown: "结论摘要：模型已接收诊断信号。",
                    risks: [],
                    suggestions: [],
                  }),
                },
              },
            ],
          }),
        );
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("failed to resolve test server address");
    }

    try {
      const { stdout } = await execFileAsync(
        "python3",
        [localSidecarScript, "--org", "1001", "--start", "2026-04-05", "--end", "2026-04-11"],
        {
          env: {
            ...process.env,
            HETANG_ANALYSIS_EVIDENCE_JSON: JSON.stringify(evidencePack),
            HETANG_ANALYSIS_EVIDENCE_MARKDOWN: evidencePack.markdown,
            HETANG_ANALYSIS_DIAGNOSTIC_JSON: JSON.stringify(diagnosticBundle),
            HETANG_ANALYSIS_ORCHESTRATION_PLAN_JSON: JSON.stringify(orchestrationPlan),
            OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
            OPENAI_API_KEY: "test-key",
            OPENAI_MODEL: "gpt-5.4",
          },
        },
      );

      const parsedResponse = JSON.parse(stdout);
      const captured = JSON.parse(requestBody);
      const prompt = String(captured.messages?.[0]?.content ?? "");

      expect(parsedResponse.summary).toContain("模型已接收诊断信号");
      expect(prompt).toContain("诊断信号");
      expect(prompt).toContain("点钟集中风险");
      expect(prompt).toContain("优先检查点钟集中、班次承接和头部技师依赖");
      expect(prompt).toContain("本轮编排计划");
      expect(prompt).toContain("会员沉默回流");
      expect(prompt).toContain("编排步骤");
      expect(prompt).toContain("先确认营收、客数、钟数、钟效等事实");
    } finally {
      server.close();
    }
  });
});
