# Environment Context Solar Term Addendum Design

日期：2026-04-19
状态：approved
范围：在现有 `environment_context_snapshot` 中增加 24 节气，并只做轻量策略修正与解释增强

## 一、目标

在不引入第二套事实系统的前提下，把中国 24 节气纳入现有环境上下文层：

- 第一优先：增强召回策略的时令感知
- 第二优先：增强分析解释的经营语境
- 明确边界：节气只做环境修正，不替代天气、不覆盖客户交易事实、不直接决定客户风险

本次是对 [environment-context-strategy-first-design.md](/root/htops/docs/plans/2026-04-18-environment-context-strategy-first-design.md) 的增量设计，不重开新架构。

---

## 二、为什么要加节气

当前环境层已经有：

- `seasonTag`
- `monthTag`
- `isWeekend`
- `weatherTag / temperatureBand / precipitationTag / windTag`

这些足够表达“大季节”和“当天天气”，但还缺一层更贴近中国本地生活节奏的时间语义：

- 同样都是春季，`惊蛰`、`清明`、`谷雨` 的出行感受并不一样
- 同样都是冬季，`霜降`、`立冬`、`小雪`、`大寒` 对夜间外出意愿的影响强度不同
- 对足疗/按摩/饭后休闲这种线下消费来说，节气比“月份”更接近真实经营语境

因此，节气适合作为：

- 中国本地门店的轻量环境标签
- 对 `postDinnerLeisureBias` 与 `eveningOutingLikelihood` 的小幅修正因子
- 解释层里更自然的经营提示

不适合作为：

- 客户层主风险分核心输入
- 覆盖天气的强判定因子
- 自动执行的强硬规则

---

## 三、设计原则

### 1. 节气属于环境上下文，不属于客户事实

节气只回答：

- 当前时令更偏向“愿不愿意出来”
- 晚饭后 / 夜场 / 保健恢复这类需求是否更值得优先看

节气不回答：

- 某个客户是否一定会回店
- 某个客户的流失是否更严重

### 2. 节气修正必须弱于天气

优先级顺序保持：

1. 客户行为与交易事实
2. 当天真实天气
3. 节气 / 季节性经营语境

也就是说：

- 大雨、强风、明显降温时，节气不能把“保守触达”重新扳回激进
- 节气只能做小幅正负修正

### 3. 第一版使用确定性近似，不联网、不引入外部天文依赖

第一版只需要足够稳定地表达经营语境，不要求天文级精度。

采用方式：

- 本地固定节气切换日近似表
- 直接由 `bizDate` 推导 `solarTerm`

这样：

- 无外部依赖
- 可测试
- 可复现
- 适合当前 repo 的 bounded context

---

## 四、新增字段

在 `EnvironmentContextSnapshot` 上新增：

```ts
type EnvironmentSolarTerm =
  | "xiaohan"
  | "dahan"
  | "lichun"
  | "yushui"
  | "jingzhe"
  | "chunfen"
  | "qingming"
  | "guyu"
  | "lixia"
  | "xiaoman"
  | "mangzhong"
  | "xiazhi"
  | "xiaoshu"
  | "dashu"
  | "liqiu"
  | "chushu"
  | "bailu"
  | "qiufen"
  | "hanlu"
  | "shuangjiang"
  | "lidong"
  | "xiaoxue"
  | "daxue"
  | "dongzhi";
```

```ts
type EnvironmentContextSnapshot = {
  ...
  solarTerm?: EnvironmentSolarTerm;
  ...
};
```

命名保持 ASCII，解释层再映射成中文节气名。

---

## 五、节气如何影响现有环境上下文

### A. `postDinnerLeisureBias`

当前它主要来自：

- 门店晚场能力
- 店型特征

增加节气后：

- `春分 / 清明 / 谷雨 / 立夏` 这类更适合饭后出行的节气，做小幅正向修正
- `小暑 / 大暑` 做小幅负向修正
- `霜降 / 立冬 / 小雪 / 小寒 / 大寒` 做小幅负向修正

修正方式：

- 只做一档以内的轻量 nudging
- 不让节气单独把 `low` 强拉到不合理的 `high`

### B. `eveningOutingLikelihood`

当前它已经看：

- 周末
- 天气
- 气温
- 北方城市夜经济偏好
- 门店夜场承接能力

增加节气后：

- 在原有分值基础上做轻量加减分
- 春季舒适节气上调一点
- 盛夏闷热与深秋初冬下调一点

### C. `badWeatherTouchPenalty`

不受节气直接控制。

原因：

- 这是更硬的当天现实约束
- 不能被“当前节气不错”这种长期语义覆盖

---

## 六、第一版节气分组策略

### 1. 轻微正向

- `chunfen`
- `qingming`
- `guyu`
- `lixia`

适用语义：

- 北方气温回升
- 晚饭后出行更友好
- 夜场与饭后休闲承接可优先看

### 2. 中性

其余大多数节气默认中性，不额外做经营推断放大。

### 3. 轻微负向

- `xiaoshu`
- `dashu`
- `shuangjiang`
- `lidong`
- `xiaoxue`
- `xiaohan`
- `dahan`

适用语义：

- 盛夏炎热或冬季转冷
- 夜间即时到店意愿通常更弱
- 触达更应保守或偏预约

---

## 七、解释层口径

解释文案只做经营提示，不写成绝对结论。

推荐风格：

- `当前临近谷雨，晚间气温和饭后出行通常更友好，可优先看晚饭后与夜场承接。`
- `当前处于霜降前后，夜间即时外出意愿通常转弱，别强推今天立刻到店。`

避免风格：

- `因为谷雨所以顾客一定更愿意来`
- `因为立冬所以今天不能召回`

---

## 八、影响范围

继续只接到已经激活的真实调用链：

1. `src/environment-context.ts`
   - 负责推导 `solarTerm`
   - 负责节气到 bias 的轻量修正

2. `src/reactivation-strategy.ts`
   - 吃到修正后的环境上下文
   - 保留 `strategyJson` 的节气摘要

3. `src/reactivation-queue.ts`
   - 继续复用策略结果
   - 不单独新增一套节气逻辑

4. `src/query-engine-renderer.ts`
   - 在解释层输出节气经营提示

5. 已接好的真实入口
   - `rebuildMemberReactivationStrategiesForDateRange`
   - `rebuildMemberReactivationQueueForDateRange`
   - `executeStoreRuntimeQuery` 的 advice/risk 分析路径

---

## 九、不做的事

这次明确不做：

- 不接第三方节气 API
- 不引入农历库
- 不做城市级复杂节气画像学习
- 不把节气直接灌进客户主风险分
- 不做节气专属召回模板系统

---

## 十、验收标准

满足以下条件即可认为第一版完成：

1. `EnvironmentContextSnapshot` 能稳定产出 `solarTerm`
2. 节气能对 `postDinnerLeisureBias / eveningOutingLikelihood` 产生小幅修正
3. 真实召回重建链路能吃到该修正
4. 真实 analysis/advice 渲染链路能展示节气解释
5. 所有新增行为都有测试覆盖

