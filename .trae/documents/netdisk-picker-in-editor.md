# 网盘文件选择器：在编辑器里直接从网盘选文件

## Context（为什么做这个）

当前写文章/笔记/批注时，要插入网盘下载卡片必须**手写** `{{netdisk 文件名}}`，或切到 `/admin/disk/` 复制嵌入代码再贴回来，打断写作流。本次在编辑器内直接加「🌐 网盘」按钮，点开弹窗选文件即自动插入 token，构建时由 remark-netdisk 渲染为卡片。覆盖三个编辑面：Decap 文章/笔记正文（markdown 组件）、Decap 批注内容、前台文章页「批注」浮层。批注内容目前是纯文本组件，本次一并升级为 markdown 渲染，使 `{{netdisk}}` token 在批注里也能渲染成卡片。

## 涉及文件

| 文件 | 改动 | 作用 |
|---|---|---|
| `public/netdisk-picker.js` | **新建** | 共享核心：token 解析、`/disk/list` 拉取、弹窗 UI、`window.NetdiskPicker.open(onSelect)` API；自动检测 Decap 后台上下文并接管编辑器注入 |
| `public/admin/index.html` | 编辑 | `</body>` 前加 `<script src="/netdisk-picker.js" defer>` |
| `public/admin/config.yml` | 编辑 L126 | 批注 `content` 组件 `text` → `markdown`，使选择器自动覆盖批注编辑器 |
| `src/utils/netdisk-card.mjs` | **新建** | 共享卡片 HTML 生成：`buildCardHtml(basename, manifest)` / `buildMissingHtml(name)` / `renderAnnoContent(raw, manifest)` |
| `src/utils/remark-netdisk.mjs` | 编辑 | 改为 import `buildCardHtml`/`buildMissingHtml`（消除重复模板，保持一致） |
| `src/pages/posts/[slug].astro` | 编辑 | ① 前端 frontmatter 用 marked + `renderAnnoContent` 预渲染批注内容→`contentHtml`；② 客户端 `content.innerHTML = anno.contentHtml`（替换 `textContent`）；③ 批注浮层加「🌐」按钮调用 `NetdiskPicker.open()` 插入 textarea；④ 内联 netdisk 清单供即时显示用 |
| `package.json` | 编辑 | 新增 `marked` 依赖（构建期渲染批注 markdown） |

## 实现细节

### 1. `public/netdisk-picker.js`（共享核心 + Decap 注入）

**token 解析（复用现有 `getUserToken` 思路）**：依次试 `localStorage["decap-cms-user"]`/`["netlify-cms-user"]` 的 `.token`（已在 Decap 登录则无需二次登录）→ `sessionStorage["disk-admin-token"]` → `localStorage["disk-admin-token"]`。无 token 时弹窗提示「先登录后台」+ OAuth 弹窗按钮（复用 `disk/index.html` L426-457 握手）。

**`api(path)`**：复用 `disk/index.html` L465-480，Bearer + 401 清 `disk-admin-token`（不清 Decap token）。

**弹窗**：`z-index:99999`（同 `.qa-toast`），复用 `disk/index.html` 的 `formatSize`、文件行渲染。带搜索框（客户端过滤 basename）、刷新按钮、5 分钟缓存。选文件时回调 `onSelect(basename)`。

**Decap 编辑器注入（仅 `/admin/` 路径自动激活）**：
- MutationObserver（200ms 节流，复用 index.html L594-602 模式）监听 `document.body`
- 检测 `.cms-editor-visual` / `.cms-editor-raw`（Decap v3 markdown 组件的稳定类名，Slate contentEditable）+ 降级 `#nc-root [class*="EditorMarkdown" i]`
- 在容器右上角注入浮动「🌐 网盘」按钮（`position:absolute; z-index:300`），用 `data-netdisk-picker="1"` 幂等标记
- 跟踪 `lastActiveEditor`：document 捕获阶段 `focus` 监听 `[contenteditable]`/`textarea` within `.cms-editor-*`
- 选文件后 `insertAtCursor(lastActiveEditor, "{{netdisk "+name+"}}")`

**`insertAtCursor(el, text)`**：
- contentEditable（Slate，两种模式都是）：`el.focus()` → `document.execCommand("insertText", false, text)`（触发 `beforeinput`→Slate `editor.insertText`）→ 比对 `textContent` 变化验证；失败降级复制 + toast「请 Ctrl+V 粘贴」
- textarea（批注 text 组件降级 / 前台批注浮层）：`setRangeText` + `dispatchEvent(new Event("input",{bubbles}))`

### 2. 批注内容 markdown 渲染（`[slug].astro`）

**构建期预渲染**（frontmatter）：
- `import { marked } from "marked"`（新增依赖）
- `import manifest from "../data/netdisk.json"`
- 对每条批注：`contentHtml = renderAnnoContent(anno.content, manifest)` = 先 `marked.parse(raw)` 得 HTML → 再正则替换 `{{netdisk name}}` → `buildCardHtml`（marked 输出的 inline HTML 会原样保留卡片 span）
- 序列化 `contentHtml` 进 `annotation-data`；`Anno` 类型加 `contentHtml: string`

**客户端**（L197）：`content.innerHTML = anno.contentHtml`（替换 `content.textContent = anno.content`）

**即时显示**（前台保存批注后立即渲染，L325+）：内联 netdisk 清单（`<script id="netdisk-cards-data">`，只含被文章批注引用的文件子集），新建批注即时显示时客户端走同样的 token 替换 + marked CDN 懒加载（复用 files 页 L138-150 的 CDN 懒加载模式）。

### 3. 前台批注浮层选择器（`[slug].astro` L290 表单）

表单 HTML 加「🌐」按钮（`<button class="anno-netdisk">🌐</button>`），点击 → `NetdiskPicker.open(name => insertIntoTextarea(textarea, "{{netdisk "+name+"}}"))`。token 复用 `getUserToken()`（文章页已有，L147-159）。

### 4. 共享卡片模板（`src/utils/netdisk-card.mjs`）

提取 remark-netdisk 现有的 `cardHtml(entry)`/`missingHtml(name)` 为独立函数，remark-netdisk 和批注预渲染都 import。HTML 模板与 `global.css` 的 `.nd-card`/`.nd-ico`/`.nd-name`/`.nd-meta`/`.nd-btn`/`.nd-copy` 类名严格一致（已在 Phase 3 定稿）。

## 验证

1. **构建**：`npm run build` 通过，文章页 `annotation-data` 含 `contentHtml` 字段
2. **Decap 注入**：`npm run cms`（本地）→ 进入文章编辑 → markdown 编辑器右上出现「🌐 网盘」按钮 → 点击弹窗列出文件 → 选文件后正文光标处出现 `{{netdisk 文件名}}`；代码块内 token 不被处理（remark-netdisk 已验证）
3. **批注渲染**：文章页已有批注的 `anno-content` 显示卡片（非纯文本）；新建含 `{{netdisk x}}` 的批注保存后即时显示卡片
4. **前台批注浮层**：文章页悬停段落→批注→表单有「🌐」按钮→选文件插入 textarea
5. **token 无感**：已在 Decap 登录时，点「🌐 网盘」直接出文件列表（无需二次登录）
6. **Worker 鉴权**：复用已验证的 `/disk/list` 端点 + CORS（github.io 白名单）
