// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";
import remarkNetdisk from "./src/utils/remark-netdisk.mjs";

export default defineConfig({
  site: SITE.website,
  base: SITE.base,
  output: "static",
  integrations: [sitemap()],
  markdown: {
    // {{netdisk 文件名}} / {{网盘 文件名}} → 网盘下载卡片（数据源 src/data/netdisk.json）
    remarkPlugins: [remarkNetdisk],
    shikiConfig: {
      // 统一使用深色代码主题，明暗模式下都好看
      theme: "one-dark-pro",
      wrap: true,
    },
  },
});
