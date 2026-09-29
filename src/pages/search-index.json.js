import { getSortedPosts, formatDate, postUrl } from "../utils/posts";
import { getSortedEnglish, englishUrl, displayTitle, plainExcerpt } from "../utils/english";

// 全站搜索索引（构建时生成 JSON，供搜索页使用）
// 加密内容不进索引
export async function GET() {
  const posts = (await getSortedPosts()).filter((p) => !p.data.password);
  const english = (await getSortedEnglish()).filter((e) => !e.data.password);

  const postIndex = posts.map((p) => ({
    title: p.data.title,
    description: p.data.description ?? "",
    category: p.data.category,
    tags: p.data.tags,
    date: formatDate(p.data.date),
    url: postUrl(p.id),
  }));

  const englishIndex = english.map((e) => ({
    title: displayTitle(e),
    description: plainExcerpt(e),
    category: `英语·${e.data.type}`,
    tags: e.data.tags,
    date: formatDate(e.data.date),
    url: englishUrl(e.id),
  }));

  // 合并后按日期倒序（YYYY-MM-DD 字符串可直接比较）
  const index = [...postIndex, ...englishIndex].sort((a, b) => (a.date < b.date ? 1 : -1));

  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
