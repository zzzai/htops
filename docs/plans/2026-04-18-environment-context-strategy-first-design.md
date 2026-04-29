# Environment Context Strategy-First Design

日期：2026-04-18
状态：approved
范围：迎宾店召回策略优先，复用到问答分析解释

## 一、目标

在不破坏 `htops` 现有主链的前提下，为系统增加一层克制的“环境上下文”：

- 第一优先：影响召回策略
- 第二优先：复用到问答分析解释
- 明确边界：环境上下文不替代交易事实，不覆盖 capability graph，不进入第二套 ontology runtime

本设计服务于如下判断：

1. 人是环境的产物，季节、天气、温度、节假日、城市夜经济，会影响“人何时出来、出来做什么、适不适合被触达”
2. 这些因素适合做“门店级上下文修正”，不适合一开始就当成客户流失主事实
3. 第一版要先稳，再逐步学习，不追求一开始全量特征化

---

## 二、当前现状

仓库已经具备部分时间行为特征，但还没有真正的环境上下文层：

- `src/reactivation-features.ts`
  - 已有 `daypart`
  - 已有 `weekday`
  - 已有 `monthPhase`
  - 已有 `weekendVisitShare90d`
  - 已有 `lateNightVisitShare90d`
  - 已有 `overnightVisitShare90d`
- `src/reactivation-strategy.ts`
  - 已根据时段偏好、周几偏好、月相位偏好生成 `recommendedTouchWeekday` / `recommendedTouchDaypart`

也就是说，系统已经会看“客户过去喜欢什么时候来”，但还不会系统性看：

- 当前是否为北方夜间活跃季节
- 当前天气是否适合夜间出行
- 当前是否为节假日前后
- 当前气温和降雨是否会显著影响“饭后休闲/夜场局/保健恢复”需求

---

## 三、设计原则

### 1. 环境上下文只做修正层，不做主事实层

交易、储值、到店、技师绑定、周期偏离，仍是召回主事实。

环境上下文只做：

- 策略修正
- 解释增强
- 低风险提示

不做：

- 覆盖客户行为事实
- 直接决定客户一定流失
- 在第一版直接进入主风险分强特征

### 2. 先策略，后解释，共用一套上下文

第一版环境上下文优先影响：

- 触达窗口推荐
- 夜场适配度
- 当日是否适合主动触达
- 理由摘要与解释层

同一套上下文复用到问答分析解释层，避免双轨逻辑。

### 3. 先低风险特征，后高不确定性特征

第一版只引入 3 类环境数据：

1. 可确定的时间与日历特征
2. 可持续维护的城市/门店经营经验
3. 有明确分类边界的天气快照

不先引入：

- 复杂气象序列预测
- 自动学习出的高维天气 embedding
- 低置信度商圈经验直接参与严格评分

---

## 四、核心新增对象

第一版新增一个轻量对象：

`environment_context_snapshot`

它不是新的 runtime，也不是新的 ontology，只是一层输入上下文快照。

建议结构如下：

```ts
type EnvironmentContextSnapshot = {
  orgId?: string;
  bizDate: string;
  cityCode?: string;
  seasonTag?: "spring" | "summer" | "autumn" | "winter";
  monthTag?: string;
  isWeekend?: boolean;
  holidayTag?: "workday" | "weekend" | "holiday" | "pre_holiday" | "post_holiday";
  weatherTag?: "clear" | "cloudy" | "rain" | "storm" | "snow" | "unknown";
  temperatureBand?: "cold" | "cool" | "mild" | "warm" | "hot" | "unknown";
  precipitationTag?: "none" | "light" | "moderate" | "heavy" | "unknown";
  windTag?: "low" | "medium" | "high" | "unknown";
  citySeasonalPattern?: string;
  nightlifeSeasonality?: string;
  postDinnerLeisureBias?: "low" | "medium" | "high";
  eveningOutingLikelihood?: "low" | "medium" | "high";
  badWeatherTouchPenalty?: "none" | "low" | "medium" | "high";
  contextJson?: string;
};
```

### 三类来源

#### 1. calendar-derived

纯本地可推导，无外部依赖：

- `seasonTag`
- `monthTag`
- `isWeekend`
- `holidayTag`（第一版可先只支持普通工作日 / 周末，节假日后续接）

#### 2. store/city context

来自门店画像与经营经验：

- `citySeasonalPattern`
- `nightlifeSeasonality`
- `postDinnerLeisureBias`

例如：

- 安阳是中国北方城市
- 当前季节夜间撸串、喝酒、饭后休闲需求偏强
- 迎宾店是晚场大店、多房型、多人局/商务局承接较强

#### 3. weather snapshot

来自天气数据，但第一版只保留离散标签：

- `weatherTag`
- `temperatureBand`
- `precipitationTag`
- `windTag`

不直接存极细数值模型特征。

---

## 五、第一版如何影响系统

### A. 召回策略层

影响文件：

- `src/reactivation-strategy.ts`
- 可能新增 `src/environment-context.ts`
- 可能新增 `src/environment-context.test.ts`

第一版只做 4 个轻修正：

#### 1. `touch_window_adjustment`

如果：

- 门店晚场适配高
- 城市当前夜间休闲偏强
- 当日天气适合出行

则提高：

- `recommendedTouchDaypart = late-night / after-work`
- `touchWindowMatchScore`

#### 2. `seasonal_nightlife_boost`

如果：

- 北方城市
- 当前属于夜间活动较强季节
- 店型为晚场/多人局/商务承接型

则对晚场推荐做温和提升。

注意：

- 只影响触达建议与优先顺序
- 不直接把客户主风险分大幅拉高

#### 3. `bad_weather_penalty`

如果：

- 大雨
- 强风
- 明显降温

则降低“今天就必须主动打”的激进程度，避免错误触达。

#### 4. `post_dinner_relaxation_hint`

如果：

- 餐饮协同强
- 城市/季节夜间休闲需求偏强
- 门店有夜场承接能力

则动作建议更偏：

- 晚饭后触达
- 强调放松恢复
- 强调朋友局/饭后局/下班后松弛场景

### B. 召回输出层

影响文件：

- `src/reactivation-queue.ts`
- `src/reactivation-push.ts`

第一版不改变主任务结构，只增强：

- `reasonSummary`
- `touchAdviceSummary`

例如：

- 当前北方春季夜间活动偏强，迎宾店晚场承接能力高，建议优先晚饭后联系。
- 今日天气一般，建议不强推白天到店，优先安排本周晚间窗口。

### C. 问答分析解释层

影响文件：

- `src/query-engine-renderer.ts`
- 或新增环境解释 helper

作用方式：

- 不改 SQL 主事实
- 不改 capability graph 主语义
- 只在解释文案中补环境上下文

例如：

- 迎宾店本身属于晚场大店，且当前安阳夜间休闲需求偏强，因此晚间承接和饭后回流更值得重点关注。

---

## 六、第一版不做什么

第一版明确不做：

1. 不把天气特征直接塞进主客户流失评分
2. 不引入第二套语义 runtime
3. 不让环境因子覆盖储值、到店、技师绑定等主事实
4. 不做复杂模型训练
5. 不做自动化节假日知识体系重构
6. 不让 `src/runtime.ts` 承担新业务入口职责

---

## 七、字段分层建议

建议将环境因素按以下层级存放：

### 1. `confirmed`

只放可确定事实：

- 当前 `bizDate`
- 是否周末
- 当前月/季节
- 门店营业时间
- 店型和承接能力

### 2. `estimated_market_context`

放天气快照和第三方参考数据：

- `weatherTag`
- `temperatureBand`
- `precipitationTag`
- `windTag`

### 3. `research_note`

放经营经验与环境判断：

- 北方春季夜间活动偏强
- 饭后休闲需求偏强
- 大店适合晚间/夜场承接

---

## 八、模块建议

### 新增模块

建议新增：

- `src/environment-context.ts`
  - 负责构造 `environment_context_snapshot`
  - 输入为 `bizDate + orgId + store profile + optional weather snapshot`

### 修改模块

- `src/reactivation-strategy.ts`
  - 接入环境上下文修正
- `src/reactivation-queue.ts`
  - 增强理由摘要与触达摘要
- `src/query-engine-renderer.ts`
  - 增强分析解释
- `src/types.ts`
  - 新增环境上下文类型

### 暂不修改

- `src/runtime.ts`
- capability graph 主结构
- SQL compiler 主执行链

---

## 九、第一版推荐上线项

建议上线：

1. `seasonTag`
2. `isWeekend`
3. `weatherTag`
4. `temperatureBand`
5. `postDinnerLeisureBias`
6. `eveningOutingLikelihood`
7. `badWeatherTouchPenalty`
8. 召回解释增强
9. 问答分析解释增强

建议后置：

1. 节假日前后复杂模式
2. 气象细数值特征
3. 自动学习“天气 -> 到店概率”模型
4. 更精细的城市气候模板

---

## 十、验证方式

第一版验证不看“模型精度”，先看策略是否更合理：

1. 召回建议是否更符合门店经营直觉
2. 迎宾店是否更倾向推荐晚饭后/晚场触达
3. 恶劣天气时是否减少明显不合理触达建议
4. 问答解释是否更像真实经营分析，而不是只报数字

建议新增样本：

- 北方春季工作日晚间
- 大雨天
- 强降温日
- 周末夜场
- 饭后休闲场景

---

## 十一、结论

这次完善的关键，不是让系统“更会聊天气”，而是让系统开始具备：

- 环境影响人的活动节奏
- 环境影响门店承接窗口
- 环境影响召回时机与解释逻辑

第一版最合理的路线是：

1. 新增 `environment_context_snapshot`
2. 优先影响召回策略
3. 同步复用到问答分析解释
4. 保持环境上下文是“修正层”，不是“主事实层”

这样既符合 `htops` 的 Ontos-lite 路线，也符合“先稳后强”的 harness engineering 原则。
