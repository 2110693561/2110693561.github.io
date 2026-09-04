---
title: 为个人博客接入百度网盘资源（三件套）：总览页、文章下载卡片、后台管理
date: 2026-09-04
category: 项目实战
tags: [Astro, Cloudflare Workers, 百度网盘, 静态博客]
description: 在一个纯静态 Astro + GitHub Pages 博客里，不增加任何常驻后端的前提下，实现了网盘资源总览页、文章正文内嵌下载卡片、后台（/admin/disk/）浏览/上传/分享管理三件套。
---

## 1. 目标

之前博客已经通过 `scripts/baidu-sync.mjs`（xpan 开放 API + 网页端内部接口）实现了「资料」条目附件的**同步上传 → 创建分享 → frontmatter 回写** → 资料页「☁️ 百度网盘」备用按钮。在此基础上希望扩展三件事：

1. **前台「网盘资源」总览页**（`/disk/`）：不跟资料条目绑定，直接把网盘 `/apps/mynote` 下的**全部文件**按类型分组展示，附带备用下载链接和提取码，`npm run baidu:sync` 一跑就自动更新。
2. **文章正文内嵌下载卡片**：在任意文章/笔记正文的指定位置写 `{{netdisk 文件名.zip}}` 或 `{{网盘 文件名.zip}}`，构建时自动渲染为带下载按钮和「一键复制提取码」的卡片，不用回资料页绕一圈。
3. **CMS 后台网盘管理页**（`/admin/disk/`）：在后台里浏览网盘目录、创建分享、上传文件、复制「嵌入代码」——复用现有 Cloudflare OAuth Worker 做鉴权和代理，不新增后端。

整体约束：**不能增加任何需要 24h 开机的后端**，保持 GitHub Pages + 若干 Secrets 的静态/Serverless 架构。

## 2. 最终效果

上线后三条独立使用路径：

- **读者路径**：导航栏点「网盘」→ 按图片/文档/压缩包/其他分组浏览，有链接的文件显示「☁️ 百度网盘」蓝色按钮和「提取码」按钮（点击即复制），待分享的文件显示灰色徽标（下一次 CI 会自动补齐）。
- **作者路径（写文章）**：在正文中写 `{{netdisk GD32固件手册.pdf}}`，`npm run build` 时自动从 `src/data/netdisk.json` 查找 basename，渲染带下载 + 提取码复制的内联卡片，代码块里的 token 不会被处理。
- **作者路径（后台管理）**：访问 `/admin/disk/` → 用站点所有者的 GitHub 账号登录（复用 Decap CMS 的 OAuth 弹窗，token 存在 `sessionStorage`，和 Decap 隔离）→ 表格列出网盘中所有文件的名称、大小、分享状态，行操作包括创建分享、复制链接、复制提取码、复制 `{{netdisk …}}` 嵌入代码（粘贴到文章即生效）；右上角「上传文件」按钮最大 64MB（XHR 带进度条），秒传命中直接跳过。

## 3. 架构流程图

```
              ┌───────────────────────────────────────────────────────┐
              │                      构建期（npm run build / CI）      │
              │                                                       │
  src/files/*.md ◄────── frontmatter baidu/code 回写──────┐          │
       │                                                  │          │
       ▼                                                  │          │
  public/files/*.{zip,pdf,...} ──► scripts/baidu-sync.mjs │          │
       │                     ▲      1. precreate/秒传/分片上传      │
       │                     │      2. 网页端 /share/set 创建分享    │
       │                     │      3. 回写 frontmatter              │
       │                     │      4. 生成清单 ◄──────┐              │
       │                     └────────────────────────┐              │
       ▼                                              ▼              │
                                  src/data/netdisk.json              │
                    (version,generatedAt,remoteDir,files[])          │
                       ▲                    ▲                    ▲    │
      ┌────────────────┘                    │                    │    │
      ▼                                     ▼                    │    │
src/pages/disk/                  src/utils/remark-netdisk.mjs      │    │
  index.astro  ───import────►  构建期遍历 mdast，               │    │
  (按扩展名分组渲染)            {{netdisk 文件名}} 替换成           │    │
                               自包含 nd-card HTML               │    │
                                                                │    │
              └─────────────────────────────────────────────────┼────┘
                                                                │
                     推送后的 GitHub Pages (纯静态 dist/) ◄─────┘
                       导航 /disk/       任意文章内 nd-card       ┌ /admin/disk/ 独立HTML
                                                                │
              ┌─────────────────────────────────────────────────┼──────────┐
              │                                                 ▼          │
              │             Cloudflare OAuth Worker（/disk/* 端点）        │
              │  Secrets: GITHUB_ALLOWED_OWNER / BAIDU_APP_KEY / ...       │
              │                                                             │
              │   GET  /disk/list    ◄── 1. xpan list + merge netdisk.json │
              │   POST /disk/share   ◄── 网页端 /share/set（BDUSS 凭证）  │
              │   POST /disk/upload  ◄── precreate → 秒传 → 8MB分片→create│
              │   OPTIONS /disk/*     ◄── CORS 白名单：<username>.github.io│
              │                         · localhost:8080 · 127.0.0.1:8787    │
              │   GET  /auth → /callback ◄── Decap CMS 原有握手（字节不动） │
              │                                                             │
              └─────────────────────────▲───────────────────────────────────┘
                                        │ Authorization: Bearer <gh-token>
                                        │ verifyOwner() 比对 GITHUB_ALLOWED_OWNER
                                        │
                   public/admin/disk/index.html
                   · GitHub OAuth 弹窗（postMessage authorizing:github ↔ authorization:github:success:）
                   · XHR 上传 + 进度条
                   · 事件委托复制（clipboard API + execCommand 降级）
                   · data-theme=dark 与 localStorage.theme 同步
```

核心设计原则——**所有分享链接在 build 期就固化到产物里**：浏览器直链不会污染 access_token，Worker 只在后台管理时才接触敏感凭证，前台页面零密钥。

## 4. 关键技术点

### 4.1 单一数据源：`src/data/netdisk.json`

三个功能（前台总览、文章卡片、后台清单合并）共用一份构建期清单，schema 非常简洁：

```jsonc
{
  "version": 1,
  "generatedAt": "ISO 时间",
  "remoteDir": "/apps/mynote",
  "files": [{
    "basename": "xxx.zip",
    "size": 123456,
    "fsId": 123456,
    "md5": "十六进制串",
    "link": "https://pan.baidu.com/s/…?pwd=abcd",  // null = 待分享，下次 sync 补齐
    "code": "abcd",
    "source": "md" | "sync" | "prev",
    "updatedAt": "ISO 时间"
  }]
}
```

内容不变时 `saveManifest` 会跳过写入，避免 CI 每次都产生无意义的 diff commit。优先级：`sync 本轮新建` > `src/files/*.md frontmatter 已有的` > `上一轮清单里保留的`。

### 4.2 构建期 MD 渲染：remark 插件

Astro 7.x 默认用 Sätteri 处理器，想用 `remarkPlugins` 必须手动装 `@astrojs/markdown-remark`（否则配置校验直接报错——这个点第一次 build 才踩雷）。

插件实现关键点：

- 语法正则：`/\{\{(?:netdisk|网盘)\s+([^{}]+?)\s*\}\}/g`（中文安全，文件名不能含 `{}/}`）；
- 只处理 `text` 节点，**递归遍历 mdast 时跳过 `code` / `inlineCode` 子树**，保证代码块里的示例不被渲染；
- 匹配到 basename → 查 `netdisk.json` 生成 `cardHtml(entry)`；未匹配生成 `missingHtml` 占位并 `console.warn`；
- 卡片 HTML 只用 `data-*` 属性，**不写内联 `onclick`**——复制提取码由 [BaseLayout.astro 全局脚本](file:///c:/Users/zhang/project_mynote/src/layouts/BaseLayout.astro#L160) 事件委托 `.nd-copy`，所有文章/笔记/首页自动覆盖。

### 4.3 后台管理页（`/admin/disk/index.html`）

**独立 HTML + 原生 JS**，不受 Decap CMS 10 分钟配置缓存影响，`<meta name="robots" content="noindex">`。关键设计：

1. **登录完全复用 Decap 的 OAuth 握手协议**：`window.open(worker/auth)`，弹窗先向主窗口 `postMessage('authorizing:github')`，主窗口回发同样字符串后弹窗才投递 `authorization:github:success:{token:...}`（含 2 秒超时的兜底）。token 存 `sessionStorage["disk-admin-token"]`，和 Decap 的 `netlify-cms-user` 隔离。
2. **CORS 安全**：Worker 只放行三个来源——`https://<owner>.github.io`、`http://localhost:8080`（`npm run cms` 本地）、`http://127.0.0.1:8787`（wrangler dev），非白名单来源 OPTIONS 只返回 204、不带 `Access-Control-Allow-Origin`，浏览器自动拦截。
3. **Owner 鉴权**：除 OPTIONS 外所有 `/disk/*` 先调 `api.github.com/user`（Bearer 传入的 token）比对 `login` 或 `id` 等于 `GITHUB_ALLOWED_OWNER`，否则 401。避免把 Worker 变成「任何 GitHub 账号都能调百度接口」的代理。
4. **上传用 XMLHttpRequest 不用 fetch**：fetch 没有上传进度事件，XHR 的 `upload.onprogress` 直接渲染顶部进度条。

### 4.4 Worker `/disk/upload` + 内联纯 JS MD5

Worker 运行时 `WebCrypto` 只提供 SHA 家族，**没有 MD5**，但 xpan 的 precreate/秒传需要每片 8MB 的 MD5 做 block_list——只能手写一份纯 JS MD5（MD5 是公共算法，不涉及密钥）。在落地前对拍了 0B / 3B / 43B / 55/56/57B（MD5 填充边界） / 64B / 8MB / 8MB+1B 共 9 组输入，与 `node:crypto` 输出完全一致才合入。

上传大小上限 64MB（Workers 免费档单请求 ~128MB 内存，留足余量），超限直接 413 提示用户改用本地 `npm run baidu:sync`。

### 4.5 refresh_token 轮换自愈

`openapi.baidu.com/oauth/2.0/token` 用 refresh_token 换 access_token 时，**会偶尔下发新的 refresh_token 并作废旧的**。Worker 没有持久化层无法自己保存，这里采用轻量方案：

1. Worker 检测到响应里返回了和 Secret 不一样的新 refresh_token → 响应头加 `x-baidu-rotated: 1`，同时业务数据正常返回（不让用户的单次操作失败）；
2. `/admin/disk/` 顶部隐藏横幅检测到该头 → 显示红色提醒：`npx wrangler secret put BAIDU_REFRESH_TOKEN` 重配；
3. 本地 `baidu-sync.mjs` 每次换 token 都会写 `.baidu-token.json`，所以本地方案自动兼容。

## 5. 遇到的主要困难与排查过程

### 困难 1：`qrLogin` 扫码一直只拿到 32 位无效 BDUSS

这是整个项目里最费时的坑，前后让你扫了五六次码。

- **表现**：扫码完成后 `.env` 里写入的 `BAIDU_BDUSS` 总是 32 字符（印象里正常 BDUSS 是 ~190 字符），用它调任何网页端接口都报 `errno=-6 登录失效`。
- **第一次诊断（误以为是 JSONP 解析问题）**：`qrbdusslogin` v3 返回类型是 `text/html` 的 JSONP 内容，且错误模板里键名用单引号 `'data': {...}`，`parseLoose` 直接 JSON.parse 失败 → 回退取 `cv.v` 这个 32 位临时值。修了 JSONP 解析 + 加 `callback` 参数后，拿到了 192 位的 bduss，**但预检仍然是 -6**。
- **关键突破**：把 `qrbdusslogin` 响应的 `Set-Cookie` 头完整 dump 出来——下发了 **9 个 cookie**（`BDUSS/STOKEN/PTOKEN/UBI/PASSID/BDUSS_BFESS/STOKEN_BFESS/PTOKEN_BFESS/UBI_BFESS`），而 body JSONP 里那份 192 位 bduss 用在独立请求里，访问 `disk/main` 被 302 跳回登录页，说明它**根本不是有效的会话值**。真正有效的 BDUSS 存在于响应的 Set-Cookie 头。
- **最终修复**：`qrLogin` 改成全程维护 Cookie jar，`qrbdusslogin` 请求带齐历史 cookie（`BAIDUID` 等会话标识），然后从**本次响应的 Set-Cookie** 读 `BDUSS`/`STOKEN` 存 `.env`。现在写入的 bduss 是 192 位、stoken 64 位。

### 困难 2：`gettemplatevariable` 预检「永远」-6

修复 BDUSS 之后，`getBdstoken()`（`/api/gettemplatevariable?fields=["bdstoken"]`）还是报错 -6，导致分享流程在第一步就被判为「登录失效」。

- **排查**：带整套 cookie 访问 `disk/main` 页面，在 `window.locals` 里发现 `isLogin:0, bdstoken:""`——服务器眼里我们就是没登录！但明明 `api/list?dir=/apps/mynote`（同样的 BDUSS+STOKEN）能正常列目录、errno=0。
- **决定性实测**：直接跳过 getBdstoken 预检，`/share/set` 里把 `bdstoken` 字段**传空字符串**，发送请求 → **errno=0 创建成功，link + pwd 都正确**。
- **结论**：百度在最近一次升级里对 `/share/set?channel=chunlei&clienttype=0&web=1` 已不再强制校验 bdstoken，而 `gettemplatevariable` 接口对「非浏览器真实会话」的 API 调用加了更严的风控。**所有路径（本地脚本 + Worker）彻底删除 getBdstoken 这一步**，直接用 BDUSS/STOKEN 调 /share/set，errno=-6 才真的提示登录失效。

> 这两个踩坑的组合花了大半天的扫码才定位清楚。教训：**当「预检接口」和「真正业务接口」的鉴权结论不一致时，以业务接口的真实返回为准**，不要迷信预检的单一错误码。

### 困难 3：Astro 7 移除了 markdown-remark

注册 remarkPlugins 的第一版 `astro.config.ts` 在 build 时报：
```
markdown.remarkPlugins run on the unified processor from @astrojs/markdown-remark,
which is no longer installed by default now that Sätteri is the default Markdown processor.
```
额外 `npm install @astrojs/markdown-remark` 就好。已在 Hard Constraints 里标注，防止以后换环境重踩。

## 6. 后续建议

1. **CI 每月一次的定时 baidu:sync**——百度的分享链接理论上永久有效，但长期可能因为账号风控被批量失效；在 `.github/workflows/deploy.yml` 加一个每月 1 号的 `schedule` cron，跑 `npm run baidu:sync` 后提交 src/files + netdisk.json 变更，可以自动修复任何静默失效（目前是手动或每次 push 触发）。
2. **Worker 持久化 refresh_token**——目前 refresh_token 轮换要人工 `wrangler secret put`；给 Worker 加一个 KV Namespace（`wrangler.toml` 的 `kv_namespaces`），检测到轮换时 `await KV.put("BAIDU_REFRESH_TOKEN", newRt)`，可彻底解放人工。
3. **/files/ 资料页的客户端 marked 预览**现在不会渲染 `{{netdisk …}}` token（marked 不经过 Astro 的 remark 流程）—— 可在 `src/pages/files/index.astro` 的 marked 渲染前，对文本内容先跑一次正则替换，把 token 替换成 nd-card HTML（和 remark-netdisk 渲染规则保持一致）。
4. **Worker /disk/download 代理**目前计划里 v1 没做——大文件会把 Workers 出口流量翻一倍；如果以后想支持「临时直链下载」不走 pan.baidu.com 跳转，要评估一下 Workers R2 作为中转缓存，避免重复拉取。
5. **文件名含 `{}/}` 的边界情况**——目前正则 `[^{}]+` 会截断，遇到再处理即可；文档和管理页提示里已写明这是已知限制。

---

*项目仓库：<https://github.com/2110693561/2110693561.github.io>*
