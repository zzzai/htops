# Hermes ARK Coding v3 Temporary Switch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Temporarily switch only Hermes runtime to Volcengine ARK `api/coding/v3`, use a verified compatible model for normal dialogue smoke testing, and leave htops business model routing unchanged.

**Architecture:** Patch the Hermes-private runtime config/env under `/root/htops/.hermes-runtime`, not the shared `.env.runtime`. Because the endpoint rejects current GPT model names, switch Hermes default and compression model to a previously verified compatible model.

**Tech Stack:** Hermes runtime YAML, Hermes runtime `.env`, systemd service restart, CLI smoke test.

---

### Task 1: Back up Hermes-private runtime files

**Files:**
- Backup: `/root/htops/.hermes-runtime/config.yaml`
- Backup: `/root/htops/.hermes-runtime/.env`

**Step 1:** Copy both files into a timestamped backup directory under `/root/htops/tmp/`.

**Step 2:** Confirm the backup files exist before editing.

### Task 2: Patch Hermes runtime only

**Files:**
- Modify: `/root/htops/.hermes-runtime/config.yaml`
- Modify: `/root/htops/.hermes-runtime/.env`

**Step 1:** In `config.yaml`, update main model config:
- `model.default` -> `deepseek-v3-2-251201`
- `model.provider` -> keep `custom`
- `model.base_url` -> `https://ark.cn-beijing.volces.com/api/coding/v3`
- `model.api_key` -> set ARK key

**Step 2:** In `config.yaml`, update compression path to avoid unsupported GPT summaries:
- `compression.summary_model` -> `deepseek-v3-2-251201`
- `compression.summary_provider` -> `custom`
- `compression.summary_base_url` -> same ARK endpoint
- `auxiliary.compression.provider` -> `custom`
- `auxiliary.compression.model` -> `deepseek-v3-2-251201`
- `auxiliary.compression.base_url` -> same ARK endpoint
- `auxiliary.compression.api_key` -> same ARK key

**Step 3:** In `config.yaml`, update `custom_providers` entry to the same endpoint and key for consistency.

**Step 4:** In `.env`, update Hermes-private `OPENAI_API_KEY` and `OPENAI_BASE_URL` to the same ARK values.

### Task 3: Restart Hermes gateway only

**Services:**
- `hermes-gateway.service`

**Step 1:** Restart `hermes-gateway.service`.

**Step 2:** Confirm it returns `active`.

### Task 4: Verify effective runtime and smoke test

**Commands:**
- `systemctl is-active hermes-gateway.service`
- masked inspection of `/root/htops/.hermes-runtime/config.yaml`
- `HOME=/root/htops/.hermes-runtime HERMES_HOME=/root/htops/.hermes-runtime /root/hermes-agent/.sandbox-home/.local/bin/hermes chat -q "..."`

**Expected:**
- Gateway stays healthy
- Hermes returns a normal plain-text answer through the temporary ARK-backed model
- No htops business service restart is required
