// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";

export default defineConfig({
  site: SITE.website,
  base: SITE.base,
  output: "static",
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      // 统一使用深色代码主题，明暗模式下都好看
      theme: "one-dark-pro",
      wrap: true,
    },
  },
});
