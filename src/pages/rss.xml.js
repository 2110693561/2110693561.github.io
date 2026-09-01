import rss from "@astrojs/rss";
import { getSortedPosts, postUrl } from "../utils/posts";
import { SITE } from "../config";

export async function GET(context) {
  // 加密文章不进 RSS
  const posts = (await getSortedPosts()).filter((p) => !p.data.password);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site,
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: postUrl(p.id),
      categories: [...p.data.tags],
    })),
    customData: "<language>zh-CN</language>",
  });
}
