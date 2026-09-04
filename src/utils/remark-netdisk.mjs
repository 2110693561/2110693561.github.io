/**
 * remark-netdisk：把正文里的 {{netdisk 文件名}} / {{网盘 文件名}} 标记
 * 在构建期替换为网盘下载卡片（链接与提取码来自 src/data/netdisk.json，
 * 由 scripts/baidu-sync.mjs 生成）。代码块内不处理；未知文件渲染为占位提示。
 * 纯 JS 无依赖；卡片只用 data-* 属性，点击复制由 BaseLayout 的全局脚本委托。
 */
import fs from "node:fs";
import path from "node:path";

const TOKEN_RE = /\{\{(?:netdisk|网盘)\s+([^{}]+?)\s*\}\}/g;
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

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatSize(s) {
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 1024) return `${s} B`;
  if (s < 1048576) return `${(s / 1024).toFixed(1)} KB`;
  return `${(s / 1048576).toFixed(1)} MB`;
}

function cardHtml(entry) {
  const name = esc(entry.basename);
  const size = formatSize(entry.size);
  const code = entry.code ? esc(entry.code) : "";
  const meta = [size, code ? `提取码 ${code}` : null].filter(Boolean).join(" · ");
  const link = entry.link
    ? `<a class="nd-btn baidu-btn" href="${esc(entry.link)}" target="_blank" rel="noopener">下载</a>`
    : `<a class="nd-btn nd-disabled" href="/disk/" title="分享链接尚未创建，稍后自动补齐">待分享</a>`;
  const copy = code
    ? `<button class="nd-copy code-btn" type="button" data-code="${code}" title="点击复制提取码">提取码</button>`
    : "";
  return (
    `<span class="nd-card"><span class="nd-ico">📦</span>` +
    `<span class="nd-info"><span class="nd-name">${name}</span><span class="nd-meta">${esc(meta)}</span></span>` +
    `${link}${copy}</span>`
  );
}

function missingHtml(name) {
  return (
    `<span class="nd-card nd-missing"><span class="nd-ico">⚠️</span>` +
    `<span class="nd-info"><span class="nd-name">${esc(name)}</span><span class="nd-meta">网盘中未找到该文件</span></span>` +
    `<a class="nd-btn" href="/disk/">查看网盘</a></span>`
  );
}

function splitTextNode(node) {
  const parts = [];
  let last = 0;
  for (const m of node.value.matchAll(TOKEN_RE)) {
    const start = m.index;
    if (start > last) parts.push({ type: "text", value: node.value.slice(last, start) });
    const name = m[1];
    const entry = (loadManifest().files || []).find((f) => f.basename === name);
    if (entry) {
      parts.push({ type: "html", value: cardHtml(entry) });
    } else {
      console.warn(`[remark-netdisk] 网盘中未找到「${name}」，已渲染为占位提示（可在 /admin/disk/ 上传后重跑同步）`);
      parts.push({ type: "html", value: missingHtml(name) });
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
