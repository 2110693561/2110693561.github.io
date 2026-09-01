import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// 博客文章：src/content/blog/*.md
const blog = defineCollection({
  loader: glob({
    pattern: "**/*.{md,mdx}",
    base: "./src/content/blog",
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(""),
    date: z.coerce.date(),
    category: z.string().default("未分类"),
    tags: z.array(z.string()).default([]),
    // 草稿：保存但不发布，不出现在任何列表和 RSS/搜索里
    draft: z.boolean().default(false),
    // 隐藏：不在首页/列表/标签/分类/RSS/搜索中显示，但直接链接仍可访问（不公开收录）
    hidden: z.boolean().default(false),
    // 设置后内容加密，访客输入密码才能查看
    password: z.string().optional(),
  }),
});

// 随手记：src/content/notes/*.md
// 低门槛碎片笔记：只需 date + 正文，标题和标签可选
const notes = defineCollection({
  loader: glob({
    pattern: "**/*.md",
    base: "./src/content/notes",
  }),
  schema: z.object({
    date: z.coerce.date(),
    title: z.string().optional(),
    tags: z.array(z.string()).default([]),
    // 草稿随手记：不显示
    draft: z.boolean().default(false),
    // 隐藏随手记：不在时间线显示，直接链接仍可访问
    hidden: z.boolean().default(false),
    // 设置后内容加密，访客输入密码才能查看
    password: z.string().optional(),
  }),
});

// 资料：上传的文件记录，src/files/*.md（附件实体在 public/files/）
// 用于个人资料库：支持在 /files/ 页面预览与下载
const files = defineCollection({
  loader: glob({
    pattern: "*.md",
    base: "./src/files",
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    description: z.string().optional(),
    // 附件地址（如 /files/xxx.pdf）
    attachment: z.string(),
    // 隐藏：不在资料页显示
    hidden: z.boolean().default(false),
  }),
});

export const collections = { blog, notes, files };
