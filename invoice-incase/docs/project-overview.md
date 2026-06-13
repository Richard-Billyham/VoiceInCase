# 项目总览文档

本文档用于记录当前 `invoice_manager` 项目的整体情况，包括项目定位、技术栈、目录结构、运行方式、核心业务、数据库结构、UI 现状、已知问题和后续改造方向。

本文档描述的是当前项目现状，不等同于未来目标架构。数据结构重构方向另见：

[data-structure-improvement.md](./data-structure-improvement.md)

## 1. 项目定位

当前项目是一个基于 Python 和 PyQt6 的本地桌面端发票报销与进度管理系统。

项目核心定位：

```text
本地桌面应用
离线运行
个人使用
发票数据敏感，不依赖云端
管理发票、附件、报销批次、项目归属和统计查询
```

当前系统更接近一个个人离线票据整理和报销跟踪工具，而不是多人协作的企业报销系统。

### 1.1 当前适用场景

适合：

- 个人整理报销发票。
- 按项目归集发票。
- 上传和查看发票附件。
- 将多张发票合并创建报销单。
- 跟踪报销单状态。
- 本地 SQLite 免安装运行。
- MySQL 模式下展示数据库课程设计相关对象，例如表、存储过程、函数和触发器。

不适合：

- 多用户审批流。
- 财务系统级权限控制。
- 云端共享。
- 企业级审计和合规流程。
- 高并发或多人同时操作。

## 2. 当前技术栈

### 2.1 语言和 UI

```text
Python 3
PyQt6
Qt Widgets
QSS 样式表
```

当前 UI 是 PyQt6 Widgets 架构，页面通过 Python 代码构建，不是 QML，也不是 WebView。

目前已经做了初步 UI 改造：

- 样式从代码中抽离到 `ui/styles/app.qss`。
- 增加 QSS 热加载能力。
- 新增 UI sandbox，但目前用户倾向于直接在实际界面上调整。
- 主界面风格正在向米白、低饱和、卡片式工作台方向调整。

### 2.2 数据库

系统支持两种数据库：

```text
MySQL
SQLite
```

默认配置是 MySQL，但本地个人使用更推荐 SQLite。

MySQL 主要用于完整数据库对象展示：

- 表
- 外键
- CHECK
- ENUM
- 存储过程
- 函数
- 触发器

SQLite 用于本地免安装运行：

- 通过 `database/sqlite_schema.sql` 初始化。
- 部分 MySQL 存储过程逻辑由 Python 服务层实现。

### 2.3 OCR 和文件处理

当前依赖：

```text
pytesseract
Pillow
PyMuPDF
opencv-python
```

OCR 处理在：

```text
extensions/ocr_service.py
```

支持：

- PDF 文本提取。
- 扫描 PDF OCR。
- 图片 OCR。
- 发票字段解析。

注意：`pytesseract` 只是 Python 调用层，本机仍需安装 Tesseract OCR 程序和中文语言包 `chi_sim`。

### 2.4 Excel 导出

使用：

```text
openpyxl
```

导出工具在：

```text
ui/export_utils.py
```

支持将表格数据导出为 `.xlsx`，并处理列宽、表头样式、文本列格式等。

## 3. 运行方式

当前建议使用项目内虚拟环境运行，避免 Anaconda base 环境的 PyQt6 DLL 问题。

### 3.1 启动主程序

```powershell
cd E:\Projects\VoiceInCase\invoice_manager
.\.venv\Scripts\python.exe main.py --dev-ui
```

`--dev-ui` 会启用 QSS 热加载。

普通启动：

```powershell
.\.venv\Scripts\python.exe main.py
```

### 3.2 样式文件

全局样式文件：

```text
ui/styles/app.qss
```

修改并保存该文件后，在 `--dev-ui` 模式下样式会自动刷新。

### 3.3 UI sandbox

当前仍保留 UI sandbox：

```powershell
.\.venv\Scripts\python.exe tools\ui_sandbox.py
```

它用于预览组件样式，不连接数据库。但当前实际 UI 调整主要以真实主程序为准。

### 3.4 依赖安装

依赖文件：

```text
requirements.txt
```

当前依赖：

```text
PyQt6
PyMySQL
pytesseract
Pillow
PyMuPDF
openpyxl
opencv-python
```

安装：

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

如果只需要启动 UI，最低需要：

```text
PyQt6
PyMySQL
```

## 4. 目录结构

当前主要目录：

```text
invoice_manager/
  main.py
  config.py
  requirements.txt
  README.md

  database/
    db.py
    admin.py
    sqlite_schema.sql
    sql/
      01_create_tables.sql
      02_sample_data.sql
      03_procedures.sql
      04_functions.sql
      05_triggers.sql
      06_demo_queries.sql

  services/
    project_service.py
    supplier_service.py
    invoice_service.py
    reimbursement_service.py
    file_service.py
    lookup_service.py
    settings_service.py

  ui/
    main_window.py
    project_page.py
    supplier_page.py
    invoice_page.py
    reimbursement_page.py
    statistics_page.py
    settings_page.py
    theme.py
    styles/
      app.qss
    export_utils.py
    table_utils.py
    form_utils.py
    error_utils.py
    refresh_utils.py
    validation_utils.py

  extensions/
    ocr_service.py
    feishu_service.py

  tools/
    reset_database.py
    ui_sandbox.py

  uploads/
    invoices/
    others/

  docs/
    project-overview.md
    data-structure-improvement.md
```

## 5. 入口和启动流程

### 5.1 主入口

入口文件：

```text
main.py
```

主要逻辑：

1. 配置 Windows 下 PyQt6 DLL 搜索路径。
2. 创建 `QApplication`。
3. 设置字体为 `Microsoft YaHei`。
4. 应用固定浅色 palette。
5. 加载 `ui/styles/app.qss`。
6. 创建并显示 `MainWindow`。
7. 如果传入 `--dev-ui`，启用 QSS 热加载。

### 5.2 主窗口

主窗口：

```text
ui/main_window.py
```

当前页面：

```text
项目管理
供应商管理
发票管理
报销单管理
统计查询
系统设置
```

主窗口采用：

```text
左侧导航
右侧内容区
QStackedWidget 页面切换
页面懒加载
```

如果数据库连接失败，默认进入系统设置页。  
如果数据库连接成功，默认进入项目管理页。

## 6. 配置管理

配置文件：

```text
config.py
```

默认数据库配置：

```text
db_type: mysql
host: localhost
port: 3306
user: root
database: invoice_manager
sqlite_path: 空
```

用户保存后的配置路径：

```text
%LOCALAPPDATA%\invoice-manager\config.json
```

SQLite 默认数据库路径：

```text
%LOCALAPPDATA%\invoice-manager\invoice_manager.db
```

当前附件目录仍在项目目录下：

```text
uploads/
```

后续产品化建议改为用户数据目录：

```text
%LOCALAPPDATA%\invoice-manager\uploads
```

## 7. 数据库访问层

数据库封装：

```text
database/db.py
```

核心能力：

- 根据 `DB_CONFIG["db_type"]` 判断 MySQL 或 SQLite。
- MySQL 使用 `pymysql`。
- SQLite 使用标准库 `sqlite3`。
- `CursorAdapter` 把通用 SQL 中的 `%s` 参数占位符转换成 SQLite 的 `?`。
- SQLite 查询结果转换为 dict。
- `db_cursor(commit=False)` 统一处理连接、提交、回滚和关闭。

常用函数：

```text
fetch_all
fetch_one
execute
execute_insert
execute_many
call_procedure
test_connection
```

SQLite 首次连接时，如果 schema 不存在，会自动调用初始化逻辑。

## 8. 当前数据库结构

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

### 8.1 project

项目表。

当前字段包括：

```text
project_id
project_name
budget_amount
start_date
end_date
status
remark
created_at
updated_at
```

注意：根据新的业务理解，`budget_amount` 计划删除或至少在 UI 隐藏。项目未来更适合作为分类和归属，而不是预算控制对象。

### 8.2 supplier

供应商表。

当前字段包括：

```text
supplier_id
supplier_name
tax_no
contact_name
phone
address
created_at
updated_at
```

注意：根据新的业务理解，`supplier` 计划删除。未来发票表可直接保存销售方文本字段，例如：

```text
seller_name
seller_tax_no
```

### 8.3 invoice

发票表。

当前字段包括：

```text
invoice_id
project_id
supplier_id
invoice_code
invoice_number
issue_date
item_name
spec_model
unit
quantity
amount
tax_amount
description
status
created_at
updated_at
```

当前状态：

```text
待报销
报销中
已完成
已作废
```

### 8.4 attachment

附件表。

当前字段包括：

```text
attachment_id
invoice_id
file_name
file_type
file_path
uploaded_at
```

当前附件类型：

```text
发票图片/pdf
其他
```

后续计划增加：

```text
remark
```

长期可考虑通用附件模型，支持发票、报销批次、报销子订单和对账交易。

### 8.5 reimbursement

报销单表，未来建议明确为“报销批次”。

当前字段包括：

```text
reimbursement_id
reimbursement_no
project_id
total_amount
status
apply_time
completed_time
remark
created_at
updated_at
```

当前状态：

```text
待提交
审核中
已完成
已驳回
已取消
```

未来建议批次状态由子订单状态聚合得到。

### 8.6 reimbursement_invoice

报销单和发票的中间表。

当前字段包括：

```text
reimbursement_invoice_id
reimbursement_id
invoice_id
created_at
```

当前问题：

- 只能表达“批次包含哪些发票”。
- 不能表达批次内子订单的独立状态。
- 不能表达部分到账。
- 不能表达异常结项。
- 不能表达同一批次内财务拆分处理。

未来建议引入：

```text
reimbursement_item
```

### 8.7 status_log

报销状态日志表。

当前字段包括：

```text
log_id
reimbursement_id
old_status
new_status
operate_time
remark
```

当前只记录报销批次状态。未来可能需要扩展到子订单状态日志。

## 9. MySQL 数据库对象

MySQL 脚本位于：

```text
database/sql/
```

### 9.1 建表脚本

```text
01_create_tables.sql
```

包含：

- 建库
- 建表
- 主键
- 外键
- 唯一约束
- CHECK
- ENUM

### 9.2 示例数据

```text
02_sample_data.sql
```

用于插入演示项目、供应商、发票等数据。

### 9.3 存储过程

```text
03_procedures.sql
```

包含：

```text
sp_create_reimbursement
sp_update_reimbursement_status
```

`sp_create_reimbursement` 负责：

- 校验项目存在。
- 校验至少选择一张发票。
- 校验发票属于当前项目。
- 校验发票状态为 `待报销`。
- 校验发票有附件。
- 校验发票没有进入有效报销单。
- 创建报销单。
- 插入中间表。
- 更新发票状态为 `报销中`。
- 写入状态日志。

`sp_update_reimbursement_status` 负责：

- 校验报销单存在。
- 校验新状态合法。
- 更新报销单状态。
- 写入状态日志。
- 根据报销单状态同步发票状态。

### 9.4 函数

```text
04_functions.sql
```

当前函数：

```text
fn_project_invoice_total
fn_project_pending_amount
fn_project_reimbursing_amount
fn_project_completed_amount
fn_project_remaining_budget
```

注意：`fn_project_remaining_budget` 与预算字段绑定，未来如果删除预算，需要删除或改造。

### 9.5 触发器

```text
05_triggers.sql
```

当前触发器：

```text
trg_ri_before_insert
trg_ri_after_insert
trg_ri_after_delete
trg_reimbursement_before_update
```

作用：

- 防止发票重复进入有效报销单。
- 插入/删除报销单-发票关联后自动更新报销单总金额。
- 阻止已完成报销单回退到其他状态。

## 10. 服务层

服务层位于：

```text
services/
```

### 10.1 project_service.py

项目业务逻辑：

- 查询项目。
- 搜索项目。
- 创建项目。
- 更新项目。
- 删除项目。
- 计算发票总额和剩余预算。

注意：剩余预算逻辑未来需要随预算删除一起调整。

### 10.2 supplier_service.py

供应商业务逻辑：

- 查询供应商。
- 搜索供应商。
- 创建供应商。
- 更新供应商。
- 删除供应商。

注意：供应商表未来计划删除，对应服务层也应删除或停用。

### 10.3 invoice_service.py

发票业务逻辑：

- 查询发票。
- 搜索发票。
- 按项目查询发票。
- 按状态查询发票。
- 创建发票。
- 更新发票。
- 作废发票。
- 删除发票。
- 查询发票附件。

### 10.4 reimbursement_service.py

报销业务逻辑：

- 查询报销单。
- 查询报销单关联发票。
- 查询状态日志。
- 创建报销单。
- 更新报销单状态。

MySQL 下调用存储过程。  
SQLite 下用 Python 实现对应逻辑。

当前创建报销单规则：

```text
必须至少选择一张发票
发票必须属于同一项目
发票状态必须是 待报销
发票必须有附件
发票不能已经进入有效报销单
```

### 10.5 file_service.py

附件处理：

- 创建上传目录。
- 复制附件到 `uploads/`。
- 新增附件记录。
- 删除附件记录。
- 删除本地附件文件。
- 校验发票附件格式。

当前路径：

```text
uploads/invoices
uploads/others
```

### 10.6 lookup_service.py

提供下拉选项。

当前用于项目和供应商选择。

未来删除 supplier 后，需要改造。

### 10.7 settings_service.py

数据库配置保存：

- 获取当前数据库配置。
- 保存用户数据库配置到本地配置文件。
- 更新运行时 `DB_CONFIG`。

## 11. UI 层

UI 层位于：

```text
ui/
```

当前仍是 PyQt6 Widgets。

### 11.1 main_window.py

主窗口：

- 左侧导航。
- 右侧内容区。
- 页面懒加载。
- 数据库状态显示。
- 刷新当前页/刷新全部。
- 数据库配置变更后重建数据页面。

当前外观已改为：

- 左侧米白侧栏。
- 品牌 `VoiceInCase`，其中 `Voice` 更大。
- 顶部弱化为状态/工具栏。
- 数据库状态显示为轻量连接状态。

### 11.2 project_page.py

项目管理页。

当前功能：

- 搜索项目。
- 新增项目。
- 编辑项目。
- 删除项目。
- 导出 Excel。
- 刷新。
- 项目表格。

当前 UI 已进行工作台化改造：

- 页面标题。
- 轻量搜索工具条。
- 顶部统计卡片。
- 当前项目预算概览。
- 待处理事项。
- 项目预算列表 section。
- 状态胶囊。

注意：由于预算字段未来计划删除，该页面当前的“预算概览”只是过渡状态，后续应改为“项目报销概览”或“项目票据概览”。

### 11.3 supplier_page.py

供应商管理页。

当前功能：

- 搜索供应商。
- 新增供应商。
- 编辑供应商。
- 删除供应商。
- 导出 Excel。

未来计划删除 supplier 后，该页面也应删除或替换为分组管理。

### 11.4 invoice_page.py

发票管理页。

当前功能：

- 搜索发票。
- 按状态筛选。
- 新增发票。
- 导入发票文件。
- OCR 识别。
- 编辑发票。
- 删除发票。
- 导出 Excel。
- 附件管理。

这是后续最重要的页面之一。未来需要适配：

- 删除供应商下拉。
- 增加销售方文本字段。
- 增加分组选择。
- 附件备注。
- OCR 识别结果确认。

### 11.5 reimbursement_page.py

报销单管理页。

当前功能：

- 查看报销单。
- 创建报销单。
- 查看报销单发票明细。
- 更新报销单状态。
- 查看状态日志。

未来需要重点改造：

- 报销批次。
- 报销子订单。
- 子订单状态。
- 分批到账。
- 异常结项。
- 对账同步。

### 11.6 statistics_page.py

统计查询页。

当前基于项目和发票状态做汇总。

未来应改为：

- 发票总额。
- 待提交金额。
- 报销中金额。
- 已到账金额。
- 异常结项金额。
- 按项目统计。
- 按分组统计。
- 按时间统计。

### 11.7 settings_page.py

系统设置页。

当前功能：

- 配置数据库类型。
- 配置 MySQL。
- 配置 SQLite。
- 保存配置。
- 测试连接。
- 初始化数据库。
- 写入演示数据。

未来建议增加：

- OCR 环境检测。
- 数据目录显示。
- 附件目录显示。
- 日志目录显示。
- 备份/恢复。

## 12. OCR 模块

OCR 模块：

```text
extensions/ocr_service.py
```

主要函数：

```text
recognize_invoice_file
parse_invoice_file
parse_invoice_text
```

支持：

- PDF 文本提取。
- 扫描 PDF OCR。
- 图片 OCR。
- 发票代码/号码解析。
- 日期解析。
- 金额解析。
- 税额解析。
- 明细解析。
- 项目/供应商名称匹配。

未来需要改造：

- 删除供应商匹配，改为销售方文本。
- 增加分组匹配或人工选择。
- OCR 结果进入确认流程，不直接保存。
- 支持附件备注。

## 13. 文件和附件

当前附件目录：

```text
uploads/invoices
uploads/others
```

附件上传逻辑：

1. 检查源文件存在。
2. 校验附件类型。
3. 复制到 uploads 目录。
4. 文件名加短 UUID 避免冲突。
5. 数据库保存相对路径。

删除逻辑：

- 删除附件记录。
- 删除本地文件。
- 删除前校验文件路径在 `UPLOAD_ROOT` 下，避免误删项目外文件。

未来建议：

- 附件增加 `remark`。
- 附件增加 `file_hash`。
- 附件目录迁移到用户数据目录。
- 附件支持绑定报销批次、子订单和对账交易。

## 14. 当前 UI 风格方向

当前 UI 正在参考用户提供的 InCase 风格进行调整。

目标风格：

```text
米白背景
低饱和棕色/绿色
左侧轻量侧栏
清晰品牌区
卡片式工作台
细边框
圆角
信息密度适中
避免传统 Qt 默认控件感
```

当前已完成的 UI 调整：

- 样式从代码抽到 `app.qss`。
- 主窗口支持 QSS 热加载。
- 左侧品牌改为 `VoiceInCase`。
- 顶部大标题已去除。
- 数据库状态弱化。
- 项目页工具条轻量化。
- 项目页统计卡片轻量化。
- 项目页增加概览面板。
- 项目页增加待处理事项面板。
- 项目页表格增加 section、记录数和状态胶囊。

当前仍需继续调整：

- 项目页去预算化。
- 发票页适配新风格。
- 报销页适配新风格。
- 设置页适配新风格。
- 删除/替换供应商页。
- 增加分组管理页。
- 增加对账页。

## 15. 当前已知问题

### 15.1 数据结构问题

- `supplier` 表价值不高，计划删除。
- `project.budget_amount` 价值不高，计划删除或隐藏。
- `reimbursement_invoice` 不能表达子订单状态。
- 当前缺少对账交易表。
- 当前缺少分组表。
- 当前缺少异常结项逻辑。
- 附件缺少备注。
- 附件缺少 hash，不能识别重复上传。

### 15.2 UI 问题

- 只有项目页正在重构，其他页面仍偏旧。
- 当前项目页仍存在预算相关展示，后续要改掉。
- Qt 内置图标风格不统一，后续可能需要换自定义图标。
- 部分按钮只是视觉入口，尚未接真实跳转。
- 当前样式依赖 QSS，复杂 UI 仍受 Qt Widgets 限制。

### 15.3 工程问题

- 缺少自动化测试。
- 缺少数据库迁移机制。
- 缺少日志系统。
- 缺少打包脚本。
- README 编码和内容需要整理。
- 缺少正式用户手册。

### 15.4 部署问题

- 当前附件存储在项目目录下，不适合长期用户数据。
- OCR 依赖本机 Tesseract，安装和检测流程不完整。
- Anaconda base 环境下 PyQt6 可能出现 DLL 导入问题，当前通过项目 `.venv` 规避。

## 16. 后续数据结构改造方向

见：

[data-structure-improvement.md](./data-structure-improvement.md)

核心方向：

```text
删除 supplier
删除或隐藏预算字段
attachment 增加 remark
新增 expense_group
新增 reimbursement_item
新增 reconciliation_transaction
新增 reconciliation_match
支持异常结项
批次状态由子订单状态聚合
对账完成后同步子订单和批次状态
```

## 17. 建议的后续实施顺序

### 17.1 设计确认阶段

先确认：

- 是否删除 supplier。
- 是否删除 budget_amount。
- 分组模型怎么定义。
- 报销子订单是否允许一张发票拆多条。
- 报销子订单是否允许多张发票合并一条。
- 异常结项是否算完成。
- 对账是否支持退款、负数、冲销。

### 17.2 数据库迁移阶段

建议顺序：

```text
1. attachment 增加 remark
2. invoice 增加 seller_name、seller_tax_no
3. 新增 expense_group
4. invoice 增加 group_id
5. UI 隐藏预算字段
6. 删除 supplier 相关 UI 和逻辑
7. 删除 supplier 表和 invoice.supplier_id
8. 删除 project.budget_amount
9. 新增 reimbursement_item
10. 新增 reconciliation_transaction
11. 新增 reconciliation_match
```

### 17.3 UI 改造阶段

建议顺序：

```text
1. 完成项目页去预算化
2. 改造发票页
3. 新增分组管理页
4. 改造报销页为批次/子订单模式
5. 新增对账页
6. 改造统计页
7. 改造设置页
```

### 17.4 工程质量阶段

建议补：

```text
pytest 测试
数据库迁移脚本
日志系统
备份/恢复
打包脚本
用户手册
```

## 18. 当前结论

当前项目已经有一个可运行的 PyQt6 桌面应用基础，适合继续作为个人离线发票管理工具演进。

但当前业务模型仍偏“课程设计式发票报销管理”，下一阶段需要向更真实的个人报销跟踪模型调整：

```text
项目 = 归属/分类
分组 = 负责人/场景
发票 = 票据来源
报销批次 = 一次提交
报销子订单 = 实际被财务处理的最小单元
对账交易 = 实际到账流水
对账匹配 = 交易和批次/子订单的关系
异常结项 = 不再继续处理的结束状态
```

UI 方面，当前已开始从传统 Qt CRUD 界面转向米白卡片式工作台风格。后续需要在数据结构调整后继续统一发票页、报销页、统计页和设置页。

