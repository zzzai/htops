import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerHetangCli } from "../../src/cli.js";
import { runHetangCommand } from "../../src/command.js";
import { hetangOpsConfigSchema, resolveHetangOpsConfig } from "../../src/config.js";
import { createHetangInboundClaimHandler } from "../../src/inbound.js";
import { sendHetangMessage } from "../../src/notify.js";
import { createHetangOpsRuntime } from "../../src/runtime.js";
import { createHetangOpsService } from "../../src/service.js";

export default definePluginEntry({
  id: "hetang-ops",
  name: "Hetang Ops",
  description: "Five-store Hetang API sync, local analytics, and WeCom daily delivery",
  configSchema: hetangOpsConfigSchema,
  register(api) {
    const config = resolveHetangOpsConfig(api.pluginConfig ?? {});
    const runtime = createHetangOpsRuntime({
      config,
      logger: api.logger,
      resolveStateDir: () => api.runtime.state.resolveStateDir(),
      runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
      poolRole: "query",
    });

    api.registerCli(
      ({ program }) => {
        registerHetangCli({ program, runtime });
      },
      { commands: ["hetang"] },
    );

    if (config.service.enableInGateway) {
      api.registerService(
        createHetangOpsService(runtime, {
          mode: "all",
          schedulePollIntervalMs: config.service.scheduledPollIntervalMs,
          analysisPollIntervalMs: config.service.analysisPollIntervalMs,
        }),
      );
    }

    api.on(
      "inbound_claim",
      createHetangInboundClaimHandler({
        config,
        runtime,
        logger: api.logger,
        sendReply: async (params) =>
          await sendHetangMessage({
            notification: {
              channel: params.channel,
              target: params.target,
              accountId: params.accountId,
              threadId: params.threadId,
            },
            message: params.message,
            runCommandWithTimeout: api.runtime.system.runCommandWithTimeout,
          }),
      }),
    );

    api.registerCommand({
      name: "hetang",
      description: "Query Hetang store sync status or reports.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const text = await runHetangCommand({
          runtime,
          config,
          args: ctx.args?.trim() ?? "",
          channel: ctx.channel,
          senderId: ctx.senderId,
          commandBody: ctx.commandBody,
          from: ctx.from,
          to: ctx.to,
          accountId: ctx.accountId,
          messageThreadId: ctx.messageThreadId,
          replyTarget: ctx.to?.trim() || ctx.from?.trim() || ctx.senderId?.trim(),
        });
        return { text };
      },
    });
  },
});
