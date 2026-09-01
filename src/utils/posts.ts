import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"blog">;

/** 按日期倒序获取所有已发布（非草稿、非隐藏）文章 */
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection("blog", ({ data }) => !data.draft && !data.hidden);
  return posts.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 格式化为 2026-09-01 形式 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 粗略估算阅读时长（中文按 ~400 字/分钟，忽略代码块） */
export function readingMinutes(text: string | undefined): number {
  if (!text) return 1;
  const cleaned = text.replace(/```[\s\S]*?```/g, "").trim();
  return Math.max(1, Math.round(cleaned.length / 400));
}

/** 文章详情页 URL */
export function postUrl(slug: string): string {
  return `${import.meta.env.BASE_URL}posts/${slug}/`;
}

/** 统计标签 -> 文章数（降序） */
export function getTagMap(posts: Post[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of posts) {
    for (const t of p.data.tags) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}

/** 统计分类 -> 文章数（降序） */
export function getCategoryMap(posts: Post[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of posts) {
    const c = p.data.category;
    map.set(c, (map.get(c) ?? 0) + 1);
  }
  return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
}

/** 按年份分组（年份降序，组内日期降序） */
export function groupByYear(posts: Post[]): Array<[number, Post[]]> {
  const map = new Map<number, Post[]>();
  for (const p of posts) {
    const y = p.data.date.getFullYear();
    if (!map.has(y)) map.set(y, []);
    map.get(y)!.push(p);
  }
  return [...map.entries()].sort((a, b) => b[0] - a[0]);
}

/** 标签页 URL */
export function tagUrl(tag: string): string {
  return `${import.meta.env.BASE_URL}tags/${encodeURIComponent(tag)}/`;
}

/** 分类页 URL */
export function categoryUrl(cat: string): string {
  return `${import.meta.env.BASE_URL}categories/${encodeURIComponent(cat)}/`;
}
