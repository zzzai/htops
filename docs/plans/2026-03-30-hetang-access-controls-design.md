# Hetang Access Controls Design

## Goal

Keep the current WeCom AI Bot transport unchanged, but make `hetang-ops` safe for store data by adding employee binding, multi-store scopes, per-user quotas, and durable audit logs.

## Scope

This v1 protects the existing `/hetang ...` command path. It does not add a new freeform analytics tool yet.

## Recommended Approach

### Approach A: DB-backed bindings + DB-backed scopes + DB-backed audit + role defaults

This keeps enforcement close to the `hetang-ops` data model and avoids introducing a separate policy service. Identity lives in PostgreSQL, store scopes live in PostgreSQL, command audits live in PostgreSQL, and quota checks are computed from recent audit rows. This is the recommended v1 because it is durable, easy to inspect, and small enough to ship quickly.

### Approach B: Config-backed bindings + DB-backed audit

This makes employee bindings part of plugin config. It is simpler to code, but every staff change requires config edits and service restarts. It is workable for testing, but brittle for daily operations.

### Approach C: External IAM or generic OpenClaw-wide policy layer

This is the cleanest long-term shape if multiple business plugins need the same RBAC. It is overkill for the current goal and would delay the store-manager rollout.

## Chosen Design

Use approach A.

## Data Model

Add three PostgreSQL tables inside `hetang-ops`:

- `employee_bindings`
  - key: `(channel, sender_id)`
  - fields: `employee_name`, `role`, legacy `org_id`, `is_active`, `hourly_quota`, `daily_quota`, `notes`, timestamps
- `employee_binding_scopes`
  - key: `(channel, sender_id, org_id)`
  - one employee may be bound to zero, one, or many stores
  - zero scopes means the employee is only allowed full-store access if their role is `hq`
- `command_audit_logs`
  - append-only
  - fields: `occurred_at`, `channel`, `sender_id`, `command_name`, `action`, `requested_org_id`, `effective_org_id`, `decision`, `reason`, `command_body`, `response_excerpt`

## Roles

- `hq`
  - may query any store
  - may run `/hetang status`
  - may run `/hetang sync`
  - if no explicit scopes are configured, this means all stores
- `manager`
  - may query only their configured store scopes
  - may not run `/hetang status`
  - may not run `/hetang sync`
- `staff`
  - denied for analytics commands in v1
- `disabled`
  - denied for all protected commands

## Command Policy

- `/hetang help`
  - open
- `/hetang whoami`
  - open, but returns useful access info only when bound
  - show Chinese name when mapped
  - show store names instead of raw `OrgId`
  - show `总部（可查全部门店）` for unscoped `hq`
- `/hetang report [OrgId|门店名] [YYYY-MM-DD]`
  - `hq`: any store
  - `manager` with exactly one scope: omitted store defaults to that store
  - `manager` with multiple scopes: caller must specify a permitted store
- `/hetang status`
  - `hq` only
- `/hetang sync [OrgId|门店名]`
  - `hq` only

## Quotas

Use role defaults unless the binding row overrides them:

- `hq`
  - `15` per hour
  - `80` per day
- `manager`
  - `6` per hour
  - `30` per day
- `staff`
  - `0`
- `disabled`
  - `0`

Only allowed protected commands consume quota. `help` and `whoami` do not.

## Binding Management

Add CLI management so operators can bind users without manual SQL:

- `openclaw hetang access list`
- `openclaw hetang access grant --channel wecom --user <senderId> --role <hq|manager|staff|disabled> [--orgs <orgId,orgId>] [--name <employeeName>] [--hourly <n>] [--daily <n>]`
- `openclaw hetang access revoke --channel wecom --user <senderId>`

For the first rollout:

- store managers and store-level operators use `manager` plus one or more scopes
- regional operators with two stores also use `manager` plus multiple scopes
- headquarters users use `hq` with no scopes

## Audit Rules

Every `/hetang` command invocation writes an audit row, including denied requests. This provides:

- privacy traceability
- quota counting
- incident review

## Error Handling

- unbound user: deny with a short operator-facing message
- manager querying another store: deny and explain store scope
- multi-store manager omits store on `report`: deny and ask them to specify one of the allowed stores
- quota exceeded: deny with remaining reset window hint
- unknown store alias: keep existing help behavior unless caller is a manager with a bound store default

## Testing

- store tests for bindings, multiple scopes, revoke behavior, audit persistence, and quota counting
- command tests for:
  - unbound deny
  - single-scope manager default-store report
  - multi-scope manager explicit-store allow
  - multi-scope manager omitted-store deny
  - manager cross-store deny
  - hq all-store status/sync allow
  - `whoami` store-name display
  - quota deny after repeated calls

## Out of Scope

- generic natural-language analytics tool integration
- group-chat sender allowlists inside the WeCom plugin
- automatic HR sync from enterprise directories
