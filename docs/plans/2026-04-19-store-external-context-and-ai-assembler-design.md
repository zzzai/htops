# Store External Context And AI Assembler Design

日期：2026-04-19
状态：approved
范围：把门店外部参考情报正式落到 PostgreSQL，并提供统一的 AI 上下文组装层

## 背景

当前迎宾店周边 PDF、外卖数据、热力图 OCR 结论已经沉淀到项目文档，但还没有进入运行时数据面。

现状问题：

1. 原始 PDF 与 OCR 中间结果仍停留在文件和文档层
2. `estimated` / `research_note` 尚未进入 PostgreSQL
3. AI 当前只能吃到环境上下文、客户事实、召回事实，无法稳定读取门店外部上下文
4. 缺少统一 assembler，容易让后续 AI 模块各自拼 prompt，造成字段不一致

## 目标

### 目标内

- 新增门店外部上下文存储表，支持 `confirmed / estimated / research_note`
- 支持存储结构化数字、文本结论、适用模块、来源、置信度、是否禁止参与算分
- 提供一个统一 assembler，把门店外部上下文按 AI 友好格式组装成结构化对象
- 为后续 store advice / analysis explanation / customer growth AI 提供稳定读取面

### 目标外

- 本轮不让这些外部上下文直接改写召回主排序
- 本轮不引入向量数据库或新知识库系统
- 本轮不做全文 RAG，不让 AI 直接读取 PDF
- 本轮不做自动 OCR pipeline，只先接住已整理的结构化结果

## 设计原则

1. PostgreSQL first
   - 可被运行时读取的上下文，最终必须进入 PG

2. truth level explicit
   - 每条上下文必须显式标注 `truthLevel`
   - `research_note` 默认不参与精确算分

3. AI reads structured context
   - AI 读取 assembler 产物，不读取原始 PDF

4. one storage path, many consumers
   - 同一份 store external context 可被 analysis、store advice、customer growth AI 复用

## 存储模型

新增一张表：

`store_external_context_entries`

每行表示某门店在某次快照下的一条上下文项，核心字段：

- `org_id`
- `snapshot_date`
- `context_kind`
- `metric_key`
- `value_text`
- `value_num`
- `value_json`
- `unit`
- `truth_level`
- `confidence`
- `source_type`
- `source_label`
- `source_uri`
- `applicable_modules_json`
- `not_for_scoring`
- `note`
- `raw_json`
- `updated_at`

建议 `context_kind` 第一版只允许：

- `store_business_profile`
- `estimated_market_context`
- `research_note`

## 运行时组装

新增 assembler 模块：

`src/store-external-context.ts`

提供两类能力：

1. 读取指定门店最新快照
2. 组装出 AI 可读上下文对象

输出对象建议为：

```json
{
  "orgId": "1001",
  "snapshotDate": "2026-04-18",
  "confirmed": {},
  "estimatedMarketContext": {},
  "researchNotes": [],
  "provenance": {}
}
```

其中：

- `confirmed` 和 `estimatedMarketContext` 优先输出键值化结构
- `researchNotes` 保持列表形态，避免被误当硬事实
- `provenance` 保留来源、置信度、是否禁止算分

## 与 AI 的关系

第一版 assembler 不直接调用 AI，只负责：

- 把 PG 中的 store external context 转成统一结构
- 明确哪些字段可用于解释，哪些字段不可用于算分
- 为后续 customer growth AI / store advice / analysis explanation 提供同一份输入

这样可以保持：

- deterministic kernel 继续掌控主排序和主分层
- AI 只在解释、建议、补充判断层使用这些上下文

## 失败与降级

- 门店无外部上下文时，assembler 返回空结构，不报错
- 某条上下文 value 解析失败时，跳过该条，不拖垮整份上下文
- `research_note` 默认不参与数值判断

## 为什么不引入新数据库 / Obsidian / llm-wiki

- 当前数据量和复杂度还没到必须引入新系统
- 本轮最重要的是“让系统稳定可读”，不是“让知识工具更丰富”
- PostgreSQL 已足够承接这批上下文
- `md` 仍保留给人读和设计审计
- 后续若外部资料规模显著增大，再考虑 `pgvector` 或专门知识层
