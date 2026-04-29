# Store Master Data And External Intelligence Design

日期：2026-04-21  
状态：approved  
范围：把门店物理主数据、外部平台数据、原始证据和 AI 读取层收成统一生产级数据架构

## 一、背景

当前项目已经有一层可运行的门店外部上下文存储：

- `store_external_context_entries`
- `confirmed / estimated / research_note`
- AI-safe assembler

这层已经解决了“外部知识能不能进运行时”的问题，但还没有解决下面 4 个更基础的问题：

1. 门店物理数据还没有正式主数据表
2. 外部平台抓回来的数据还缺少“原始证据 -> 标准化 -> 快照 -> 特征”的完整链路
3. 现在大多数外部数据仍偏解释层，尚未进入稳定算法层
4. 后续高德、美团、抖音、小红书、点评、评论等数据一旦增多，如果没有统一架构，系统会再次碎片化

因此，这一轮的目标不是再引一个“知识工具”，而是把：

- 门店物理主数据
- 外部平台观察数据
- 原始证据材料
- AI 可检索语义材料

统一到一套可持续演进的生产架构里。

---

## 二、设计目标

### 目标内

- 明确外部数据应以 `PostgreSQL` 为主库
- 明确哪些数据是 `master data`，哪些是 `observation`，哪些只是 `evidence`
- 为后续高德、美团、抖音、小红书等采集能力预留稳定落点
- 明确 AI 读取路径，避免 AI 直接吃原始网页和未校验事实
- 明确门店面积、开业时间、营业时间、城市位置等物理字段如何真正进入策略和算法

### 目标外

- 本轮不引入新的主数据库产品
- 本轮不把 Obsidian / llm-wiki 作为生产知识主链
- 本轮不做重型图数据库方案
- 本轮不让 LLM 成为事实真相源

---

## 三、备选方案

### 方案 A：继续以 `md/json + store_external_context_entries` 为主

优点：

- 成本最低
- 继续沿用现有外部上下文快照方式

缺点：

- 主数据与观察数据混在一起
- 版本、来源、空间信息、评论明细、平台批次难以长期管理
- 算法层会越来越依赖散落字段，而不是稳定特征

### 方案 B：以 `PostgreSQL` 为统一主库，叠加 `PostGIS`，需要时再加 `pgvector`

优点：

- 与当前项目最兼容
- 支持事务、版本、权限、审计
- 既能承接主数据，也能承接时序快照与评论明细
- `PostGIS` 可以直接处理门店位置、商圈半径、周边 POI、竞对距离
- 后续若需要 AI 语义检索，可以在同库加 `pgvector`

缺点：

- 需要补一轮正式的数据分层设计

### 方案 C：一开始就上多数据库架构

例如：

- `PostgreSQL` 管主数据
- `ElasticSearch` 管评论搜索
- 图数据库管关系
- 向量库管 RAG

优点：

- 理论上长期上限高

缺点：

- 对当前 5 店规模明显过重
- 运维、权限、数据一致性复杂度过高
- 很容易把“数据工程问题”提前做成“平台工程问题”

## 四、推荐方案

选择 **方案 B**。

一句话就是：

**PostgreSQL 做统一主库，`PostGIS` 做空间能力，`pgvector` 只作为后续可选增强；原始文件放对象存储或本地归档，不再引新的主数据库。**

这也是当前阶段效率、准确率、可控性最平衡的方案。

---

## 五、总体架构

推荐把外部与门店数据分成 5 层。

### 1. 原始证据层

职责：

- 保存原始网页
- PDF
- 截图
- OCR 结果
- 平台接口原始 JSON
- 浏览器抓取结果

存储建议：

- 对象存储或本地归档目录
- PostgreSQL 只保存索引元数据和引用路径

这层的作用不是给 AI 直接读，而是：

- 可追溯
- 可复盘
- 出问题时能回放

### 2. 标准化观察层

职责：

- 把外部平台抓回来的结果整理成结构化快照
- 保留来源、时间、批次、置信度、适用模块、是否禁止算分

例子：

- `3km 内竞对数量`
- `周边酒店数量`
- `门店在美团的评分`
- `抖音团购活跃度`
- `小红书近 30 天提及热度`

这层是“观察到的外部世界”，不是最终真相源。

### 3. 主数据真相层

职责：

- 保存门店稳定物理事实与经营基础档案

例子：

- 门店面积
- 开业时间
- 营业时间
- 房间数
- 房型结构
- 所在城市
- 地址
- 经纬度
- 停车条件
- 店型

这层必须是 `master data`，不能继续只存在 `md/json` 或临时快照里。

### 4. 派生特征层

职责：

- 从主数据与观察数据派生出真正供算法消费的稳定特征

例子：

- `store_age_months`
- `lifecycle_stage`
- `night_window_hours`
- `late_night_capable`
- `store_scale_band`
- `capacity_prior`
- `competitor_pressure_band`
- `residential_office_mix`
- `parking_advantage_band`

算法不应该直接吃零散原字段，而应该优先吃这层特征。

### 5. AI 检索与解释层

职责：

- 给 AI 提供结构化、可控、带真相边界的输入
- 需要时再追加评论文本的向量检索能力

这层仍然只能是读层，不能反向改写真相。

---

## 六、推荐数据库与存储选型

### 主库

`PostgreSQL`

原因：

- 当前仓库已经是 PG-first
- 现有 `store_external_context_entries` 已证明这条路径可行
- 易于和现有 owner store、报表、权限、调度任务整合

### 空间能力

`PostGIS`

原因：

- 门店位置、3km 商圈、POI 半径、竞对距离，本质都是空间问题
- 不应把空间计算全部写成应用层脚本

### 语义检索

`pgvector`，但不是 P0

适用范围：

- 评论文本
- 小红书正文
- 调研报告切片
- 长文经营分析材料

### 原始文件

- 本地归档目录或对象存储
- DB 中只留 `document_id / file_path / checksum / source_url / captured_at`

### 明确不推荐作为主链

- `Obsidian`
- `llm-wiki`
- 单独 `MongoDB`
- 单独图数据库

这些工具可以做人类知识整理，但不适合做当前经营系统的生产真相源。

---

## 七、核心数据模型

### 1. `store_master_profiles`

作用：

- 门店稳定主数据总表

建议核心字段：

- `org_id`
- `store_name`
- `brand_name`
- `city_name`
- `district_name`
- `address_text`
- `longitude`
- `latitude`
- `geo_point`
- `opening_date`
- `renovation_date`
- `area_m2`
- `room_count_total`
- `room_mix_json`
- `service_hours_json`
- `store_format`
- `business_scene`
- `parking_available`
- `parking_convenience_level`
- `operating_status`
- `source_label`
- `verified_at`
- `raw_json`
- `updated_at`

规则：

- 这里只放“相对稳定且应被全系统复用”的门店主事实
- 不把短周期波动塞进来

### 2. `store_master_profile_snapshots`

作用：

- 保存主数据历史版本

为什么需要：

- 面积可能不变，但营业时间、房间结构、装修状态、停车条件会变
- 算法回溯时必须知道“当时系统认为门店是什么样”

### 3. `store_external_observation_batches`

作用：

- 记录一次外部采集任务

建议字段：

- `batch_id`
- `org_id`
- `source_platform`
- `capture_scope`
- `capture_mode`
- `captured_at`
- `operator_id`
- `browser_profile_id`
- `status`
- `raw_manifest_json`

### 4. `store_external_observations`

作用：

- 保存结构化外部观察结果

建议字段：

- `observation_id`
- `org_id`
- `snapshot_date`
- `source_platform`
- `metric_domain`
- `metric_key`
- `value_num`
- `value_text`
- `value_json`
- `unit`
- `truth_level`
- `confidence`
- `source_label`
- `source_uri`
- `batch_id`
- `evidence_document_id`
- `applicable_modules_json`
- `not_for_scoring`
- `valid_from`
- `valid_to`
- `raw_json`
- `updated_at`

这张表与当前 `store_external_context_entries` 的关系：

- `store_external_observations` 是更底层、更完整的标准化观察层
- `store_external_context_entries` 继续保留，作为运行时解释快照或 AI-safe 发布层
- 后续由 observation 层向 context 层做受控发布，而不是直接人工往 context 表里堆字段

### 5. `external_source_documents`

当前仓库里已经有这张表，用于 HQ 外部情报文档。

建议扩展使用边界：

- 增加门店作用域字段，或新增关联表，把文档和具体门店绑定
- 继续保存原文摘要、正文、来源 URL、发布时间、抓取时间、原始 JSON

这样就不需要另造一套重复的“原始文档表”。

### 6. `external_review_items`

作用：

- 保存美团 / 抖音 / 小红书 / 点评评论明细

建议字段：

- `review_id`
- `org_id`
- `source_platform`
- `platform_store_id`
- `published_at`
- `rating_score`
- `author_hash`
- `review_text_raw`
- `review_text_clean`
- `reply_text`
- `helpful_count`
- `sentiment_label`
- `topic_tags_json`
- `evidence_document_id`
- `raw_json`
- `updated_at`

评论是单独一层，不能只聚合成一个评分均值。

### 7. `store_feature_snapshots`

作用：

- 保存供算法直接消费的派生特征快照

建议字段：

- `org_id`
- `snapshot_date`
- `feature_key`
- `feature_value_num`
- `feature_value_text`
- `feature_value_json`
- `feature_tier`
- `source_bundle_json`
- `updated_at`

---

## 八、真相边界与发布规则

必须明确 4 个概念。

### 1. `raw_evidence`

原始材料：

- 网页
- PDF
- 截图
- JSON

只能做证据，不直接进算法。

### 2. `confirmed`

已确认事实：

- 内部系统事实
- 官方台账
- 人工确认后的门店主数据

可进入主数据与硬约束层。

### 3. `estimated`

估计性信号：

- 平台估算客流
- 第三方热力人口
- 周边租金估值
- 外卖指数

可进入软调整和解释层，但不能覆盖 confirmed。

### 4. `research_note`

研究备注：

- 热力图观察
- 经营判断
- 竞对策略备注
- 行业解读

主要用于解释、提示、分析 narrative，默认不直接算分。

补充一条关键规则：

**不是所有数据都应该直接变成“权重”。**

正确顺序是：

`原始数据 -> 标准化 -> 主事实 / 观察 -> 派生特征 -> 算法使用 -> AI 解释`

---

## 九、门店物理数据到底怎么正确使用

用户之前给的这类字段：

- 面积大小
- 开业时间
- 营业时间
- 城市位置

本质上不是“给 AI 的随手上下文”，而是：

**门店主数据。**

它们的正确使用方式如下。

### 1. 面积大小

不要直接写成一个神秘权重。

正确做法：

- 入 `store_master_profiles.area_m2`
- 派生 `store_scale_band`
- 结合 `room_count_total` 推出 `capacity_prior`
- 仅作为容量、店型、承接强度、晚场潜力的辅助因子

### 2. 开业时间

不要直接等同于“老店就一定更强”。

正确做法：

- 入 `opening_date`
- 派生 `store_age_months`
- 派生 `lifecycle_stage`
- 与复购、会员沉淀、口碑稳定度联合使用

### 3. 营业时间

这是硬约束级字段。

正确做法：

- 入 `service_hours_json`
- 派生 `service_window_hours`
- 派生 `late_night_capable`
- 派生 `night_window_hours`
- 直接参与时段策略、晚场召回、深夜承接判断

### 4. 城市位置

不能只当一段文字。

正确做法：

- 入 `city_name / district_name / address_text / lat / lng / geo_point`
- 用 `PostGIS` 计算：
  - 3km 商圈
  - 周边住宅 / 办公 / 酒店 / 餐饮
  - 竞对密度
  - 停车便利与道路可达性
- 最终派生 `residential_office_mix`、`nightlife_corridor_level`、`competitor_pressure_band`

因此，你前面说的方向并没有错。

真正要修正的只是：

**这些数据不应该被 AI 生吞，而应该先变成标准化主数据和派生特征。**

---

## 十、算法使用分层

建议把所有字段分成 4 种使用层级。

### 1. 硬约束层

例子：

- 营业时间
- 房间数
- 门店状态

作用：

- 决定这件事能不能做

### 2. 软调整层

例子：

- 面积
- 夜场能力
- 停车便利
- 商圈夜生活强度
- 竞对压力

作用：

- 调整优先级、目标时段、资源倾斜

### 3. 解释层

例子：

- 热力图研究结论
- 行业态势
- 评论主题
- 宏观消费情绪

作用：

- 回答“为什么”
- 不直接改主分

### 4. 学习层

例子：

- 这次策略联系率、预约率、到店率
- 哪类门店 / 哪类商圈 / 哪类时段策略更有效

作用：

- 更新下一轮特征校准
- 逐步让模型更聪明

---

## 十一、外部平台自动采集架构

推荐采用“多阶段采集”，不要让一个 Agent 同时负责登录、抓取、解析、建模、发布。

### 1. 发现层

负责：

- 确定门店在各平台的实体 ID
- 确定竞对目标集合
- 维护平台映射关系

### 2. 抓取层

优先级：

1. 官方 API / 官方开放平台
2. 官方商家后台导出
3. 授权浏览器自动化
4. 人工补录

不推荐：

- 无授权的大规模野路子抓取

### 3. 抽取层

负责：

- 从页面或接口结果中抽出结构化字段
- 评论单条明细
- POI 名单
- 评分、销量、营业时间、价格带等

### 4. 归一层

负责：

- 统一字段名
- 统一时间格式
- 统一平台门店映射
- 统一 truth level

### 5. 发布层

负责：

- 写入 observation
- 生成 feature snapshot
- 向 AI 发布受控上下文

### 平台建议

#### 高德

适合采：

- POI
- 地理位置
- 周边配套
- 可达性
- 商圈结构

优先方式：

- 官方 API / 官方能力

#### 美团 / 点评

适合采：

- 店铺评分
- 评论主题
- 团购项目
- 价格带
- 竞对结构

优先方式：

- 商家后台导出或授权浏览器读取

#### 抖音生活服务

适合采：

- 团购项目
- 活动强度
- 平台曝光线索

优先方式：

- 官方开放平台或授权后台

#### 小红书

适合采：

- 门店提及内容
- 种草主题
- 用户关注点
- 负面吐槽点

优先方式：

- 授权浏览器读取
- 只把结果作为观察和研究，不直接当硬事实

---

## 十二、AI 在这套架构中的位置

AI 不负责创造事实，AI 负责 4 件事：

1. 读已发布的结构化上下文
2. 对评论、帖子、报告做摘要和标签
3. 生成解释和经营建议
4. 参与学习闭环，但不能直接改写真相层

因此，AI 永远应位于：

**主数据 / 观察 / 特征 之后，解释 / 决策建议 / 学习校正 之前。**

---

## 十三、什么时候才需要新数据库

当前阶段，不需要。

只有出现下面情况时，才考虑拆库：

1. 评论和帖子文本量达到百万级以上，PG 全文和向量性能明显吃紧
2. 行为事件流变成高吞吐时序分析场景，需要列式数仓
3. 图关系问题明显超过普通关系型建模能力

在这之前，坚持：

- `PostgreSQL`
- `PostGIS`
- 需要时再加 `pgvector`

是最稳妥的路径。

---

## 十四、结论

最终建议非常明确：

1. **外部数据的正式生产库，继续用 `PostgreSQL`。**
2. **门店面积、开业时间、营业时间、城市位置这类数据，必须升级为 `store master data`，不能只停留在 markdown、json 或临时上下文。**
3. **高德、美团、抖音、小红书这类数据，应先进入 observation 层，再派生特征，不要直接让 AI 生吞。**
4. **原始网页、PDF、截图、接口返回体，放证据层，不直接当算法输入。**
5. **AI 只读取受控发布层，负责解释、洞察、标签和学习，不负责定义真相。**

这套架构的好处是：

- 现在能落地
- 后面能扩展
- 不会因为数据越来越多而把系统做散
- 能支撑你后面想要的“越来越像经营大师”的方向

