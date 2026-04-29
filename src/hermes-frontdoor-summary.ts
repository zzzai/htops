export type HermesFrontdoorEvent = {
  timestamp: string;
  lane: string;
  reason: string;
  chatId: string;
  userId: string;
  rawLine: string;
};

export type HermesFrontdoorSummary = {
  total: number;
  uniqueChats: number;
  uniqueUsers: number;
  lanes: Array<{ key: string; count: number }>;
  reasons: Array<{ key: string; count: number }>;
};

function countEntries(values: string[]): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.key.localeCompare(right.key, "zh-CN");
    });
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter((value) => value && value !== "-")).size;
}

export function extractHermesFrontdoorEvent(line: string): HermesFrontdoorEvent | null {
  const match = line.match(
    /^(\S+\s+\S+)\s+INFO\s+\S+:\s+htops_hermes_frontdoor lane=([^\s]+) reason=([^\s]+) chat_id=([^\s]+) user_id=([^\s]+)$/u,
  );
  if (!match) {
    return null;
  }
  return {
    timestamp: match[1] ?? "",
    lane: match[2] ?? "",
    reason: match[3] ?? "",
    chatId: match[4] ?? "",
    userId: match[5] ?? "",
    rawLine: line,
  };
}

export function summarizeHermesFrontdoorEvents(
  events: HermesFrontdoorEvent[],
): HermesFrontdoorSummary {
  return {
    total: events.length,
    uniqueChats: uniqueCount(events.map((event) => event.chatId)),
    uniqueUsers: uniqueCount(events.map((event) => event.userId)),
    lanes: countEntries(events.map((event) => event.lane)),
    reasons: countEntries(events.map((event) => event.reason)),
  };
}

export function renderHermesFrontdoorSummary(summary: HermesFrontdoorSummary): string {
  const lines = [
    "Hermes frontdoor summary",
    `Total events: ${summary.total}`,
    `Unique chats: ${summary.uniqueChats}`,
    `Unique users: ${summary.uniqueUsers}`,
    "",
    "Lane counts:",
  ];

  for (const entry of summary.lanes) {
    lines.push(`- ${entry.key}: ${entry.count}`);
  }

  if (summary.reasons.length > 0) {
    lines.push("", "Reason counts:");
    for (const entry of summary.reasons) {
      lines.push(`- ${entry.key}: ${entry.count}`);
    }
  }

  return lines.join("\n");
}
