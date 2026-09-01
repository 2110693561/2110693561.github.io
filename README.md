# MyNote · 个人技术博客

基于 Astro 的静态博客，部署在 GitHub Pages。参考 AstroPaper / Fuwari 等主流开源博客的功能设计。

## 技术栈

- **Astro 7**：静态站点生成
- **Markdown**：所有内容都是仓库里的 md 文件
- **Fuse.js**：构建时生成索引的客户端全文搜索
- **@astrojs/rss / @astrojs/sitemap**：RSS 订阅与 SEO
- **GitHub Actions**：推送到 main 自动构建部署

## 功能

- 文章系统：分类、标签、按年份归档、上下篇导航
- 文章详情：自动目录（TOC）、阅读时长估算、代码高亮
- 随手记：碎片化笔记时间线，只需 date + 正文
- 网页后台：`/admin/` 基于 Decap CMS，文章 / 随手记 / 批注 / 项目都能在浏览器里新增、修改、删除
- 密码保护：文章或随手记设置 `password` 后，构建时内容用 AES-256-GCM 加密，访客输入密码才能查看（密码不出现在任何公开页面）
- 段落批注：文章页悬停任意段落点「批注」，写完复制 JSON 到后台保存，重新构建后显示在对应段落旁
- 隐藏项目：项目数据（`src/data/projects.json`）里设置 `hidden: true` 即可不在网站显示
- 全文搜索：标题 / 描述 / 分类 / 标签（加密内容自动排除）
- Giscus 评论：基于 GitHub Discussions（在 `src/config.ts` 填好配置后开启）
- 访问统计：不蒜子站点访问量（页脚展示，可在 `src/config.ts` 关闭）
- 明暗主题：跟随系统 + 手动切换，无闪烁
- RSS：`/rss.xml`（加密内容自动排除）
- Sitemap + SEO meta
- 项目展示页、关于页、404 页

## 本地运行

需要 Node.js 22+。

```bash
npm install
npm run dev
```

打开 http://localhost:4321

## 目录结构

```
src/
├── config.ts              # 站点配置（站点名、导航、社交链接、项目数据）
├── content.config.ts      # 内容集合定义（blog / notes）
├── content/
│   ├── blog/              # 文章（frontmatter: title, date, category, tags, draft, password?）
│   └── notes/             # 随手记（frontmatter: date, title?, tags?, password?）
├── data/
│   ├── annotations/       # 段落批注（JSON，后台维护）
│   └── projects.json      # 项目展示数据（支持 hidden）
├── layouts/BaseLayout.astro
├── components/            # PostCard / NoteCard / LockedContent
├── pages/                 # 路由页面
├── styles/global.css      # 设计系统（CSS 变量明暗主题）
└── utils/                 # posts / encrypt / annotations 工具函数
public/admin/              # Decap CMS 后台（/admin/）
```

## 写一篇新文章

在 `src/content/blog/` 新建 md 文件：

```md
---
title: 文章标题
description: 一句话摘要（列表和 SEO 用）
date: 2026-09-01
category: 分类名
tags: [标签1, 标签2]
---

正文，支持标准 Markdown。
```

`draft: true` 的文章不会出现在网站任何地方。

## 写一条随手记

在 `src/content/notes/` 新建 md 文件：

```md
---
date: 2026-09-01
tags: [可选]
---

随便写点什么，支持 Markdown。
```

## 网页后台（写作 / 管理）

访问 `/admin/`（导航栏「后台」入口），可以增删改文章、随手记、段落批注和项目，还能在「站点设置」里修改站点名称、作者、首页描述等基础信息（改动保存后自动构建上线）。

**本地使用**：另开一个终端运行 `npm run cms`，再打开 `http://localhost:4321/admin/`，即可直接读写本地文件（无需登录）。

**线上使用（部署后）**：

1. 创建 GitHub OAuth App（Settings → Developer settings → OAuth Apps）：
   - Homepage URL：你的 Pages 地址
   - Authorization callback URL：`https://你的-worker域名/callback`
2. 在 `oauth-worker/` 目录下部署 Cloudflare Worker（需要 Cloudflare 账号）：

   ```bash
   npx wrangler login
   npx wrangler secret put GITHUB_CLIENT_ID     # 粘贴 OAuth App 的 Client ID
   npx wrangler secret put GITHUB_CLIENT_SECRET # 粘贴 OAuth App 的 Client Secret
   npx wrangler deploy
   ```

3. 在 `public/admin/config.yml` 里填上 `repo` 和 `base_url`（Worker 地址），并注释掉 `local_backend`

**Giscus 评论**（可选）：仓库需公开并开启 Discussions，安装 [giscus app](https://github.com/apps/giscus)，然后按 `src/config.ts` 里 `GISCUS` 的注释从 [giscus.app](https://giscus.app/zh-CN) 取值填入，`enabled: true` 即可。加密文章不显示评论。

**访问统计**：默认开启不蒜子（无需注册），页脚显示站点总访问量；`src/config.ts` 里 `ANALYTICS.busuanzi: false` 可关闭。

**密码保护**：在后台给文章/随手记填「查看密码」，或直接在 frontmatter 加 `password: xxx`。构建时内容会被 AES-256-GCM 加密，访客输入密码后浏览器本地解密。加密内容不会进入搜索索引和 RSS。

**段落批注**：文章页把鼠标悬停在任意段落上，右侧出现「批注」按钮 → 写内容 → 点「复制批注 JSON」→ 到后台「段落批注」新建并填入对应字段保存，网站重新构建后批注显示在段落旁。

## 部署到 GitHub Pages

1. 把 `src/config.ts` 里的 `website` 改成你的 Pages 地址（如 `https://yourname.github.io`），`public/robots.txt` 同步修改
2. 仓库名如果不是 `yourname.github.io`，把 `src/config.ts` 的 `base` 改成 `/仓库名/`
3. 推送到 GitHub，仓库 Settings → Pages → Source 选 **GitHub Actions**
4. 推送到 main 后自动构建部署（见 `.github/workflows/deploy.yml`）

## 定制

几乎所有个性化内容集中在 `src/config.ts`：站点名称、作者、导航、社交链接、项目展示数据。配色主题在 `src/styles/global.css` 顶部的 CSS 变量里。

## 路线图

- [x] v2 基础框架
- [x] v3 网页后台 + 密码保护 + 段落批注
- [x] v3.1 Giscus 评论 + 访问统计（本仓库当前状态）
- [ ] 线上后台 OAuth 登录（按上文步骤部署 oauth-worker 后即可启用）
- [ ] GitHub Pages 上线

## 历史

v1 版本代码备份在 `tech-notes-blog-v1.zip`。
