import { renderHetangAnalysisResult } from "./analysis-result.js";

type AnalysisQueueLike = {
  jobId: string;
  status: string;
  queueDisposition?: string;
  storeName?: string;
  timeFrameLabel?: string;
  resultText?: string;
};

function isPortfolioScopeLabel(storeName: string): boolean {
  return /^(?:\d+店|[一二三四五六七八九十两]+店|多店)$/u.test(storeName.trim());
}

export function renderAnalysisQueueMessage(params: {
  job: AnalysisQueueLike;
  fallbackStoreName: string;
  fallbackTimeFrameLabel: string;
}): string {
  const storeName = params.job.storeName ?? params.fallbackStoreName;
  const timeFrameLabel = params.job.timeFrameLabel ?? params.fallbackTimeFrameLabel;

  if (params.job.queueDisposition === "reused-completed") {
    return (
      renderHetangAnalysisResult(params.job.resultText)?.trim() ||
      `${storeName}${timeFrameLabel}经营复盘已完成，但暂未生成可发送内容。`
    );
  }

  if (
    params.job.queueDisposition === "reused-pending" ||
    params.job.queueDisposition === "reused-running"
  ) {
    const isRunning = params.job.queueDisposition === "reused-running";
    const isPortfolioScope = isPortfolioScopeLabel(storeName);
    const stageText = isRunning
      ? isPortfolioScope
        ? "阶段进度：2/3 正在拉取多店经营数据并做风险归因。"
        : "阶段进度：2/3 正在拉取经营数据并做归因。"
      : isPortfolioScope
        ? "阶段进度：1/3 正在排队，等待开始拉取多店经营数据。"
        : "阶段进度：1/3 正在排队，等待开始拉取经营数据。";
    return [
      isRunning
        ? isPortfolioScope
          ? `这条总部复盘已经在分析中了，已加入同时间窗任务 ${params.job.jobId} 的回推队列。`
          : `这条复盘已经在分析中了，已加入同时间窗任务 ${params.job.jobId} 的回推队列。`
        : isPortfolioScope
          ? `这条总部复盘我已经挂上队列，沿用同时间窗任务 ${params.job.jobId} 的回推队列。`
          : `这条复盘我已经挂上队列，沿用同时间窗任务 ${params.job.jobId} 的回推队列。`,
      stageText,
      isRunning
        ? `先别着急催第二遍，完成后会先回一条摘要；我会先回你一版完成摘要，再补正式复盘。也可用 /hetang analysis status ${params.job.jobId} 查看进度。`
        : `轮到后会先回完成摘要，再补完整复盘；也可用 /hetang analysis status ${params.job.jobId} 查看进度。`,
    ].join("\n");
  }

  if (isPortfolioScopeLabel(storeName)) {
    return [
      `已收到，我先看${storeName}整体盘子，再抓最危险门店和下周总部动作。`,
      "阶段进度：1/3 已接单，准备拉取多店经营数据。",
      "先拉多店营收、会员留存、团购承接和技师产能，再做风险排序、最危险门店判断和下周总部动作建议。",
      "预计需要 20-50 秒，完成后会先回一条摘要；我会先回你一版完成摘要，再补正式复盘。",
    ].join("\n");
  }

  return [
    `已收到，我先去看${storeName}${timeFrameLabel}经营盘子，正在生成${storeName}${timeFrameLabel}经营复盘。`,
    "阶段进度：1/3 已接单，准备拉取经营数据。",
    "先拉营收、团购转化、会员留存和技师产能；也会先看营收、团购转化、会员留存和技师表现，再汇总结论和动作建议。",
    "预计需要 15-40 秒，完成后会先回一条摘要；我会先回你一版完成摘要，再补正式复盘。",
  ].join("\n");
}

export function renderAnalysisQueueLimitMessage(params: {
  storeName: string;
  timeFrameLabel: string;
  pendingCount: number;
  limit: number;
}): string {
  return [
    `${params.storeName}${params.timeFrameLabel}深度复盘当前排队较满（${params.pendingCount}/${params.limit}），我已先保留你的复盘意图。`,
    "建议先用快查问题拿到第一版经营判断，稍后再触发深度复盘。",
    "快查示例：昨天营收、近7天复到店、近30天储值转化、哪位技师点钟率下滑。",
  ].join("\n");
}
