# 数据结构改进方案草案

本文档用于梳理当前发票报销系统的数据结构改进方向。此文档只做设计分析，不直接修改数据库和代码。后续确认方案后，再拆分为数据库迁移、服务层改造和 UI 改造任务。

## 1. 背景和目标

当前系统的数据模型以项目、供应商、发票、附件、报销单、报销单-发票关联、状态日志为核心。这个模型可以支撑基础的“按项目录入发票并创建报销单”的流程，但在真实报销场景里会遇到几个问题：

- 供应商信息在当前个人离线使用场景下价值不高，维护成本高于收益。
- 项目预算在当前业务里也比较鸡肋，真实流程更关心发票、报销批次、子订单和到账对账，而不是预算控制。
- 附件除了文件路径外，还需要人工备注，例如“银行到账截图”“发票原件”“聊天记录截图”等。
- 一个报销批次中包含多个子订单/子条目，财务可能拆分处理，导致批次内不同子订单状态不一致。
- 一个报销批次可能分批到账，不能只用单一批次状态表达整个流程。
- 需要对账表单，用银行交易或到账截图去匹配一个或多个报销批次，或者匹配批次内的一个或多个子订单。
- 部分批次或子订单可能因为个人原因、财务原因、材料缺失等无法继续报销，需要异常结项。
- 发票或报销条目需要按“交给谁/属于哪个组/哪个场景”分组，例如比赛发票交给 A，实验室采购交给 B。

改造目标：

- 简化无用实体和字段，降低录入成本。
- 明确“报销批次”和“批次内子订单”的状态关系。
- 支持分批到账和部分对账。
- 支持异常结项，不强行要求每笔都完成报销。
- 支持按分组/负责人/场景归集票据。
- 保持个人离线桌面软件的数据结构清晰可维护。

## 2. 当前结构简述

当前核心表：

```text
project
supplier
invoice
attachment
reimbursement
reimbursement_invoice
status_log
```

主要关系：

```text
project 1 - n invoice
supplier 1 - n invoice
invoice 1 - n attachment
project 1 - n reimbursement
reimbursement n - n invoice，通过 reimbursement_invoice 关联
reimbursement 1 - n status_log
```

当前模型中，`reimbursement` 更像“报销批次”，`invoice` 更像“报销子项的来源数据”。但是 `reimbursement_invoice` 只是关联表，没有自己的金额、状态、异常、到账、备注等字段。因此无法表达“同一个批次里的某几张发票先到账，另外几张被拆出去或异常结项”。

### 2.1 预算字段处理建议

当前 `project.budget_amount` 以及由它衍生出来的“剩余预算”“预算使用率”等展示，在新的业务理解下价值不高。

原因：

- 个人离线发票管理更关心“哪些发票提交了、哪些到账了、哪些异常结项了”。
- 预算金额往往不准确，也不一定有人维护。
- 对账流程关注的是实际银行交易金额与报销批次/子订单金额的匹配。
- 分组、负责人、场景归集比预算更贴近实际使用。

建议目标：

```text
删除 project.budget_amount
删除项目页中的预算、剩余预算、预算使用率
删除或改造预算相关统计函数
项目页改为展示发票/报销/到账/异常相关汇总
```

如果担心一次性删除风险较高，可以分两步：

```text
第一步：UI 隐藏预算字段，不再要求维护
第二步：数据库迁移时物理删除 budget_amount
```

## 3. 关键业务概念重新定义

建议把系统里的业务对象重新定义为以下几个层次：

### 3.1 项目 project

项目仍然保留，用于表示活动、课题、比赛、实验室采购等上层归属。

例如：

```text
办公用品采购
设备维护项目
某某比赛
某实验室采购
```

### 3.2 分组 group

新增分组概念，用于表示发票/报销材料的归集方式或负责人。

例如：

```text
A 负责
B 负责
比赛材料
实验室材料
导师待确认
个人垫付
```

分组不是预算项目的替代品。它更像“材料交给谁/走哪条线/属于哪个归集场景”。

由于预算字段计划删除，项目不再承担预算控制职责。项目主要承担分类、归属、查询和统计维度职责。

### 3.3 发票 invoice

发票仍然表示票据本身。建议移除 supplier 依赖后，发票上保留必要的销售方文本字段即可。

例如：

```text
seller_name
seller_tax_no
```

这样既不需要维护供应商主数据，又能保留发票 OCR 或手动录入得到的销方信息。

### 3.4 报销批次 reimbursement

`reimbursement` 建议明确命名为“报销批次”。

一个报销批次表示用户提交给财务的一组报销材料。用户视角下它是“一次提交”，但财务可能拆分处理。

### 3.5 报销子订单 reimbursement_item

建议新增 `reimbursement_item` 表，表示报销批次里的子订单/子条目。

一个子订单可以来源于一张发票，也可以来源于一张发票的一部分，或者是非发票类费用条目。

它需要有自己的：

- 金额
- 状态
- 异常原因
- 到账金额
- 对账状态
- 附件/备注

这样才能表达：

```text
一个批次里有 5 个子订单：
1、2 已到账
3 正在审核
4 被财务拆到另一个批次
5 因材料缺失异常结项
```

### 3.6 对账交易 reconciliation_transaction

新增对账交易表，用来记录银行到账、转账、退款、冲销等实际资金流水。

关键字段：

- 金额
- 时间
- 分类
- 附件
- 备注

### 3.7 对账匹配 reconciliation_match

新增对账匹配表，用于把一笔交易和一个或多个报销批次/子订单关联起来。

核心场景：

```text
选择一笔银行到账交易
勾选一个或多个报销批次
或勾选一个或多个报销批次里的子订单
保存对账
系统自动同步相关子订单和批次状态
```

## 4. supplier 表处理建议

### 4.1 是否删除 supplier

根据你的反馈，`supplier` 在当前个人离线使用场景里“没什么用”，可以考虑删除独立供应商表。

当前 supplier 的主要问题：

- 每次录入发票都要维护供应商，增加录入成本。
- 对个人报销而言，供应商很少需要作为独立主数据管理。
- OCR 可以直接识别销售方名称和税号，不一定需要进入供应商库。
- 供应商去重、联系人、电话、地址等字段对当前业务价值不高。

### 4.2 替代方案

删除 supplier 表后，建议在 `invoice` 表中直接保留销方文本字段：

```text
seller_name       销售方名称
seller_tax_no     销售方税号
```

可选字段：

```text
buyer_name        购买方名称
buyer_tax_no      购买方税号
```

这样可以满足发票识别和查询需要，同时避免维护供应商主表。

### 4.3 迁移影响

需要处理：

- 删除 `invoice.supplier_id` 外键。
- 删除 `supplier` 表。
- 发票服务层和 UI 删除供应商下拉框。
- OCR 识别出的 `seller_name` 直接写入 invoice。
- 老数据迁移时，把 `supplier.supplier_name` 和 `supplier.tax_no` 回填到 `invoice.seller_name`、`invoice.seller_tax_no`。

## 5. attachment 表改进

当前附件表：

```text
attachment_id
invoice_id
file_name
file_type
file_path
uploaded_at
```

建议增加：

```text
remark TEXT
```

用途：

- 标注附件用途。
- 解释截图来源。
- 记录人工说明。

例如：

```text
发票原件
银行到账截图
财务系统截图
微信支付截图
补充说明材料
```

进一步建议：附件不应只绑定 invoice。未来可能需要绑定到：

- 发票
- 报销批次
- 报销子订单
- 对账交易

因此中长期可以考虑把附件改为通用附件模型：

```text
attachment
  attachment_id
  owner_type       invoice / reimbursement / reimbursement_item / reconciliation_transaction
  owner_id
  file_name
  file_type
  file_path
  remark
  uploaded_at
```

短期低风险方案：

- 保留 `invoice_id`。
- 先增加 `remark`。
- 对账附件另建 `reconciliation_attachment` 或后续再做通用附件。

长期推荐方案：

- 做通用附件表。

## 6. 报销状态模型改进

### 6.1 当前问题

当前报销批次 `reimbursement.status` 是单一状态：

```text
待提交
审核中
已完成
已驳回
已取消
```

但真实场景里，一个批次里可能有多个子订单，且财务可能拆分处理，导致批次状态无法准确表达内部进度。

例如：

```text
批次 R001：
  子订单 1：已到账
  子订单 2：审核中
  子订单 3：异常结项
```

此时整个批次既不能简单叫“已完成”，也不能简单叫“审核中”。

### 6.2 建议新增 reimbursement_item

建议新增：

```text
reimbursement_item
```

字段草案：

```text
item_id
reimbursement_id
invoice_id
project_id
group_id
item_name
amount
reconciled_amount
status
exception_reason
exception_time
remark
created_at
updated_at
```

字段说明：

| 字段 | 说明 |
|---|---|
| item_id | 子订单 ID |
| reimbursement_id | 所属报销批次 |
| invoice_id | 来源发票，可为空 |
| project_id | 所属项目，冗余便于查询 |
| group_id | 所属分组 |
| item_name | 子订单名称 |
| amount | 应报销金额 |
| reconciled_amount | 已对账金额 |
| status | 子订单状态 |
| exception_reason | 异常结项原因 |
| exception_time | 异常结项时间 |
| remark | 备注 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

### 6.3 子订单状态建议

建议 `reimbursement_item.status` 使用：

```text
待提交
已提交
审核中
待补充
部分到账
已到账
已驳回
异常结项
已取消
```

说明：

| 状态 | 含义 |
|---|---|
| 待提交 | 已创建但未正式提交 |
| 已提交 | 已交给财务或负责人 |
| 审核中 | 财务处理中 |
| 待补充 | 需要补材料或补信息 |
| 部分到账 | 已收到部分金额 |
| 已到账 | 金额已全部到账 |
| 已驳回 | 财务明确拒绝 |
| 异常结项 | 因特殊原因不再继续报销 |
| 已取消 | 用户主动取消 |

### 6.4 批次状态建议

`reimbursement.status` 不再完全由用户直接改，而是可以由子订单状态聚合得到。

建议批次状态：

```text
待提交
已提交
处理中
部分到账
已完成
需处理
异常结项
已取消
```

### 6.5 子订单状态到批次状态的聚合规则

推荐规则：

```text
如果所有子订单都是 已取消：
  批次 = 已取消

如果所有子订单都是 异常结项：
  批次 = 异常结项

如果所有有效子订单都是 已到账 或 异常结项：
  批次 = 已完成

如果至少一个子订单是 部分到账 或 已到账，但还有未完成子订单：
  批次 = 部分到账

如果任意子订单是 待补充 或 已驳回：
  批次 = 需处理

如果任意子订单是 审核中 或 已提交：
  批次 = 处理中

否则：
  批次 = 待提交
```

这里的“有效子订单”可以排除 `已取消`，但是否排除 `异常结项` 需要根据业务定义决定。

建议：

- `异常结项` 表示这个子订单不再继续，不阻塞批次完成。
- 但批次中如果所有子订单都是异常结项，则批次状态为 `异常结项`，而不是 `已完成`。

## 7. 对账表单设计

### 7.1 新增 reconciliation_transaction

用于记录实际资金流水或对账单。

字段草案：

```text
transaction_id
transaction_no
amount
transaction_time
category
direction
status
remark
created_at
updated_at
```

字段说明：

| 字段 | 说明 |
|---|---|
| transaction_id | 交易 ID |
| transaction_no | 交易编号，可为空 |
| amount | 金额 |
| transaction_time | 到账/付款时间 |
| category | 分类 |
| direction | 收入/支出/退款/冲销 |
| status | 待对账/部分对账/已对账/异常 |
| remark | 备注 |

分类建议：

```text
报销到账
退款
个人垫付
补差
其他
```

方向建议：

```text
收入
支出
退款
冲销
```

状态建议：

```text
待对账
部分对账
已对账
异常
```

### 7.2 对账附件

对账交易通常需要银行截图、财务系统截图等附件。

短期方案：

```text
reconciliation_attachment
  attachment_id
  transaction_id
  file_name
  file_type
  file_path
  remark
  uploaded_at
```

长期方案：

使用通用 `attachment` 表，通过 `owner_type='reconciliation_transaction'` 关联。

### 7.3 新增 reconciliation_match

用于记录交易和报销批次/子订单的匹配关系。

字段草案：

```text
match_id
transaction_id
reimbursement_id
item_id
matched_amount
remark
created_at
```

字段说明：

| 字段 | 说明 |
|---|---|
| match_id | 匹配 ID |
| transaction_id | 交易 ID |
| reimbursement_id | 匹配的报销批次，可为空 |
| item_id | 匹配的报销子订单，可为空 |
| matched_amount | 本次匹配金额 |
| remark | 备注 |

约束建议：

- `transaction_id` 必填。
- `reimbursement_id` 和 `item_id` 至少填一个。
- 如果填了 `item_id`，可以通过 item 找到 reimbursement。
- `matched_amount > 0`。
- 同一交易可以匹配多个子订单。
- 同一子订单可以被多笔交易部分对账。

### 7.4 对账流程

业务流程：

```text
1. 新建一笔对账交易
   填金额、时间、分类、附件、备注。

2. 选择这笔交易

3. 勾选一个或多个报销批次
   或展开批次后勾选一个或多个子订单。

4. 输入或自动分摊 matched_amount

5. 保存对账

6. 系统更新子订单 reconciled_amount

7. 根据 reconciled_amount 和 amount 更新子订单状态

8. 根据所有子订单状态聚合更新报销批次状态

9. 更新交易状态：待对账/部分对账/已对账
```

### 7.5 对账状态同步规则

子订单：

```text
如果 reconciled_amount = 0:
  保持原状态

如果 0 < reconciled_amount < amount:
  状态 = 部分到账

如果 reconciled_amount >= amount:
  状态 = 已到账
```

交易：

```text
matched_total = 该交易所有 matched_amount 之和

如果 matched_total = 0:
  待对账

如果 matched_total < transaction.amount:
  部分对账

如果 matched_total = transaction.amount:
  已对账

如果 matched_total > transaction.amount:
  异常
```

批次：

```text
每次子订单状态变化后，重新聚合 reimbursement.status。
```

## 8. 异常结项设计

### 8.1 需求

有些批次或子订单因为个人或财务问题无法继续报销，例如：

```text
发票信息错误
缺少材料
超过报销期限
财务拒绝
项目/分组规则不允许
个人放弃
重复提交
```

这类情况不应该一直停留在“待补充/审核中”，需要一个明确的结束状态。

### 8.2 子订单异常结项

建议在 `reimbursement_item` 上支持：

```text
status = 异常结项
exception_reason
exception_time
remark
```

异常原因建议可选枚举：

```text
材料缺失
发票错误
超期
财务拒绝
重复提交
个人放弃
其他
```

### 8.3 批次异常结项

批次可以整体异常结项，但建议仍然通过子订单状态聚合。

例如：

```text
如果一个批次下所有子订单都是 异常结项：
  批次 = 异常结项

如果部分子订单已到账，部分异常结项：
  批次 = 已完成
  但完成说明中应体现部分异常结项
```

是否允许“部分到账 + 部分异常”显示为 `已完成`，需要你确认。另一种方案是新增：

```text
部分完成
```

但状态太多会增加 UI 复杂度。

## 9. 分组维护设计

### 9.1 新增 expense_group

建议新增分组表：

```text
expense_group
  group_id
  group_name
  owner_name
  category
  color
  remark
  is_active
  created_at
  updated_at
```

字段说明：

| 字段 | 说明 |
|---|---|
| group_id | 分组 ID |
| group_name | 分组名称 |
| owner_name | 负责人/交接人 |
| category | 分组类型 |
| color | UI 展示颜色 |
| remark | 备注 |
| is_active | 是否启用 |

示例：

```text
比赛材料 / A / 比赛
实验室采购 / B / 实验室
办公用品 / 自己 / 日常
导师待确认 / 老师 / 待确认
```

### 9.2 分组关联位置

建议在以下表增加 `group_id`：

```text
invoice.group_id
reimbursement.group_id
reimbursement_item.group_id
```

短期也可以只加在 `invoice` 和 `reimbursement_item` 上。

推荐：

- `invoice.group_id`：发票归属哪个分组。
- `reimbursement_item.group_id`：子订单实际交给谁/走哪条线。
- `reimbursement.group_id`：批次默认分组，可为空。

当从发票创建报销子订单时：

```text
reimbursement_item.group_id 默认继承 invoice.group_id
```

## 10. 建议的新结构总览

推荐目标结构：

```text
project
expense_group
invoice
attachment
reimbursement
reimbursement_item
reimbursement_item_invoice   可选
reimbursement_status_log
reconciliation_transaction
reconciliation_match
```

`project` 建议简化为：

```text
project
  project_id
  project_name
  start_date
  end_date
  status
  remark
  created_at
  updated_at
```

不再包含：

```text
budget_amount
```

项目相关统计改由发票、报销子订单和对账交易动态汇总得到。

如果保留一张发票对应一个报销子订单，可不需要 `reimbursement_item_invoice`。

如果未来需要“一张发票拆成多个子订单”或“多个发票合成一个子订单”，建议增加：

```text
reimbursement_item_invoice
  id
  item_id
  invoice_id
  amount
```

这样模型更灵活。

## 11. 推荐迁移路径

### 阶段 1：低风险字段调整

先做不改变核心关系的调整：

```text
1. attachment 增加 remark
2. invoice 增加 seller_name、seller_tax_no
3. 新增 expense_group
4. invoice 增加 group_id
5. UI 隐藏 project.budget_amount，不再维护预算
```

### 阶段 2：移除 supplier

```text
1. 把 supplier 数据回填到 invoice.seller_name、invoice.seller_tax_no
2. 修改发票 UI，删除供应商下拉框
3. 修改 OCR 写入逻辑
4. 删除 invoice.supplier_id 外键
5. 删除 supplier 表
```

### 阶段 3：移除预算字段

```text
1. 移除项目新增/编辑中的预算输入
2. 移除项目列表中的预算、剩余预算、预算使用率
3. 项目统计改为按发票金额、报销子订单金额、到账金额、异常结项金额汇总
4. 删除 project.budget_amount
5. 删除 MySQL/SQLite 中预算相关 CHECK
6. 删除 fn_project_remaining_budget，或改造成待到账/已到账统计函数
```

如果希望降低风险，可以先只隐藏 UI，不立刻删除数据库字段。

### 阶段 4：引入 reimbursement_item

```text
1. 新增 reimbursement_item
2. 从旧 reimbursement_invoice 迁移数据到 reimbursement_item
3. 服务层改成创建批次时生成子订单
4. 报销状态从子订单聚合
5. 逐步废弃 reimbursement_invoice 或改造成 item-invoice 关联表
```

### 阶段 5：引入对账

```text
1. 新增 reconciliation_transaction
2. 新增 reconciliation_match
3. 新增对账附件能力
4. 做对账 UI
5. 保存对账后同步子订单和批次状态
```

### 阶段 6：异常结项和日志增强

```text
1. 子订单支持异常结项
2. 批次支持异常聚合
3. 状态日志从只记录 reimbursement 扩展到记录 reimbursement_item
4. 可选新增 operation_log
```

## 12. 需要你确认的问题

后续动数据库前，需要确认这些设计点：

1. 是否完全删除 supplier 表，还是隐藏 UI 但保留表？
2. 发票是否需要保留销售方名称和税号？
3. 一个发票是否可能拆成多个报销子订单？
4. 一个报销子订单是否可能由多张发票组成？
5. `异常结项` 是否算作批次完成的一种？
6. 部分到账 + 部分异常时，批次状态显示为 `已完成` 还是 `部分完成`？
7. 对账交易金额是否允许超过匹配金额？
8. 对账是否需要支持负数、退款、冲销？
9. 分组是按负责人为主，还是按场景为主？
10. 分组是否需要层级，例如“比赛 > A”？
11. 是否确认最终删除 `project.budget_amount`，而不是仅在 UI 中隐藏？
12. 项目页未来是否改为展示“发票/报销/到账/异常”汇总，而非预算概览？

## 13. 初步建议

基于个人离线软件和当前项目规模，建议采用以下原则：

- 删除 supplier，降低维护成本。
- 删除或至少隐藏预算字段，避免维护无用数据。
- 发票表保留销售方文本字段，不做供应商主数据。
- 引入 `expense_group`，用于负责人/场景分组。
- 引入 `reimbursement_item`，把状态下沉到子订单。
- 批次状态由子订单聚合，不再完全手动维护。
- 引入对账交易和对账匹配表，支持一笔交易匹配多个批次或子订单。
- 支持异常结项，并让异常结项不阻塞其他子订单完成。
- 附件最终建议做通用附件，但可以先只给 attachment 增加 remark。
