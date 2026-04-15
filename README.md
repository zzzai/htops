# Hetang Ops

Canonical project root is now `/root/htops`.

This project syncs five Hetang stores into PostgreSQL, keeps raw API audit data, builds daily operating reports, and delivers summaries through configurable messaging adapters such as WeCom.

## Project Boundary

- `/root/htops` is the business project root and the only place where Hetang code, config, scripts, and runtime state should keep evolving.
- OpenClaw is now an optional gateway adapter only.
- OpenClaw-specific compatibility files live under `/root/htops/adapters/openclaw`.
- `/root/openclaw/extensions/hetang-ops` should point to `/root/htops/adapters/openclaw`, not to the whole project root.

## Internal Architecture Notes

- `src/access/` owns machine-readable access context construction and quota/scope decisions.
- `src/capability-graph.ts` owns the Capability Graph source of truth for serving-query abilities, runtime-render narrative abilities, and the first async-analysis abilities, including fallback links and downstream links.
- `src/capability-registry.ts` is now a compatibility facade over the graph, so new query capability work should extend the graph first.
- `src/runtime/` owns the thin runtime shell for serving-query execution and doctor delegation.
- `src/data-platform/serving/` owns serving-version and compiled-query read surfaces.
- `src/access.ts`, `src/runtime.ts`, and `src/store.ts` remain compatibility facades during the migration, so new logic should prefer the owner modules above instead of expanding the facades further.
- async deep-analysis jobs now keep `capabilityId` end-to-end, so routing, queueing, and future execution/audit layers can all speak the same capability language.

## Standalone Bootstrap

1. Install Node dependencies inside `/root/htops`:

```bash
cd /root/htops
pnpm install
```

The project already ships `.npmrc` with `https://registry.npmmirror.com`, so `pnpm` and `npm install <pkg>` will use a domestic npm mirror by default under this directory.

2. Build the query API Python virtualenv:

```bash
bash /root/htops/ops/setup-query-api-venv.sh
```

The bootstrap script defaults to the Tsinghua pip mirror and recreates `/root/htops/api/.venv`.

3. Start or restart the three standalone services:

```bash
systemctl restart htops-query-api.service
systemctl restart htops-scheduled-worker.service
systemctl restart htops-analysis-worker.service
```

If Hermes will call htops over the new localhost bridge, start the bridge service too:

```bash
systemctl restart htops-bridge.service
```

4. Check health:

```bash
curl -fsS http://127.0.0.1:18890/health
systemctl is-active htops-query-api.service
systemctl is-active htops-scheduled-worker.service
systemctl is-active htops-analysis-worker.service
systemctl is-active htops-bridge.service
```

5. Run the standalone CLI:

```bash
cd /root/htops
pnpm cli -- hetang status
```

## Gateway Adapter Overrides

Outbound delivery is no longer hard-coded to OpenClaw.

- `HETANG_MESSAGE_SEND_ENTRY=/path/to/gateway/dist/index.js`
  Use a different Node entry that supports `message send`.
- `HETANG_MESSAGE_SEND_BIN=my-gateway`
  Use a different binary name for CLI-style fallback sends.
- Default standalone deployment now uses `/root/htops/ops/hermes-send`, so htops only knows the stable `message send` CLI contract and no longer needs to point at OpenClaw directly.

If neither is set, Hetang only reuses the current gateway entry when it is already running inside a compatible `dist/index.js` host. Otherwise it fails fast and asks for an explicit adapter configuration.

## Codex Enhancement Pack

The repository now ships a project-local Codex enhancement pack so the best next-step Codex upgrades are visible and runnable from inside `/root/htops`.

Primary goals:

- land a low-risk Exa-first upgrade path
- keep global Codex mutations explicit instead of hidden
- preserve room for staged adoption of `oh-my-codex` and selective `everything-claude-code` patterns later

Use:

```bash
cd /root/htops
npm run codex:doctor
npm run codex:bootstrap
```

If the host already has Codex CLI and you want to apply the Exa MCP upgrade directly:

```bash
cd /root/htops
npm run codex:bootstrap -- --apply-exa
```

Long-lived guidance lives in:

- `/root/htops/docs/codex-enhancement-pack.md`
- `/root/htops/docs/codex-workflow-layer.md`
- `/root/htops/docs/plans/2026-04-13-codex-enhancement-pack-design.md`
- `/root/htops/docs/plans/2026-04-13-codex-enhancement-pack-plan.md`

The repo also now carries a low-risk workflow layer inspired by `oh-my-codex`:

```bash
cd /root/htops
npm run codex:workflow:doctor
```

Key files:

- `/root/htops/AGENTS.md`
- `/root/htops/.omx/README.md`
- `/root/htops/.omx/commands/`
- `/root/htops/.omx/templates/`

## Hermes Bridge

htops now supports a localhost bridge for Hermes ingress. The bridge is intentionally narrow:

- `GET /health`
- `GET /v1/capabilities`
- `POST /v1/messages/command`
- `POST /v1/messages/inbound`

Bridge rules:

- listen on `127.0.0.1` only
- protect `/v1/*` with `X-Htops-Bridge-Token`
- keep Hermes outside the htops codebase boundary

Runtime env knobs:

- `HETANG_BRIDGE_HOST`
- `HETANG_BRIDGE_PORT`
- `HETANG_BRIDGE_TOKEN`

Start the bridge directly:

```bash
cd /root/htops
pnpm bridge
```

Or through systemd:

```bash
systemctl restart htops-bridge.service
```

The intended split is:

- Hermes receives WeCom messages and forwards normalized payloads into the bridge
- htops bridge maps those payloads into `command.ts` and `inbound.ts`
- outbound worker pushes continue to flow through `src/notify.ts`
- `src/notify.ts` now targets the standalone `hermes-send message send ...` contract by default

## Local PostgreSQL

The plugin now expects `database.url` instead of a local SQLite file. A Docker Compose deployment is included so the first rollout can run against one local PostgreSQL instance with a bind-mounted host directory.

1. Copy `/root/htops/.env.postgres.example` to `/root/htops/.env.postgres`.
2. Replace `HETANG_PG_PASSWORD` with a random password that is at least 24 characters long.
3. Create the local data directory:

```bash
mkdir -p /root/htops/data/postgres
chmod 700 /root/htops/data/postgres
```

4. Start PostgreSQL:

```bash
docker compose \
  --env-file /root/htops/.env.postgres \
  -f /root/htops/docker-compose.postgres.yml \
  up -d
```

5. Export the plugin database URL into the OpenClaw environment:

```bash
export HETANG_DATABASE_URL="$(rg '^HETANG_DATABASE_URL=' /root/htops/.env.postgres -N | cut -d= -f2-)"
```

6. Set the plugin config to use the environment variable:

```json
{
  "database": {
    "url": "${HETANG_DATABASE_URL}"
  }
}
```

## Credential Guidance

- Use a dedicated application account such as `hetang_app`.
- Do not commit the real `.env.postgres` file.
- Keep the bind-mounted `/root/htops/data/postgres` directory on a disk that is included in your host backup plan.
- The bundled Docker Compose file enables `scram-sha-256` authentication for new passwords.

## Operations Shortcuts

- `/hetang analysis list [OrgId|门店名] [pending|running|completed|failed]`
- `/hetang analysis status [任务ID]`
- `/hetang analysis retry [任务ID]`
- `/hetang learning [OrgId|门店名]`
- `/hetang tower show [global|OrgId|门店名]`
- `/hetang tower set [global|OrgId|门店名] [key] [value]`

Current analysis-related Control Tower keys:

- `analysis.reviewMode`: `direct | single | sequential`
- `analysis.autoCreateActions`: `true | false`
- `analysis.retryEnabled`: `true | false`
- `analysis.notifyOnFailure`: `true | false`
- `analysis.maxActionItems`: `1 ~ 10`

## WeCom Access Roster

- Public repos keep a sanitized template at `/root/htops/access/wecom-access-roster.v1.example.json`.
- Local deployments should copy it to `/root/htops/access/wecom-access-roster.v1.json` and replace the placeholder people, scopes, and sender ids with real values.
- `entries` contains bindings that are safe to import immediately.
- `plannedEntries` contains intended permissions that still need the real WeCom `senderId` or a final scope decision.
- For WeCom inbound messages, the plugin now auto-provisions a binding on first contact when `senderName` matches a unique roster entry with a safe role/scope.
- `staff` entries are supported without store scopes and are treated as ordinary QA-only users.
- Validate without writing:

```bash
cp /root/htops/access/wecom-access-roster.v1.example.json /root/htops/access/wecom-access-roster.v1.json
pnpm cli -- hetang access import \
  --file /root/htops/access/wecom-access-roster.v1.json \
  --dry-run
```

## Technician Profile Rules

- 技师画像的核心业绩指标按过去 30 天真实技师数据聚合，包括上钟、点钟率、加钟率、服务营收、提成和推销营收。
- 同时补充 30 天经营节奏指标，包括服务天数、日均单量、日均营收和单钟产出，方便店长判断技师是“偶发爆发”还是“稳定产能”。
- 当前还会输出承接结构和高峰时段，包括点钟/轮钟/加钟单量、副项渗透，以及该技师最主要的服务时段，便于直接用于排班和训练。
- 顾客归属只在顾客-技师绑定覆盖率足够时才下结论；如果只识别到少量样本，系统会明确提示“覆盖不足”，不会把几位已识别顾客误写成技师整个月的总服务顾客数。
