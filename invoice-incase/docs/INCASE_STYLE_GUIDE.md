# InCase 样式风格提取与桌面复用指南

本文档基于对 `frontend/src` 下全部 44 个 CSS/CSS Modules 文件，以及样式入口、主题上下文、图标封装和前端规范文档的浏览整理。目标是帮助新的桌面应用复用 InCase 的视觉语言，而不是简单复制网页 CSS。

## 1. 总体气质

InCase 当前主风格可以概括为：

**木质收纳 / 牛皮纸盒 / 半扁平积木感 / Mobile First / 工具型库存系统。**

它不是常见的蓝色 SaaS，也不是纯 Material Design。关键气质来自：

- 暖米色应用底、白色内容面、胡桃木主色、牛皮纸边框。
- 方中带圆的 4/8/12px 圆角体系。
- 几乎不用柔雾大阴影，主要使用 `0 3px 0`、`0 4px 0`、`4px 4px 0` 这类硬阴影模拟实体厚度。
- 卡片、按钮、弹窗都像可以按下去的“木块/纸盒”。
- 用虚线分割、粗边框、等宽数字、细小标签强化“实验室收纳管理”的工具感。
- 动效克制，常见为 0.1s 下沉、0.2s 弹出、0.3s 淡入。

## 2. 样式入口与优先级

实际正在使用的主样式入口：

- `frontend/src/index.css`
- `frontend/src/styles/scrollbar.css`
- 各组件/页面的 `*.module.css`

入口关系：

- `frontend/src/main.jsx` 引入 `./index.css` 和 `./styles/scrollbar.css`，并包裹 `ThemeProvider`。
- `frontend/src/App.jsx` 也引入 `./index.css`。
- `frontend/src/context/ThemeContext.jsx` 通过 `document.documentElement` 上的 `data-theme="dark"` 切换暗色主题。

注意：

- `frontend/src/assets/styles/variables.css` 和 `frontend/src/assets/styles/index.css` 是较旧的蓝色/工业橙变量体系，当前主应用没有从 `main.jsx` 或 `App.jsx` 直接使用它们。桌面复用时建议以 `frontend/src/index.css` 为准。
- `README.md` 中明确要求 CSS Modules、CSS Variables、Mobile First，颜色/圆角/字体应优先使用 `src/index.css` 中变量。

## 3. 设计 Token

### 3.1 主色板

| Token | 浅色值 | 用途 |
| --- | --- | --- |
| `--color-primary` | `#5D4037` | 胡桃木主色，核心按钮、高亮、主图标、强调边框 |
| `--color-primary-dark` | `#3E2723` | 深咖啡，按钮硬阴影/按下厚度 |
| `--color-accent` | `#8D6E63` | 次级暖灰褐强调 |
| `--color-border` | `#D7CCC8` | 牛皮纸分割线、普通边框、浅硬阴影 |
| `--bg-app` | `#F5F2EB` | 应用底色，亚麻/纸张感 |
| `--bg-surface` | `#FFFFFF` | 卡片、弹窗、输入框内容面 |
| `--bg-surface-hover` | `#FDFCF8` | 浅暖灰 hover 背景 |
| `--text-main` | `#3E342E` | 主文字，比纯黑更柔和 |
| `--text-secondary` | `#796B63` | 次级文字 |
| `--text-tertiary` | `#BCAAA4` | 占位符、弱提示、默认 nav 图标 |
| `--text-inverse` | `#FFFFFF` | 深色按钮上的文字 |

### 3.2 语义色

| Token | 浅色值 | 用途 |
| --- | --- | --- |
| `--color-error` | `#C62828` | 错误、危险操作 |
| `--color-error-shadow` | `#8E1D1D` | 危险按钮硬阴影 |
| `--color-success` | `#558B2F` | 成功、绑定、通过 |
| `--color-warning` | `#F9A825` | 警告、评分星标 |

### 3.3 输入控件专用

| Token | 浅色值 | 用途 |
| --- | --- | --- |
| `--border-input` | `#A1887F` | 输入框/步进器/文件上传边框 |
| `--border-input-focus` | `var(--color-primary)` | 聚焦边框 |
| `--bg-input` | `#FFFFFF` | 输入背景 |
| `--bg-input-muted` | `#EFEBE9` | 上传框、开关轨道、辅助控件底色 |

### 3.4 暗色主题

暗色主题通过 `[data-theme='dark']` 覆盖变量，而不是为组件单独写暗色样式。桌面应用也应采用同样的“变量切换”方式。

| Token | 暗色值 | 说明 |
| --- | --- | --- |
| `--color-primary` | `#A1887F` | 深底上提高可读性的浅胡桃 |
| `--color-primary-dark` | `#8D6E63` | 暗色按钮厚度 |
| `--color-border` | `#4E342E` | 深咖啡分割线 |
| `--bg-app` | `#1E1B1A` | 接近黑的烧杉木底色 |
| `--bg-surface` | `#2C2624` | 深色木板 |
| `--bg-surface-hover` | `#362E2B` | 深色 hover |
| `--text-main` | `#EFEBE9` | 浅米灰主文字 |
| `--text-secondary` | `#D7CCC8` | 暖灰次级文字 |
| `--text-tertiary` | `#A1887F` | 弱提示 |
| `--text-inverse` | `#1E1B1A` | 浅主色按钮文字 |
| `--bg-input` | `#25201E` | 深色凹槽 |
| `--bg-input-muted` | `#3E2723` | 深色辅助底 |

## 4. 几何与阴影

### 4.1 圆角

```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 12px;
```

使用规则：

- 小标签、网格单元、关闭按钮：`4px`。
- 输入框、普通按钮、列表卡片：`8px`。
- 弹窗、仪表盘卡片、大模块、图片容器：`12px`。
- 除头像、开关圆钮、部分 FAB 外，尽量避免超大胶囊圆角。项目里也有注释明确把 `999px` 胶囊改回系统圆角。

### 4.2 硬阴影

```css
--shadow-card: 0 3px 0 #D7CCC8;
--shadow-btn: 0 4px 0 var(--color-primary-dark);
--shadow-btn-danger: 0 4px 0 var(--color-error-shadow);
--shadow-sm: 0 1px 0 var(--color-border);
```

扩展规则：

- 重点卡片/弹窗：`4px 4px 0 rgba(0,0,0,0.1)` 或 `6px 6px 0 rgba(0,0,0,0.15)`。
- 桌面首页大卡：可用 `8px 8px 0 rgba(0,0,0,0.1)`。
- 按钮正常态有厚度，按下态通过 `transform: translateY(4px)` 吃掉阴影。
- 避免大面积模糊阴影；只有侧栏、固定底栏、PDF 预览等局部使用轻微柔阴影。

## 5. 字体与排版

现有代码使用 `var(--font-sans)` 和 `var(--font-mono)`，但 `--font-sans` 在主 `index.css` 中未定义。桌面复用时建议补齐：

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
--font-mono: "JetBrains Mono", "Cascadia Mono", "Courier New", monospace;
```

排版规律：

- 正文/控件：13-15px。
- 页面标题移动端：16-20px。
- 页面标题桌面端：24px。
- 大仪表盘数字/品牌 Logo：28-48px。
- 常用字重：500、600、700、800、900。
- 数字、ID、库存、统计值、二维码编号使用等宽字体。
- 小标签常用 10-12px，配合大写、短文本、较粗字重。

## 6. 核心组件风格

### 6.1 按钮

来源：`components/common/Button/Button.module.css`、`BottomNav`、`Home`、`UserPage`。

按钮是 InCase 风格里最重要的触感来源。

```css
.primaryButton {
  height: 44px;
  padding: 0 16px;
  border-radius: var(--radius-md);
  background: var(--color-primary);
  color: var(--text-inverse);
  border: 1px solid var(--color-primary-dark);
  box-shadow: var(--shadow-btn);
  font-weight: 600;
  transition: transform 0.1s ease-in-out, box-shadow 0.1s ease-in-out;
}

.primaryButton:active {
  transform: translateY(4px);
  box-shadow: 0 0 0 var(--color-primary-dark);
}
```

尺寸：

- `sm`: 32px 高，13px 字号。
- `md`: 44px 高，15px 字号。
- `lg`: 52px 高，17px 字号，常用于主提交。

变体：

- Primary：胡桃木底 + 深咖啡硬阴影。
- Secondary：白底 + 牛皮纸边框 + 浅灰硬阴影。
- Danger：砖红底 + 深红硬阴影。
- Outline：透明底 + 2px 边框，无厚度。

### 6.2 卡片

来源：`Card.module.css`、`Home.module.css`、`UserPage.module.css`、`ItemCard.module.css`。

普通卡片：

- 白底。
- `1px solid var(--color-border)`。
- `border-radius: var(--radius-md)`。
- `box-shadow: var(--shadow-card)` 或 `var(--shadow-sm)`。
- 内边距通常 12-20px。

重点卡片：

- `2px solid var(--text-main)`。
- `border-radius: var(--radius-lg)`。
- `box-shadow: 6px 6px 0 rgba(0,0,0,0.1)`。
- 头部或统计区常用虚线分割：`2px dashed var(--color-border)`。

### 6.3 输入框与表单

来源：`Input.module.css`、`FormElements.module.css`、`ItemEditPage.module.css`。

输入控件：

- 高度 44px。
- `2px solid var(--color-border)` 或 `var(--border-input)`。
- `border-radius: var(--radius-md)`。
- 白底/主题输入底。
- 聚焦时只改边框，不使用强烈发光。

Textarea：

- `min-height: 80px`。
- `resize: none`。
- 14px 字号。

文件上传：

- `2px dashed var(--border-input)`。
- `background: var(--bg-input-muted)`。
- 44px 高，居中，表示“放入盒子”的语义。

Stepper：

- 外层无大边框。
- `+/-` 按钮是独立小积木块：32px、1px 边框、4px 圆角、轻微硬阴影。

### 6.4 标签与筛选

来源：`Tag.module.css`、`Filter.module.css`、`ItemCard.module.css`。

标签大致有两类：

- 普通 Tag：13px、`6px 12/14px`、1px 边框、白底或 `bg-app`。
- 元数据小标签：10px、等宽字体、`2px 6px`、4px 圆角，用于“类型/位置/库存”等。

选中态：

- 背景使用 `var(--color-primary)` 或 `var(--text-main)`。
- 文字使用 `var(--text-inverse)`。
- 有些控件选中后使用 inset 阴影，表示“按下并锁住”。

### 6.5 弹窗与 Toast

来源：`Modal.module.css`、`ConfirmDialog.module.css`、`Toast.module.css`。

弹窗：

- 遮罩：`rgba(0,0,0,0.4)` + `backdrop-filter: blur(2px)`。
- 主体：白底、`2px solid var(--text-main)`、12px 圆角。
- 硬投影：`6px 6px 0 rgba(0,0,0,0.15)`。
- 动效：`popIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)`。
- 宽度通常 300-340px，偏移动端精致弹窗。

Toast：

- 居中固定。
- `z-index: var(--z-toast)`。
- 白底 + 2px 主文字边框 + `4px 4px 0` 硬投影。
- 图标色表达类型，错误状态边框也变红。

## 7. 布局模式

### 7.1 全局容器

`app-container`：

- `min-height: 100vh`。
- `background: var(--bg-app)`。
- 移动端左右 8px。
- 桌面端 `max-width: 1400px`，左右 40px。

### 7.2 Mobile First

项目基准是移动端，桌面用 `@media (min-width: 768px)` 逐步增强。

移动端常见模式：

- 顶部 sticky header。
- 底部固定操作栏或底部导航。
- 内容宽度 100%，内边距 16-20px。
- 列表为单列。

桌面端常见模式：

- 内容最大宽度 800/1200/1400px。
- 详情页变为左图右信息的两列 grid。
- 首页/User 页变为 Bento/Grid 仪表盘。
- Inventory 页变为主列表 + 右侧筛选栏。
- 底部固定操作栏在桌面端常变为普通卡片区域。

### 7.3 导航

桌面侧栏：

- 固定左侧，240px 宽。
- 白底，右边框，24px 内边距。
- active 项使用浅 hover 底 + 右侧 3px 主色条。
- 图标 24px，`currentColor`。

移动底栏：

- 固定底部，60px + safe area。
- 白底，顶部边框。
- 中间 FAB：48px 方圆按钮，14px 圆角，胡桃木底，4px 硬阴影，上浮 12px。
- active 使用主色，非 active 使用 `text-tertiary`。

## 8. 图标语言

来源：`frontend/src/assets/icons/index.jsx` 和 `lucide-react`。

图标统一规则：

- SVG 默认 `24x24`。
- `fill: none`。
- `stroke: currentColor`。
- `strokeWidth: 2`，FAB 可到 3。
- `strokeLinecap` / `strokeLinejoin` 使用 `round`。
- 颜色由父元素 `color` 控制。

桌面应用复用时，建议优先使用线性图标，不要混用大面积实心图标。图标应跟随按钮/菜单/状态文字颜色。

## 9. 动效与反馈

常见动效：

- 页面进入：`fadeIn 0.3s ease-out`，从 `translateY(10px)` 到 0。
- 按钮按下：`translateY(2px/4px)`，阴影减少或消失。
- 卡片 hover 桌面端：`translate(-2px, -2px)`，阴影增大到 `6px 6px 0`。
- 弹窗：轻微 scale pop。
- 下拉：`translateY(-5px)` 淡入。

原则：

- 动作短、干脆。
- 按钮反馈优先用位移和阴影，不靠颜色大幅闪烁。
- hover 只在桌面明显；移动端主要用 active。

## 10. 层级

```css
--z-bottom-nav: 50;
--z-header: 50;
--z-dropdown: 1000;
--z-modal-backdrop: 2000;
--z-modal-content: 2001;
--z-toast: 3000;
```

桌面应用里可以映射为：

- 普通内容：0。
- Sticky header / bottom nav：50。
- Dropdown / popover：1000。
- Modal overlay：2000。
- Modal content：2001。
- Toast / notification：3000。

## 11. 桌面应用迁移建议

### 11.1 最小 Token 集

如果目标桌面框架不是 Web，也建议先建立这组变量或主题对象：

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
  --font-mono: "JetBrains Mono", "Cascadia Mono", "Courier New", monospace;

  --color-primary: #5D4037;
  --color-primary-dark: #3E2723;
  --color-accent: #8D6E63;
  --color-border: #D7CCC8;

  --bg-app: #F5F2EB;
  --bg-surface: #FFFFFF;
  --bg-surface-hover: #FDFCF8;

  --text-main: #3E342E;
  --text-secondary: #796B63;
  --text-tertiary: #BCAAA4;
  --text-inverse: #FFFFFF;

  --color-error: #C62828;
  --color-error-shadow: #8E1D1D;
  --color-success: #558B2F;
  --color-warning: #F9A825;

  --border-input: #A1887F;
  --border-input-focus: #5D4037;
  --bg-input: #FFFFFF;
  --bg-input-muted: #EFEBE9;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;

  --shadow-card: 0 3px 0 #D7CCC8;
  --shadow-btn: 0 4px 0 #3E2723;
  --shadow-btn-danger: 0 4px 0 #8E1D1D;
  --shadow-sm: 0 1px 0 #D7CCC8;
}
```

### 11.2 桌面信息架构

桌面端不要照搬移动端的底部导航，建议采用：

- 左侧固定侧栏：品牌、主模块、创建/扫描主操作。
- 顶部内容栏：页面标题、搜索、筛选、主题切换。
- 中央内容区：列表/网格/详情。
- 右侧辅助栏：筛选、统计、上下文操作。
- 弹窗保持小尺寸硬边框，不做全屏大玻璃拟态。

### 11.3 控件迁移优先级

优先复用：

1. 主按钮/危险按钮的硬阴影下沉。
2. 卡片的白底 + 牛皮纸边框 + 硬阴影。
3. 输入框的 2px 边框和聚焦主色。
4. 标签/元数据胶带风格。
5. 弹窗/Toast 的黑边框硬投影。
6. 图标的线性 `currentColor` 体系。
7. 暗色主题变量覆盖。

可以弱化：

- 移动端底部导航。
- 安全区 `env(safe-area-inset-bottom)`。
- 页面级移动端固定底栏。

## 12. 需要注意的源码不一致

浏览中发现以下变量在部分 CSS 中被引用，但不在当前主 `frontend/src/index.css` 中定义。复用时建议补齐或替换：

- `--font-sans`
- `--shadow-lg`
- `--color-primary-rgb`
- `--color-primary-light`
- `--bg-card`
- `--color-bg-hover`
- `--color-bg-secondary`
- `--bg-hover`

建议补齐方式：

```css
:root {
  --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif;
  --shadow-lg: 0 8px 24px rgba(0,0,0,0.12);
  --color-primary-rgb: 93, 64, 55;
  --color-primary-light: #EFEBE9;
  --bg-card: var(--bg-surface);
  --color-bg-hover: var(--bg-surface-hover);
  --color-bg-secondary: var(--bg-input-muted);
  --bg-hover: var(--bg-surface-hover);
}
```

另外，部分历史硬编码颜色仍散落在组件里，例如 `#999`、`#eee`、`#FFB74D`、浅蓝网格占用态等。新桌面应用如果追求完整主题切换，应尽量映射为 token。

## 13. 审阅范围

主要样式文件：

- `frontend/src/index.css`
- `frontend/src/styles/scrollbar.css`
- `frontend/src/App.css`
- `frontend/src/assets/styles/variables.css`
- `frontend/src/assets/styles/index.css`
- `frontend/src/components/**/*.module.css`
- `frontend/src/features/**/*.module.css`
- `frontend/src/pages/**/*.module.css`

相关文件：

- `frontend/src/main.jsx`
- `frontend/src/App.jsx`
- `frontend/src/context/ThemeContext.jsx`
- `frontend/src/assets/icons/index.jsx`
- `frontend/package.json`
- `README.md`

