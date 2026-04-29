# Consume-Detail-First Arrival Count Design

日期：2026-04-19  
状态：approved  
范围：基于顾客消费明细优化门店每日人数口径，先以 shadow metrics 方式落地，不直接替换现有 `customerCount`

## 背景

当前系统已经能用消费单 `Infos`、稳定身份引用和同结算单多人识别来计算 `customerCount`，比早期“订单数即人数”更好；但从经营视角看，仍有两个未完全分开的口径：

1. **结算顾客人数**
   - 一张消费结算单实际服务了几位顾客
2. **到店承接人数**
   - 当天大概承接了多少位实际到店顾客

在足疗门店当前业务前提下：

- 正常是一位顾客对应一位技师
- 没有“一客双技 / 双人同做”项目
- 加钟不算新增人数
- 采耳、刮痧等小项不算新增人数

因此，单看首次上钟已经可以形成较强估算；但如果消费明细本身已携带顾客名单或稳定身份，则**消费明细比上钟明细更接近“这单到底服务了几个人”**。

## 问题定义

我们要解决的不是“商圈真实路过客流”，而是门店内部更可运营的两类人数：

1. **成交人数**
2. **承接人数**

需要避免以下错误：

- 把加钟、小项当新增人数
- 把同一顾客的多次服务动作重复算人
- 因少量弱身份单据导致人数被系统性低估或高估

## 目标

### 目标内

- 新增一套 **消费明细优先** 的人数计算方案
- 明确分出：
  - `settlementCustomerCount`
  - `arrivalCustomerCountEstimated`
  - `arrivalEvidenceCoverage`
- 首批以 shadow metrics 形式落地，允许和当前 `customerCount` 并行观测
- 在弱消费身份场景下，使用首次非加钟主项上钟记录做有限补洞

### 目标外

- 不尝试估算“门店真实进门总客流”
- 不用 `CCode/CName` 直接做人数主键
- 不直接把首次上钟人数硬切成正式唯一口径
- 不在第一批做完整包间/翻房/等位联动重构

## 核心结论

### 最优口径排序

`消费明细顾客列表 > 消费明细稳定身份 > 首次非加钟主项上钟补洞`

### 为什么

1. **消费明细顾客列表**（`Infos`）最接近结算事实
2. **消费明细稳定身份**（`CardNo / MemberPhone / Phone / CardId / MemberName`）可在 `Infos` 缺失时保底
3. **首次非加钟主项上钟** 更适合补洞，而不适合作为唯一主口径

## 指标设计

### 1. `settlementCustomerCount`

定义：

- 每张非反结消费单实际服务的顾客人数之和

优先级：

1. `Infos` 解析出的顾客列表去重数
2. 若 `Infos` 缺失，则尝试消费明细稳定身份映射，至少记 1
3. 若消费明细仍弱，则退化为 1

特点：

- 不受加钟、小项直接放大
- 更接近“成交顾客人数”

### 2. `arrivalCustomerCountEstimated`

定义：

- 当天承接到店人数估算

优先级：

1. 优先使用 `settlementCustomerCount` 的单据级结果
2. 仅当某张消费单在消费明细侧证据不足时，才用 `1.6 技师上钟明细` 补洞

补洞规则：

- 只看同 `settleNo`
- 只看首次、非加钟、主项记录
- 排除小项与加钟
- 不覆盖已经有强消费明细证据的单据

特点：

- 比纯上钟估算稳
- 比纯消费明细在弱身份单据下更完整

### 3. `arrivalEvidenceCoverage`

定义：

- 当天非反结消费单中，有多少比例可以直接从消费明细得到强人数证据

用途：

- 告诉运营“今天这个人数口径有多可信”
- 支持后续是否切换 `customerCount` 正式口径

## 数据来源

### 消费明细侧

来自 `fact_consume_bills.raw_json`：

- `Infos`
- `SettleNo`
- `Payments`
- `CardNo`
- `MemberPhone`
- `Phone`
- `CardId`
- `MemberName`

### 上钟补洞侧

来自 `fact_tech_up_clock.raw_json`：

- `SettleNo`
- `AddClockType`
- `ClockType`
- `ItemCategory`
- `ItemName`
- `RoomCode`
- `CTime`
- `SettleTime`

## 主规则

### 规则 A：消费明细优先

若消费单 `Infos` 能稳定解析出 2 位顾客，则这单按 2 人算，**不再回头看上钟去覆盖它**。

### 规则 B：上钟只补弱证据单

只有当消费明细无法给出强人数结论时，才允许读取上钟补洞。

### 规则 C：加钟不新增人数

`AddClockType != 0` 的记录不计新增人数。

### 规则 D：小项不新增人数

采耳、刮痧等小项即使出现在上钟明细里，也不能当新增人数。

### 规则 E：不直接使用 `CCode/CName` 计人数

当前已知部分实时消费记录里，`CCode/CName` 可能混入前台人员信息，只适合复到店链路，不适合直接做人数口径主键。

## 为什么不直接替换 `customerCount`

因为当前线上已经有大量围绕 `customerCount` 的问答、报表和排名逻辑。

直接替换会带来两个风险：

1. 旧报表数字突变，运营会误以为数据坏了
2. 新口径若存在门店差异，没有对照期会难以判断优劣

因此首批采用：

- 新增 shadow metrics
- 报表或 query 先显式查询新口径
- 对照一段时间后，再决定是否切换 `customerCount`

## rollout 建议

### Phase 1

- 落地 shadow metrics：
  - `settlementCustomerCount`
  - `arrivalCustomerCountEstimated`
  - `arrivalEvidenceCoverage`

### Phase 2

- 开放查询：
  - “结算顾客人数”
  - “承接到店人数估算”

### Phase 3

- 对比 `customerCount` 与新口径在各店、各日期差异
- 决定是否：
  - 保留双指标长期并存
  - 或把 `customerCount` 切换到新算法

## 验收

1. 消费明细 `Infos` 有多人名单时，人数按名单去重数计算
2. `Infos` 缺失但有稳定身份时，单据仍可得到合理人数
3. 加钟和小项不会把人数抬高
4. 弱证据单据可被首次非加钟主项上钟记录补洞
5. 首批只新增 shadow metrics，不破坏现有 `customerCount` 用户面行为
