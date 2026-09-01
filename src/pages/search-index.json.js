import { getSortedPosts, formatDate, postUrl } from "../utils/posts";

// 全站搜索索引（构建时生成 JSON，供搜索页使用）
// 加密文章不进索引
export async function GET() {
  const posts = (await getSortedPosts()).filter((p) => !p.data.password);
  const index = posts.map((p) => ({
    title: p.data.title,
    description: p.data.description ?? "",
    category: p.data.category,
    tags: p.data.tags,
    date: formatDate(p.data.date),
    url: postUrl(p.id),
  }));

  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
