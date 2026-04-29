import { describe, expect, it } from "vitest";
import { renderAnalysisQueueMessage } from "./analysis-queue-message.js";

describe("renderAnalysisQueueMessage", () => {
  it("renders a more assistant-like created message", () => {
    const text = renderAnalysisQueueMessage({
      job: {
        jobId: "JOB-1",
        status: "pending",
        queueDisposition: "created",
        storeName: "荷塘悦色义乌店",
        timeFrameLabel: "近30天",
      },
      fallbackStoreName: "荷塘悦色义乌店",
      fallbackTimeFrameLabel: "近30天",
    });

    expect(text).toContain("我先去看荷塘悦色义乌店近30天经营盘子");
    expect(text).toContain("阶段进度：1/3 已接单");
    expect(text).toContain("先拉营收、团购转化、会员留存和技师产能");
    expect(text).toContain("我会先回你一版完成摘要，再补正式复盘");
  });

  it("renders clearer reused pending and running progress hints", () => {
    const pending = renderAnalysisQueueMessage({
      job: {
        jobId: "JOB-2",
        status: "pending",
        queueDisposition: "reused-pending",
        storeName: "荷塘悦色义乌店",
        timeFrameLabel: "本月",
      },
      fallbackStoreName: "荷塘悦色义乌店",
      fallbackTimeFrameLabel: "本月",
    });
    const running = renderAnalysisQueueMessage({
      job: {
        jobId: "JOB-3",
        status: "running",
        queueDisposition: "reused-running",
        storeName: "荷塘悦色义乌店",
        timeFrameLabel: "本月",
      },
      fallbackStoreName: "荷塘悦色义乌店",
      fallbackTimeFrameLabel: "本月",
    });

    expect(pending).toContain("这条复盘我已经挂上队列");
    expect(pending).toContain("阶段进度：1/3 正在排队");
    expect(pending).toContain("轮到后会先回完成摘要");

    expect(running).toContain("这条复盘已经在分析中了");
    expect(running).toContain("阶段进度：2/3 正在拉取经营数据并做归因");
    expect(running).toContain("先别着急催第二遍");
  });
});
