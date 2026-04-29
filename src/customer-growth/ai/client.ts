import { resolveAiLaneConfig } from "../../ai-lanes/resolver.js";
import type { HetangLogger, HetangOpsConfig } from "../../types.js";
import type { HetangAiLaneId } from "../../types.js";
import type { CustomerGrowthAiModule } from "./contracts.js";

function extractMessageText(payload: Record<string, unknown>): string | null {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice =
    choices.length > 0 && typeof choices[0] === "object" && choices[0] !== null
      ? (choices[0] as Record<string, unknown>)
      : null;
  const message =
    firstChoice && typeof firstChoice.message === "object" && firstChoice.message !== null
      ? (firstChoice.message as Record<string, unknown>)
      : null;
  const content = message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  if (Array.isArray(content)) {
    const text = content
      .map((entry) => {
        if (typeof entry === "string") {
          return entry;
        }
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const textValue = (entry as { text?: unknown }).text;
        return typeof textValue === "string" ? textValue : "";
      })
      .join("")
      .trim();
    return text || null;
  }
  const outputText = payload.output_text;
  return typeof outputText === "string" && outputText.trim().length > 0 ? outputText.trim() : null;
}

function tryParseObject(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const direct = tryParseObject(trimmed);
  if (direct) {
    return direct;
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  return tryParseObject(trimmed.slice(start, end + 1));
}

function isModuleEnabled(config: HetangOpsConfig, module: CustomerGrowthAiModule): boolean {
  if (!config.customerGrowthAi.enabled) {
    return false;
  }
  return config.customerGrowthAi[module].enabled === true;
}

type HetangAiTransportConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

type HetangAiTransportOverlay = {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
};

function resolveAiTransportConfig(params: {
  config: HetangOpsConfig;
  laneId: HetangAiLaneId;
  legacyTransport?: HetangAiTransportOverlay;
}): HetangAiTransportConfig | null {
  const laneOverride = params.config.aiLanes[params.laneId];
  if (laneOverride) {
    const laneConfig = resolveAiLaneConfig(params.config, params.laneId);
    const baseUrl = laneConfig.baseUrl ?? params.legacyTransport?.baseUrl;
    const apiKey = laneConfig.apiKey ?? params.legacyTransport?.apiKey;
    if (!baseUrl || !apiKey) {
      return null;
    }
    return {
      baseUrl,
      apiKey,
      model: laneConfig.model,
      timeoutMs: laneConfig.timeoutMs,
    };
  }

  if (
    !params.legacyTransport?.baseUrl ||
    !params.legacyTransport.apiKey ||
    !params.legacyTransport.model ||
    params.legacyTransport.timeoutMs === undefined
  ) {
    return null;
  }
  return {
    baseUrl: params.legacyTransport.baseUrl,
    apiKey: params.legacyTransport.apiKey,
    model: params.legacyTransport.model,
    timeoutMs: params.legacyTransport.timeoutMs,
  };
}

export async function runAiLaneJsonTask<T extends Record<string, unknown>>(params: {
  config: HetangOpsConfig;
  laneId: HetangAiLaneId;
  legacyTransport?: HetangAiTransportOverlay;
  systemPrompt: string;
  userPrompt: string;
  warnLabel: string;
  logger?: HetangLogger;
}): Promise<T | null> {
  const aiConfig = resolveAiTransportConfig({
    config: params.config,
    laneId: params.laneId,
    legacyTransport: params.legacyTransport,
  });
  if (!aiConfig) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), aiConfig.timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${aiConfig.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${aiConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: aiConfig.model,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `${params.systemPrompt}\n禁止输出解释文字，只能输出一个 JSON 对象。`,
          },
          {
            role: "user",
            content: params.userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    params.logger?.warn?.(
      `hetang-ops: ${params.warnLabel} request failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    params.logger?.warn?.(
      `hetang-ops: ${params.warnLabel} upstream returned ${response.status} ${response.statusText}`,
    );
    return null;
  }

  let payloadJson: Record<string, unknown> | null = null;
  try {
    payloadJson = (await response.json()) as Record<string, unknown>;
  } catch (error) {
    params.logger?.warn?.(
      `hetang-ops: ${params.warnLabel} response was not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }

  const content = extractMessageText(payloadJson);
  if (!content) {
    return null;
  }

  const structured = parseJsonObject(content);
  if (!structured) {
    return null;
  }

  return structured as T;
}

export async function runCustomerGrowthAiJsonTask<T extends Record<string, unknown>>(params: {
  config: HetangOpsConfig;
  module: CustomerGrowthAiModule;
  systemPrompt: string;
  userPrompt: string;
  logger?: HetangLogger;
}): Promise<T | null> {
  if (!isModuleEnabled(params.config, params.module)) {
    return null;
  }

  const legacyConfig = params.config.customerGrowthAi;
  return await runAiLaneJsonTask<T>({
    config: params.config,
    laneId: "customer-growth-json",
    legacyTransport: {
      baseUrl: legacyConfig.baseUrl,
      apiKey: legacyConfig.apiKey,
      model: legacyConfig.model,
      timeoutMs: legacyConfig.timeoutMs,
    },
    logger: params.logger,
    warnLabel: `customer growth ai for ${params.module}`,
    systemPrompt: params.systemPrompt,
    userPrompt: params.userPrompt,
  });
}
