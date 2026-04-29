# Architecture Prompt Pack Design

日期：2026-04-16
状态：approved
用途：把“Chief System & AI Architect”提示词一次性落地为仓库内可长期使用的治理资产，并与现有 repo-local workflow layer 对齐。

---

## 1. 背景

当前仓库已经有：

- `AGENTS.md` 作为项目级约束
- `.omx/commands/*` 作为 repo-local workflow pack
- `docs/plans/` 作为持久化设计与计划目录

但还缺一类稳定资产：

- 面向架构设计与架构评审的角色提示词
- 配套的上下文装配约定
- 对应的 repo-local 入口命令
- 固定的输出模板与落档位置

这导致高质量架构分析仍然偏依赖临时对话，而不是项目治理机制。

---

## 2. 目标

本次不做 prompt 平台化，不做外部注册中心，不改运行时代码。

只做一版低风险、可立即使用的 repo-local architecture prompt pack：

1. 落地架构师角色提示词
2. 落地项目级架构规则
3. 落地上下文包说明
4. 新增 `arch-review` / `arch-design` / `arch-retro` 命令入口
5. 新增配套模板
6. 补 discovery 文档，让后续会话能找到并使用它

---

## 3. 方案对比

### A. 只新增一份提示词文档

- 优点：最快
- 缺点：发现性差，执行不稳定，容易再次退化成复制粘贴

### B. 落地为 repo-local workflow 扩展层

- 优点：符合现有 `.omx` 设计；低风险；可长期使用
- 缺点：仍然依赖仓库内纪律，不是全局平台

### C. 直接做 Prompt Registry 平台

- 优点：长期治理能力最强
- 缺点：明显过度设计，不符合当前阶段

推荐：`B`

---

## 4. 落地范围

新增：

- `docs/prompts/chief-system-ai-architect.md`
- `docs/prompts/project-architecture-rules.md`
- `docs/prompts/architecture-context-pack.md`
- `.omx/commands/arch-review.md`
- `.omx/commands/arch-design.md`
- `.omx/commands/arch-retro.md`
- `.omx/templates/architecture-review-template.md`
- `.omx/templates/architecture-design-template.md`
- `.omx/templates/architecture-retro-template.md`
- `docs/reviews/README.md`
- `docs/adr/README.md`

更新：

- `AGENTS.md`
- `.omx/README.md`
- `docs/codex-workflow-layer.md`

---

## 5. 边界

这次落地明确不做：

- 修改 `src/runtime.ts`
- 修改查询执行链
- 修改调度执行逻辑
- 引入新的数据库或服务
- 为提示词增加平台级状态存储

---

## 6. 输出约定

后续使用本套提示词时：

- 架构评审/复盘输出进入 `docs/reviews/`
- 架构设计输出进入 `docs/plans/`
- 稳定决策输出进入 `docs/adr/`

---

## 7. 验证

本次属于 repo-local workflow 资产变更，验证以 workflow doctor 为主：

```bash
npm run codex:workflow:doctor
```

如果后续对命令层做进一步自动化，再补充脚本级验证。
