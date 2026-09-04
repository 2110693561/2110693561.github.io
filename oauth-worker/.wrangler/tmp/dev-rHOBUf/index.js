var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var src_default = {
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
        return new Response(JSON.stringify(data), { status: 400, headers: { "content-type": "application/json" } });
      }
      const payload = {
        token: data.access_token,
        provider: "github"
      };
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
      return new Response(html, { headers: { "content-type": "text/html;charset=UTF-8" } });
    }
    if (url.pathname.startsWith("/disk/")) {
      return handleDisk(request, env, url);
    }
    return new Response("Not Found", { status: 404 });
  }
};
var BAIDU_XPAN = "https://pan.baidu.com/rest/2.0/xpan";
var BAIDU_PCS = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
var WEB_SHARE = "https://pan.baidu.com/share/set";
var WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
var SLICE_SIZE = 8 * 1024 * 1024;
var MAX_UPLOAD = 64 * 1024 * 1024;
var CORS_LOCAL = ["http://localhost:8080", "http://127.0.0.1:8787"];
var WEB_SHARE_ERRNO = {
  "-6": "\u767B\u5F55\u72B6\u6001\u5931\u6548\u2014\u2014BAIDU_BDUSS \u4E0D\u5BF9\u6216\u5DF2\u8FC7\u671F\uFF0C\u8BF7\u91CD\u65B0 npm run baidu:login",
  "2": "\u53C2\u6570\u9519\u8BEF\uFF08\u63A5\u53E3\u53EF\u80FD\u5DF2\u53D8\u66F4\uFF09",
  "4": "\u65E0\u6743\u9650",
  "12": "\u6587\u4EF6\u6D89\u53CA\u8FDD\u89C4\u5185\u5BB9\u88AB\u7981\u6B62\u5206\u4EAB",
  "105": "\u5206\u4EAB\u94FE\u63A5\u9519\u8BEF",
  "130": "\u5206\u4EAB\u6B21\u6570\u8FBE\u5230\u4E0A\u9650"
};
var httpError = /* @__PURE__ */ __name((status, msg) => Object.assign(new Error(msg), { status }), "httpError");
var baiduTokenCache = null;
function allowOrigin(request, env) {
  const origin = request.headers.get("Origin") || "";
  const owner = String(env.GITHUB_ALLOWED_OWNER || "").trim().toLowerCase();
  const site = owner ? `https://${owner}.github.io` : "";
  if (site && origin === site) return origin;
  if (CORS_LOCAL.includes(origin)) return origin;
  return "";
}
__name(allowOrigin, "allowOrigin");
async function handleDisk(request, env, url) {
  const origin = allowOrigin(request, env);
  const cors = origin ? { "Access-Control-Allow-Origin": origin, "Access-Control-Expose-Headers": "x-baidu-rotated", Vary: "Origin" } : {};
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400"
      }
    });
  }
  const json = /* @__PURE__ */ __name((data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors, ...extra }
  }), "json");
  try {
    const login = await verifyOwner(request, env);
    if (!login) return json({ error: "GitHub \u9274\u6743\u5931\u8D25\uFF1A\u8BF7\u5148\u767B\u5F55\uFF0C\u4E14\u8D26\u53F7\u987B\u4E3A\u7AD9\u70B9\u6240\u6709\u8005\uFF08GITHUB_ALLOWED_OWNER\uFF09" }, 401);
    let result;
    if (url.pathname === "/disk/list" && request.method === "GET") {
      result = await diskList(env);
    } else if (url.pathname === "/disk/share" && request.method === "POST") {
      result = await diskShare(env, request);
    } else if (url.pathname === "/disk/upload" && request.method === "POST") {
      result = await diskUpload(env, request);
    } else {
      return json({ error: "Not Found" }, 404);
    }
    const extra = {};
    if (result && result.rotated) extra["x-baidu-rotated"] = "1";
    return json({ ok: true, ...result }, 200, extra);
  } catch (e) {
    const status = e && e.status ? e.status : 500;
    return json({ error: e && e.message || "\u5185\u90E8\u9519\u8BEF" }, status);
  }
}
__name(handleDisk, "handleDisk");
async function verifyOwner(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  const owner = String(env.GITHUB_ALLOWED_OWNER || "").trim();
  if (!owner) return null;
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "mynote-disk-admin"
    }
  });
  if (!res.ok) return null;
  const j = await res.json().catch(() => null);
  if (!j || !j.login) return null;
  if (String(j.login).toLowerCase() !== owner.toLowerCase() && String(j.id) !== owner) return null;
  return j.login;
}
__name(verifyOwner, "verifyOwner");
async function getBaiduToken(env) {
  const now = Date.now();
  if (baiduTokenCache && baiduTokenCache.expiresAt > now + 6e4) {
    return { token: baiduTokenCache.accessToken, rotated: false };
  }
  const appKey = env.BAIDU_APP_KEY;
  const secret = env.BAIDU_SECRET_KEY;
  const rt = env.BAIDU_REFRESH_TOKEN;
  if (!appKey || !secret || !rt) {
    throw httpError(500, "Worker \u7F3A\u5C11\u767E\u5EA6\u51ED\u8BC1 Secret\uFF1ABAIDU_APP_KEY / BAIDU_SECRET_KEY / BAIDU_REFRESH_TOKEN");
  }
  const u = `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(rt)}&client_id=${encodeURIComponent(appKey)}&client_secret=${encodeURIComponent(secret)}`;
  const res = await fetch(u);
  const j = await res.json().catch(() => null);
  if (!j || !j.access_token) {
    throw httpError(502, `\u5237\u65B0\u767E\u5EA6 access_token \u5931\u8D25\uFF1A${j ? JSON.stringify(j).slice(0, 200) : "\u975E JSON \u54CD\u5E94"}`);
  }
  baiduTokenCache = { accessToken: j.access_token, expiresAt: now + (Number(j.expires_in) || 2592e3) * 1e3 };
  const rotated = Boolean(j.refresh_token && j.refresh_token !== rt);
  return { token: j.access_token, rotated };
}
__name(getBaiduToken, "getBaiduToken");
async function diskList(env) {
  const { token, rotated } = await getBaiduToken(env);
  const dir = env.BAIDU_DIR || "/apps/mynote";
  const res = await fetch(
    `${BAIDU_XPAN}/file?method=list&access_token=${encodeURIComponent(token)}&dir=${encodeURIComponent(dir)}&order=name&web=1`
  );
  const j = await res.json().catch(() => null);
  if (!j || j.errno !== 0) {
    throw httpError(502, `\u7F51\u76D8\u76EE\u5F55\u8BFB\u53D6\u5931\u8D25 errno=${j ? j.errno : "\u975E JSON \u54CD\u5E94"}${j && j.errno === -9 ? "\uFF08\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u5148\u5728\u7F51\u76D8\u5EFA\u597D\u5E94\u7528\u76EE\u5F55\uFF09" : ""}`);
  }
  const files = (j.list || []).filter((f) => !f.isdir).map((f) => ({
    fsId: f.fs_id,
    basename: f.server_filename || String(f.path || "").split("/").pop(),
    size: f.size,
    md5: f.md5 || ""
  }));
  let links = {};
  const rawUrl = env.MANIFEST_RAW_URL;
  if (rawUrl) {
    try {
      const m = await (await fetch(`${rawUrl}?t=${Date.now()}`, { headers: { "User-Agent": "mynote-disk-admin" } })).json();
      if (m && Array.isArray(m.files)) {
        links = Object.fromEntries(m.files.map((f) => [f.basename, { link: f.link || null, code: f.code || null }]));
      }
    } catch {
    }
  }
  for (const f of files) {
    const l = links[f.basename];
    f.link = l ? l.link : null;
    f.code = l ? l.code : null;
  }
  return { dir, files, rotated };
}
__name(diskList, "diskList");
async function diskShare(env, request) {
  const bduss = env.BAIDU_BDUSS;
  if (!bduss) throw httpError(500, "Worker \u7F3A\u5C11 BAIDU_BDUSS Secret\uFF08\u5206\u4EAB\u8D70\u7F51\u9875\u7AEF\u63A5\u53E3\uFF0C\u9700\u8981\u626B\u7801\u767B\u5F55\u51ED\u8BC1\uFF09");
  if (bduss.length < 100) throw httpError(500, "BAIDU_BDUSS \u957F\u5EA6\u4E0D\u8DB3\uFF08\u5E94\u4E3A ~190 \u5B57\u7B26\uFF09\uFF0C\u8BF7\u91CD\u65B0 npm run baidu:login \u540E wrangler secret put");
  const stoken = env.BAIDU_STOKEN || "";
  const period = env.BAIDU_SHARE_PERIOD || "0";
  const cookie = stoken ? `BDUSS=${bduss}; STOKEN=${stoken}` : `BDUSS=${bduss}`;
  let fsId;
  try {
    fsId = Number((await request.json()).fsId);
  } catch {
    fsId = NaN;
  }
  if (!Number.isFinite(fsId) || fsId <= 0) throw httpError(400, "\u7F3A\u5C11\u6709\u6548\u7684 fsId");
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const pwd = Array.from(crypto.getRandomValues(new Uint8Array(4))).map((n) => alphabet[n % alphabet.length]).join("");
  const body = new URLSearchParams({
    fid_list: JSON.stringify([fsId]),
    // 网页端要求数字数组
    schannel: "4",
    // 私密分享（带提取码）
    channel_list: "[]",
    period: String(period),
    // 0 = 永久（非会员受限时可设 BAIDU_SHARE_PERIOD=30）
    pwd,
    bdstoken: ""
    // 新版 share/set 不强制校验此字段，留空即可
  });
  const res = await fetch(`${WEB_SHARE}?channel=chunlei&clienttype=0&web=1`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      "User-Agent": WEB_UA,
      Referer: "https://pan.baidu.com/disk/main",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });
  const j = await res.json().catch(() => null);
  if (!j || j.errno !== 0) {
    const hint = WEB_SHARE_ERRNO[String(j && j.errno)] || `\u672A\u77E5\u9519\u8BEF errno=${j ? j.errno : "\u975E JSON \u54CD\u5E94"}`;
    throw httpError(502, `\u521B\u5EFA\u5206\u4EAB\u5931\u8D25\uFF1A${hint}`);
  }
  const link = j.link || (j.shorturl ? `https://pan.baidu.com/s/${j.shorturl}` : null);
  if (!link) throw httpError(502, "\u5206\u4EAB\u63A5\u53E3\u672A\u8FD4\u56DE\u94FE\u63A5");
  return { fsId, link, code: pwd };
}
__name(diskShare, "diskShare");
async function diskUpload(env, request) {
  const form = await request.formData().catch(() => null);
  const file = form && form.get("file");
  if (!file || typeof file === "string") throw httpError(400, "\u7F3A\u5C11 file \u5B57\u6BB5\uFF08multipart/form-data\uFF09");
  if (file.size > MAX_UPLOAD) throw httpError(413, `\u6587\u4EF6 ${formatSize(file.size)} \u8D85\u8FC7 ${MAX_UPLOAD / 1048576}MB \u4E0A\u9650\uFF0C\u8BF7\u7528\u672C\u5730 npm run baidu:sync`);
  if (file.size === 0) throw httpError(400, "\u4E0D\u80FD\u4E0A\u4F20\u7A7A\u6587\u4EF6");
  const { token, rotated } = await getBaiduToken(env);
  const dir = env.BAIDU_DIR || "/apps/mynote";
  const name = String(file.name || "upload.bin").replace(/[/\\]/g, "_");
  const remotePath = `${dir}/${name}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const slices = [];
  for (let off = 0; off < buf.length; off += SLICE_SIZE) {
    slices.push(buf.subarray(off, Math.min(off + SLICE_SIZE, buf.length)));
  }
  const md5s = slices.map((s) => md5Hex(s));
  const postForm = /* @__PURE__ */ __name(async (url, fields) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString()
    });
    return res.json().catch(() => null);
  }, "postForm");
  const pre = await postForm(`${BAIDU_XPAN}/file?method=precreate&access_token=${encodeURIComponent(token)}`, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    autoinit: "1",
    block_list: JSON.stringify(md5s)
  });
  if (!pre || pre.errno !== 0) throw httpError(502, `\u9884\u521B\u5EFA\u5931\u8D25 errno=${pre ? pre.errno : "\u975E JSON \u54CD\u5E94"}`);
  if (pre.return_type === 2) return { path: remotePath, size: buf.length, rapid: true, rotated };
  const uploadid = pre.uploadid;
  if (!uploadid) throw httpError(502, "\u9884\u521B\u5EFA\u672A\u8FD4\u56DE uploadid");
  for (let i = 0; i < slices.length; i++) {
    const fd = new FormData();
    fd.append("file", new Blob([slices[i]]), name);
    const u = `${BAIDU_PCS}?method=upload&access_token=${encodeURIComponent(token)}&type=tmpfile&path=${encodeURIComponent(remotePath)}&uploadid=${encodeURIComponent(uploadid)}&partseq=${i}`;
    const r = await fetch(u, { method: "POST", body: fd });
    const j = await r.json().catch(() => null);
    if (!j || j.errno !== void 0 && j.errno !== 0 || !j.md5) {
      throw httpError(502, `\u5206\u7247 ${i + 1}/${slices.length} \u4E0A\u4F20\u5931\u8D25 ${j ? JSON.stringify(j).slice(0, 160) : ""}`);
    }
  }
  const fin = await postForm(`${BAIDU_XPAN}/file?method=create&access_token=${encodeURIComponent(token)}`, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    block_list: JSON.stringify(md5s),
    uploadid: String(uploadid)
  });
  if (!fin || fin.errno !== 0) throw httpError(502, `\u6587\u4EF6\u521B\u5EFA\u5931\u8D25 errno=${fin ? fin.errno : "\u975E JSON \u54CD\u5E94"}`);
  return { path: remotePath, size: buf.length, rapid: false, rotated };
}
__name(diskUpload, "diskUpload");
function formatSize(s) {
  if (!Number.isFinite(s) || s <= 0) return "0 B";
  if (s < 1024) return `${s} B`;
  if (s < 1048576) return `${(s / 1024).toFixed(1)} KB`;
  if (s < 1073741824) return `${(s / 1048576).toFixed(1)} MB`;
  return `${(s / 1073741824).toFixed(2)} GB`;
}
__name(formatSize, "formatSize");
function md5Hex(bytes) {
  const S = [
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    7,
    12,
    17,
    22,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    5,
    9,
    14,
    20,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    4,
    11,
    16,
    23,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21,
    6,
    10,
    15,
    21
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  const len = bytes.length;
  const paddedLen = (len + 8 >> 6) + 1 << 6;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[len] = 128;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 8, len << 3 >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(len * 8 / 4294967296), true);
  let a0 = 1732584193, b0 = 4023233417, c0 = 2562383102, d0 = 271733878;
  const rotl = /* @__PURE__ */ __name((n, c) => n << c | n >>> 32 - c, "rotl");
  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(chunk + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) {
        F = B & C | ~B & D;
        g = i;
      } else if (i < 32) {
        F = D & B | ~D & C;
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = 7 * i % 16;
      }
      F = F + A + K[i] + M[g] | 0;
      A = D;
      D = C;
      C = B;
      B = B + rotl(F, S[i]) | 0;
    }
    a0 = a0 + A | 0;
    b0 = b0 + B | 0;
    c0 = c0 + C | 0;
    d0 = d0 + D | 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  out.setUint32(0, a0 >>> 0, true);
  out.setUint32(4, b0 >>> 0, true);
  out.setUint32(8, c0 >>> 0, true);
  out.setUint32(12, d0 >>> 0, true);
  return [...new Uint8Array(out.buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(md5Hex, "md5Hex");

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-piOyPM/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../AppData/Local/npm-cache/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-piOyPM/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
