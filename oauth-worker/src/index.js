export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      const callback = `${url.origin}/callback`;
      const github = new URL("https://github.com/login/oauth/authorize");
      github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      github.searchParams.set("redirect_uri", callback);
      github.searchParams.set("scope", "repo");
      return Response.redirect(github.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });

      const data = await tokenResp.json();
      if (!data.access_token) {
        return new Response(JSON.stringify(data), { status: 400, headers: {"content-type":"application/json"} });
      }

      const payload = {
        token: data.access_token,
        provider: "github"
      };

      // 标准 Decap/Netlify CMS 握手协议：
      // 1. 弹窗先向主窗口发 "authorizing:github" 表示就绪
      // 2. CMS 回发 "authorizing:github"，弹窗收到后才交付 token
      // 3. 2 秒未收到回应则直接投递（兼容旧版行为）
      const html = `<!doctype html><html><body><script>
        (function() {
          var payload = ${JSON.stringify(payload)};
          var done = false;
          function sendToken(origin) {
            if (done) return;
            done = true;
            window.opener.postMessage(
              'authorization:github:success:' + JSON.stringify(payload),
              origin || '*'
            );
            window.close();
          }
          window.addEventListener('message', function(e) {
            if (e.data === 'authorizing:github') sendToken(e.origin);
          }, false);
          window.opener.postMessage('authorizing:github', '*');
          setTimeout(function() { sendToken('*'); }, 2000);
        })();
      <\/script></body></html>`;

      return new Response(html, { headers: {"content-type":"text/html;charset=UTF-8"} });
    }

    // ---------- 网盘管理端点（/disk/*，供 /admin/disk/ 管理页调用） ----------
    if (url.pathname.startsWith("/disk/")) {
      return handleDisk(request, env, url);
    }

    return new Response("Not Found", { status: 404 });
  }
};

// ==================== /disk/* 网盘管理 ====================
//
// 鉴权：管理页复用 Decap 同款 GitHub OAuth 弹窗拿 token，请求头
//   Authorization: Bearer <gh-token>；Worker 校验该 token 对应的 GitHub
//   用户必须是 Secret GITHUB_ALLOWED_OWNER（用户名或数字 ID）才放行。
// 百度凭证（均为 Secret）：
//   BAIDU_ACCESS_TOKEN —— 【推荐】直接用 access_token，跳过 OAuth 刷新，日常
//     零风控风险。30 天有效，过期前从本地 .baidu-token.json 取新值更新即可。
//   BAIDU_APP_KEY / BAIDU_SECRET_KEY / BAIDU_REFRESH_TOKEN —— 【降级】当
//     BAIDU_ACCESS_TOKEN 未设或过期（xpan 报 errno=-6）时自动刷新；但百度
//     安全策略可能临时拦截刷新接口（Trigger security policy）。
//   BAIDU_BDUSS（可选 BAIDU_STOKEN）—— 网页端内部接口创建分享
// 轮换提示：刷新走 refresh_token 时，若百度返回新值，响应头带 x-baidu-rotated:
//   1 + x-baidu-access-token:<新值>，管理页显示横幅提醒更新 Secret。

const BAIDU_XPAN = "https://pan.baidu.com/rest/2.0/xpan";
const BAIDU_PCS = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
const WEB_SHARE = "https://pan.baidu.com/share/set";
const BAIDU_PASSPORT = "https://passport.baidu.com";
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SLICE_SIZE = 8 * 1024 * 1024; // xpan 分片要求 4MB 的整数倍
const MAX_UPLOAD = 64 * 1024 * 1024; // Workers 免费档单请求 128MB 内存，64MB 留足余量

// CORS 白名单：站点本身 + 本地 CMS（npm run cms）+ wrangler dev
const CORS_LOCAL = ["http://localhost:8080", "http://127.0.0.1:8787"];

// 网页端分享接口错误码 → 提示（与 baidu-sync.mjs WEB_SHARE_ERRNO 同源）
const WEB_SHARE_ERRNO = {
  "-6": "登录状态失效——BAIDU_BDUSS 不对或已过期，请重新 npm run baidu:login",
  "2": "参数错误（接口可能已变更）",
  "4": "无权限",
  "12": "文件涉及违规内容被禁止分享",
  "105": "分享链接错误",
  "130": "分享次数达到上限",
};

const httpError = (status, msg) => Object.assign(new Error(msg), { status });

let baiduTokenCache = null; // { accessToken, expiresAt }（模块级，实例存续期间复用）

function allowOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const owner = String(env.GITHUB_ALLOWED_OWNER || "").trim().toLowerCase();
  const site = owner ? `https://${owner}.github.io` : "";
  if (site && origin === site) return origin;
  if (CORS_LOCAL.includes(origin)) return origin;
  return "";
}

async function handleDisk(request, env, url) {
  const origin = allowOrigin(request, env);
  const cors = origin
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "x-baidu-rotated, x-baidu-access-token, x-qr-cookie", Vary: "Origin" }
    : {};

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-QR-Cookie",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const json = (data, status = 200, extra = {}) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...cors, ...extra },
    });

  try {
    // 除 OPTIONS 外一律先做 GitHub 归属校验
    const login = await verifyOwner(request, env);
    if (!login) return json({ error: "GitHub 鉴权失败：请先登录，且账号须为站点所有者（GITHUB_ALLOWED_OWNER）" }, 401);

    let result;
    if (url.pathname === "/disk/list" && request.method === "GET") {
      result = await diskList(env);
    } else if (url.pathname === "/disk/share" && request.method === "POST") {
      result = await diskShare(env, request);
    } else if (url.pathname === "/disk/browse" && request.method === "GET") {
      result = await diskBrowse(env, url);
    } else if (url.pathname === "/disk/upload" && request.method === "POST") {
      result = await diskUpload(env, request);
    } else if (url.pathname === "/disk/mkdir" && request.method === "POST") {
      result = await diskMkdir(env, url);
    } else if (url.pathname === "/disk/auth/status" && request.method === "GET") {
      result = await diskAuthStatus(env);
    } else if (url.pathname === "/disk/auth/qrlogin" && request.method === "GET") {
      result = await diskQrInit();
    } else if (url.pathname === "/disk/auth/qrpoll" && request.method === "GET") {
      result = await diskQrPoll(env, url, request);
    } else {
      return json({ error: "Not Found" }, 404);
    }

    const extra = {};
    if (result && result.rotated) extra["x-baidu-rotated"] = "1";
    if (result && result.source === "refresh" && result.newAccessToken) {
      extra["x-baidu-access-token"] = result.newAccessToken;
    }
    if (result && result.qrCookie) extra["x-qr-cookie"] = result.qrCookie;
    return json({ ok: true, ...result }, 200, extra);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return json({ error: (e && e.message) || "内部错误" }, status);
  }
}

/** GitHub token → 用户名，必须是 GITHUB_ALLOWED_OWNER（用户名或数字 ID） */
async function verifyOwner(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const owner = String(env.GITHUB_ALLOWED_OWNER || "").trim();
  if (!owner) return null; // 未配置 Secret 一律拒绝
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mynote-disk-admin",
    },
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || !j.login) return null;
  if (String(j.login).toLowerCase() !== owner.toLowerCase() && String(j.id) !== owner) return null;
  return j.login;
}

/** 获取百度 access_token（模块级缓存）；返回 { token, rotated, source, newAccessToken? }
 *  - 优先用 BAIDU_ACCESS_TOKEN Secret（跳过 OAuth 刷新，避免触发百度风控）
 *  - access_token 过期或未设置时降级到 refresh_token 刷新
 *  - forceRefresh=true 强制走刷新流程（xpan 报 errno=-6 时调用方触发降级） */
async function getBaiduToken(env, { forceRefresh = false } = {}) {
  // Phase 1：直接用 access_token Secret（日常零 OAuth 调用，风控概率最低）
  if (!forceRefresh && env.BAIDU_ACCESS_TOKEN) {
    return { token: env.BAIDU_ACCESS_TOKEN, rotated: false, source: "direct" };
  }
  const now = Date.now();
  // Phase 2：刷新流程的模块级缓存命中
  if (!forceRefresh && baiduTokenCache && baiduTokenCache.expiresAt > now + 60_000) {
    return { token: baiduTokenCache.accessToken, rotated: false, source: "refresh" };
  }
  // Phase 3：refresh_token 换 access_token
  const appKey = env.BAIDU_APP_KEY;
  const secret = env.BAIDU_SECRET_KEY;
  const rt = env.BAIDU_REFRESH_TOKEN;
  if (!appKey || !secret || !rt) {
    throw httpError(500, "Worker 缺少百度凭证：请设置 BAIDU_ACCESS_TOKEN（跳过刷新）或 BAIDU_APP_KEY + BAIDU_SECRET_KEY + BAIDU_REFRESH_TOKEN（自动刷新）");
  }
  const u = `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(appKey)}&client_secret=${encodeURIComponent(secret)}`;
  const res = await fetch(u);
  const j = await res.json().catch(() => null);
  if (!j || !j.access_token) {
    const detail = j ? JSON.stringify(j).slice(0, 200) : "非 JSON 响应";
    const hint = j && j.error === "Trigger security policy"
      ? "（百度安全策略临时拦截：请设 BAIDU_ACCESS_TOKEN Secret 跳过刷新，本地从 .baidu-token.json 取值，或稍后重试）"
      : "";
    throw httpError(502, `刷新百度 access_token 失败：${detail}${hint}`);
  }
  baiduTokenCache = { accessToken: j.access_token, expiresAt: now + (Number(j.expires_in) || 2_592_000) * 1000 };
  const rotated = Boolean(j.refresh_token && j.refresh_token !== rt);
  return { token: j.access_token, rotated, source: "refresh", newAccessToken: j.access_token };
}

/** GET /disk/list：网盘目录（递归子目录）+ 公开清单合并（显示分享状态） */
async function diskList(env) {
  let tr = await getBaiduToken(env);
  let { token, rotated, source } = tr;
  const dir = env.BAIDU_DIR || "/apps/mynote";
  const listOnce = async (d) => {
    const r = await fetch(
      `${BAIDU_XPAN}/file?method=list&access_token=${encodeURIComponent(token)}&dir=${encodeURIComponent(d)}&order=name&web=1`
    );
    return r.json().catch(() => null);
  };
  let j = await listOnce(dir);
  // access_token 过期时 xpan 报 errno=-6：降级到 refresh_token 刷新后重试一次
  if (source === "direct" && j && j.errno === -6 && env.BAIDU_REFRESH_TOKEN) {
    tr = await getBaiduToken(env, { forceRefresh: true });
    token = tr.token; rotated = tr.rotated; source = tr.source;
    j = await listOnce(dir);
  }
  if (!j || j.errno !== 0) {
    throw httpError(502, `网盘目录读取失败 errno=${j ? j.errno : "非 JSON 响应"}${j && j.errno === -9 ? "（目录不存在，先在网盘建好应用目录）" : ""}`);
  }
  // 递归展开子目录（深度≤3）；单层失败跳过不影响整体
  const relativeDir = (root, p) => {
    const rel = p.startsWith(root) ? p.slice(root.length) : p;
    const parts = rel.split("/").filter(Boolean);
    parts.pop();
    return parts.length ? "/" + parts.join("/") : "";
  };
  const walk = async (d, root, depth) => {
    const out = [];
    let r = depth === 0 ? j : await listOnce(d);
    if (!r || r.errno !== 0) return out;
    for (const f of r.list || []) {
      if (f.isdir) {
        if (depth < 3) out.push(...(await walk(f.path, root, depth + 1)));
        continue;
      }
      out.push({
        fsId: f.fs_id,
        basename: f.server_filename || String(f.path || "").split("/").pop(),
        size: f.size,
        md5: f.md5 || "",
        dir: relativeDir(root, f.path),
      });
    }
    return out;
  };
  const files = await walk(dir, dir, 0);

  // 合并公开清单（raw.githubusercontent.com），补分享链接状态；失败不致命
  let links = {};
  const rawUrl = env.MANIFEST_RAW_URL;
  if (rawUrl) {
    try {
      const m = await (await fetch(`${rawUrl}?t=${Date.now()}`, { headers: { "User-Agent": "mynote-disk-admin" } })).json();
      if (m && Array.isArray(m.files)) {
        links = Object.fromEntries(m.files.map((f) => [f.basename, { link: f.link || null, code: f.code || null }]));
      }
    } catch {
      /* 清单拉取失败仅影响“分享状态”展示 */
    }
  }
  for (const f of files) {
    const l = links[f.basename];
    f.link = l ? l.link : null;
    f.code = l ? l.code : null;
  }
  return { dir, files, rotated, source, newAccessToken: tr.newAccessToken };
}

/** GET /disk/browse?dir=/：用 BDUSS + 网页 API 列任意目录（浏览全盘） */
async function diskBrowse(env, url) {
  const bduss = env.BAIDU_BDUSS;
  if (!bduss) throw httpError(500, "缺少 BAIDU_BDUSS Secret，无法浏览全盘（仅在已配置扫码登录凭证时可用）");
  const dir = url.searchParams.get("dir") || "/";
  const cookieParts = [`BDUSS=${bduss}`];
  if (env.BAIDU_STOKEN) cookieParts.push(`STOKEN=${env.BAIDU_STOKEN}`);
  const apiUrl = `https://pan.baidu.com/api/list?dir=${encodeURIComponent(dir)}&web=1&clienttype=0&num=200&order=name`;
  const res = await fetch(apiUrl, {
    headers: { Cookie: cookieParts.join("; "), "User-Agent": WEB_UA },
  });
  const j = await res.json().catch(() => null);
  if (!j || j.errno !== 0) {
    const msgs = { "-9": "路径不存在", "-7": "无访问权限", "2": "目录不存在" };
    throw httpError(502, `百度网盘浏览失败：errno=${j ? j.errno : "非JSON"} ${msgs[String(j ? j.errno : "")] || ""}`);
  }
  const files = (j.list || []).map((f) => ({
    name: f.server_filename,
    size: f.size || 0,
    isdir: Boolean(f.isdir),
    fsId: f.fs_id,
  }));
  return { dir, files, source: "browse" };
}

/** POST /disk/share  body {fsId}：网页端内部接口创建带提取码分享 */
async function diskShare(env, request) {
  const bduss = env.BAIDU_BDUSS;
  if (!bduss) throw httpError(500, "Worker 缺少 BAIDU_BDUSS Secret（分享走网页端接口，需要扫码登录凭证）");
  if (bduss.length < 100) throw httpError(500, "BAIDU_BDUSS 长度不足（应为 ~190 字符），请重新 npm run baidu:login 后 wrangler secret put");
  const stoken = env.BAIDU_STOKEN || "";
  const period = env.BAIDU_SHARE_PERIOD || "0";
  const cookie = stoken ? `BDUSS=${bduss}; STOKEN=${stoken}` : `BDUSS=${bduss}`;

  let fsId;
  try {
    fsId = Number((await request.json()).fsId);
  } catch {
    fsId = NaN;
  }
  if (!Number.isFinite(fsId) || fsId <= 0) throw httpError(400, "缺少有效的 fsId");

  // 创建私密分享（4 位提取码）
  // 注意：2026 版网页端后 share/set 对 bdstoken 不再强制校验，传空字符串即可成功；
  // BDUSS 无效时接口会直接返回 errno=-6，错误映射提示用户重新扫码。
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const pwd = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((n) => alphabet[n % alphabet.length])
    .join("");
  const body = new URLSearchParams({
    fid_list: JSON.stringify([fsId]), // 网页端要求数字数组
    schannel: "4", // 私密分享（带提取码）
    channel_list: "[]",
    period: String(period), // 0 = 永久（非会员受限时可设 BAIDU_SHARE_PERIOD=30）
    pwd,
    bdstoken: "", // 新版 share/set 不强制校验此字段，留空即可
  });
  const res = await fetch(`${WEB_SHARE}?channel=chunlei&clienttype=0&web=1`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "User-Agent": WEB_UA,
      Referer: "https://pan.baidu.com/disk/main",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const j = await res.json().catch(() => null);
  if (!j || j.errno !== 0) {
    const hint = WEB_SHARE_ERRNO[String(j && j.errno)] || `未知错误 errno=${j ? j.errno : "非 JSON 响应"}`;
    throw httpError(502, `创建分享失败：${hint}`);
  }
  const link = j.link || (j.shorturl ? `https://pan.baidu.com/s/${j.shorturl}` : null);
  if (!link) throw httpError(502, "分享接口未返回链接");
  return { fsId, link, code: pwd };
}

/** POST /disk/upload  multipart/form-data：file（单文件 ≤64MB）→ precreate/秒传/分片/create */
async function diskUpload(env, request) {
  const form = await request.formData().catch(() => null);
  const file = form && form.get("file");
  if (!file || typeof file === "string") throw httpError(400, "缺少 file 字段（multipart/form-data）");
  if (file.size > MAX_UPLOAD) throw httpError(413, `文件 ${formatSize(file.size)} 超过 ${MAX_UPLOAD / 1048576}MB 上限，请用本地 npm run baidu:sync`);
  if (file.size === 0) throw httpError(400, "不能上传空文件");

  let tr = await getBaiduToken(env);
  let { token, rotated, source } = tr;
  // 允许用户指定上传目录（管理页文件夹选择器），默认 /apps/mynote
  const dir = (form.get("dir") || env.BAIDU_DIR || "/apps/mynote").replace(/\/+$/, "");
  const name = String(file.name || "upload.bin").replace(/[/\\]/g, "_");
  const remotePath = `${dir}/${name}`;

  // 分片 + 每片 MD5（WebCrypto 无 MD5，用内联纯 JS 实现）
  const buf = new Uint8Array(await file.arrayBuffer());
  const slices = [];
  for (let off = 0; off < buf.length; off += SLICE_SIZE) {
    slices.push(buf.subarray(off, Math.min(off + SLICE_SIZE, buf.length)));
  }
  const md5s = slices.map((s) => md5Hex(s));

  const postForm = async (url, fields) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    });
    return res.json().catch(() => null);
  };

  // 1) 预创建（命中秒传 return_type=2 直接结束）
  let pre = await postForm(`${BAIDU_XPAN}/file?method=precreate&access_token=${encodeURIComponent(token)}`, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    autoinit: "1",
    block_list: JSON.stringify(md5s),
  });
  // access_token 过期时 xpan 报 errno=-6：降级到 refresh_token 刷新后重试
  if (source === "direct" && pre && pre.errno === -6 && env.BAIDU_REFRESH_TOKEN) {
    tr = await getBaiduToken(env, { forceRefresh: true });
    token = tr.token; rotated = tr.rotated; source = tr.source;
    pre = await postForm(`${BAIDU_XPAN}/file?method=precreate&access_token=${encodeURIComponent(token)}`, {
      path: remotePath,
      size: String(buf.length),
      isdir: "0",
      autoinit: "1",
      block_list: JSON.stringify(md5s),
    });
  }
  if (!pre || pre.errno !== 0) throw httpError(502, `预创建失败 errno=${pre ? pre.errno : "非 JSON 响应"}`);
  if (pre.return_type === 2) return { path: remotePath, size: buf.length, rapid: true, rotated, source, newAccessToken: tr.newAccessToken };

  // 2) 逐片上传（tmpfile）
  const uploadid = pre.uploadid;
  if (!uploadid) throw httpError(502, "预创建未返回 uploadid");
  for (let i = 0; i < slices.length; i++) {
    const fd = new FormData();
    fd.append("file", new Blob([slices[i]]), name);
    const u = `${BAIDU_PCS}?method=upload&access_token=${encodeURIComponent(token)}&type=tmpfile&path=${encodeURIComponent(remotePath)}&uploadid=${encodeURIComponent(uploadid)}&partseq=${i}`;
    const r = await fetch(u, { method: "POST", body: fd });
    const j = await r.json().catch(() => null);
    // superfile2 成功响应不含 errno，只返回 md5；出错时才会有非零 errno
    if (!j || (j.errno !== undefined && j.errno !== 0) || !j.md5) {
      throw httpError(502, `分片 ${i + 1}/${slices.length} 上传失败 ${j ? JSON.stringify(j).slice(0, 160) : ""}`);
    }
  }

  // 3) 合并分片（create）
  const fin = await postForm(`${BAIDU_XPAN}/file?method=create&access_token=${encodeURIComponent(token)}`, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    block_list: JSON.stringify(md5s),
    uploadid: String(uploadid),
  });
  if (!fin || fin.errno !== 0) throw httpError(502, `文件创建失败 errno=${fin ? fin.errno : "非 JSON 响应"}`);
  return { path: remotePath, size: buf.length, rapid: false, rotated, source, newAccessToken: tr.newAccessToken };
}

/** POST /disk/mkdir?path=/apps/mynote/子目录：在网盘创建目录 */
async function diskMkdir(env, url) {
  const dirPath = url.searchParams.get("path") || "";
  if (!dirPath) throw httpError(400, "缺少 path 参数");
  let tr = await getBaiduToken(env);
  let { token, rotated, source } = tr;
  const res = await fetch(`${BAIDU_XPAN}/file?method=create&access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ path: dirPath, isdir: "1", size: "0", block_list: "[]" }).toString(),
  });
  let j = await res.json().catch(() => null);
  // access_token 过期降级刷新
  if (source === "direct" && j && j.errno === -6 && env.BAIDU_REFRESH_TOKEN) {
    tr = await getBaiduToken(env, { forceRefresh: true });
    token = tr.token; rotated = tr.rotated; source = tr.source;
    const res2 = await fetch(`${BAIDU_XPAN}/file?method=create&access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ path: dirPath, isdir: "1", size: "0", block_list: "[]" }).toString(),
    });
    j = await res2.json().catch(() => null);
  }
  if (!j || j.errno !== 0) throw httpError(502, `创建目录失败 errno=${j ? j.errno : "非 JSON 响应"}`);
  return { path: dirPath, rotated, source, newAccessToken: tr.newAccessToken };
}

function formatSize(s) {
  if (!Number.isFinite(s) || s <= 0) return "0 B";
  if (s < 1024) return `${s} B`;
  if (s < 1048576) return `${(s / 1024).toFixed(1)} KB`;
  if (s < 1073741824) return `${(s / 1048576).toFixed(1)} MB`;
  return `${(s / 1073741824).toFixed(2)} GB`;
}

// ==================== 网盘登录管理（/disk/auth/*） ====================
//
// 目的：在后台 /admin/disk/ 页面查看百度三类凭证（access_token / refresh_token
//   / BDUSS）的有效性，并提供扫码登录获取 BDUSS/STOKEN。Worker 不能动态修改
//   自身 Secret，所以扫码得到的凭证通过响应体返回前端，由用户复制 wrangler
//   secret put 命令在本地终端执行更新。
// cookie jar：百度扫码登录需要跨请求保持会话（BAIDUID 等），Worker 无持久内
//   存，所以把 cookie 序列化后通过响应头 x-qr-cookie 下发，前端下次请求通过
//   请求头 X-QR-Cookie 回传，实现"无状态"会话保持。

/** 宽松解析：兼容纯 JSON 与 JSONP（callback({...})，百度登录接口常见） */
function parseLoose(text) {
  if (typeof text !== "string") return null;
  try {
    return JSON.parse(text);
  } catch {}
  const m = text.match(/\((\{[\s\S]*\})\s*\)\s*;?\s*$/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {}
    try {
      return JSON.parse(m[1].replace(/'([A-Za-z_]\w*)'\s*:/g, '"$1":'));
    } catch {}
  }
  return null;
}

/** 从 Response 收集 Set-Cookie 到 jar（Map） */
function ingestCookies(res, jar) {
  const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const c of sc) {
    const pair = c.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

/** 把 cookie jar 序列化为请求头字符串 */
function cookieHeader(jar) {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/** 从字符串还原 cookie jar（Map） */
function parseCookieHeader(str) {
  const jar = new Map();
  for (const part of String(str || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) jar.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return jar;
}

/** GET /disk/auth/status：检测三类凭证有效性（只读，不修改任何 Secret）
 *  - access_token：调 xpan uinfo（轻量），errno=0 有效 / errno=-6 失效
 *  - refresh_token：只检测是否配置（实际调用会真刷新，可能触发百度风控）
 *  - BDUSS：调 gettemplatevariable 取 bdstoken，errno=0 有效 / -6 失效 */
async function diskAuthStatus(env) {
  const auth = { accessToken: "unset", refreshToken: "unset", bduss: "unset", detail: {} };

  // 1) access_token
  if (env.BAIDU_ACCESS_TOKEN) {
    try {
      const r = await fetch(`${BAIDU_XPAN}/nas?method=uinfo&access_token=${encodeURIComponent(env.BAIDU_ACCESS_TOKEN)}`);
      const j = await r.json().catch(() => null);
      if (j && j.errno === 0) {
        auth.accessToken = "ok";
        if (j.bduid) auth.detail.baiduId = j.bduid;
      } else if (j && j.errno === -6) {
        auth.accessToken = "expired";
      } else {
        auth.accessToken = "unknown";
      }
      auth.detail.accessTokenErrno = j ? j.errno : null;
    } catch {
      auth.accessToken = "unknown";
    }
  }

  // 2) refresh_token：只看是否配置，不主动调用（避免触发风控）
  auth.refreshToken = env.BAIDU_APP_KEY && env.BAIDU_SECRET_KEY && env.BAIDU_REFRESH_TOKEN ? "configured" : "unset";

  // 3) BDUSS
  if (env.BAIDU_BDUSS) {
    if (env.BAIDU_BDUSS.length < 100) {
      auth.bduss = "invalid";
      auth.detail.bdussHint = "长度不足（应为 ~190 字符），疑似临时值或粘贴错误";
    } else {
      try {
        const cookie = env.BAIDU_STOKEN
          ? `BDUSS=${env.BAIDU_BDUSS}; STOKEN=${env.BAIDU_STOKEN}`
          : `BDUSS=${env.BAIDU_BDUSS}`;
        const r = await fetch(
          "https://pan.baidu.com/api/gettemplatevariable?app_id=250528&clienttype=0&web=1&fields=%5B%22bdstoken%22%5D",
          { headers: { Cookie: cookie, "User-Agent": WEB_UA, Referer: "https://pan.baidu.com/disk/main" } }
        );
        const j = await r.json().catch(() => null);
        if (j && j.errno === 0 && j.result && j.result.bdstoken) {
          auth.bduss = "ok";
        } else if (j && j.errno === -6) {
          auth.bduss = "expired";
        } else {
          auth.bduss = "unknown";
        }
        auth.detail.bdussErrno = j ? j.errno : null;
      } catch {
        auth.bduss = "unknown";
      }
    }
  }

  return { auth };
}

/** GET /disk/auth/qrlogin：初始化扫码 → 返回二维码图片 URL + sign + 会话 cookie
 *  前端保存 qrCookie，后续 /disk/auth/qrpoll 请求带 X-QR-Cookie 头回传 */
async function diskQrInit() {
  const jar = new Map();
  const res = await fetch(`${BAIDU_PASSPORT}/v2/api/getqrcode?lp=pc`, {
    headers: { "User-Agent": WEB_UA, Referer: "https://pan.baidu.com/" },
  });
  ingestCookies(res, jar);
  const code = parseLoose(await res.text());
  if (!code || !code.imgurl || !code.sign) {
    throw httpError(502, `获取登录二维码失败：${JSON.stringify(code).slice(0, 200)}`);
  }
  const imgurl = String(code.imgurl).startsWith("http") ? code.imgurl : `https://${code.imgurl}`;
  return { imgurl, sign: code.sign, qrCookie: cookieHeader(jar) };
}

/** GET /disk/auth/qrpoll?sign=xxx：轮询扫码状态（需带 X-QR-Cookie 头）
 *  - 未扫码：百度 unicast 长轮询返回 errno=1（超时），本端返回 status="waiting"
 *  - 已扫码确认：拿到临时 bduss → 立即调 qrbdusslogin 换正式 BDUSS/STOKEN
 *  Worker 单次请求 CPU 时间有限，不能 180s 长等；前端每 2.5s 调一次本端点 */
async function diskQrPoll(env, url, request) {
  const sign = url.searchParams.get("sign");
  if (!sign) throw httpError(400, "缺少 sign 参数");
  const qrCookie = request.headers.get("X-QR-Cookie") || "";
  const jar = parseCookieHeader(qrCookie);
  const H = (extra = {}) => ({
    "User-Agent": WEB_UA,
    Referer: "https://pan.baidu.com/",
    ...extra,
    Cookie: cookieHeader(jar),
  });

  // 1) 长轮询 unicast（百度侧约 2-30s 返回，errno=1 为超时未扫码）
  const pr = await fetch(
    `${BAIDU_PASSPORT}/channel/unicast?channel_id=${encodeURIComponent(sign)}&callback=bdqr&lp=pc`,
    { headers: H() }
  );
  ingestCookies(pr, jar);
  const pj = parseLoose(await pr.text());
  if (!pj || pj.errno !== 0 || !pj.channel_v) {
    return { status: "waiting", qrCookie: cookieHeader(jar) };
  }
  const cv = parseLoose(pj.channel_v);
  if (!cv || !cv.v) {
    return { status: "waiting", qrCookie: cookieHeader(jar) };
  }
  const tmpBduss = cv.v;

  // 2) 用临时 bduss 换正式凭证（Set-Cookie 头下发 BDUSS/STOKEN）
  const lr = await fetch(
    `${BAIDU_PASSPORT}/v3/login/main/qrbdusslogin?bduss=${encodeURIComponent(tmpBduss)}` +
      `&u=${encodeURIComponent("https://pan.baidu.com/")}&clientfrom=web&lp=pc&loginmerge=true&actionlog&v=2&getcookies=1&callback=bdlogin`,
    { headers: H() }
  );
  ingestCookies(lr, jar);
  const lj = parseLoose(await lr.text());
  const sess = (lj && lj.data && lj.data.session) || {};
  const bduss = jar.get("BDUSS") || sess.bduss || "";
  const stoken = jar.get("STOKEN") || sess.stoken || "";
  // 正式 BDUSS 约 190 字符；32 位的是临时 v，不能用于网页接口
  if (bduss.length < 100) {
    const msg = (lj && lj.errInfo && lj.errInfo.msg) || (lj && lj.message) || "响应中无正式 BDUSS";
    throw httpError(502, `换取登录凭证失败：${msg}（请重新扫码）`);
  }
  return { status: "done", bduss, stoken, qrCookie: cookieHeader(jar) };
}

// ---------- 纯 JS MD5（WebCrypto 不提供 MD5；已与 node:crypto 对拍验证） ----------
function md5Hex(bytes) {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const len = bytes.length;
  const paddedLen = (((len + 8) >> 6) + 1) << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 8, (len << 3) >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor((len * 8) / 4294967296), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const rotl = (n, c) => (n << c) | (n >>> (32 - c));

  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }

  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0 >>> 0, true);
  out.setUint32(4, b0 >>> 0, true);
  out.setUint32(8, c0 >>> 0, true);
  out.setUint32(12, d0 >>> 0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
