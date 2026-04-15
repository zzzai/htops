const CORRECTION_KEYWORDS =
  /(不是这个意思|乱回|乱答|乱回复|瞎回|瞎回复|答非所问|没听懂|没理解|理解错|别套模板|不要模板|别给模板|重新回答|重答)/u;

export type CorrectionInterruptDecision =
  | { action: "continue" }
  | {
      action: "repair";
      reason: "live-correction";
      previousUserText: string;
      prefixText: string;
    };

type StoredTurn = {
  userText: string;
  assistantText: string;
  occurredAtMs: number;
};

export function buildCorrectionInterruptKey(params: {
  channel: string;
  accountId?: string;
  conversationId?: string;
  senderId?: string;
  threadId?: string;
}): string {
  return [
    params.channel,
    params.accountId ?? "-",
    params.conversationId ?? params.senderId ?? "-",
    params.threadId ?? "-",
  ].join(":");
}

export function createCorrectionInterruptService(params: {
  ttlMs: number;
  now?: () => number;
}) {
  const memory = new Map<string, StoredTurn>();

  return {
    rememberTurn(entry: {
      key: string;
      userText: string;
      assistantText: string;
      occurredAtMs?: number;
    }) {
      memory.set(entry.key, {
        userText: entry.userText,
        assistantText: entry.assistantText,
        occurredAtMs: entry.occurredAtMs ?? (params.now?.() ?? Date.now()),
      });
    },

    resolveCorrection(entry: { key: string; text: string }): CorrectionInterruptDecision {
      if (!CORRECTION_KEYWORDS.test(entry.text)) {
        return { action: "continue" };
      }
      const stored = memory.get(entry.key);
      if (!stored) {
        return { action: "continue" };
      }
      const nowMs = params.now?.() ?? Date.now();
      if (nowMs - stored.occurredAtMs > params.ttlMs) {
        memory.delete(entry.key);
        return { action: "continue" };
      }
      return {
        action: "repair",
        reason: "live-correction",
        previousUserText: stored.userText,
        prefixText: "我按刚才那条门店问题重答：",
      };
    },
  };
}
