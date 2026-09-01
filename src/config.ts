// ============================================
// 站点全局配置：想定制博客，改这一个文件就够了
// ============================================

export const SITE = {
  // 站点名称（导航栏 logo 处显示）
  name: "MyNote",
  // 你的名字（页脚、RSS、SEO 用）
  author: "zhang",
  // 浏览器标签页标题
  title: "MyNote · 技术笔记",
  // 站点描述（首页 hero、SEO）
  description:
    "个人技术博客：嵌入式 GD32 / ESP32、Linux 与 AI 的学习笔记、项目记录和随手记。",
  // GitHub Pages 地址（username.github.io 仓库）
  website: "https://2110693561.github.io",
  // 仓库名为 yourname.github.io 时用 "/"；
  // 仓库名为其他（如 mynote）时改成 "/mynote/"
  base: "/",
  locale: "zh-CN",
};

// 导航栏（顺序即展示顺序）
export const NAV = [
  { text: "首页", url: "/" },
  { text: "文章", url: "/posts/" },
  { text: "随手记", url: "/notes/" },
  { text: "项目", url: "/projects/" },
  { text: "搜索", url: "/search/" },
  { text: "关于", url: "/about/" },
  { text: "后台", url: "/admin/" },
];

// 页脚社交链接
export const SOCIALS = [
  { name: "GitHub", url: "https://github.com/2110693561" },
  { name: "RSS", url: "/rss.xml" },
];

// ---------- 访问统计 ----------
// 不蒜子：无需注册账号，自动统计站点访问量（服务为第三方公共实例）
export const ANALYTICS = {
  // 设为 false 可关闭页脚的站点访问量统计
  busuanzi: true,
};

// ---------- Giscus 评论（基于 GitHub Discussions） ----------
// 启用步骤：
// 1. 博客仓库必须是公开仓库，并在 Settings → General → Features 勾选 Discussions
// 2. 安装 https://github.com/apps/giscus 到该仓库
// 3. 打开 https://giscus.app/zh-CN ，填入仓库名，选择一个 Discussion 分类，
//    把页面底部生成的 repo / repoId / category / categoryId 填到下面
// 4. enabled 改为 true
export const GISCUS = {
  enabled: false,
  repo: "", // 例如 yourname/mynote
  repoId: "",
  category: "Announcements",
  categoryId: "",
  // pathname：按路径把评论关联到每篇文章
  mapping: "pathname",
  reactionsEnabled: true,
};

// ---------- 项目展示页数据 ----------
// 项目数据存放在 src/data/projects.json（可在 CMS 后台编辑）
export interface Project {
  name: string;
  description: string;
  // 项目主页 / 在线演示
  url?: string;
  // 仓库地址
  repo?: string;
  tags?: string[];
  // 设为 true 后不在网站上展示
  hidden?: boolean;
}
