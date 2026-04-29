# Codex Enhancement Pack Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a repo-local Codex enhancement pack with doctor, bootstrap, and permanent guidance for low-risk upgrades.

**Architecture:** Keep the implementation inside `/root/htops`. Represent recommendation logic in a pure source module, expose operator-facing scripts from `scripts/`, and document the rollout in `docs/` plus the main README.

**Tech Stack:** TypeScript, tsx, Vitest, Node child_process/fs

---

### Task 1: Add failing tests for the enhancement pack

**Files:**
- Create: `src/codex-enhancement.test.ts`
- Create: `src/codex-enhancement.ts`

### Task 2: Implement recommendation and doctor rendering logic

**Files:**
- Modify: `src/codex-enhancement.ts`
- Test: `src/codex-enhancement.test.ts`

### Task 3: Add operator-facing scripts

**Files:**
- Create: `scripts/codex-doctor.ts`
- Create: `scripts/codex-bootstrap.ts`

### Task 4: Add long-lived documentation

**Files:**
- Create: `docs/codex-enhancement-pack.md`
- Modify: `README.md`

### Task 5: Add package entrypoints and verify

**Files:**
- Modify: `package.json`
- Test: `src/codex-enhancement.test.ts`

Run:

```bash
npm test -- src/codex-enhancement.test.ts
npm run codex:doctor
npm run codex:bootstrap
```
