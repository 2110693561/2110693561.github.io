/**
 * netdisk-card.mjs：网盘下载卡片的 HTML 生成（共享）
 * ---------------------------------------------------------------
 * remark-netdisk（构建期 mdast 替换）与 [slug].astro 批注内容预渲染共用此模块，
 * 保证文章正文与批注里的卡片样式严格一致（类名对应 global.css 的 .nd-*）。
 * 纯 JS 无依赖；卡片只用 data-* 属性，点击复制由 BaseLayout 全局脚本委托。
 *
 * token 语法（两种）：
 *   1. {{netdisk 文件名}}                   ← 查 src/data/netdisk.json 清单
 *   2. {{netdisk 文件名#分享ID#提取码}}      ← 直接渲染，不查清单（选全盘文件时用）
 *      分享ID = pan.baidu.com/s/ 后面的部分；提取码可省略
 *      用 # 分隔（不用 |，避免 Markdown 表格语法冲突；不含 https:// 避免 GFM autolink 拆节点）
 */

const TOKEN_RE = /\{\{(?:netdisk|网盘)\s+([^{}]+?)\s*\}\}/g;

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function formatSize(s) {
  if (!Number.isFinite(s) || s <= 0) return "";
  if (s < 1024) return `${s} B`;
  if (s < 1048576) return `${(s / 1024).toFixed(1)} KB`;
  return `${(s / 1048576).toFixed(1)} MB`;
}

/** 解析 token 内容：支持「文件名」和「文件名#分享ID#提取码」两种语法
 *  分享ID = pan.baidu.com/s/ 后面的部分，插件自动拼回完整 URL */
function parseToken(raw) {
  var parts = raw.split("#");
  var basename = parts[0].trim();
  var shareId = parts.length > 1 ? parts[1].trim() : null;
  var code = parts.length > 2 ? parts[2].trim() : null;
  return {
    basename,
    url: shareId ? "https://pan.baidu.com/s/" + shareId : null,
    code: code || null,
  };
}

/** 已分享文件 → 下载卡片（含下载按钮 + 提取码复制按钮） */
function buildCardHtml(entry) {
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

/** 网盘中未找到的文件 → 占位提示卡片 */
function buildMissingHtml(name) {
  return (
    `<span class="nd-card nd-missing"><span class="nd-ico">⚠️</span>` +
    `<span class="nd-info"><span class="nd-name">${esc(name)}</span><span class="nd-meta">网盘中未找到该文件</span></span>` +
    `<a class="nd-btn" href="/disk/">查看网盘</a></span>`
  );
}

/** 在清单里按 basename 查找条目 */
function findEntry(manifest, basename) {
  return (manifest?.files || []).find((f) => f.basename === basename) || null;
}

/**
 * 把原始字符串里的 {{netdisk ...}} / {{网盘 ...}} 替换为卡片 HTML。
 * 用于批注内容预渲染：先 replaceTokens(raw) → marked.parse() 得最终 HTML。
 * marked 会把内联 HTML span 原样保留，卡片样式不破坏。
 *
 * 支持两种语法：
 *   {{netdisk 文件名}}                → 查清单渲染
 *   {{netdisk 文件名#分享ID#提取码}}   → 直接渲染（全盘文件用，分享ID = /s/ 后的部分）
 */
function replaceTokens(raw, manifest) {
  if (!raw || !raw.includes("{{")) return raw;
  return raw.replace(TOKEN_RE, (m, raw2) => {
    const { basename, url, code } = parseToken(raw2);
    // 扩展语法：内嵌了 url → 直接渲染卡片，不查清单
    if (url) {
      return buildCardHtml({ basename, size: 0, link: url, code });
    }
    // 标准语法：查清单
    const entry = findEntry(manifest, basename);
    return entry ? buildCardHtml(entry) : buildMissingHtml(basename);
  });
}

export { TOKEN_RE, esc, formatSize, parseToken, buildCardHtml, buildMissingHtml, findEntry, replaceTokens };
