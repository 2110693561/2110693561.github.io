---
title: 编辑器内网盘文件选择器：写文章时直接从网盘选文件，不用手写文件名
date: 2026-09-04
category: 项目实战
tags: [Astro, Decap CMS, 百度网盘, 编辑器]
description: 在 Decap CMS 编辑器和前台批注浮层里加「🌐 网盘」按钮，点开弹窗选文件即插入 {{netdisk 文件名}}，构建时自动渲染为下载卡片。覆盖文章正文、批注内容、前台批注三个编辑面。
---

## 背景与目标

上一篇接入了网盘资源三件套（总览页 + 文章下载卡片 + 后台管理），但写文章时插入下载卡片仍要**手写** `{{netdisk 文件名}}`，或切到 `/admin/disk/` 复制嵌入代码再贴回来——打断写作流。

本次解决这个痛点：在编辑器里直接加「🌐 网盘」按钮，点开弹窗选文件即自动插入 token，构建时由 remark-netdisk 渲染为卡片。覆盖三个编辑面：

1. Decap 文章/笔记正文（markdown 组件）
2. Decap 批注内容（升级为 markdown 组件）
3. 前台文章页「批注」浮层

## 怎么使用

### 场景一：在 Decap 后台写文章/笔记时插入网盘文件

1. 登录后台 `/admin/` → 进入文章或笔记编辑页
2. markdown 编辑器右上角自动出现一个「🌐 网盘」浮动按钮
3. 把光标放在想插入下载卡片的位置
4. 点击「🌐 网盘」→ 弹出文件选择弹窗（带搜索框）
5. 在搜索框输入文件名关键词过滤，或直接滚动列表
6. 点击目标文件行 → `{{netdisk 文件名.zip}}` 自动插入到光标位置
7. 保存发布后，`npm run build` 时 remark-netdisk 把 token 渲染为带下载按钮和提取码复制的卡片

> 已经登录 Decap 后台的，点「🌐 网盘」直接出文件列表，**无需二次登录**——选择器复用 Decap 自己的 GitHub token 调 Worker `/disk/list`。

### 场景二：写批注时插入网盘文件

批注内容字段已从纯文本升级为 markdown 组件，同样有「🌐 网盘」按钮：

1. 后台进入批注集合 → 新建/编辑批注
2. markdown 编辑器里同样有「🌐 网盘」按钮
3. 选文件后插入 `{{netdisk 文件名}}`
4. 构建时批注内容经 marked 预渲染为 HTML，token 替换为卡片，文章页批注区直接显示下载卡片

### 场景三：在前台文章页直接写批注时插入

1. 打开任意文章页 → 悬停某个段落 → 出现「批注」按钮
2. 点击后弹出批注表单（仅站长登录后显示完整按钮）
3. 表单左侧有「🌐」按钮 → 点击 → 选文件 → `{{netdisk 文件名}}` 插入到批注文本框
4. 保存后即时显示卡片（客户端 marked CDN 懒加载 + 内联网盘清单渲染）

### 弹窗操作

- **搜索**：顶部搜索框输入文件名，实时过滤
- **刷新**：右下「↻ 刷新」强制重新拉取网盘目录（绕过 5 分钟缓存）
- **取消/关闭**：点遮罩、按 Esc、点 × 都可关闭
- **文件状态徽标**：绿色「已分享」/ 灰色「待分享」，一眼看出哪些还没创建分享链接

## 技术实现要点

### 1. 共享卡片模板（`src/utils/netdisk-card.mjs`）

把卡片 HTML 生成提取为独立模块，remark-netdisk（文章正文）和批注预渲染共用，保证两处卡片样式严格一致（类名对应 `global.css` 的 `.nd-card`/`.nd-ico`/`.nd-name` 等）。

### 2. 选择器核心（`public/netdisk-picker.js`）

一个 17KB 的纯 JS 文件，无依赖，同时服务后台和前台：

- **token 解析**：依次试 `localStorage["decap-cms-user"]`（已在 Decap 登录）→ `sessionStorage["disk-admin-token"]`（管理页登录）→ `localStorage["disk-admin-token"]`。三级回退，最大化「无需二次登录」概率。
- **Decap 编辑器注入**：MutationObserver（200ms 节流）检测 `.cms-editor-visual`/`.cms-editor-raw`（Decap v3 markdown 组件稳定类名，底层是 Slate contentEditable），在容器右上角注入浮动按钮，`data-netdisk-picker` 幂等标记防重复。
- **插入到光标**：Slate contentEditable 用 `document.execCommand("insertText")`（触发 `beforeinput` → Slate `editor.insertText`，和键盘打字同一条路径）；textarea 用 `setRangeText` + `input` 事件。失败降级为复制 + toast 提示粘贴。
- **弹窗**：`z-index:99999`，明暗主题跟随 `html[data-theme]`，搜索/刷新/5 分钟缓存。

### 3. 批注内容 markdown 渲染（`src/pages/posts/[slug].astro`）

批注原来是纯文本（`widget: text`），现在升级为 markdown：

- **构建期**：frontmatter 用 `marked.parse(replaceTokens(content, manifest))` 预渲染每条批注 → `contentHtml`，序列化进 `annotation-data`。token 先替换为卡片 HTML span，marked 原样保留内联 HTML。
- **客户端**：`content.innerHTML = anno.contentHtml`（替换原来的 `textContent`）。
- **即时显示**：前台新建批注保存后，走客户端降级渲染（marked CDN 懒加载 + 内联网盘清单子集），未加载完 marked 时先显示转义文本，加载后自动 markdown 渲染。

### 4. 前台批注浮层选择器

批注表单加「🌐」按钮（仅站长登录时显示），点击调 `window.NetdiskPicker.open()`，选文件后 `setRangeText` 插入 textarea。选择器脚本按需懒加载（不增加无批注页面的开销）。

## 改进建议

1. **选择器弹窗里直接预览卡片效果**——目前只显示文件名/大小/分享状态，可以在每行末尾加一个「预览」按钮，点击在弹窗内渲染该文件的 nd-card 样式，方便确认卡片长什么样再决定是否插入。

2. **选择器支持上传**——现在弹窗只能从已有文件里选。如果写文章时发现网盘里没有目标文件，要切到 `/admin/disk/` 上传再回来。可以在弹窗里加一个「上传」入口，复用 Worker `/disk/upload` 端点，上传完直接可选。

3. **批注即时显示 marked 渲染的时序问题**——新建批注保存后，marked CDN 脚本异步加载，在加载完成前的瞬间显示的是转义纯文本（含卡片 span 但没 markdown 排版）。可以在文章页 `<head>` 里用 `modulepreload` 预加载 marked，或改为构建期全量渲染（去掉客户端 marked 依赖）。

4. **选择器按钮位置自适应**——目前固定在编辑器右上角。如果 Decap 的模式切换按钮（raw/rich toggle）恰好在同一位置，可能重叠。可以用 `getBoundingClientRect` 检测重叠后下移，或改用 Decap 工具栏注入（但工具栏 DOM 不稳定，风险更高）。

5. **多文件批量插入**——目前每次选一个文件。如果一篇文章要引用多个网盘文件，可以支持多选（Shift/Ctrl 连选），一次性插入多个 token。

6. **文件列表分组与排序**——弹窗目前按网盘目录原始顺序平铺。可以按扩展名分组（图片/文档/压缩包，和 `/disk/` 总览页一致），或按修改时间倒序，让常用文件更容易找到。

7. **批注 content 改 markdown 后的存量兼容**——已有批注是纯文本，升级后 marked 会原样渲染（纯文本经 marked 输出还是纯文本），不会破坏。但如果旧批注里有 `<` `>` 等字符，marked 会按 markdown 语法处理（如 `<tag>` 被当 inline HTML）。建议在迁移说明里提示检查旧批注。

---

*项目仓库：<https://github.com/2110693561/2110693561.github.io>*
