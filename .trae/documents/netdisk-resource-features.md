# 博客网盘资源功能实施计划（三大件）

## Context

百度网盘已作为资料系统的备用下载源（脚本上传 + 分享 + 回写 md frontmatter）。用户希望在此基础上扩展三件事：

1. **前台「网盘资源」总览页**：自动列出网盘 `/apps/mynote` 全部文件 + 分享链接，跑一次 sync 页面自动更新；
2. **文章内嵌下载卡片**：在任意文章/笔记的指定位置用 `{{netdisk 文件名}}` 语法插入下载卡片（构建时渲染）；
3. **CMS 后台网盘管理**：在 `/admin/disk/` 页面浏览网盘、创建分享、复制嵌入代码、上传文件——复用现有 Cloudflare OAuth Worker（源码在 `oauth-worker/`）做鉴权与代理。

核心数据源是一个**构建时生成的清单文件** `src/data/netdisk.json`，它是三个功能共用的 join key（按 basename 匹配）。

已核实的现状（Phase 3 验证过）：
- 导航在 `src/config.ts` L33-42 的 `NAV` 数组；
- 暗色模式是 `<html data-theme>` + CSS 变量（`src/styles/global.css`），纯变量写法无需暗色特判；
- `baidu-sync.mjs` main() 在 `tasks.length===0` 时 **L654 提前 return**——必须重构，否则空跑不生成清单；
- `.baidu-btn/.code-btn` 样式目前是 files 页内联 `is:global`，其他页面用不了，需挪一份进 global.css；
- Astro tsconfig 已开 resolveJsonModule，页面可直接 `import netdisk.json`；
- `oauth-worker/` 零依赖单文件 + wrangler.toml，WebCrypto 无 MD5（xpan 秒传预检需要），需内联纯 JS MD5。

## 清单 Schema（src/data/netdisk.json，生成并提交）

```jsonc
{
  "version": 1,
  "generatedAt": "ISO时间",
  "remoteDir": "/apps/mynote",
  "files": [{
    "basename": "xxx.jpg", "size": 123, "fsId": 456, "md5": "",
    "link": "https://pan.baidu.com/s/…?pwd=abcd",   // null = 待分享
    "code": "abcd",
    "source": "md" | "sync" | "prev",
    "updatedAt": "ISO时间"
  }]
}
```

按 basename 排序；内容不变则跳过写入（避免 CI 提交噪音）。

## Phase 1 — sync 脚本生成清单

**改**：[scripts/baidu-sync.mjs](file:///c:/Users/zhang/project_mynote/scripts/baidu-sync.mjs)、`.github/workflows/deploy.yml`（一行）

- 新函数（纯 Node 无依赖）：
  - `loadManifest()/saveManifest()`（读写+去噪）；
  - `collectMdLinks()`：复用 `collectTasks()` 的行解析模式，从 `src/files/*.md` 提取 file/baidu/code → Map；
  - `shareMissingLinks()`：对网盘有文件但无链接的条目调现有 `createShareWeb()` 补分享，配额 `BAIDU_MAX_SHARES_PER_RUN`（默认 10，防 errno 130 分享上限风暴）；
  - `buildManifest()`：合并优先级 sync > md > prev。
- **main() 重构**：L654 提前 return 改为跳过上传块但继续；结尾（回写循环后）重新 `listDir()` → 收集 → 补分享 → 写清单。`--dry-run` 只打印统计。
- deploy.yml 提交路径加 `src/data/netdisk.json`。

**验证**：`node --check`；dry-run 看统计；实跑两次（第二次应为 no-op diff，不重复建分享）；确认 md 引用文件的链接来自 frontmatter、孤儿文件链接来自补分享。

## Phase 2 — 前台总览页 /disk/ + 导航

**新增** `src/pages/disk/index.astro`；**改** `src/config.ts`（NAV 加 `{ text: "网盘", url: "/disk/" }` 插在「资料」后）、`src/styles/global.css`（把 `.baidu-btn/.code-btn` 规则从 files 页复制为全局，files 页不动）。

- 页面逻辑：import 清单 → 按扩展名分组（图片/文档/压缩包/其他）→ 复用 `.card/.file-row/.file-actions` 模式渲染行：徽标（扩展名）+ 文件名 + 大小 + `.baidu-btn`（有链接时）+ `.code-btn`（data-code）+ `待分享` 灰徽（无链接）。
- 页内 `<script>`：复制提取码逻辑照抄 files 页 L256-283（clipboard API + execCommand 降级 + 「✓ 已复制」）。
- 样式全部走 CSS 变量 → 明暗自适应；640px 断点。

**验证**：`npm.cmd run build`；dev 下看分组/复制/待分享/暗色/375px。

## Phase 3 — remark 下载卡片插件

**新增** `src/utils/remark-netdisk.mjs`；**改** `astro.config.ts`（markdown.remarkPlugins 注册）、`src/layouts/BaseLayout.astro`（现有 `<script>` 加 ~10 行全局委托复制）、`global.css`（卡片样式）。

- 语法：`{{netdisk 文件名.zip}}`（别名 `{{网盘 …}}`），正则 `/\{\{(?:netdisk|网盘)\s+([^{}]+?)\s*\}\}/g`（中文安全）。
- 插件：惰性读 `process.cwd()/src/data/netdisk.json`（模块级缓存）；递归遍历 mdast，跳过 `code/inlineCode` 子树；`text` 节点按正则切分，产出纯 text + `{type:"html"}` 节点。
- 卡片 HTML：自包含 `<span class="nd-card">`，**只用 data-\* 属性不写内联事件**，值全部 HTML 转义：图标+文件名+大小/提取码 meta + `下载` 链接 + `提取码` 复制按钮。
- 未找到文件 → 可见占位卡（⚠️ + 链到 /disk/）+ 构建期 console.warn；找到了但没分享 → 「待分享」禁用态。
- BaseLayout 脚本对 `.nd-copy` 做事件委托（render() 的三处调用 posts/notes/首页 自动全覆盖；RSS 与 search-index 不含正文，无泄漏）。

**验证**：`node --check`；临时测试 md（有效 token/未知 token/代码块内 token）→ build → `rg "nd-card" dist` 检查三种情况 → 删临时文件。

## Phase 4 — Worker /disk/* 端点

**改** [oauth-worker/src/index.js](file:///c:/Users/zhang/project_mynote/oauth-worker/src/index.js)、wrangler.toml（注释）。**/auth、/callback 保持字节级不动**（Decap 正在用）。

- **新 Secret（用户本地执行）**：`npx.cmd wrangler secret put GITHUB_ALLOWED_OWNER`（值=用户 GitHub 用户名/ID）+ `BAIDU_APP_KEY/BAIDU_SECRET_KEY/BAIDU_REFRESH_TOKEN/BAIDU_BDUSS/BAIDU_STOKEN`；部署 `npx.cmd wrangler deploy`（cwd=oauth-worker）。
- CORS：fetch 顶部 OPTIONS→204 短路；allowlist 只放行 `https://<user>.github.io`、localhost:8080（CMS 本地）、127.0.0.1:8787（wrangler dev）；`Access-Control-Allow-Headers: Authorization, Content-Type`。
- `verifyOwner()`：每个 /disk/* 先校验 `Authorization: Bearer <gh-token>` → api.github.com/user → login 比对 owner，否则 401。
- `getBaiduToken()`：模块级缓存 + refresh_token 换 access_token；若百度返回新 refresh_token，响应头 `x-baidu-rotated:1` 提示用户重新 put secret（Worker 无法持久化）。
- `GET /disk/list`：xpan list `/apps/mynote` → 合并 raw.githubusercontent.com 上的公开 netdisk.json（显示链接状态，失败不致命）。
- `POST /disk/share`（body {fsId}）：把 `getBdstoken + share/set` 逻辑从 baidu-sync.mjs 移植（~50 行，Worker 不能 import Node 脚本，有意重复）。
- `POST /disk/upload`：formData 单文件 ≤64MB（超限 413）；内联纯 JS MD5（~80 行）；precreate→秒传/8MB 分片→create，64MB ≈ 10 个子请求，远低于免费档 50。
- `GET /disk/download`：**v1 跳过**（出口流量翻倍，后续可选）。

**验证**：`node --check`；用户本地 `npx.cmd wrangler dev` + curl OPTIONS（204+CORS）/无 token（401）/带 token（JSON）；最后 deploy。

## Phase 5 — 管理页 public/admin/disk/

**新增** `public/admin/disk/index.html`（独立 HTML+JS 无构建，Decap 的 10 分钟配置缓存不影响它）。

- 样式：复制 Decap admin 的 `:root` 调色板 + `<meta robots noindex>`。
- 登录：**完全复用 Decap 的 OAuth 弹窗握手**（window.open worker/auth ↔ postMessage `authorizing:github`/`authorization:github:success`），token 存 sessionStorage（key `disk-admin-token`，与 Decap 隔离）；401 → 清 token 显示重新登录。
- UI：工具栏（刷新/上传）+ 表格（名称/大小/分享状态徽标）；行操作 `[创建分享]`（POST /disk/share）`[复制链接]` `[复制提取码]` `[复制嵌入]`（复制 `{{netdisk 文件名}}`，粘贴进任意文章即完成 Phase 3 卡片挂载）；上传用 **XMLHttpRequest**（fetch 无上传进度），带进度条。
- 复制逻辑同款降级模式。

**验证**：部署站点访问 /admin/disk/ → 登录弹窗 → 列表 → 给未分享文件建分享 → 复制嵌入 → 粘进文章看卡片；`npm.cmd run cms` 下从 localhost:8080 测 CORS。

## Phase 6 — 收尾

- `oauth-worker/README.md`：Secret 表 + 端点列表；`.env.example` 加 `BAIDU_MAX_SHARES_PER_RUN=10`；关于页可提一句 `{{netdisk …}}` 语法。
- 更新项目记忆。

## 风险与已知取舍

1. 清单先于链接提交是**设计如此**：待分享灰徽渲染，后续每次 push 的 CI 增量补齐；
2. main() 提前 return 的重构是脚本侧最大风险点——需空跑验证清单仍会生成；
3. 文件名含 `{`/`}` 不支持（文档注明）；中文文件名已由 `[^{}]+` 覆盖；
4. Worker refresh_token 可能轮换 → 响应头提示 + 管理页横幅（v2 可加 KV）；
5. Worker 上传上限 64MB、下载代理 v1 不做；
6. /files/ 页的客户端 marked 预览不会渲染 token（已知限制，可后续加预处理）。

## 执行顺序与前置事项

按 Phase 1→6 顺序做（1-3、6 我全可完成并本地验证；4-5 代码我写好，**Secret 配置与 wrangler deploy 需你在本地终端执行**）。另：**首次扫码授权仍未完成**——实跑 `npm.cmd run baidu:sync` 扫一次码，Phase 1 的清单生成也需要它。
