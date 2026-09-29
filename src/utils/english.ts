import { getCollection, type CollectionEntry } from "astro:content";

export type EnglishEntry = CollectionEntry<"english">;

/** 固定的学习类型顺序（列表分组与后台下拉共用） */
export const ENGLISH_TYPES = ["词汇", "语法", "听力", "口语", "阅读", "写作", "表达", "综合"] as const;

/** 按日期倒序获取所有已发布（非草稿、非隐藏）英语笔记 */
export async function getSortedEnglish(): Promise<EnglishEntry[]> {
  const list = await getCollection("english", ({ data }) => !data.draft && !data.hidden);
  return list.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** 详情页 URL */
export function englishUrl(id: string): string {
  return `${import.meta.env.BASE_URL}english/${id}/`;
}

/** 列表页类型分组锚点 */
export function englishTypeAnchor(type: string): string {
  return `${import.meta.env.BASE_URL}english/#type-${encodeURIComponent(type)}`;
}

/** 标题缺省时取正文首句纯文本（去 markdown 符号，截断 24 字） */
export function displayTitle(entry: EnglishEntry, max = 24): string {
  if (entry.data.title) return entry.data.title;
  const plain = (entry.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-!\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain || "未命名笔记";
}

/** 正文纯文本摘要（去 markdown 符号与代码块，用于搜索索引） */
export function plainExcerpt(entry: EnglishEntry, max = 120): string {
  const plain = (entry.body ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[>*_~|#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? plain.slice(0, max) + "…" : plain;
}

/** 按类型分组（按 ENGLISH_TYPES 固定顺序，未知类型排最后），组内日期倒序 */
export function groupByType(list: EnglishEntry[]): Array<[string, EnglishEntry[]]> {
  const map = new Map<string, EnglishEntry[]>();
  for (const e of list) {
    const t = e.data.type || "综合";
    if (!map.has(t)) map.set(t, []);
    map.get(t)!.push(e);
  }
  const known = ENGLISH_TYPES.filter((t) => map.has(t)) as readonly string[];
  const extra = [...map.keys()].filter((t) => !known.includes(t));
  return [...known, ...extra].map((t) => [t, map.get(t)!]);
}
