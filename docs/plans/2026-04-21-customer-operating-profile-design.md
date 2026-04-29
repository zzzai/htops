# Customer Operating Profile Design

日期：2026-04-21
状态：approved
范围：把“用户画像”升级为适配荷塘线下服务业的“顾客经营画像”，并明确它如何进入 customer growth / world model / 经营动作引擎

## 0. 2026-04-21 实现回写

已进入 owner path 的部分：

- `observation -> signal -> daily profile snapshot` 已落地到 `src/store.ts`、`src/customer-growth/customer-observation.ts`、`src/customer-growth/customer-operating-profile.ts`
- 顾客画像读路径已可展示稳定快照、observation 来源摘要与 `事实 / 观察 / 推断 / 预测` 边界
- `strategy / queue / intelligence` 已通过 `action-profile-bridge` 吸收服务诉求、时段偏好、技师关系、触达渠道等 bounded inputs
- `world model customer_state` 已吸收 `latestOperatingProfile` 与 `operatingProfileEvidence`
- nightly review / semantic quality 已能把 `missing_observation / stale_profile / low_hit_action` 收编进最小学习闭环

当前仍是后续波次的部分：

- 服务现场 observation 还没有统一采集入口；目前已具备 store/owner 能力，但尚未形成稳定的人录入、表单或企微写入面
- 当前稳定入链的画像字段仍偏“经营动作直接相关”，主要是服务诉求、互动风格、时段偏好、触达偏好、技师关系；更丰富的人群、身份、身体状态层还要后续收敛
- `world model` 目前完成的是 owner/path 接线；并非所有 read surface 都已把 `customerOperatingProfiles` 正式装配进来
- HQ 周报、总部诊断、跨店聚合叙事还没有系统化消费这套顾客经营画像证据

## 一、结论

`htops` 不应建设成传统互联网那种“标签越多越好”的画像平台。

更适合荷塘的定义是：

**顾客经营画像 = 一套以真实交易、服务过程、关系互动、门店供给与环境匹配为底座，用于驱动经营动作的顾客状态模型。**

它的目标不是“猜这个人像谁”，而是稳定回答：

- 这个顾客现在最值得做什么动作
- 适合在哪个门店、哪个时段、由哪类技师承接
- 触达成功概率和到店成功概率各有多高
- 哪些信息是硬事实，哪些只是观察，哪些只是推断

---

## 二、为什么不能只照搬互联网画像

传统互联网画像擅长：

- 大规模标签体系
- 内容兴趣建模
- 召回 / 粗排 / 精排
- 时间衰减与点击反馈

这些方法有价值，但如果直接照搬到荷塘，会出现 4 个问题：

1. 荷塘不是内容分发业务，核心不是“看什么”，而是“来不来、何时来、来了能不能承接”
2. 线下服务强依赖身体状态、时段场景、技师匹配、供给约束，这些在互联网画像里通常不是主轴
3. 顾客很多关键信息来自“服务过程中的观察与沟通”，而不是线上点击流
4. 大量主观标签如果不分证据等级，会迅速污染主分层和动作决策

因此要采用：

**互联网方法论 + 线下服务业特有画像层 + 明确证据边界**

---

## 三、该借什么，不该借什么

### 应该借鉴的部分

- `事实 / 规则 / 预测` 三层分开
- 长短期偏好分层
- 时间衰减
- 流失拐点
- 召回候选 -> 动作排序 -> 反馈学习
- 假设 -> 验证 -> 回灌

### 不应直接照搬的部分

- 用 `TF-IDF` 当顾客偏好主引擎
- 为了“全面”而构建海量兴趣标签
- 把猜测性人口属性当真相
- 把内容推荐的排序链路原样搬到经营动作链路

荷塘真正的主问题是：

**顾客需求 × 身体状态 × 时段场景 × 技师供给 × 门店承接 × 关系触达**

---

## 四、顾客经营画像的 8 层结构

### 1. 身份识别层

作用：

- 解决“这个人是谁、是不是同一个人、和哪个会员主档关联”

典型字段：

- `member_id`
- `customer_identity_key`
- `customer_display_name`
- `phone`
- `member_level`
- `home_store_org_id`
- `current_member_state`

来源：

- 会员表
- 消费单
- 当前会员快照

### 2. 消费能力层

作用：

- 表征顾客的实际消费力和升级空间

典型字段：

- `pay_amount_30d / 90d`
- `visit_count_30d / 90d`
- `stored_balance`
- `recharge_total_90d`
- `客单价带`
- `加钟率`
- `点钟率`
- `项目升级接受度`
- `价格敏感度`

说明：

- 这层优先使用真实消费能力，不依赖“猜收入”
- 如果确有职业、收入带信息，也应作为补充观察，不应替代真实消费事实

### 3. 身体与服务需求层

作用：

- 表征这位顾客为什么来、服务时最重要的诉求是什么

典型字段：

- `主要身体诉求`
- `肩颈 / 腰背 / 睡眠 / 疲劳 / 放松`
- `力度偏好`
- `禁忌项`
- `是否容易加钟`
- `对环境温度 / 噪音 / 私密性是否敏感`

说明：

- 这是线下服务业比互联网画像更重要的新增层
- 只能记录服务相关状态，不应伪装成医疗诊断

### 4. 互动风格层

作用：

- 表征顾客在服务和跟进中的行为风格

典型字段：

- `偏安静 / 偏沟通`
- `等待敏感度`
- `决策速度`
- `价格沟通接受度`
- `是否适合电话`
- `是否适合企微`

说明：

- 不记录主观评判词
- 只保留可执行的交互特征

### 5. 偏好层

作用：

- 表征顾客更偏好的项目、技师、房型、时段和环境

典型字段：

- `preferred_projects`
- `preferred_tech_types`
- `preferred_dayparts`
- `preferred_room_types`
- `preferred_beverages`
- `preferred_service_pace`

说明：

- 这层必须做时间衰减
- 一次偶然行为不能快速升成稳定偏好

### 6. 场景层

作用：

- 识别顾客更常在哪种消费场景下出现

典型字段：

- `午后放松型`
- `晚饭后修复型`
- `夜场解压型`
- `深夜临时型`
- `商务接待型`
- `同行消费型`

说明：

- 这是线下经营动作的关键层
- 直接决定召回时机和承接配置

### 7. 关系层

作用：

- 记录顾客与技师、客服、店长、企微触达之间的关系记忆

典型字段：

- `top_tech_name`
- `service_relationship_strength`
- `best_followup_role`
- `followup_response_history`
- `booked_then_arrived_rate`
- `last_effective_followup_channel`

说明：

- 召回成败很大程度取决于这一层
- 这是当前仓库里最值得继续强化的动作层输入之一

### 8. 风险与机会层

作用：

- 为经营动作引擎提供预测与排序依据

典型字段：

- `silent_risk`
- `return_probability`
- `contact_response_probability`
- `best_contact_window`
- `best_arrival_window`
- `upsell_readiness`
- `confidence_discount`

说明：

- 这层是预测层，不是真相层
- 必须与硬事实和观察层显式分离

---

## 五、证据等级模型

顾客经营画像不能只存“字段值”，必须连同证据一起存。

建议统一分 4 类：

### 1. 硬事实 `hard_fact`

来源：

- 消费记录
- 储值记录
- 到店记录
- 点钟记录
- 技师关联记录
- 顾客明确自报且有结构化录入

用途：

- 可进入主分层
- 可进入统计口径
- 可进入召回核心打分

### 2. 观察事实 `observed_fact`

来源：

- 技师观察
- 客服观察
- 店长观察
- 服务后结构化反馈

特点：

- 有价值，但并非绝对真相
- 需要来源、观察人、时间、置信度、有效期

用途：

- 可进入偏好、互动风格、场景判断
- 只能 bounded 地影响动作层

### 3. 推断标签 `inferred_label`

来源：

- 系统从长期行为中推断
- 多条 observation 汇总
- AI 或规则归纳

用途：

- 用于动作建议、解释和优先级微调
- 不得直接覆盖身份和主事实

### 4. 预测信号 `predicted_signal`

来源：

- 排序模型
- 规则模型
- world model bridge

用途：

- 只用于动作排序
- 必须可以回溯输入因子

---

## 六、该收哪些数据

不是“能不能收更多”，而是“收哪些信息才能稳定形成经营价值”。

### A. 优先收的高价值信息

- 顾客明确表达的职业、作息、来店目的
- 消费能力相关事实
- 服务诉求
- 力度偏好
- 技师偏好
- 时段偏好
- 跟进接受度
- 预约习惯
- 到店阻力
- 房型/环境偏好

### B. 可以收，但必须加证据边界

- 职业
- 收入带
- 身体状态
- 性格风格
- 到店动机
- 生活节律

要求：

- 标注 `source_type`
- 标注 `confidence`
- 标注 `valid_to`
- 标注 `for_scoring / for_explanation / for_ops_only`

### C. 不应作为稳定真相写死的

- 单次主观印象
- 价值判断
- 夸张描述
- 无来源的敏感推断

问题不在于“看起来重要”，而在于这类内容一旦入库后通常难以验证，容易长期污染动作决策。

---

## 七、正确的数据存储方式

顾客经营画像建议分 4 层存储。

### 1. 原始观察层

建议新增：

- `customer_service_observation_batches`
- `customer_service_observations`

职责：

- 收服务过程里的结构化观察
- 保存来源、角色、观察人、时间、原始备注

### 2. 规范化信号层

建议新增：

- `customer_operating_signals`

职责：

- 把 observation 归一化为稳定信号
- 例如：
  - `service_need.shoulder_neck = high`
  - `interaction_style.prefers_quiet = true`
  - `lifestyle.work_rest_pattern = late_shift_possible`

### 3. 顾客经营画像快照层

建议新增：

- `mart_customer_operating_profiles_daily`

职责：

- 输出供查询、解释、动作引擎消费的稳定快照

### 4. 动作特征层

职责：

- 不是直接展示给人，而是供 `strategy / queue / learning / world-model bridge` 使用

例子：

- `time_slot_fit_score`
- `tech_relationship_score`
- `service_need_match_score`
- `followup_channel_fit_score`
- `observation_confidence_discount`

---

## 八、如何进入算法

### 核心原则

- 主分层继续由 deterministic 硬事实主导
- 观察和推断不直接改 `primarySegment`
- 它们只作为 bounded adjustment 进入动作层

### 推荐的动作总分结构

`动作分 = 顾客价值 × 回店概率 × 联系响应概率 × 时段匹配 × 技师/门店承接匹配 × 策略优先级 × 置信折扣`

其中：

- 顾客价值：主要来自消费与储值事实
- 回店概率：来自 recency、frequency、历史召回结果、时间习惯
- 联系响应概率：来自关系层与历史跟进反馈
- 时段匹配：来自 daypart preference、门店营业/夜场能力、环境上下文
- 技师/门店承接匹配：来自 top tech、技师类型偏好、店型与供给
- 策略优先级：总部或门店阶段性经营目标
- 置信折扣：用于惩罚低证据 observation

### 不同信号的衰减建议

- 时段偏好：短衰减
- 技师偏好：中衰减
- 项目偏好：中长衰减
- 触达反馈：短中衰减
- 一次性备注：很短衰减
- 明确自报且长期稳定的信息：低衰减

---

## 九、进入系统各模块的边界

### 1. customer intelligence

- 可以吸收：硬事实、稳定 observation 汇总
- 不应吸收：未经验证的低置信 observation 直接改主分层

### 2. customer profile query

- 可以展示：画像快照 + 证据来源摘要
- 应显式区分：事实、观察、推断、预测

### 3. reactivation strategy / queue

- 可以吸收：服务诉求、时段偏好、关系强度、跟进接受度、禁忌项、场景偏好
- 必须 bounded：不允许 observation 直接重写 segment

### 4. world model

- customer_state 应升级为“身份 + 价值 + 服务需求 + 偏好 + 关系 + 风险”的复合状态
- observation 只能作为 evidence，不直接等于世界真相

### 5. weekly / HQ narrative

- 可以使用：职业结构、高净值倾向、商务属性、夜场画像等聚合洞察
- 前提：来源可回溯，且为聚合输出，不是随意下结论

---

## 十、与当前 Task 6 的关系

当前 `Task 6` 已完成最小升级，已覆盖：

- 顾客经营画像快照进入 `strategy / queue / intelligence` 的 bounded bridge
- 服务诉求、时段偏好、技师关系、触达偏好进入动作层 adjustment
- 主分层仍由 deterministic 硬事实主导，不允许 observation 直接重写 `primarySegment`
- 执行反馈学习、环境层 hints、门店容量约束继续并入动作层

当前仍未覆盖的关键点：

1. observation 统一采集入口与稳定回填机制
2. 更丰富的画像字段域与更强证据治理
3. HQ / weekly / cross-store 聚合读面系统化消费这套画像证据

因此，下一步重点已经不是“是否接入 Task 6”，而是继续扩 observation 输入面、world model/read surface 消费面、学习反馈精细度。

---

## 十一、落地顺序

建议分 4 波。

### Wave 1：数据结构与 owner path（已完成）

- observation tables
- signals
- daily profile snapshot

### Wave 2：读路径与解释路径（已完成）

- customer profile query
- AI-safe profile summary
- evidence-aware rendering

### Wave 3：动作层桥接（已完成）

- strategy
- queue
- followup advisory
- bounded learning

### Wave 4：世界模型与学习回灌（最小版已完成）

- customer_state enrichment
- world-model bridge
- nightly learning gap detection

---

## 十二、最终定位

荷塘需要的不是一个“画像标签中心”。

荷塘真正需要的是：

**一个能把顾客真实状态、服务过程认知、门店供给约束、时段环境变化和历史反馈结果统一起来的顾客经营画像系统。**

它服务的不是展示，而是：

- 更准的召回
- 更准的技师匹配
- 更准的时段经营
- 更准的关系跟进
- 更准的总部经营判断
