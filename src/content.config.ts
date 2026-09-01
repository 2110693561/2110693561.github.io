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
    draft: z.boolean().default(false),
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
    // 设置后内容加密，访客输入密码才能查看
    password: z.string().optional(),
  }),
});

export const collections = { blog, notes };
