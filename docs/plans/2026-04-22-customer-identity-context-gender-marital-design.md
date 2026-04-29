# Customer Identity Context Gender Marital Design

日期：2026-04-22
状态：approved
范围：把 `gender / marital_status` 作为受治理的顾客身份上下文接入 `htops`，并明确它们在画像、读链、world model、doctor 和动作层里的使用边界

## 一、结论

对荷塘线下足疗/按摩门店来说，`gender` 和 `marital_status` 不应继续被简单排除。

但它们也不应被做成：

- 无边界的人口标签系统
- AI 自由推断的人群属性
- 直接驱动主分层或召回优先级的粗暴规则

更适合 `htops` 的定位是：

**把 `gender / marital_status` 作为受治理的 customer identity context，纳入现有 `observation -> signal -> operating profile -> read surface` 主链，先服务于画像展示、解释、doctor 质检和场景提示，再视数据质量决定是否进入更下游的 bounded recommendation。**

这条路线与当前仓库主链一致：

- 顾客画像主链已经是 8 域经营画像，而不是纯人口标签系统
- 当前已有 observation truth boundary、signal normalization、profile snapshot、profile evidence
- 当前动作桥只消费少量高价值经营信号，不会自动吃掉所有画像字段

对应代码锚点：

- `src/customer-growth/observation-capture.ts`
- `src/customer-growth/customer-observation.ts`
- `src/customer-growth/customer-operating-profile.ts`
- `src/customer-growth/profile.ts`
- `src/world-model/customer-profile-evidence.ts`
- `src/customer-growth/action-profile-bridge.ts`

## 二、为什么现在应该纳入

### 1. 行业相关性是真实存在的

在足疗/按摩场景里，性别和婚姻状态可能影响：

- 服务项目偏好
- 到店场景
- 同行消费概率
- 触达表达方式
- 促销切入点

这类影响不是“互联网画像标签”，而是线下经营上下文。

### 2. 当前系统已经有足够的语义壳层来安全承接

当前仓库已经具备：

- `hard_fact / observed_fact / inferred_label / predicted_signal` 证据边界
- observation -> signal 归一化
- daily operating profile snapshot
- profile read surface 和 world model evidence

因此这次不需要再开第二套画像平台，也不需要把入口继续塞进 `src/runtime.ts`。

### 3. 现在最缺的不是“能不能放”，而是“怎么放才不失控”

真正的关键不是字段本身，而是：

- 哪些来源允许写入
- 哪些值允许进入主画像
- 哪些模块可以读取
- 是否允许进入 deterministic scoring / action engine
- 如何避免 AI 从姓名、头像、语气直接猜

## 三、备选方案

### 方案 A：只展示，不入主链

做法：

- 只在顾客详情页临时展示 `gender / marital_status`
- 不进入 observation、signal、snapshot、evidence

优点：

- 风险最低

缺点：

- 无法被 world model、doctor、nightly review 统一消费
- 无法保留证据边界
- 会变成散落字段，后续更难治理

### 方案 B：纳入主链，但先只做受控上下文

做法：

- 进入 observation / signal / profile snapshot / evidence
- 进入 profile read surface、world model explanation、doctor quality
- 第一阶段不进入 action bridge、不直接改主分层和优先级

优点：

- 最符合当前代码结构
- 既承认行业价值，又把风险控制在 owner path 内
- 允许后续根据数据质量继续演进

缺点：

- 第一阶段收益主要体现在“画像更真、解释更准、质检更全”，而不是立刻带来强策略 uplift

### 方案 C：直接进入分层、召回评分和话术分流

做法：

- 把 `gender / marital_status` 直接接入 `action-profile-bridge` 或召回优先级

优点：

- 短期看起来“更有动作”

缺点：

- 极易形成刻板规则
- 伪精确风险极高
- 与当前 deterministic 主链下的安全边界不匹配

## 四、推荐方案

选择 **方案 B**。

推荐理由：

1. 与 `htops` 现有 8 域顾客经营画像最兼容
2. 不需要新建第二套 ontology runtime 或 demographic runtime
3. 不会破坏当前 `customer growth / world model / doctor` 的 owner path
4. 可以把“字段纳入”和“动作消费”拆成两个波次，降低业务风险

## 五、在 `htops` 里的正确角色

### 1. `gender`

正确角色：

- 顾客身份上下文
- 服务表达和场景理解的辅助变量

不正确角色：

- 从姓名或头像推断出的伪标签
- 直接决定项目推荐或召回优先级的单点规则

### 2. `marital_status`

正确角色：

- 生活阶段上下文
- 消费场景提示的上游输入

不正确角色：

- “已婚/未婚”直接映射成固定服务偏好
- 直接替代真实消费行为和场景事实

### 3. 经营上更值得消费的是派生场景，而不是原始人口属性

未来真正可能有价值的不是字段本身，而是从它们约束出来的派生 context，例如：

- `companionship_hint`
- `couple_or_household_context_hint`
- `family_gift_potential_hint`

但这些派生值必须晚于原始字段治理，且第一阶段只允许进入 explanation / review，不直接进排序。

## 六、数据模型设计

### 1. observation / signal 层

第一阶段不另起新入口，继续复用现有通用 observation capture owner：

- `signalDomain: "identity_context"`
- `signalKey: "gender"`
- `signalKey: "marital_status"`

这样可以直接复用：

- `src/customer-growth/observation-capture.ts`
- `src/customer-growth/customer-observation.ts`

### 2. 标准值

建议第一阶段先收敛为：

- `gender`: `male | female | other | unknown | undisclosed`
- `marital_status`: `single | married | divorced | widowed | other | unknown | undisclosed`

说明：

- `unknown` 表示系统当前不知道
- `undisclosed` 表示顾客明确未披露或不适合记录
- 必须允许空和未知，不能逼系统硬判

### 3. profile snapshot 层

在 `identityProfileJson` 中新增最小必要字段：

- `gender`
- `gender_truth_boundary`
- `gender_confidence`
- `gender_confidence_discount`
- `gender_source_role`
- `gender_observed_at`
- `marital_status`
- `marital_status_truth_boundary`
- `marital_status_confidence`
- `marital_status_confidence_discount`
- `marital_status_source_role`
- `marital_status_observed_at`

第一阶段不单独新建列，先延续当前 `identityProfileJson` 聚合方式，保持与 `CustomerOperatingProfileDailyRecord` 的现有结构兼容。

## 七、真相边界与允许来源

### 1. 允许来源

允许进入主链的来源：

- 会员显式资料
- 顾客自述
- 店长/前台/客服/技师的明确人工确认

### 2. 不允许来源

不允许作为确定事实写入主链的来源：

- 从姓名、头像、昵称、语气做出的 LLM 猜测
- 从消费项目、同行记录、节日表达直接反推出的婚姻状态
- 任何未保留原始证据的二手判断

### 3. truth boundary 规则

`gender`：

- `hard_fact`：会员资料或明确系统事实
- `observed_fact`：顾客自述或人工确认
- `inferred_label / predicted_signal`：允许保留在研究或 review 面，但默认不提升为稳定画像事实

`marital_status`：

- `hard_fact`：会员资料中有明确且可信来源
- `observed_fact`：顾客自述或人工确认
- `inferred_label / predicted_signal`：默认只作 review 候选，不直接上主画像

这里的关键原则是：

**允许记录弱信号，但不允许弱信号伪装成确定身份事实。**

## 八、消费边界

### 第一阶段允许消费的模块

- 顾客画像查询
- 画像证据展示
- world model customer evidence
- doctor / quality summary
- AI explanation

### 第一阶段不允许直接消费的模块

- `action-profile-bridge`
- deterministic 主分层
- reactivation priority 主评分
- 任何 capability graph 内的硬动作路由

换句话说：

- **可以被看见**
- **可以被解释**
- **可以被质检**
- **暂不直接决定动作优先级**

## 九、模块映射

### 1. capture

- 继续复用 `src/customer-growth/observation-capture.ts`
- 不新开入口，不加 `runtime.ts` 入口职责

### 2. normalize

- `src/customer-growth/customer-observation.ts`
- 后续加一个小型 identity context owner/helper，用来统一标准值、来源规则、字段策略

### 3. snapshot

- `src/customer-growth/customer-operating-profile.ts`
- 将 `identity_context` 信号写入 `identityProfileJson`

### 4. read surface

- `src/customer-growth/profile.ts`
- `src/customer-query.ts`
- world model evidence:
  - `src/world-model/customer-profile-evidence.ts`

### 5. action layer

- 第一阶段显式不接 `src/customer-growth/action-profile-bridge.ts`

### 6. quality loop

- 第二阶段接入：
  - `src/ops/doctor.ts`
  - nightly review / missing facts 提示

## 十、两周路线

### Week 1：纳入主链并可见

目标：

- 字段进入 observation -> signal -> profile snapshot
- 顾客画像读链和 world model evidence 能显式展示
- 边界和来源说明完整

交付：

- `identity_context` 规范
- snapshot 落盘
- 画像读链展示
- evidence 标签补全

### Week 2：接入质量闭环，但不放大动作面

目标：

- 让 doctor / review 能看见缺失、冲突、过期
- 给 explanation 提供更可靠的上下文引用
- 保持 action bridge 和 deterministic scoring 不变

交付：

- `identity_context_missing`
- `identity_context_conflict`
- `identity_context_stale`
- 可选的 explanation-only 派生场景提示

## 十一、明确不做

本轮明确不做：

1. 不做第二套 demographic runtime
2. 不让 LLM 直接猜性别和婚姻状态
3. 不让 `gender / marital_status` 直接进入 reactivation priority 评分
4. 不把这两个字段做成 capability graph 的 ad-hoc routing 入口
5. 不把实现责任堆进 `src/runtime.ts`

## 十二、成功标准

如果这条线做好，系统应该达到：

1. 顾客画像里能看到 `gender / marital_status`，且来源和边界明确
2. world model / doctor 能把这两个字段当受治理上下文消费
3. 动作主链不会因为这两个字段被粗暴改写
4. 后续若要做更强经营派生，可以在此基础上继续安全演进
