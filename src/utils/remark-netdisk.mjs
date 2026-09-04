/**
 * remark-netdisk：把正文里的 {{netdisk 文件名}} / {{网盘 文件名}} 标记
 * 在构建期替换为网盘下载卡片（链接与提取码来自 src/data/netdisk.json，
 * 由 scripts/baidu-sync.mjs 生成）。代码块内不处理；未知文件渲染为占位提示。
 * 卡片 HTML 模板与批注预渲染共用 src/utils/netdisk-card.mjs，保证样式一致。
 */
import fs from "node:fs";
import path from "node:path";
import { TOKEN_RE, parseToken, buildCardHtml, buildMissingHtml, findEntry } from "./netdisk-card.mjs";

let manifestCache = null;

function loadManifest() {
  if (manifestCache) return manifestCache;
  try {
    manifestCache = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "data", "netdisk.json"), "utf8"));
  } catch {
    manifestCache = { files: [] };
  }
  return manifestCache;
}

function splitTextNode(node) {
  const parts = [];
  let last = 0;
  for (const m of node.value.matchAll(TOKEN_RE)) {
    const start = m.index;
    if (start > last) parts.push({ type: "text", value: node.value.slice(last, start) });
    const { basename, url, code } = parseToken(m[1]);
    if (url) {
      // 扩展语法：内嵌 url+code → 直接渲染卡片，不查清单
      parts.push({ type: "html", value: buildCardHtml({ basename, size: 0, link: url, code }) });
    } else {
      const entry = findEntry(loadManifest(), basename);
      if (entry) {
        parts.push({ type: "html", value: buildCardHtml(entry) });
      } else {
        console.warn(`[remark-netdisk] 网盘中未找到「${basename}」，已渲染为占位提示（可在 /admin/disk/ 上传后重跑同步）`);
        parts.push({ type: "html", value: buildMissingHtml(basename) });
      }
    }
    last = start + m[0].length;
  }
  if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
  return parts;
}

function walk(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "code" || node.type === "inlineCode") return;
  if (!Array.isArray(node.children)) return;
  const next = [];
  for (const child of node.children) {
    if (child && child.type === "text" && typeof child.value === "string" && child.value.includes("{{")) {
      next.push(...splitTextNode(child));
    } else {
      walk(child);
      next.push(child);
    }
  }
  node.children = next;
}

export default function remarkNetdisk() {
  return (tree) => {
    walk(tree);
  };
}
