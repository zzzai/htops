# Runtime provider switch implementation plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Switch Hermes and htops runtime provider endpoint and API key without changing any model names.

**Architecture:** Change runtime-only configuration surfaces, back them up first, restart affected services, then verify effective config and health.

**Tech Stack:** local env files, YAML runtime config, systemd services.

---

### Task 1: Back up active runtime config

**Files:**
- Backup: `/root/htops/.env.runtime`
- Backup: `/root/htops/.hermes-runtime/config.yaml`
- Backup: `/root/.hermes/config.yaml`
- Backup: `/root/.hermes/.env`

### Task 2: Patch runtime provider values only

**Files:**
- Modify: `/root/htops/.env.runtime`
- Modify: `/root/htops/.hermes-runtime/config.yaml`
- Modify: `/root/.hermes/config.yaml`
- Modify: `/root/.hermes/.env`

**Rules:**
- change `base_url` / `api_key`
- keep all `model` values untouched

### Task 3: Restart runtime services

**Services:**
- `hermes-gateway.service`
- `htops-bridge.service`
- `htops-scheduled-worker.service`
- `htops-analysis-worker.service`
- `htops-query-api.service`

### Task 4: Verify

**Commands:**
- `node --import tsx scripts/print-hermes-gateway-runtime.ts`
- `systemctl is-active hermes-gateway.service htops-bridge.service htops-scheduled-worker.service htops-analysis-worker.service htops-query-api.service`
- masked config inspection for `base_url` / `api_key`

