# Store Manager Bot Guide Poster Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 生成一张面向店长的企微问数使用教程长图，内容聚焦“可以问什么、怎么问、注意事项”。

**Architecture:** 复用现有 `SVG -> Chrome headless -> PNG` 图片生成链路，不引入新依赖。新增一个独立的店长教程图生成模块和一个预览脚本，避免影响现有周图逻辑。

**Tech Stack:** TypeScript, Vitest, SVG rendering, Google Chrome headless

---

### Task 1: 为教程图 SVG 结构写失败测试

**Files:**
- Add: `src/store-manager-bot-guide-image.test.ts`
- Add: `src/store-manager-bot-guide-image.ts`

**Step 1: Write the failing test**

- 新增测试，断言 SVG 至少包含：
  - `店长企微问数教程`
  - `可以问什么`
  - `怎么问`
  - `注意事项`
  - 示例句：
    - `迎宾店昨天日报`
    - `迎宾店昨天营收`
    - `迎宾店昨天有什么风险和建议`
    - `迎宾店今天高价值客户跟进情况`

**Step 2: Run test to verify it fails**

Run:
- `npx vitest run src/store-manager-bot-guide-image.test.ts`

Expected:

- 失败，因为模块还不存在。

**Step 3: Write minimal implementation**

- 新增 `src/store-manager-bot-guide-image.ts`
- 实现：
  - `renderStoreManagerBotGuidePosterSvg()`
  - 静态竖版海报布局

**Step 4: Run test to verify it passes**

Run:
- `npx vitest run src/store-manager-bot-guide-image.test.ts`

Expected:

- SVG 结构测试通过。

### Task 2: 为 PNG 输出写失败测试

**Files:**
- Modify: `src/store-manager-bot-guide-image.test.ts`
- Modify: `src/store-manager-bot-guide-image.ts`

**Step 1: Write the failing test**

- 增加测试，断言：
  - 会生成 `png`
  - 返回图片路径
  - 会调用 Chrome 截图参数

**Step 2: Run test to verify it fails**

Run:
- `npx vitest run src/store-manager-bot-guide-image.test.ts`

Expected:

- 失败，因为 PNG 构建逻辑还未实现。

**Step 3: Write minimal implementation**

- 在 `src/store-manager-bot-guide-image.ts` 增加：
  - `buildStoreManagerBotGuidePosterImage()`

**Step 4: Run test to verify it passes**

Run:
- `npx vitest run src/store-manager-bot-guide-image.test.ts`

Expected:

- PNG 输出测试通过。

### Task 3: 增加预览脚本

**Files:**
- Add: `scripts/render-store-manager-bot-guide-image.ts`

**Step 1: Add script**

- 新增脚本，执行后输出 PNG 路径

**Step 2: Verify**

Run:
- `node --import tsx scripts/render-store-manager-bot-guide-image.ts`

Expected:

- 输出一张真实 PNG 路径

### Task 4: 回归验证并生成预览图

**Files:**
- No additional files unless layout polish is needed

**Step 1: Run verification**

Run:
- `npx vitest run src/store-manager-bot-guide-image.test.ts`
- `node --import tsx scripts/render-store-manager-bot-guide-image.ts`

Expected:

- 测试通过
- 成功生成 PNG
- 图片可用于用户预览
