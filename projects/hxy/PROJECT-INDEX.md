# HXY 项目索引

## 当前输入资产

| 类型 | 位置 | 状态 |
|---|---|---|
| 原始资料 | `knowledge/hxy/raw/` | 已解压，本机保留 |
| 检索索引 | `knowledge/hxy/index.json` | 已生成，51 sources / 539 chunks |
| 结构化知识 | `knowledge/hxy/structured/` | 已生成，863 claims / 562 entities |
| 知识治理报告 | `knowledge/hxy/structured/governance-report.json` | 已生成，6 当前候选 / 1 冲突复核项 |
| OSI 合同 | `knowledge/hxy/structured/osi-contract.json` | 已生成，5 核心域 / 1 高优先级复核项 |
| 品牌策划草案 | `knowledge/hxy/structured/brand-planning-draft.json` | 已生成，三层定位 / 4 个终端动作 / 14 个验证项 |
| 品牌策划全案 | `knowledge/hxy/structured/brand-master-plan.json` | 已生成，7 章节 / 4 个方法论原则 / 5 条书籍依据 |
| 终端执行手册 | `knowledge/hxy/structured/execution-playbook.json` | 已生成，4 个执行面 / 3 个验证指标 |
| 小店模型 | `knowledge/hxy/structured/store-model.json` | 已生成，投资 / 营收 / 净现金流 / 回本周期 |
| 样板验证矩阵 | `knowledge/hxy/structured/pilot-validation-matrix.json` | 已生成，7 个验证项 |
| 正式品牌全案 | `projects/hxy/deliverables/hxy-brand-plan-v1.md` | 已生成，面向业务汇报 |
| 样板店执行包 | `projects/hxy/deliverables/hxy-pilot-execution-pack-v1.md` | 已生成，面向门店落地 |
| 终端物料包 | `projects/hxy/deliverables/hxy-terminal-material-pack-v1.md` | 已生成，面向门头、菜单、话术、私域 |
| 资产清单 | `projects/hxy/assets/01-current-asset-register.md` | 已生成，区分事实源、生成资产和待验证假设 |
| 华与华理论 | `knowledge/brand/index.json` | 已可联合检索 |
| 项目底稿 | `docs/plans/2026-05-14-hxy-project-knowledge-brief.md` | 已生成 |
| 联合知识工作流 | `docs/plans/2026-05-14-hxy-brand-theory-workflow.md` | 已生成 |

## 当前能力

- HXY 项目资料问答
- HXY + 华与华品牌理论联合问答
- 模型基于 `/root/.claude` 配置进行综合回答
- 回答带资料引用
- 第一批结构化 claim/entity/evidence/relation 已生成
- 第一版知识治理报告已生成，可用于 current / deprecated / conflicted 人工复核
- 第一版 HXY OSI 合同已生成，可供品牌策划 Agent 和样板店验证使用
- 第一版品牌策划草案已生成，明确当前定位、融资叙事和远期愿景分层
- 第一版品牌策划全案已生成，接入文化母体、购买理由、超级符号、货架思维
- 第一版终端执行手册已生成，覆盖门头、菜单、技师话术、私域复购
- 第一版小店模型和样板验证矩阵已生成，能把方案假设转成经营测算和验收指标
- 第一版正式品牌全案和样板店执行包已生成，可用于业务评审和样板店试跑
- 第一版终端物料包已生成，可用于门头、海报、菜单、技师话术和私域跟进
- 第一版资产清单已生成，明确事实源、生成资产、假设和验证边界
- 原始资料和索引不进入 Git / Docker 镜像

## 项目体系文件

| 文件 | 作用 |
|---|---|
| `README.md` | 项目边界和目录说明 |
| `architecture/01-target-architecture.md` | 超智大脑目标架构 |
| `knowledge/01-knowledge-base-design.md` | 知识库设计 |
| `semantic/01-ontos-lite.md` | 轻量本体设计 |
| `data/01-data-agent-design.md` | 数据智能体设计 |
| `agents/01-agent-map.md` | 业务智能体地图 |
| `roadmap/01-stage-roadmap.md` | 从筹备期到万店规模路线图 |
| `governance/01-quality-and-safety.md` | 质量、安全、审计治理 |
| `assets/01-current-asset-register.md` | 当前资产清单与事实/假设边界 |
| `schemas/knowledge-asset.schema.json` | 知识资产结构 |
| `schemas/knowledge-claim.schema.json` | 知识主张结构 |
| `specs/structured-knowledge-v1-summary.md` | 结构化知识资产 v1 摘要 |
| `specs/knowledge-governance-v1-summary.md` | 知识治理 v1 摘要 |
| `specs/osi-contract-v1-summary.md` | HXY OSI 合同 v1 摘要 |
| `specs/brand-planning-draft-v1-summary.md` | HXY 品牌策划草案 v1 |
| `specs/brand-master-plan-v1-summary.md` | HXY 品牌策划全案 v1 摘要 |
| `specs/execution-playbook-v1-summary.md` | HXY 终端执行手册 v1 摘要 |
| `specs/store-model-and-validation-v1-summary.md` | HXY 小店模型与样板验证 v1 摘要 |
| `deliverables/hxy-brand-plan-v1.md` | 荷小悦品牌策划全案 v1 |
| `deliverables/hxy-pilot-execution-pack-v1.md` | 荷小悦样板店执行包 v1 |
| `deliverables/hxy-terminal-material-pack-v1.md` | 荷小悦终端物料包 v1 |
| `samples/store-model-input.sample.json` | 小店模型输入样例 |
| `samples/pilot-real-parameter-intake.md` | 样板店真实参数采集表 |
| `decisions/ADR-001-project-boundary.md` | 项目边界架构决策 |

## 下一步执行清单

1. 人工确认《荷小悦品牌策划全案》v1、《样板店执行包》v1 和《终端物料包》v1。
2. 把终端物料包转成可打印门头/海报/菜单/技师卡/私域话术卡。
3. 用 `samples/pilot-real-parameter-intake.md` 采集真实选址、面积、房租、技师人数，替换小店模型样例输入。
4. 把套餐成交、复购和健康档案字段接入真实数据表。
5. 把执行反馈回流到 HXY 知识治理报告。
6. 接入更多营销/管理书籍后，拆出营销动作和管理动作 Agent。
