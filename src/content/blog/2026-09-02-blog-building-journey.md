---
title: 我的博客是怎么搭起来的：技术栈、踩坑实录与优化路线
description: 从零搭建 Astro + Decap CMS 博客的完整复盘：技术选型、架构设计、功能实现细节，十几个实际问题的排查与解决过程，以及后续优化路线图。
date: 2026-09-02
category: 建站
tags: [Astro, Decap CMS, GitHub Pages, Cloudflare, 踩坑]
---

这个博客从上线到现在，前前后后做了大量迭代：网页后台、草稿/加密、资料管理、随手记导入、批注系统……这篇文章把技术栈、实现细节、踩过的坑和后续规划一次性讲清楚。

## 一、成果概览

先看现在这个站已经有什么：

- **前台**：文章（分类/标签/归档）、随手记时间线、资料预览页（预览懒加载）、项目展示、全文搜索、RSS、明暗主题、giscus 评论、全站折叠式浏览（首页三个区块 + 每条内容可展开）
- **后台**（`/admin/`）：完全在网页上写作和管理，不需要本地环境，不需要手动 git
- **内容管理**：草稿、隐藏、密码加密、批量上传、整文件夹上传、本地笔记导入、划段批注
- **托管成本**：0 元（GitHub Pages + Cloudflare 免费额度）

## 二、技术栈全景

| 层 | 技术 | 用途 |
|---|---|---|
| 站点框架 | Astro | 静态生成、内容集合（Content Collections）+ schema 校验 |
| 网页后台 | Decap CMS 3 | 浏览器里的写作/管理界面，单 HTML 接入 |
| 托管 | GitHub Pages | 免费静态托管，`用户名.github.io` |
| CI/CD | GitHub Actions | push 后自动 `astro build` 并发布 |
| 内容存储 | Git 仓库本身 | 所有文章/配置都是 Markdown/JSON/YAML 文件 |
| API | GitHub Contents API / Git Data API | 网页后台读写仓库；Git Data API 用于批量提交 |
| 登录 | GitHub OAuth App + Cloudflare Worker | OAuth 中转服务，Secret 存 Worker 环境变量 |
| 加密 | Web Crypto API（AES-GCM + PBKDF2） | 构建时加密正文，浏览器端输入密码解锁 |
| 本地开发 | decap-server | 本地跑 CMS 时代理 GitHub 认证 |
| 前端增强 | 原生 CSS 变量 / MutationObserver / IntersectionObserver | 主题系统、后台 UI 注入、灯箱等 |
| 统计 | 不蒜子 | 页面访问计数 |

几个选型理由：

- **Astro**：默认零 JS、构建极快，Content Collections 可以用 zod schema 约束 frontmatter，写错字段构建直接报错，等于给内容上了类型检查
- **Decap CMS**：不需要任何服务端，一个 `config.yml` 就能生成后台；内容仍以纯 Markdown 存仓库，随时可迁移
- **Cloudflare Worker**：GitHub OAuth 需要 client_secret，不能暴露在前端，免费额度的 Worker 正好做中转

## 三、架构设计

```
浏览器 ──> GitHub Pages（Astro 构建产物 + /admin/ 后台）
                │
                ├──> GitHub API：网页后台直接读写仓库内容（每次保存 = 一次 git commit）
                ├──> OAuth Worker（Cloudflare）：GitHub 登录中转，持有 client_secret
                └──> 不蒜子：访问统计

push 到 main ──> GitHub Actions：npm ci → astro build → deploy-pages
```

核心思路：**内容即代码**。所有内容以 Markdown 存在仓库里，后台只是仓库的一个友好视图，任何改动都是可追溯、可回滚的 git 提交。

## 四、关键功能实现细节

### 1. 内容状态：草稿 / 隐藏 / 加密

在 schema 里给文章和随手记加了三个字段（`src/content.config.ts`）：

```ts
// 草稿：只在后台可见，网站/RSS/搜索都不出现
draft: z.boolean().default(false),
// 隐藏：不在首页/列表/标签/分类/RSS/搜索中显示，但直接链接仍可访问
hidden: z.boolean().default(false),
// 设置后内容加密，访客输入密码才能查看
password: z.string().optional(),
```

所有列表查询统一过滤：

```ts
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft && !data.hidden);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}
```

加密的实现分两端。**构建时**（Node 端）用 AES-256-GCM 加密正文，密文和 salt/iv 一起内联进页面，明文不落盘：

```ts
import { randomBytes, pbkdf2Sync, createCipheriv } from "node:crypto";

const PBKDF2_ITERATIONS = 120000;

export function encryptForBrowser(plain: string, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // WebCrypto 的 AES-GCM 要求 tag 附在密文尾部
  return {
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    data: Buffer.concat([encrypted, tag]).toString("base64"),
  };
}
```

**浏览器端**拿到密文后，输入密码用 WebCrypto 的 `crypto.subtle.deriveKey`（PBKDF2 参数与构建端一致）派生密钥解密。这样即使直接翻仓库源码也看不到加密内容。

### 2. 后台增强：不改源码的 CSS/JS 注入

Decap 后台是 React 应用，没有官方主题能力。做法是在 `/admin/index.html` 里注入自定义 CSS（用 `[class*="appBar" i]` 这类属性选择器匹配内部类名）和一段常驻脚本：

- 顶栏注入「回到主页」按钮和**明暗切换**（读写同一个 `localStorage.theme` 与前台同步）
- 列表行注入快捷按钮：草稿 / 隐藏 / 加密 / 删除，一键切换并保存
- 编辑器里用 `MutationObserver` 监控 DOM，自动放大图片缩略图 + 点击灯箱
- 注册自定义预览模板，让编辑器「预览」面板的排版与前台完全一致

注入按钮的核心模式——MutationObserver 监听 DOM 变化，按钮不存在就插一个（Decap 是 SPA，页面切换会重建 DOM，所以要常驻补位）：

```js
function ensure() {
  var host = document.querySelector('#nc-root [class*="appBar" i]');
  if (host && !document.getElementById("back-to-blog")) {
    var a = document.createElement("a");
    a.id = "back-to-blog";
    a.href = "https://xxx.github.io/";
    a.textContent = "← 回到主页";
    host.insertBefore(a, host.firstChild);
  }
}
new MutationObserver(function () {
  pending ||= setTimeout(ensure, 200); // 防抖，避免频繁操作 DOM
}).observe(document.body, { childList: true, subtree: true });
```

### 3. 批量提交：Git Data API（关键代码）

这是整个后台最核心的一段：把 N 个文件合成**一次 commit**，绕开 GitHub 二级限流。流程是「建 blob → 建 tree → 建 commit → 更新分支引用」：

```js
// 批量提交：多个文件合成一次 commit
async function ghPutFilesBatch(token, files, message) {
  const j = async (url, opts) => {
    const res = await fetch("https://api.github.com" + url,
      { ...opts, headers: { Authorization: `token ${token}` } });
    if (!res.ok) throw new Error("GitHub " + res.status);
    return res.json();
  };
  // 1. 拿到分支最新 commit（每次都 no-store，避免旧引用导致 409）
  const ref = await j(`/repos/${REPO}/git/ref/heads/${BRANCH}`, { cache: "no-store" });
  const baseCommit = await j(`/repos/${REPO}/git/commits/${ref.object.sha}`);
  // 2. 每个文件上传为 blob
  const treeItems = [];
  for (const f of files) {
    const blob = await j(`/repos/${REPO}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content: f.content, encoding: "base64" }),
    });
    treeItems.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  // 3. 建树（基于原树的 delta）→ 4. 建 commit → 5. 快进分支引用
  const tree = await j(`/repos/${REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
  });
  const commit = await j(`/repos/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [baseCommit.sha] }),
  });
  await j(`/repos/${REPO}/git/refs/heads/${BRANCH}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
}
```

配合坑 3 的 409 问题，所有单文件写操作都遵循「先读最新 SHA，再提交」：

```js
// 先拉最新文件拿 SHA，再带着 SHA 提交，避免 409 Conflict
const res = await fetch(`${GH}/repos/${REPO}/contents/${path}?t=${Date.now()}`, {
  headers: { Authorization: `token ${token}` }, cache: "no-store",
});
const { sha } = await res.json();
await fetch(`${GH}/repos/${REPO}/contents/${path}`, {
  method: "PUT",
  headers: { Authorization: `token ${token}` },
  body: JSON.stringify({ message, content: btoa(content), sha }),
});
```

### 4. 批注系统

文章页选中文字 → 写批注 → **直接调 GitHub Contents API 提交** `src/data/annotations/` 下的 JSON 文件。构建时把批注数据内联进文章页，正文段落标号定位。批注按钮的垂直位置限制在文章标题以下，避免遮挡：

```js
// 按钮最高只出现在文章标题下方
const header = document.querySelector(".post-header");
const minTop = header ? header.getBoundingClientRect().bottom + 4 : 8;
hoverBtn.style.top =
  `${Math.max(minTop, Math.min(rect.top - 14, window.innerHeight - 48))}px`;
```

### 5. 资料管理

- 资料条目是 `src/files/` 下的 Markdown，附件存 `public/files/`（单文件批量上传加时间戳前缀防重名）
- 批量上传：原生文件选择器 Ctrl/Shift 多选 → 逐个上传 → **合并为一次 git 提交** → 刷新列表
- **整文件夹上传**：选择一个文件夹，内部所有文件（含子文件夹）合并为一条资料，**保留相对目录结构**——说明文档 `.md` 里的图片相对引用（如 `assets/图1.png`）在预览页渲染时自动正常显示，不用改任何路径：

```js
// 文件夹上传核心：按「大小分流 + 分批合并提交」
const big = [], small = [];
files.forEach((f) => (f.size < 2 * 1048576 ? small : big).push(f));
// 大文件逐个传（XHR 读实时百分比），422 已存在时自动取 sha 覆盖
for (const f of big) {
  const path = `public/files/${base}/${safeRelPath(relPathOf(f, root))}`;
  await ghPutFileCover(t, path, await b64OfBlob(f), "上传资料：" + f.name, onProgress);
}
// 小文件每 15 个合并为一次 commit，避免连续提交触发次级限流
for (let i = 0; i < small.length; i += 15) {
  const items = await Promise.all(small.slice(i, i + 15).map(toBlobItem));
  await ghPutFilesBatch(t, items, "上传资料（批量）：" + base);
}
```

  其他细节：自动跳过 `.DS_Store` / `Thumbs.db` 等垃圾文件；重复上传同名文件夹时自动覆盖旧文件而不是报错。

- 预览页 `/files/`：图片直接显示、PDF 内嵌、Markdown 渲染成页面，其他类型给下载链接；**预览区默认收起，展开时才发起加载**（见坑 12）
- 删除资料时级联删除附件文件，避免媒体库残留孤儿文件

### 6. 随手记导入

支持两种方式：

- **单文件导入**：多个 `.md/.txt`，文件名即标题，自动补日期；带 frontmatter 的保留原标题/标签
- **文件夹导入（推荐）**：把 `笔记.md` 和 `笔记.assets/` 自动配对，图片上传到 `public/images/notes/笔记名/`，**并改写文中所有图片路径**，跳过 `.DS_Store` 等垃圾文件

所有文件合并成**一次 git 提交**（Git Data API：创建 tree → 创建 commit → 更新 ref），既快又不会触发限流。

### 7. 前台体验

**折叠式浏览**：从随手记推广到了全站——首页「最新文章 / 随手记 / 资料」三个区块统一用原生 `<details>/<summary>` 折叠（点击标题栏展开收起，箭头旋转 + 淡入动画，标题栏里的跳转链接 `stopPropagation` 防误触）；每条随手记默认只显示开头，`scrollHeight` 判断内容短就直接完整显示，避免出现无意义的按钮：

```js
document.querySelectorAll(".note-fold").forEach((box) => {
  const content = box.querySelector(".note-content");
  const btn = box.querySelector(".note-fold-btn");
  if (content.scrollHeight <= 150) {       // 内容不长就不折叠
    box.removeAttribute("data-collapsed");
    return;
  }
  btn.hidden = false;
  btn.addEventListener("click", () => {
    if (box.hasAttribute("data-collapsed")) {
      box.removeAttribute("data-collapsed");
      btn.textContent = "收起";
    } else {
      box.setAttribute("data-collapsed", "");
      btn.textContent = "展开全文";
    }
  });
});
```

**资料页懒加载**：每份资料的附件与预览区默认收起（卡片只剩标题行 + 「展开预览 (N)」按钮），**展开时才首次加载** PDF iframe / 拉取文本——首屏不再发一堆请求，页面从「无限长」变成一屏能览：

```js
btn.addEventListener("click", () => {
  if (fold.hasAttribute("data-collapsed")) {
    if (!loaded) {                          // 首次展开才加载预览
      loaded = true;
      fold.querySelectorAll(".file-inline").forEach((box) =>
        fillPreview(box.dataset.kind, box.dataset.url, box)
      );
    }
    fold.removeAttribute("data-collapsed");
    btn.textContent = "收起";
  } else {
    fold.setAttribute("data-collapsed", "");
    btn.textContent = `展开预览 (${count})`;
  }
});
```

**编辑器预览**：注册自定义预览模板，套上前台同款 `.prose` 样式表，预览即所见即所得（还要把明暗主题同步进预览 iframe）：

```js
CMS.registerPreviewStyle("/admin/preview.css");
var MarkdownPreview = createClass({
  render: function () {
    // widgetFor 用 Decap 内置渲染 Markdown，容器套前台排版
    return h("div", { className: "prose" }, this.props.widgetFor("body"));
  }
});
CMS.registerPreviewTemplate("blog", MarkdownPreview);
CMS.registerPreviewTemplate("notes", MarkdownPreview);
```

## 五、踩坑实录：问题与解决

### 坑 1：OAuth 登录失败

**现象**：后台 GitHub 登录后回调报错。
**原因**：OAuth App 的回调 URL 与 Worker 实际回调地址不完全一致（多了或少了一个 `/callback`）。
**解决**：回调 URL 必须精确到 `Worker地址/callback`；`client_secret` 用 `npx wrangler secret put GITHUB_CLIENT_SECRET` 存进 Worker，绝不写进仓库。

### 坑 2：批量导入触发 GitHub 二级限流

**现象**：连续导入多篇笔记后，后面的提交全部 403，要等很久才恢复。
**原因**：每个文件一次 commit，短时间高频写操作触发 GitHub 的 abuse 限流。
**解决**：改用 **Git Data API 批量提交**——先把所有文件的 blob 建好，一次性建 tree、创建 commit、更新分支引用。N 个文件从 N 次提交变成 1 次。

### 坑 3：保存时 409 Conflict

**现象**：后台点快捷按钮（草稿/隐藏/删除）偶尔报 409。
**原因**：页面拿着缓存的文件 SHA 去更新，而文件在别处已被改过，SHA 对不上。
**解决**：所有写操作前先 GET 一次最新 SHA 再提交；同时给请求加时间戳禁用缓存。

### 坑 4：部署成功但页面不更新（最迷惑）

**现象**：代码 push 了，Actions 也绿了，线上页面还是旧的，连带查询参数都绕不过缓存。
**原因**：GitHub Pages 的 Fastly CDN 对 HTML 有 **10 分钟缓存**（`max-age=600`），且 cache key 不区分查询参数。
**解决**：
1. 用 `curl -I` 看响应头：`Last-Modified` 是部署时间、`X-Cache: MISS/HIT`、`Age` 判断缓存状态
2. 请求一个**只在新版本里存在的静态资源**（如新 hash 的 CSS 文件）确认部署是否真的完成——静态资源与 HTML 同批部署，资源在就说明部署成功，剩下的只是缓存等待
3. 急用时推一个空提交强制重新触发部署

这次因为这个走了大弯路：抓取工具自身也有缓存，一直返回旧页面，差点误判成部署失败。

### 坑 5：后台「预览」按钮凭空消失

**现象**：编辑页找不到预览切换。
**原因**：`config.yml` 里集合级配置了 `editor: { preview: false }`，会直接禁用预览。
**解决**：改成 `preview: true`。教训：接手配置时先全局搜一遍关键配置项。

### 坑 6：构建失败——图片引用不存在

**现象**：导入笔记后站点构建直接红。
**原因**：笔记里的 `![](...)` 引用的图片没跟着导入，Astro 构建时找不到文件。
**解决**：用**文件夹导入**把 `笔记.assets/` 一起带上并改写路径；存量坏引用替换成占位文本。

### 坑 7：CMS 配置陷阱

- `folder_support: true` 会导致配置加载失败，别加
- 媒体目录配置不对时，上传的文件会落到 `src/files/public/files/` 这种嵌套怪路径，注意 `media_folder` / `public_folder` 要配套

### 坑 8：媒体库孤儿文件

**现象**：删了资料条目，媒体库里还有图。
**原因**：早期的删除只删记录不删附件。
**解决**：删除时级联删除 `public/files/` 下的附件；历史残留用媒体库多选清理一次。

### 坑 9：批注按钮遮挡标题

**现象**：批注按钮出现在文章标题区域，挡住视线。
**解决**：取 `.post-header` 的 `bottom` 作为按钮 top 的最小值：`Math.max(minTop, Math.min(rect.top - 14, ...))`。

### 坑 10：Windows / 环境问题

- PowerShell 执行策略拦截 `npm.ps1` → 统一用 `npm.cmd` / `npx.cmd`
- 沙箱/受限环境里网络操作被禁 → git push 留在本地终端执行
- 部署方式曾被改成「Deploy from branch」导致构建产物不对 → 恢复 Actions 工作流部署，并推空提交强制重部署

### 坑 11：浏览器缓存干扰判断

**现象**：改了后台样式怎么刷新都不变。
**原因**：浏览器本地缓存 + CDN 缓存双重叠加，普通刷新不生效。
**解决**：验证类操作一律 **Ctrl+F5** 硬刷新，或开无痕窗口；写操作请求统一加时间戳参数禁缓存。

### 坑 12：资料页「全量内嵌预览」拖垮页面

**现象**：资料一多，`/files/` 页面变成无限长——每份资料的 PDF iframe、Markdown 全文、图片全部直接铺开，首屏就发几十个请求，找一份资料要滚很久。
**原因**：页面加载时无条件给所有可预览文件建 `iframe` / `fetch` 内容，既浪费带宽又把页面撑爆。
**解决**：两层折叠——每份资料卡片默认只剩标题行 + 「展开预览 (N)」，展开时才首次加载预览内容（`loaded` 标记防止重复加载）；首页三个区块同样用 `<details>` 整体折叠。篇幅和性能一起解决。

## 六、后续优化路线

### 短期（体验补全）

- **文章 TOC 目录**：右侧悬浮显示 h2/h3 层级，滚动高亮当前小节（IntersectionObserver）
- **代码块增强**：语法高亮主题统一 + 一键复制按钮
- **图片优化**：懒加载（`loading="lazy"` 已有，补充 `srcset` 响应式）+ 转 WebP/AVIF + `astro:assets` 统一管理

> 评论系统已上线：用的就是 giscus（GitHub Discussions 存储），仓库 Discussions 开启 + 安装 [giscus App](https://github.com/apps/giscus) + 填入 `repoId` / `categoryId` 三步搞定，评论区主题跟随站点明暗切换，滚动到才懒加载。

### 中期（能力扩展)

- **搜索升级**：换成 Pagefind——构建时生成离线索引，搜索体验和分词都更好，还不占服务端
- **定时发布**：frontmatter 加 `pubDate`，构建时（Actions 定时触发）过滤未到时间的文章，实现「预约发布」
- **批注通知**：收到新批注时通过 Telegram Bot / 邮件推送提醒
- **写作端增强**：编辑器支持粘贴图片直接上传到媒体库；手机端快捷发布随手记（PWA 或快捷指令调用 GitHub API）
- **数据看板**：自托管 Umami 统计访问来源，替代纯计数

### 长期（工程化）

- **构建提速**：Actions 加 npm/Astro 构建缓存，构建时间从分钟级压到秒级
- **SEO 完善**：自动生成 `sitemap.xml`、Open Graph 图（构建时用 satori 渲染文章封面）
- **容灾备份**：Actions 定时把内容同步镜像到另一个私有仓库，防单点
- **预览环境**：PR / 分支部署预览（GitHub Pages 不支持，可评估 Cloudflare Pages 的分支预览能力）
- **View Transitions**：Astro 的视图过渡动画，让页面切换更顺滑

## 七、总结

1. **内容即代码**是这个站最核心的设计——Markdown 存仓库，后台只是视图，数据永远在自己手里
2. **静态方案的坑主要在「缓存」和「限流」**：CDN 缓存要有等待预期，批量写操作要合并提交
3. **免费 ≠ 凑合**：GitHub Pages + Cloudflare Worker + 原生前端技术就能做出完成度很高的产品

如果你也想搭一个类似的站，欢迎参考这篇文章的架构和踩坑记录。有问题可以在文章里划词批注，或在底部评论区留言（giscus，GitHub 账号直接登录），我都会收到提醒。
