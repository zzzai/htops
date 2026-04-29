# 三条主线两周落地优先级清单

日期：2026-04-18
状态：in-progress
范围：Ontos-lite 第一阶段收口、自学习闭环桥接、迎宾店画像分层召回执行化

## 2026-04-18 最新进展

### 已完成

1. `conversation semantic state -> semantic quality -> doctor` 已形成可见链路
   - 已有 clarify carry、多轮补槽、topic switch 相关 owner service
   - semantic quality 已可汇总 top failure、owner module、sample/backlog 候选
   - doctor 已可直接展示 semantic quality 摘要
2. `nightly review -> 学习闭环桥接` 已进入半自动状态
   - review finding 已显式标注 `sample_candidate / backlog_candidate / deploy_followup_candidate`
   - `/hetang review` 与 doctor 已能展示 follow-up target 聚合
   - semantic quality 已能吸收最新 review finding，形成次日修复输入
3. `迎宾店画像分层召回执行化` 已补齐最小命令面
   - `/hetang reactivation summary ...`：查看每日执行摘要与高优先待跟进名单
   - `/hetang reactivation tasks ...`：查看任务清单与状态过滤
   - `/hetang reactivation update ...`：回写已联系/已回复/已预约/已到店等反馈
4. 线上 smoke 已完成一轮真实闭环验证
   - `htops-bridge.service` 已重启并吃到新命令面
   - `summary / tasks` 命令已通过 bridge 直连验证
   - 发现 `scripts/rebuild-customer-history-local.ts` 漏掉 `reactivation queue rebuild`，已补齐
   - 已对迎宾店 `2026-04-09` 重建 queue，并完成 `summary -> tasks -> update -> revert` 一轮 smoke
5. `2026-04-18` 当前日召回执行链已补到真实可用
   - 修正 `historical coverage` 口径：非零 `raw_api_batches` 不再整段误判为全覆盖
   - `runCustomerHistoryCatchup` 已支持“快照到当天、派生层只差尾巴”时只补尾巴日期
   - 已对迎宾店 `2026-04-18` 完成真实 `summary -> tasks -> update -> revert` smoke
   - `htops-scheduled-worker.service` 与 `htops-bridge.service` 已重启吃到本轮代码
6. `environment_context_snapshot` 已进入真实调用链，并补入中国 24 节气轻量修正
   - 已新增 `solarTerm`，由 `bizDate` 本地确定性推导，无外部依赖
   - 节气只对 `postDinnerLeisureBias / eveningOutingLikelihood` 做小幅修正，不覆盖天气与客户事实
   - 召回策略重建、召回队列重建、store advice / analysis explanation 已吃到同一份环境上下文
   - analysis 解释层已可输出 `清明 / 谷雨` 这类节气经营提示
7. `门店外部知识 -> PG snapshot -> store advice 解释链` 已补齐最小闭环
   - 已新增 `store_external_context_entries` 存储与 AI-safe assembler，显式区分 `confirmed / estimated / research_note`
   - 已落盘 `data/store-external-context/yingbin-2026-04-18.json`，并新增 `scripts/import-store-external-context.ts`
   - `store advice` 运行时已可读取 PG 最新 snapshot，把营业时段 / 周边估算 / 研究备注以“外部情报补充”形式注入解释，但不直接改主评分

### 当前限制

- 迎宾店 `2026-04-18` 已可做真实召回 smoke
- 当前剩余限制不在命令面，而在后续要继续观察 scheduled worker 是否能稳定自动补到当天尾部，不再依赖手工 local rebuild
- 门店外部知识虽然已完成结构、导入脚本和运行时接线，但线上 PG 是否已导入最新 snapshot，仍取决于后续是否实际执行 `scripts/import-store-external-context.ts`

### 当前判断

按当前范围，三条主线都已经具备“可见、可验、可继续迭代”的最小闭环，不再停留在纯计划或纯 owner service 阶段。

---

## 一、当前判断

这三条主线里，最该先收的是：

1. `Ontos-lite` 第一阶段收口
2. `nightly review -> 学习闭环` 桥接
3. `迎宾店画像分层召回` 执行运营层

原因很直接：

- 第一条决定主链是否更稳，直接影响问答准确度与可解释性
- 第二条决定系统能不能持续变好，而不是靠人工盯失败样本
- 第三条已经不是“算不出来”，而是“能不能跑成真正的运营闭环”

因此，接下来两周不应该三线平均发力，而应该按下面顺序推进：

1. 先把 `conversation semantic state + quality loop` 收到可验收
2. 再把 `nightly review` 的结果接进样本集和优化 backlog
3. 最后把迎宾店召回补成最小可运营闭环

---

## 二、优先级总表

| 优先级 | 主线 | 目标 | 为什么现在做 | 主要模块 | 两周验收标准 |
| --- | --- | --- | --- | --- | --- |
| 必做 P0 | Ontos-lite | 收掉第一阶段最后缺口 | 这是当前主问答主链的上限约束 | `src/query-intent.ts` `src/semantic-intent.ts` `src/app/conversation-semantic-state-service.ts` `src/app/semantic-quality-service.ts` `src/app/admin-read-service.ts` `src/ops/doctor.ts` | clarify carry、复合问法、topic switch 稳定；doctor 能看见 top failure 与当前 semantic state 摘要 |
| 必做 P0 | 自学习闭环 | 把 nightly review 结果接入优化主链 | 有 review 但没形成真正闭环，ROI 还没兑现 | `src/app/conversation-review-service.ts` `src/app/conversation-review-finding-service.ts` `src/app/semantic-quality-service.ts` 以及对应 docs/plans | review 输出能自动沉淀为 backlog、样本集、部署后复验清单 |
| 应做 P1 | 迎宾店画像分层召回 | 从“策略存在”推进到“执行起来” | 业务价值高，但不该先于主问答稳定性 | `src/customer-profile.ts` `src/reactivation-features.ts` `src/reactivation-strategy.ts` `src/reactivation-queue.ts` `src/reactivation-push.ts` | 有最小任务卡、任务状态流转、反馈回写、效果复盘口径 |
| 可以后置 P2 | Hermes / WeCom 深集成 | 把召回卡片、反馈解析、渠道编排做成完整工作台 | 需要建立在前面三项都成型后 | 未来独立 workstream | 不进入本两周主目标 |

---

## 三、必做项

### 1. Ontos-lite 第一阶段收口

#### 目标

把系统从“已有 capability graph 与 clarify carry”推进到“对多轮补槽、复合问法、topic switch 有稳定解释”，并且这些失败可被质量面稳定看见。

#### 这两周只做三件事

1. 把 `conversation semantic state` 从“clarify 延续”扩到：
   - 复合问法
   - 老板式口语的第二句补槽
   - topic switch reset
2. 把 `semantic quality` 从“看 top failure”扩到：
   - top failure 绑定 owner module
   - top failure 自动沉淀样本候选
   - deploy-window 视角可直接复验
3. 把 `doctor / admin read surface` 补成：
   - 当前 semantic state 是否活跃
   - 当前主要 failure 类型
   - 哪些 failure 正在进入修复闭环

#### 非目标

- 不引入第二套 ontology runtime
- 不把更多职责塞进 `src/runtime.ts`
- 不为了“更智能”去改写 safe execution 主链

#### 两周验收标准

- 对于老板式口语、复合问法、第二句补槽，新增 live 样本命中率明显提升
- `doctor` / Query API 能直接回答：
  - 当前有没有 semantic failure 集中爆点
  - 这些失败属于哪类
  - 是否已进入 backlog / sample candidate
- 第一阶段可以明确宣告：`Ontos-lite Phase 1 complete`

---

### 2. 自学习闭环桥接

#### 目标

把“nightly review 会产出复盘结果”推进到“复盘结果能驱动第二天的改进动作”。

#### 当前缺口

现在的问题不是没有 review，而是 review 结果没有稳定流入这三条主线：

1. 失败样本集
2. owner-module 优化 backlog
3. 部署后复验清单

#### 这两周只做四件事

1. 给 nightly review finding 增加更明确的去向字段：
   - `sample_candidate`
   - `backlog_candidate`
   - `deploy_followup_candidate`
2. 把 review finding 和 semantic quality top failure 建立映射
3. 把 nightly review 的高频失败直接收成样本集草稿
4. 给值班/验收面补一条“昨夜 review 是否产生新 failure cluster”

#### 非目标

- 不做“AI 自动改代码”
- 不做“AI 自动改 capability graph 并自动上线”
- 不做无人审批的自治闭环

#### 两周验收标准

- nightly review 结果不再只是存库，而是会进入下一轮修复输入
- 能回答“昨晚发现了什么新问题、今天该修什么、修后如何复验”
- 自学习闭环可以进入“半自动有效”状态，而不是“只是有复盘”

---

## 四、应做项

### 3. 迎宾店画像分层召回执行化

#### 目标

把迎宾店召回从“特征、策略、分层都已具备”推进到“可交付给运营执行，并形成反馈闭环”。

#### 正确认知

这里现在最大的缺口不是算法，而是执行层：

- 没有稳定任务对象
- 没有最小任务状态流转
- 没有客服/店长反馈闭环
- 没有效果复盘口径

#### 这两周只做三件事

1. 收出最小任务模型
   - 谁是召回对象
   - 当前分层/优先级是什么
   - 当前任务状态是什么
2. 收出最小反馈模型
   - 已联系 / 未联系 / 拒绝 / 已预约 / 已到店
   - 回写后能反向更新下一轮策略输入
3. 收出最小复盘口径
   - 任务完成率
   - 联系成功率
   - 到店转化率
   - 分层策略命中效果

#### 非目标

- 不先做完整 Hermes 工作台
- 不先做全自动顾客侧对话
- 不先做复杂多渠道编排

#### 两周验收标准

- 迎宾店可以跑一轮真实召回任务
- 有任务、有反馈、有复盘
- 能清楚回答“哪些画像分层有效，哪些无效”

#### 补充：门店画像采集表

这张表用于后续沉淀 `store_business_profile`，原则是只收会真实改变召回策略、触达窗口、承接安排和复盘解释的数据。

| 优先级 | 类别 | 建议字段 | 主要来源 | 采集方式 | 更新频率 | 对召回的作用 |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | 门店定位 | `store_format` `store_scale` `business_scene` `opening_date` `renovation_date` | 品牌档案、店长确认、美团/点评门店页 | 首次人工建档，季度复核 | 开店/装修变更时即时；其余季度 | 决定召回周期基线，区分大店/标准店、商务型/社区型、影院式等不同回店节奏 |
| P0 | 承接能力 | `area_m2` `room_count` `room_mix` `service_hours` `slot_capacity_by_daypart` `tech_shift_capacity` | 门店台账、排班表、房态表 | 人工录入基础信息；按营业排班自动汇总各时段承接上限 | 基础信息月度；排班按日 | 决定该不该往晚场、周末、夜场推，避免把召回打到接不住的时段 |
| P0 | 客群结构 | `member_visit_share_90d` `walkin_visit_share_90d` `groupbuy_visit_share_90d` `high_value_customer_share_90d` `night_customer_share_90d` `business_customer_share_90d` | 消费单、会员单、团购单、客户分层结果 | 从现有交易和客户分层数据按 90 天窗口聚合；商务客先规则识别后人工抽检 | 按日滚动 | 决定不同店的沉默阈值、优先级和召回对象选择 |
| P0 | 到店时段结构 | `weekday_visit_share_90d` `weekend_visit_share_90d` `afternoon_visit_share_90d` `after_work_visit_share_90d` `late_night_visit_share_90d` `overnight_visit_share_90d` `visit_time_coverage_rate_90d` | 消费时间、结账时间 | 直接从已有到店时间推算；缺失时间单独统计覆盖率 | 按日滚动 | 决定最佳触达时间、建议预约时间和夜场型门店的召回打法 |
| P0 | 技师结构 | `top_tech_list` `tech_specialty_map` `tech_schedule_stability_30d` `loyal_customer_binding_rate_90d` `tech_capacity_limit_by_daypart` | 技师档案、排班、客户技师绑定记录 | 现有技师关联数据自动聚合，专长和排班规则人工补录 | 排班按日；专长月度 | 决定召回是否能匹配熟悉技师，避免“联系了但没人接得住” |
| P0 | 商品与价格结构 | `ticket_price_band` `stored_value_pay_share_90d` `cash_pay_share_90d` `addon_rate_90d` `package_rate_90d` `tea_meal_attach_rate_90d` `project_mix_topn` | 消费单、支付方式、附加项目、项目明细 | 从账单结构自动聚合 | 按日滚动 | 决定召回话术应强调熟客回流、储值唤醒、项目升级还是休闲恢复 |
| P0 | 地理商圈结构 | `nearby_residential_clusters` `nearby_office_clusters` `nearby_hotels` `parking_convenience_level` `arterial_road_access` `nightlife_corridor_level` | 地图 POI、店长调研、门店现场认知 | 首次人工调研建档，半年复核 | 半年；重大变化即时 | 决定天然来店场景是社区复购、商务局、朋友局还是夜场局 |
| P0 | 竞对结构 | `competitor_count_3km` `competitor_price_band_topn` `competitor_hours_profile` `competitor_rating_band` `competitor_groupbuy_intensity` `large_store_competitor_flag` | 美团/点评、地图 POI、商圈巡检 | 半人工采集，月度更新关键指标 | 月度 | 决定外部分流风险，避免只看内部沉默而忽略竞对吸走客流 |
| P0 | 召回执行反馈 | `contact_rate` `reply_rate` `booking_rate` `arrival_rate` `repurchase_rate_30d` `reactivation_outcome_by_segment` `reactivation_outcome_by_tech` `reactivation_outcome_by_daypart` | `/hetang reactivation update` 回写、客服记录、预约结果 | 从召回任务闭环自动沉淀 | 按日滚动 | 这是最关键闭环，用来验证哪些分层、技师、时段真的有效 |
| P0 | 门店事件 | `manager_change_event` `key_tech_leave_event` `renovation_event` `promotion_event` `parking_change_event` `construction_event` | 店长上报、运营周报、企微反馈 | 人工事件录入，重要事件必须带起止时间 | 事件触发 | 解释模型失效、召回异常和阶段性波动，避免错把经营事件当成客户流失 |
| P1 | 城市画像 | `city_consumption_band` `night_consumption_strength` `salary_cycle_pattern` `holiday_traffic_volatility` | 统计公报、地图热力、运营经验 | 先人工建档，后按季度维护 | 季度 | 给门店召回节奏提供城市级基线，避免单店过拟合 |
| P1 | 周边人群画像 | `residential_family_share` `commuter_white_collar_share` `hotel_overnight_share` `business_reception_share` | 小区/写字楼/酒店 POI，地图人口热力，店长调研 | 半人工建档，季度校准 | 季度 | 帮助判断门店主要客群来自社区、通勤、住宿还是商务接待 |
| P1 | 渠道结构 | `meituan_share_90d` `douyin_share_90d` `private_domain_share_90d` `referral_share_90d` `walkin_share_90d` | 渠道订单、活动单、人工标注 | 按订单来源自动聚合，缺口人工补标签 | 按周 | 决定召回话术、利益点和渠道协同打法 |
| P1 | 预约与排队 | `peak_slot_fill_rate` `queue_wait_time_by_daypart` `good_reactivation_slots` `bad_reactivation_slots` | 预约系统、排队记录、房态 | 自动聚合高峰承接压力；人工标记禁推时段 | 按日 | 决定哪些时段适合承接召回，避免推去常满房时段 |
| P2 | 更细人口学标签 | `age_band_mix` `family_stage_mix` `local_vs_nonlocal_mix` | 会员档案、外部画像 | 条件成熟后再补 | 月度或季度 | 用于更细的话术分层，但当前不是主矛盾 |
| P2 | 更重商圈热力 | `footfall_heatmap_score` `competitive_heat_shift` `night_heat_shift` | 付费商圈热力、LBS 数据 | 后置采购接入 | 月度 | 用于更精细的商圈竞争判断，不是第一阶段必须项 |
| P2 | 短周期环境因子 | `weather_impact_tag` `traffic_impact_tag` `road_control_tag` | 天气、路况、城管公告 | 条件触发采集 | 实时或事件触发 | 只用于解释短期波动，不应成为召回主链第一优先级 |

补充说明：

- `late_night_visit_share_90d` 和 `overnight_visit_share_90d` 已可从现有到店时间推算，不属于新增采集成本项。
- 对于时间缺失的账单，需要同步保留 `visit_time_coverage_rate_90d`，否则夜场型门店会被系统性低估。
- 第一阶段建议先按“迎宾店 + 安阳市区共享画像”建第一版，再逐步扩到五店统一口径。
- 已知迎宾店门口有停车场，可先收为 `onsite_parking_available=true`、`parking_convenience_level=high`，后续若拿到车位数或高峰可用率再补细。

#### 补充：第三方 PDF 参考情报（`/root/htops/mdshuju`）

当前目录下已有 4 份第三方 PDF 报告，可作为 `estimated` / `research_note` 输入，不可直接当 `confirmed` 真相源：

| 文件 | 类型 | 当前可提取信息 | 建议入库层级 | 使用建议 |
| --- | --- | --- | --- | --- |
| `荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查周边.pdf` | 周边总览 | `人口规模 44.96 万` `周边房屋均价 6789.7 元/㎡` `周边店铺平均租金 91.8 元/月/㎡` `住宅区 257` `写字楼 33` `商业区 14` `居住人数 41.4 万` `办公人数 7.1 万` `客流量 82.6 万人次/月均日客流口径` `周边配套 7559 家（零售 3708 / 餐饮 2397 / 娱乐 516 / 酒店 477 / 教育 461）` | `estimated` | 可用于支撑“迎宾店处于高人口、高配套、住宅+办公+酒店混合商圈”的判断，不宜直接写成精确事实 |
| `荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查人口热力.pdf` | 人口热力 | 人口总规模、居住人口、工作人口、住宅热力、写字楼热力等空间热区图 | `research_note` | 用于佐证“住宅与办公混合型商圈”，更适合做空间判断，不适合直接抽成精确数字 |
| `荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查行业热力.pdf` | 行业热力 | 休闲娱乐热力、人均休闲娱乐热力、餐饮热力、商超便利热力、教育热力等空间热区图 | `research_note` | 用于判断协同业态和竞品密度，适合辅助“夜间休闲/餐饮联动”类经营推断 |
| `荷塘悦色影院式沐足(迎宾公园店)周边3.0km的周边调研-查外卖.pdf` | 外卖生态 | `外卖门店数 662` `月订单指数 79.20 万` `预估月销售额 1461.15 万` `单店客单价 22.18 元` `店均订单量 1196` `店均销售额 2.21 万`，以及餐饮品类结构 | `estimated` | 不直接决定足疗召回，但可作为“周边餐饮活跃、夜间消费基础较强”的补充信号 |

使用规则：

- 这 4 份 PDF 统一视为第三方参考情报，不可覆盖官方公示、系统交易数据、人工确认事实。
- 其中 `查周边.pdf` 的结构化数字可沉淀到 `estimated_market_context`。
- `查人口热力.pdf` 与 `查行业热力.pdf` 更适合作为 `research_note`，用于支持“住宅密集 / 办公密集 / 餐饮协同 / 夜场潜力”这类推断。
- 若后续要把这些情报接入召回策略，应先转成有 `source_type=third_party_pdf`、`captured_at=2026-04-18`、`confidence=medium` 的字段，而不是裸写死值。

热力图 OCR 补充结果：

- 已将 `查人口热力.pdf`、`查行业热力.pdf` 的热力图页转成图片并做 OCR，确认图上反复出现的核心地标包括：
  - `华城国际`
  - `迎宾公园`
  - `安阳市政府`
  - `安阳市人民医院`
  - `安阳德宝国际名城`
  - `鸿泰苑`
  - `S301`
  - `安阳市第八中学`
- 这说明两份热力图覆盖的高密度观察区域，稳定落在迎宾公园 - 华城国际 - 市政府 - 人民医院这一带的城市核心走廊。
- 当前 OCR 已能拿到地标层和模块标题，但 `①②③` 热区编号与具体地标的一一对应仍不够稳定，因此这部分仍应作为 `research_note` 使用，不建议写成“精确热点坐标”。

#### 补充：迎宾店可入项目参考情报表

下表将当前已成功提取的结构化数字和稳定事实统一收口。原则是：

- `confirmed`：可作为门店画像或城市基线的已确认事实
- `estimated`：可作为项目参考情报，但不可覆盖内部交易真相源
- `research_note`：用于经营判断和策略解释，不直接参与精确算分

| 分组 | 字段 | 值 | 入库层级 | 来源 | 置信度 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 门店基础 | `store_name` | `荷塘悦色影院式沐足(迎宾公园店)` | `confirmed` | 门店页截图 | high | 迎宾店唯一识别 |
| 门店基础 | `service_hours` | `11:30-次日02:00` | `confirmed` | 门店页截图 | high | 判定晚场/深夜承接能力 |
| 门店基础 | `area_m2` | `2000` | `confirmed` | 门店页截图 | high | 判定大店属性 |
| 门店基础 | `capacity_headcount` | `100` | `confirmed` | 门店页截图 | high | 评估门店承接容量 |
| 门店基础 | `opening_date` | `2018-07-18` | `confirmed` | 门店页截图 | high | 判定成熟店而非新店 |
| 门店基础 | `renovation_date` | `2022-10-20` | `confirmed` | 门店页截图 | high | 评估门店环境新旧程度 |
| 门店基础 | `single_room_count` | `5` | `confirmed` | 门店页截图 | high | 房型结构分析 |
| 门店基础 | `double_room_count` | `8` | `confirmed` | 门店页截图 | high | 房型结构分析 |
| 门店基础 | `multi_room_count` | `20` | `confirmed` | 门店页截图 | high | 判断多人局/商务局承接属性 |
| 门店基础 | `room_count_total` | `33` | `confirmed` | 门店页截图汇总 | high | 门店规模判断 |
| 门店基础 | `store_format` | `cinema_foot_bath` | `confirmed` | 店名与门店页截图 | high | 门店定位标签 |
| 门店基础 | `onsite_parking_available` | `true` | `confirmed` | 用户确认 | high | 自驾便利性判断 |
| 门店基础 | `parking_convenience_level` | `high` | `confirmed` | 用户确认 | high | 适配商务/夜间自驾客群 |
| 企业主体 | `entity_established_date` | `2018-04-09` | `confirmed` | 工商主体公开页 | medium | 区分主体成立与门店开业时间 |
| 城市基线 | `urban_disposable_income_per_capita_2024` | `46528 元/年` | `confirmed` | 文峰区 2024 统计公报 | high | 作为区域消费力基线 |
| 商圈总览 | `market_population_scale_3km` | `44.96 万人` | `estimated` | `查周边.pdf` | medium | 判断 3km 商圈总体容量 |
| 商圈总览 | `avg_house_price_3km` | `6789.7 元/㎡` | `estimated` | `查周边.pdf` | medium | 判断区域居住消费档次 |
| 商圈总览 | `avg_shop_rent_3km` | `91.8 元/月/㎡` | `estimated` | `查周边.pdf` | medium | 辅助判断商业成熟度 |
| 商圈总览 | `residential_zone_count_3km` | `257` | `estimated` | `查周边.pdf` | medium | 判断居住密度与社区客群基础 |
| 商圈总览 | `office_building_count_3km` | `33` | `estimated` | `查周边.pdf` | medium | 判断办公/商务客群基础 |
| 商圈总览 | `commercial_zone_count_3km` | `14` | `estimated` | `查周边.pdf` | medium | 判断商业聚集度 |
| 商圈总览 | `residential_population_3km` | `41.4 万人` | `estimated` | `查周边.pdf` | medium | 判断居住型客群体量 |
| 商圈总览 | `office_population_3km` | `7.1 万人` | `estimated` | `查周边.pdf` | medium | 判断办公型客群体量 |
| 商圈总览 | `monthly_avg_daily_footfall_3km` | `82.6 万人次` | `estimated` | `查周边.pdf` | medium | 判断客流活跃度 |
| 商圈配套 | `poi_total_3km` | `7559 家` | `estimated` | `查周边.pdf` | medium | 判断商圈综合成熟度 |
| 商圈配套 | `retail_poi_count_3km` | `3708 家` | `estimated` | `查周边.pdf` | medium | 判断零售活跃度 |
| 商圈配套 | `catering_poi_count_3km` | `2397 家` | `estimated` | `查周边.pdf` | medium | 判断餐饮协同强度 |
| 商圈配套 | `entertainment_poi_count_3km` | `516 家` | `estimated` | `查周边.pdf` | medium | 判断休闲娱乐聚集度 |
| 商圈配套 | `hotel_poi_count_3km` | `477 家` | `estimated` | `查周边.pdf` | medium | 判断过夜/商务住宿客群基础 |
| 商圈配套 | `education_poi_count_3km` | `461 家` | `estimated` | `查周边.pdf` | medium | 判断教育配套与家庭客群信号 |
| 交通配套 | `bus_stop_count_3km` | `121` | `estimated` | `查周边.pdf` | medium | 判断公交可达性 |
| 交通配套 | `bus_line_count_3km` | `35` | `estimated` | `查周边.pdf` | medium | 判断公共交通便利度 |
| 交通配套 | `metro_station_count_3km` | `0` | `estimated` | `查周边.pdf` | medium | 城市交通结构判断 |
| 交通配套 | `nearest_rail_time` | `约10分钟` | `estimated` | `查周边.pdf` | medium | 判断外来客/城际客便捷度 |
| 交通配套 | `nearest_airport_time` | `约30分钟` | `estimated` | `查周边.pdf` | medium | 低频外来商务客参考 |
| 周边样本 | `nearest_bus_stop_names` | `富泉街光明路口 / 光明路富泉街口 / 兴泰路华城国际 / 兴泰路文明大道路口` | `estimated` | `查周边.pdf` | medium | 可达性与地理定位辅助 |
| 周边样本 | `nearest_residential_names` | `福佳斯东区 / 昊澜花园 / 福佳斯·国际花园东区 / 阳光雨露昊澜园 / 凤起宸鸣` | `estimated` | `查周边.pdf` | medium | 住宅客群来源线索 |
| 周边样本 | `nearest_office_names` | `全家福商务中心 / 中信银行大厦 / 安阳市金融中心` | `estimated` | `查周边.pdf` | medium | 办公/商务客群来源线索 |
| 外卖生态 | `delivery_store_count_3km` | `662` | `estimated` | `查外卖.pdf` | medium | 判断周边即配餐饮生态活跃度 |
| 外卖生态 | `delivery_monthly_order_index_3km` | `79.20 万` | `estimated` | `查外卖.pdf` | medium | 判断周边日常消费热度 |
| 外卖生态 | `delivery_estimated_monthly_sales_3km` | `1461.15 万` | `estimated` | `查外卖.pdf` | medium | 判断消费总盘子规模 |
| 外卖生态 | `delivery_avg_ticket` | `22.18 元` | `estimated` | `查外卖.pdf` | medium | 判断周边即时消费价格带 |
| 外卖生态 | `delivery_avg_orders_per_store` | `1196 笔/月` | `estimated` | `查外卖.pdf` | medium | 判断单店活跃度 |
| 外卖生态 | `delivery_median_orders_per_store` | `679 笔/月` | `estimated` | `查外卖.pdf` | medium | 观察分布中位水平 |
| 外卖生态 | `delivery_avg_sales_per_store` | `2.21 万/月` | `estimated` | `查外卖.pdf` | medium | 辅助判断商圈交易热度 |
| 外卖品类 | `delivery_top_categories` | `粥/粉/面 105；快餐厅 100；奶茶饮品 61；炸鸡汉堡 50；面包甜点 50` | `estimated` | `查外卖.pdf` | medium | 说明周边以高频轻餐饮为主 |
| 热力走廊 | `core_heatmap_landmarks` | `华城国际 / 迎宾公园 / 安阳市政府 / 安阳市人民医院 / 安阳德宝国际名城 / 鸿泰苑 / S301 / 安阳市第八中学` | `research_note` | 热力图 OCR | medium | 支撑“核心走廊型商圈”判断 |
| 城市季节性 | `seasonal_nightlife_pattern` | `安阳属中国北方城市，当前季节夜晚撸串、喝酒、饭后休闲需求偏强` | `research_note` | 用户业务经验 | medium | 支撑“晚间触达优先、餐饮后续承接、夜场召回解释” |
| 经营判断 | `store_business_scene_inference` | `大店 + 晚场 + 多人局 + 商务/社区混合型` | `research_note` | 截图事实 + PDF 参考情报综合判断 | medium | 用于召回策略解释，不直接当硬事实算分 |

使用建议：

- `confirmed` 字段可以直接进入第一版 `store_business_profile`。
- `estimated` 字段建议统一挂到 `estimated_market_context` 或 `external_context_snapshot`，并带上 `source_type=third_party_pdf`。
- `research_note` 只用于策略解释和运营研判，不建议直接参与严谨阈值判定或自动打分。
- 像“北方春季夜间撸串喝酒后续休闲需求偏强”这类季节性经营经验，更适合先进入 `research_note`，后续若叠加真实晚场消费数据持续验证，再考虑升级为策略规则。

---

## 五、可以后置项

### 4. Hermes / WeCom 深集成

这个方向价值高，但不应该抢占当前两周的核心资源。

后置原因：

- 现在更稀缺的是业务真相源和质量闭环，不是外层工作流壳子
- 如果主链语义状态和学习闭环还没收好，先做 Hermes 只会把问题搬到更复杂的执行面

建议后置到下面条件满足之后再开：

1. `Ontos-lite Phase 1` 收完
2. `nightly review -> backlog/sample` 已打通
3. 迎宾店最小召回闭环已验证可跑

---

## 六、两周执行节奏

### 第 1 周

#### 必做

1. 收 `conversation semantic state`
2. 收 `semantic quality -> owner -> sample candidate`
3. 补 `doctor / admin` 的 semantic quality 展示

#### 应做

1. 梳理 nightly review finding 的去向字段
2. 确定 review -> backlog/sample 的最小桥接契约

### 第 2 周

#### 必做

1. 打通 nightly review -> backlog/sample/deploy follow-up
2. 做一轮 deploy-window 复验
3. 明确 `Ontos-lite Phase 1` 是否可以收口

#### 应做

1. 收迎宾店最小召回任务模型
2. 补任务反馈回写与效果复盘口径
3. 选 1 轮真实运营样本做试跑

---

## 七、建议的投入顺序

如果只能按最小投入产出比来排，建议顺序如下：

1. `conversation semantic state`
2. `semantic quality -> sample/backlog bridge`
3. `nightly review -> deploy follow-up`
4. `迎宾店召回任务状态流转`
5. `迎宾店反馈闭环`

这也是当前最符合 `htops` 主架构方向的推进方式：

- 先强化语义真相源
- 再强化质量闭环
- 最后把策略变成可执行运营动作

---

## 八、结论

未来两周不应该平均推进三条主线，而应该明确按这条路径收口：

1. 先收 `Ontos-lite Phase 1`
2. 再收 `nightly review -> 学习闭环`
3. 最后把 `迎宾店画像分层召回` 跑成最小运营闭环

一句话说，当前真正的主线不是“继续加功能”，而是：

**把语义状态、质量闭环、运营执行三者接成一条能持续变好的主链。**
