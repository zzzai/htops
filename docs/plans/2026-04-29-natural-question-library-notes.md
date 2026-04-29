# Natural Question Library Notes

日期：2026-04-29  
来源：`knowledge/150_natural_questions.html`

## 1. 这份文件是什么

`knowledge/150_natural_questions.html` 不是普通展示页，而是一份高价值业务语料库。

它沉淀了三类真实角色的自然问法：

- 门店老板
- 店长
- 运营 / 会员专员

这些问法的价值不在于“多了 150 句中文”，而在于它们提供了：

1. 更接近真实人的表达方式
2. 更接近真实岗位关心的问题结构
3. 比“字段名问法”更接近最终产品使用场景的语义基线

## 2. 应该怎么用

这份问法库应同时服务三件事：

### 2.1 语义识别回归集

优先把高频自然问法转成：

- `semantic-intent.test.ts`
- `query-intent.test.ts`
- `route-eval` / coverage builder

目标不是全量一次吃完，而是按业务价值分批接入。

### 2.2 Capability Graph 扩展输入

问法库可以直接暴露当前 capability gap：

- 哪些问题只是说法别名，还没有映射到现有 capability
- 哪些问题已经超出当前数据面，需要新 capability
- 哪些问题属于实时运营能力，还不该伪装成已支持

### 2.3 产品输出面设计参考

这些问题可以反过来指导：

- 门店老板看什么
- 店长看什么
- 运营 / 会员专员看什么

也就是说，它不仅是 NLP 训练材料，还是产品需求材料。

### 2.4 正式 contract 输入

从 2026-04-29 起，这份问法库不再只是“测试素材”，也作为正式 contract 输入之一：

- `src/semantic-operating-contract.json`
- `src/semantic-operating-contract.ts`
- `docs/plans/2026-04-29-semantic-operating-contract.md`

这些资产把问法按 `question family -> capability -> metric/segment/analysis recipe` 收口，避免自然语言库继续只停留在散样本层。

## 3. 已接入的第一批问法

当前已经先接了底层有真实支撑、容易稳定命中的一批：

- `今天进账多少`
- `本月充了多少钱进来`
- `哪些会员快跑了`
- `美团来的客人回头了吗`
- `今天来了几个新客`
- `今天加钟加了几个`
- `最近有没有反结情况`

这些问法优先级高的原因是：

- 当前 metrics / customer segment / groupbuy 转化链已有事实基础
- 增强方式主要是别名和自然表达识别
- 不需要先做新的数据模型

## 4. 第二批推荐接入问法

下一批更值得推进的是：

- `哪个技师最能赚`
- `哪个技师最受客人喜欢`
- `谁充了钱还没来过`
- `指名某技师的客人有多少`
- `优惠券用了没`
- `卖出什么副项了`

这批的特点是：

- 业务价值高
- 但部分需要 customer-tech / coupon / market item structure 再收口

## 5. 不应假装支持的问题

目前不建议伪装成已完成的，是那些需要明显实时状态面的问法：

- `现在几个人在上钟`
- `谁现在没事干`
- `现在有客人在等位吗`
- `后台有几张待结账的单`

这类问题如果没有稳定实时数据源，不要让 AI 编故事。

## 6. 推荐推进方式

推荐按三层推进：

1. `别名层`
   只是自然说法变化，直接补到 metric / semantic expansion。
2. `能力层`
   当前 facts 足够，但 query capability 还没正式暴露。
3. `数据层`
   底层事实本身还不完整，先补数据，不先补文案。
