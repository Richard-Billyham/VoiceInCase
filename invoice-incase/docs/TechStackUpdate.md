你现在接手一个已有的个人桌面发票管理系统。原项目是数据库课程大作业，技术栈主要是 PyQt / Qt Widgets / Python / SQLite。现在需要将其升级为现代桌面应用，并纳入个人软件生态。

请阅读当前项目中的 PDR、SRS、README 和代码，参考现有 PDR / SRS 的文档风格、章节结构、表达粒度和命名习惯，对文档中的技术路线和实现方案进行更新。

## 目标

将旧技术栈：

* PyQt / Qt Widgets
* Python GUI 逻辑
* 传统桌面控件式 UI
* 窗口 / 对话框 / 表格控件堆叠结构

替换为新技术栈：

* Tauri 2
* React
* TypeScript
* Vite
* SQLite
* Rust 后端命令层

系统仍然是本地桌面应用，不是网站，也不需要服务器。

## 修改原则

1. 保留原有业务目标、用户场景、功能需求和数据对象。
2. 不要推翻重写 PDR / SRS，只修改和技术栈、系统架构、实现方案相关的内容。
3. 所有文档风格要尽量贴近原 PDR / SRS。
4. 删除或替换 PyQt、Qt Widgets、QMainWindow、QDialog、QTableWidget、QSS 等旧技术描述。
5. 不要为了炫技引入复杂中间件。
6. 不要写死本机路径、绝对路径或用户环境。
7. 不清楚的地方用 TODO / 待确认 标注，不要编造。

## 新架构方向

请将系统描述为：

```text
Tauri 负责桌面应用壳、本地能力和系统集成。
React + TypeScript 负责界面、交互和组件化。
Rust 后端命令负责数据库访问、文件操作和本地业务逻辑。
SQLite 负责本地数据持久化。
```

前端负责：

* 页面布局
* 表格
* 表单
* 搜索
* 筛选
* 弹窗
* 详情面板
* 状态展示
* 主题样式

后端负责：

* SQLite 读写
* 数据校验
* 附件导入、复制、打开、删除
* 数据备份与恢复
* 旧数据库迁移
* 后续 OCR / PDF / 导出功能预留

## 核心业务对象

请保留并整理这些对象：

* 发票 Invoice
* 订单 Order
* 附件 Attachment
* 标签 Tag
* 分类 Category
* 供应商 / 客户 Counterparty
* 状态 Status
* 系统设置 Settings

如果原文档已有字段定义，优先沿用原含义。

## 页面结构建议

将旧 PyQt 窗口式结构改为现代桌面 CRUD 应用结构：

```text
总览 Dashboard
发票管理 Invoice
订单管理 Order
附件管理 Attachment
统计分析 Statistics
系统设置 Settings
```

典型布局：

```text
左侧导航栏
顶部工具栏
中间数据表格
右侧详情面板
新增 / 编辑弹窗
搜索与筛选区域
```

## 视觉风格要求

不要保留 Qt 默认控件风格。

界面方向：

* 暗绿色主色调
* 直角边框
* 深色直角阴影
* 现代化复古管理系统风格
* 强调表格可读性
* 强调状态标签和信息层级
* 看起来像桌面应用，而不是普通网页后台

## 工程结构建议

可参考以下结构，但不要机械套用：

```text
project-root/
├─ docs/
├─ src/
│  ├─ app/
│  ├─ pages/
│  ├─ components/
│  ├─ services/
│  ├─ types/
│  └─ styles/
├─ src-tauri/
│  ├─ src/
│  │  ├─ main.rs
│  │  ├─ db.rs
│  │  ├─ invoice.rs
│  │  ├─ order.rs
│  │  ├─ attachment.rs
│  │  └─ commands.rs
│  └─ tauri.conf.json
├─ package.json
└─ vite.config.ts
```

## 新旧技术对照

```text
PyQt / Qt Widgets        -> Tauri 2 + React + TypeScript
QMainWindow              -> React App Layout
QTableWidget             -> React Table Component
QDialog                  -> Modal / Drawer
QSS                      -> CSS / CSS Variables
Python GUI Event Handler -> React Event + Tauri Command
Python SQLite Logic      -> Rust SQLite Service
本地路径直接操作          -> Tauri 文件系统能力
```

## 迁移策略

请在文档中补充迁移思路：

```text
第一阶段：冻结旧 PyQt 版本，作为功能参考和数据来源。
第二阶段：梳理旧数据库结构和核心业务对象。
第三阶段：建立 Tauri + React 新项目骨架。
第四阶段：实现发票、订单、附件的基础 CRUD。
第五阶段：迁移旧数据，并补充导入导出、备份、统计等扩展功能。
```

## 输出要求

请输出：

1. 需要修改的章节列表。
2. 修改后的 PDR / SRS 相关内容。
3. 新旧技术栈对照表。
4. 新架构下的模块划分。
5. 迁移计划。
6. 后续开发任务清单。

最终目标是：把这个项目从 PyQt 数据库大作业升级为一个结构清晰、UI 现代、技术栈轻量、适合长期维护的本地桌面发票管理系统。
