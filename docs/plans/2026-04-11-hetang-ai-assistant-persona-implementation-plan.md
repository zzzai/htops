# Hetang AI Assistant Persona Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unify the user-facing persona of `荷塘AI小助手` across Hermes general QA and htops business-mode replies.

**Architecture:** Keep the current routing split. Update Hermes runtime persona in `SOUL.md`, then align htops identity/capability copy in `src/inbound.ts` so all user-facing intros share one outer role while preserving HQ/store/staff mode differences.

**Tech Stack:** Markdown, TypeScript, Vitest

---

### Task 1: Lock the new persona wording with failing tests

**Files:**
- Modify: `src/inbound.test.ts`
- Modify: `src/app/message-entry-service.test.ts`

**Step 1: Write the failing tests**

- Require HQ/store/staff identity replies to contain `荷塘AI小助手`
- Keep the existing role-specific expectations like `连锁经营参谋` and `门店经营参谋`
- Require the message-entry identity reply to contain `荷塘AI小助手`

**Step 2: Run tests to verify they fail**

Run: `npm test -- src/inbound.test.ts src/app/message-entry-service.test.ts`

**Step 3: Implement the minimal wording changes**

- Update `src/inbound.ts` identity and capability copy only

**Step 4: Run tests to verify they pass**

Run: `npm test -- src/inbound.test.ts src/app/message-entry-service.test.ts`

---

### Task 2: Define the Hermes-side unified persona

**Files:**
- Modify: `/root/htops/.hermes/SOUL.md`

**Step 1: Replace the placeholder content with the new persona**

- Define name, role, boundaries, tone, and behavior rules
- Make it explicit that general questions are answered directly, while business questions should behave like a data-grounded operating assistant

**Step 2: Verify the file content**

Run: `sed -n '1,220p' /root/htops/.hermes/SOUL.md`

---

### Task 3: Regression verification

**Files:**
- Test: `src/inbound.test.ts`
- Test: `src/app/message-entry-service.test.ts`

**Step 1: Run the targeted test suite**

Run: `npm test -- src/inbound.test.ts src/app/message-entry-service.test.ts`

**Step 2: Manually inspect the final copy**

Run:

```bash
sed -n '1,220p' /root/htops/.hermes/SOUL.md
sed -n '320,390p' /root/htops/src/inbound.ts
```
