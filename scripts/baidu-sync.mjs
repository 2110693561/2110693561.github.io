#!/usr/bin/env node
/**
 * 百度网盘资料同步脚本（xpan 官方开放 API）
 * ---------------------------------------------------------------
 * 把 src/files/*.md 里引用的本地附件（public/files/ 下）自动：
 *   1. 上传到百度网盘应用专区 /apps/mynote/（可用 .env 的 BAIDU_DIR 改）
 *   2. 创建分享：默认在上传后按提示手动粘贴链接自动回写；
 *      在 .env 填 BAIDU_BDUSS（可选）则分享也全自动，详见下方「关于分享接口」
 * 回写后资料页会自动显示「☁️ 百度网盘」备用按钮。
 *
 * 关于分享接口：xpan 免费版分享接口已下线，官方新接口（apaas/1.0/share/set）
 * 属于付费的企业服务，个人应用调不通。因此本脚本提供两条分享路径：
 *   a) 全自动（可选）：在 .env 填 BAIDU_BDUSS（网盘网页版登录 Cookie），脚本走
 *      网页端同款内部接口 /share/set 直接创建分享。注意：BDUSS 等同账号登录凭证，
 *      只能存在本机（.env 已 gitignore）；该接口非官方开放能力、百度不保证长期
 *      可用，自动化属协议灰色地带，低频自用风险较低但非零。
 *   b) 手动粘贴（默认）：不填 BDUSS 时，上传完成后按提示在网盘客户端创建分享、
 *      把链接粘贴进终端，脚本解析后自动回写，最终效果与 a) 完全一致。
 *
 * 前置准备：
 *   1. 在 https://pan.baidu.com/union 注册开发者、创建应用，拿到 AppKey / SecretKey
 *      （个人应用只能读写网盘 /apps/应用名/ 目录）
 *   2. 复制 .env.example 为 .env，填入 BAIDU_APP_KEY / BAIDU_SECRET_KEY
 *   3. 首次授权（设备码模式，无需域名/回调）：
 *        npm run baidu:auth
 *      按提示在浏览器打开 https://openapi.baidu.com/device 输入用户码即可
 *   4. 同步：
 *        npm run baidu:sync            # 实际上传 + 回写
 *        npm run baidu:sync -- --dry-run   # 只打印计划，不改动
 *   5. 可选：分享全自动凭证（扫码一次自动写入 .env，长期有效）：
 *        npm run baidu:login
 *      浏览器自动打开二维码 → 网盘 App 扫码确认 → 自动写入 BAIDU_BDUSS/BAIDU_STOKEN。
 *      未配置时运行 baidu:sync 也会在交互终端里询问是否现场扫码。
 *
 * 安全说明：
 *   - access_token / refresh_token 只保存在本地 .baidu-token.json（已 gitignore）
 *   - refresh_token 有效期约 10 年，access_token 30 天过期后脚本自动刷新
 *   - 任何 token 都不会进入前端、git 仓库或日志
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { exec } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKEN_FILE = path.join(ROOT, ".baidu-token.json");
const FILES_DIR = path.join(ROOT, "src", "files");
const PUBLIC_DIR = path.join(ROOT, "public");
const SLICE_SIZE = 8 * 1024 * 1024; // xpan 分片要求 4MB 的整数倍

const XPAN = "https://pan.baidu.com/rest/2.0/xpan";
const PCS_UPLOAD = "https://d.pcs.baidu.com/rest/2.0/pcs/superfile2";
const OAUTH = "https://openapi.baidu.com/oauth/2.0";
const WEB_SHARE = "https://pan.baidu.com/share/set"; // 网页版内部接口（非官方开放能力）
const WEB_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// ---------- 小工具 ----------

const log = (msg) => console.log(msg);
const warn = (msg) => console.warn("⚠️  " + msg);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mask = (s) => (s ? `${String(s).slice(0, 6)}…` : "(空)");

function loadEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw; // 去 UTF-8 BOM
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || m[1].startsWith("#")) continue;
    let val = m[2]
      .replace(/\s+#.*$/, "") // 去掉行内注释（如 xxxx # 备注）
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

// 脱敏显示：前 4 位 + 长度，便于核对"值到底读对没有"
const maskKey = (s) => (s ? `${s.slice(0, 4)}…（${s.length} 位）` : "(空)");

/** 凭证预检查：在发起网络请求前拦掉常见配置错误 */
function checkCredentials(appKey, secret) {
  const problems = [];
  const placeholder = /你的|your[_-]?key|xxxx/i;
  if (!appKey || placeholder.test(appKey)) problems.push("BAIDU_APP_KEY 未填写或仍是 .env.example 里的占位符");
  if (!secret || placeholder.test(secret)) problems.push("BAIDU_SECRET_KEY 未填写或仍是占位符");
  if (appKey && /^\d+$/.test(appKey)) problems.push("BAIDU_APP_KEY 填成了纯数字的【AppID】——OAuth 需要的是【AppKey】（字母+数字混合），AppID 不能用");
  if (appKey && appKey.length < 15) problems.push(`BAIDU_APP_KEY 长度只有 ${appKey.length} 位（正常 AppKey 为 20+ 位），大概率复制不完整`);
  return problems;
}

async function postForm(url, token, fields) {
  const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });
  return res.json();
}

// ---------- 授权（设备码模式 + 自动刷新） ----------

function saveToken(data) {
  const t = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in - 300) * 1000, // 提前 5 分钟视为过期
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
  return t;
}

async function deviceAuth(appKey, secret) {
  log("→ 发起设备码授权…");
  const codeRes = await fetch(
    `${OAUTH}/device/code?response_type=device_code&client_id=${appKey}&scope=basic,netdisk`,
    { headers: { "User-Agent": "pan.baidu.com" } }
  );
  const code = await codeRes.json();
  if (code.error || !code.device_code) {
    if (code.error === "invalid_client") {
      throw new Error(
        [
          "百度服务器不认识 client_id（invalid_client: unknown client id）。逐项检查：",
          "  1) .env 里 BAIDU_APP_KEY 必须是【AppKey】（字母+数字混合，20+ 位），不是纯数字的【AppID】",
          "  2) 应用必须在【百度网盘开放平台】https://pan.baidu.com/union 创建；百度智能云 / 百度地图后台的 Key 不通用",
          "  3) 值不要带引号、行内注释或多余空格（改完直接重跑即可）",
          `  当前读取到的 AppKey：${maskKey(appKey)}`,
        ].join("\n")
      );
    }
    throw new Error(`获取设备码失败：${JSON.stringify(code)}`);
  }

  log("");
  log("请在浏览器打开以下地址，并输入用户码完成授权：");
  log(`  地址：${code.verification_url || "https://openapi.baidu.com/device"}`);
  log(`  用户码：${code.user_code}`);
  log("");
  log(`（也可以用网盘 App 扫码：${code.qrcode_url}）`);
  log("等待授权中…");

  let interval = code.interval || 5;
  const deadline = Date.now() + (code.expires_in || 600) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const res = await fetch(
      `${OAUTH}/token?grant_type=device_token&code=${code.device_code}&client_id=${appKey}&client_secret=${secret}`,
      { headers: { "User-Agent": "pan.baidu.com" } }
    );
    const j = await res.json();
    if (j.access_token) {
      log("✓ 授权成功");
      return saveToken(j);
    }
    if (j.error === "authorization_pending") continue;
    if (j.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (j.error === "expired_token") throw new Error("设备码已过期，请重新运行授权命令");
    throw new Error(`授权失败：${j.error || JSON.stringify(j)}`);
  }
  throw new Error("授权超时，请重新运行授权命令");
}

async function refreshToken(appKey, secret, refreshToken) {
  const res = await fetch(
    `${OAUTH}/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}&client_id=${appKey}&client_secret=${secret}`,
    { headers: { "User-Agent": "pan.baidu.com" } }
  );
  const j = await res.json();
  if (!j.access_token) throw new Error(`刷新 token 失败：${j.error || JSON.stringify(j)}`);
  // 刷新可能同时下发新的 refresh_token，没有则沿用旧的
  return saveToken({ ...j, refresh_token: j.refresh_token || refreshToken });
}

async function getToken(appKey, secret) {
  let saved = null;
  if (fs.existsSync(TOKEN_FILE)) {
    try {
      saved = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
    } catch {
      saved = null;
    }
  }
  if (saved?.access_token && Date.now() < saved.expires_at) {
    return saved.access_token;
  }
  // CI（GitHub Actions）没有本地 token 文件，允许用环境变量里的 refresh_token 刷新
  const envRefresh = process.env.BAIDU_REFRESH_TOKEN?.trim();
  if (saved?.refresh_token || envRefresh) {
    try {
      log("→ access_token 已过期/缺失，用 refresh_token 刷新…");
      return (await refreshToken(appKey, secret, saved?.refresh_token || envRefresh)).access_token;
    } catch (e) {
      warn(e.message + "，转为重新授权");
    }
  }
  if (!process.stdin.isTTY) {
    throw new Error("CI 环境无法交互式授权：请在仓库 Secrets 配置有效的 BAIDU_REFRESH_TOKEN（取自本地 .baidu-token.json 的 refresh_token 字段）");
  }
  return (await deviceAuth(appKey, secret)).access_token;
}

// ---------- 网盘操作 ----------

async function ensureDir(token, dir) {
  const j = await postForm(`${XPAN}/file?method=create`, token, { path: dir, isdir: "1" });
  // errno -8 = 目录已存在，视为成功
  if (j.errno !== 0 && j.errno !== -8) {
    if (j.errno === -7 || j.errno === -10) {
      throw new Error(
        `无权限在 ${dir} 创建目录（errno=${j.errno}）。个人应用只能写入 /apps/你的应用名/ 这个专属目录。` +
          "请到 https://pan.baidu.com/union 控制台「应用管理」查看你的应用名，然后在 .env 里设置 BAIDU_DIR=/apps/你的应用名"
      );
    }
    throw new Error(`创建目录 ${dir} 失败 errno=${j.errno}（请检查 BAIDU_DIR 是否在 /apps/你的应用名/ 下）`);
  }
}

async function listDir(token, dir) {
  const res = await fetch(
    `${XPAN}/file?method=list&access_token=${encodeURIComponent(token)}&dir=${encodeURIComponent(dir)}&order=name`
  );
  const j = await res.json();
  if (j.errno !== 0) return null;
  return j.list || [];
}

/** 计算文件相对应用根目录的文件夹（"" = 根目录） */
function relativeDir(rootDir, filePath) {
  const rel = filePath.startsWith(rootDir) ? filePath.slice(rootDir.length) : filePath;
  const parts = rel.split("/").filter(Boolean);
  parts.pop(); // 去掉文件名本身
  return parts.length ? "/" + parts.join("/") : "";
}

/** 递归列出目录树（含子目录，深度≤3）；条目 isdir 置 0 并带 dir 字段（相对应用根目录） */
async function listDirAll(token, dir, rootDir = dir, depth = 0) {
  const entries = await listDir(token, dir);
  if (!entries) return [];
  const files = [];
  for (const f of entries) {
    if (f.isdir === 1) {
      if (depth < 3) files.push(...(await listDirAll(token, f.path, rootDir, depth + 1)));
      continue;
    }
    files.push({ ...f, isdir: 0, dir: relativeDir(rootDir, f.path) });
  }
  return files;
}

async function uploadFile(token, remotePath, localPath) {
  const buf = await fs.promises.readFile(localPath);
  const slices = [];
  for (let off = 0; off < buf.length; off += SLICE_SIZE) {
    slices.push(buf.subarray(off, Math.min(off + SLICE_SIZE, buf.length)));
  }
  const md5s = slices.map((s) => crypto.createHash("md5").update(s).digest("hex"));

  // 注意：预上传是 method=precreate，最后合并分片才是 method=create，两者不能混
  const pre = await postForm(`${XPAN}/file?method=precreate`, token, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    autoinit: "1",
    block_list: JSON.stringify(md5s),
  });
  if (pre.errno !== 0) throw new Error(`预创建失败 errno=${pre.errno}`);
  if (pre.return_type === 2) {
    log("  · 秒传命中，无需上传");
    return;
  }
  const uploadid = pre.uploadid;
  if (!uploadid) throw new Error("预创建未返回 uploadid，无法上传分片");

  for (let i = 0; i < slices.length; i++) {
    const form = new FormData();
    form.append("file", new Blob([slices[i]]), path.basename(localPath));
    const u = `${PCS_UPLOAD}?method=upload&access_token=${encodeURIComponent(token)}&type=tmpfile&path=${encodeURIComponent(remotePath)}&uploadid=${encodeURIComponent(uploadid)}&partseq=${i}`;
    const res = await fetch(u, { method: "POST", body: form });
    const j = await res.json();
    // superfile2 成功响应不含 errno，只返回 md5；出错时才会有非零 errno
    if (j.errno !== undefined && j.errno !== 0) {
      throw new Error(`分片 ${i + 1}/${slices.length} 上传失败 errno=${j.errno} ${j.errmsg || ""}`);
    }
    if (!j.md5) throw new Error(`分片 ${i + 1}/${slices.length} 上传返回异常：${JSON.stringify(j).slice(0, 200)}`);
    log(`  · 分片 ${i + 1}/${slices.length} 完成`);
  }

  const fin = await postForm(`${XPAN}/file?method=create`, token, {
    path: remotePath,
    size: String(buf.length),
    isdir: "0",
    block_list: JSON.stringify(md5s),
    uploadid,
  });
  if (fin.errno !== 0) throw new Error(`文件创建失败 errno=${fin.errno}`);
}

// ---------- 扫码授权：自动获取并保存 BDUSS/STOKEN（免手动抓 Cookie） ----------

/** 宽松解析：兼容纯 JSON 与 JSONP（callback({...})） */
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
    // 百度 JSONP 错误模板里偶尔混用单引号键（如 'data':），做最小规范化后再试
    try {
      return JSON.parse(m[1].replace(/'([A-Za-z_]\w*)'\s*:/g, '"$1":'));
    } catch {}
  }
  return null;
}

/** 把键值对写回 .env（存在则替换该行，不存在则追加；不打印值） */
export function upsertEnvFile(entries) {
  const p = path.join(ROOT, ".env");
  let text = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  for (const [k, v] of Object.entries(entries)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    if (re.test(text)) text = text.replace(re, `${k}=${v}`);
    else text += (text.endsWith("\n") || text === "" ? "" : "\n") + `${k}=${v}\n`;
  }
  fs.writeFileSync(p, text, "utf8");
}

/**
 * 扫码登录拿网盘网页版凭证（passport 扫码登录，与 pan.baidu.com 网页扫码同源）。
 * 流程（已实测）：getqrcode 出码 → unicast 长轮询拿临时 bduss → qrbdusslogin 换正式凭证。
 * 用网盘 App 扫码并在手机确认后返回 { bduss, stoken }。
 * BDUSS 长期有效（改密码/退出登录才失效），写进 .env 后无需重复扫码。
 */
export async function qrLogin(timeoutMs = 180000) {
  const baseHeaders = { "User-Agent": WEB_UA, Referer: "https://pan.baidu.com/" };
  // Node fetch 不跨请求保存 Cookie，手动维护会话 jar（BAIDUID/BAIDUID_BFESS 等，
  // qrbdusslogin 换凭证时需要带回，否则拿不到正式 BDUSS）
  const jar = new Map();
  const ingestCookies = (res) => {
    const sc = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const H = (extra = {}) => ({
    ...baseHeaders,
    ...extra,
    Cookie: [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
  });

  // 1) 取二维码
  const res = await fetch("https://passport.baidu.com/v2/api/getqrcode?lp=pc", { headers: baseHeaders });
  ingestCookies(res);
  const code = parseLoose(await res.text());
  if (!code?.imgurl || !code?.sign) {
    throw new Error(`获取登录二维码失败：${JSON.stringify(code)?.slice(0, 200)}`);
  }
  const imgurl = code.imgurl.startsWith("http") ? code.imgurl : `https://${code.imgurl}`;

  log("\n用【百度网盘 App】或【百度 App】扫下面的二维码，并在手机上点「确认登录」：");
  log(`  ${imgurl}`);
  try {
    const opener =
      process.platform === "win32"
        ? `start "" "${imgurl}"`
        : process.platform === "darwin"
          ? `open "${imgurl}"`
          : `xdg-open "${imgurl}"`;
    exec(opener);
    log("（已尝试在浏览器打开二维码；没弹出来就复制上面的链接手动打开）");
  } catch {
    log("（请复制上面的链接到浏览器打开二维码）");
  }

  // 2) 长轮询 unicast，扫码确认后 channel_v.v 即临时 bduss
  //    （中间态 channel_v 可能只有 {status:1}，必须等到出现 v 字段）
  let tmpBduss = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const pr = await fetch(
      `https://passport.baidu.com/channel/unicast?channel_id=${encodeURIComponent(code.sign)}&callback=bdqr&lp=pc`,
      { headers: H() }
    );
    ingestCookies(pr);
    const pj = parseLoose(await pr.text());
    if (pj?.errno === 0 && pj.channel_v) {
      const cv = parseLoose(pj.channel_v); // channel_v 是内嵌 JSON 字符串
      if (cv?.v) {
        tmpBduss = cv.v;
        break;
      }
    }
    // errno=1 为长轮询超时未扫码，继续下一轮
  }
  if (!tmpBduss) throw new Error("扫码超时，请重跑命令");

  // 3) 用临时 bduss 换正式凭证。
  //    v3 接口成功时，正式 BDUSS/STOKEN 主要通过【响应的 Set-Cookie 头】下发
  //    （BDUSS/STOKEN/BDUSS_BFESS 等，与浏览器行为一致）；body 是 JSONP，
  //    成功响应里含换行/特殊字符，直接 JSON.parse 常失败。因此优先从 cookie jar 取。
  const lr = await fetch(
    `https://passport.baidu.com/v3/login/main/qrbdusslogin?bduss=${encodeURIComponent(tmpBduss)}` +
      `&u=${encodeURIComponent("https://pan.baidu.com/")}&clientfrom=web&lp=pc&loginmerge=true&actionlog&v=2&getcookies=1&callback=bdlogin`,
    { headers: H() }
  );
  ingestCookies(lr);
  const lj = parseLoose(await lr.text());
  const sess = lj?.data?.session || {};
  const bduss = jar.get("BDUSS") || sess.bduss || "";
  const stoken = jar.get("STOKEN") || sess.stoken || "";
  // 正式 BDUSS 约 190 字符；32 位的是临时 v，不能用于网页接口
  if (bduss.length < 100) {
    const msg = lj?.errInfo?.msg || lj?.message || lj?.errmsg || "响应（Set-Cookie 与 body）中都没有正式 BDUSS";
    throw new Error(`换取登录凭证失败（${lj?.code || lj?.errno || "未知"}：${msg}）。请重新扫码，或改用浏览器手动复制 BDUSS。`);
  }
  return { bduss, stoken };
}

// ---------- 分享链接路径 A：网页端内部接口（BAIDU_BDUSS，可选全自动） ----------

const randomPwd = () =>
  Array.from({ length: 4 }, () => {
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    return alphabet[crypto.randomInt(alphabet.length)];
  }).join("");

const webCookie = (bduss, stoken) => (stoken ? `BDUSS=${bduss}; STOKEN=${stoken}` : `BDUSS=${bduss}`);

/** 取网页端 CSRF token；同时兼作 BDUSS 有效性预检 */
async function getBdstoken(bduss, stoken) {
  const res = await fetch(
    "https://pan.baidu.com/api/gettemplatevariable?app_id=250528&clienttype=0&web=1&fields=%5B%22bdstoken%22%5D",
    { headers: { Cookie: webCookie(bduss, stoken), "User-Agent": WEB_UA, Referer: "https://pan.baidu.com/disk/main" } }
  );
  const j = await res.json().catch(() => null);
  return j?.result?.bdstoken || null;
}

const WEB_SHARE_ERRNO = {
  "-6": "登录状态失效——BDUSS 不对或已过期（可补 STOKEN 再试）",
  "2": "参数错误（接口可能已变更）",
  "4": "无权限",
  "12": "文件涉及违规内容被禁止分享",
  "105": "分享链接错误",
  "130": "分享次数达到上限",
};

/** 登录凭证失效类错误（触发自动重新扫码） */
const credError = (msg) => Object.assign(new Error(msg), { credInvalid: true });

/**
 * 用网页端内部接口创建带提取码的分享（需 BAIDU_BDUSS，可选 STOKEN）。
 * 返回 { link, pwd }；任何失败抛错，由调用方降级到手动流程。
 *
 * 重要：早期需要先通过 gettemplatevariable 取 bdstoken，但百度在 2026 版网页端升级后
 * 对 share/set 已不再强制校验 bdstoken——传空字符串即可成功。因此本函数已移除
 * getBdstoken 前置调用，直接请求创建分享；BDUSS 无效时接口返回 errno=-6（登录失效）。
 */
export async function createShareWeb(fsId, { bduss, stoken = "", period = "0" }) {
  if (!bduss || bduss.length < 100) throw credError(WEB_SHARE_ERRNO["-6"]);

  const pwd = randomPwd();
  const body = new URLSearchParams({
    fid_list: JSON.stringify([Number(fsId)]), // 网页端要求数字数组
    schannel: "4", // 私密分享（带提取码）
    channel_list: "[]",
    period: String(period), // 0 = 永久（部分非会员账号受限，可设 BAIDU_SHARE_PERIOD=30）
    pwd,
    bdstoken: "", // 新版 share/set 对该字段不再强制校验，传空即可
  });
  const res = await fetch(`${WEB_SHARE}?channel=chunlei&clienttype=0&web=1`, {
    method: "POST",
    headers: {
      Cookie: webCookie(bduss, stoken),
      "User-Agent": WEB_UA,
      Referer: "https://pan.baidu.com/disk/main",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const j = await res.json().catch(() => null);
  if (!j || j.errno !== 0) {
    const hint = WEB_SHARE_ERRNO[String(j?.errno)] || `未知错误 errno=${j?.errno ?? "非JSON响应"}`;
    throw String(j?.errno) === "-6" ? credError(hint) : new Error(hint);
  }
  const link = j.link || (j.shorturl ? `https://pan.baidu.com/s/${j.shorturl}` : null);
  if (!link) throw new Error(`接口返回异常：${JSON.stringify(j).slice(0, 200)}`);
  return { link, pwd };
}

// ---------- 分享链接路径 B：手动创建 + 交互回写（默认） ----------
// 上传完成后引导用户在网盘客户端手动创建分享，粘贴链接，脚本解析并回写。

/**
 * 解析用户粘贴的分享文本，兼容网盘客户端/网页常见复制格式：
 *   https://pan.baidu.com/s/1xxxx?pwd=abcd
 *   链接：https://pan.baidu.com/s/1xxxx 提取码：abcd
 *   https://pan.baidu.com/netdisk/share?surl=xxxx
 * 返回 { link, code }，识别不到链接返回 null。
 */
export function parseSharePaste(text) {
  const urlMatch = text.match(/https?:\/\/[^\s"'，,。、）)】\]]+/i);
  if (!urlMatch) return null;
  const link = urlMatch[0].replace(/^http:\/\//i, "https://");
  let code = null;
  try {
    code = new URL(link).searchParams.get("pwd");
  } catch {
    /* 链接格式异常时忽略，仍按原文回写 */
  }
  if (!code) {
    const m = text.match(/(?:提取码|访问码|密码|pwd|code)[：:\s]*([0-9a-z]{4})\b/i);
    if (m) code = m[1].toLowerCase();
  }
  return { link, code };
}

/**
 * 逐个引导用户为已上传文件粘贴分享链接。
 * 非交互环境（管道/CI，stdin 不是 TTY）下只打印待办清单，不阻塞。
 * 返回 [{ task, link, code }]。
 */
async function promptShareLinks(tasks, remoteDir) {
  const results = [];
  if (tasks.length === 0) return results;

  if (!process.stdin.isTTY) {
    log("\n──────────────────────────────────────────────────────");
    log("以下文件已上传但还没有分享链接（需手动创建，或在 .env 填 BAIDU_BDUSS 走全自动）：");
    for (const t of tasks) {
      log(`  · ${remoteDir}/${t.basename}  （资料：${t.mdName}）`);
    }
    log("操作：网盘网页/客户端进入「我的应用数据/mynote」→ 逐个文件右键「分享」");
    log("      → 创建链接 → 复制，然后在终端重跑 npm run baidu:sync 并粘贴链接。");
    log("──────────────────────────────────────────────────────");
    return results;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (const t of tasks) {
      log("");
      log(`→ 为「${t.basename}」创建分享（资料：${t.mdName}）`);
      log(`  网盘位置：应用数据 → mynote → ${t.basename}（完整路径 ${remoteDir}/${t.basename}）`);
      log("  网盘网页/客户端中右键该文件 →「分享」→ 创建链接 → 复制（链接一般自带 ?pwd=）");
      const paste = (await rl.question("  粘贴分享链接（直接回车跳过，稍后可重跑本命令补录）： ")).trim();
      if (!paste) {
        log("  · 已跳过");
        continue;
      }
      const parsed = parseSharePaste(paste);
      if (!parsed) {
        warn("  未识别到链接，已跳过（可重跑命令补录）");
        continue;
      }
      let code = parsed.code;
      if (!code) {
        code = (await rl.question("  链接里没识别到提取码，请输入 4 位提取码（无提取码直接回车）： ")).trim().toLowerCase() || null;
      }
      results.push({ task: t, link: parsed.link, code });
      log(`  ✓ 已记录：${parsed.link}${code ? `  提取码：${code}` : "（无提取码）"}`);
    }
  } finally {
    rl.close();
  }
  return results;
}

// ---------- frontmatter 解析与回写 ----------

/**
 * 扫描 src/files/*.md，收集需要同步的本地附件。
 * 只认 attachments 列表里的 `- file: xxx`；已有 baidu 的条目跳过；http 链接跳过。
 */
export function collectTasks() {
  const tasks = [];
  if (!fs.existsSync(FILES_DIR)) return tasks;
  for (const name of fs.readdirSync(FILES_DIR)) {
    if (!name.endsWith(".md")) continue;
    const mdPath = path.join(FILES_DIR, name);
    const text = fs.readFileSync(mdPath, "utf8");
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== "---") continue;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end === -1) continue;

    let inAttachments = false;
    for (let i = 1; i < end; i++) {
      const line = lines[i];
      if (/^attachments:\s*$/.test(line)) {
        inAttachments = true;
        continue;
      }
      if (inAttachments && /^\S/.test(line)) break; // 回到顶层 key
      if (!inAttachments) continue;

      const m = line.match(/^(\s*)-\s+file:\s*(.+?)\s*$/);
      if (!m) continue;
      const fileVal = m[2].replace(/^["']|["']$/g, "");
      // 向后扫描该条目的续行 key，判断是否已有 baidu
      let hasBaidu = false;
      for (let j = i + 1; j < end; j++) {
        if (/^\s*-\s+file:/.test(lines[j]) || /^\S/.test(lines[j])) break;
        if (/^\s+baidu:/.test(lines[j])) hasBaidu = true;
      }
      if (hasBaidu) continue;
      if (/^https?:\/\//i.test(fileVal)) continue;

      // /files/xxx.zip → public/files/xxx.zip
      const rel = fileVal.replace(/^\/?public\//, "").replace(/^\//, "");
      const localPath = path.join(PUBLIC_DIR, rel);
      if (!fs.existsSync(localPath)) {
        warn(`${name} 引用的本地文件不存在，跳过：${fileVal}`);
        continue;
      }
      tasks.push({ mdPath, mdName: name, fileRef: fileVal, localPath, basename: path.basename(fileVal) });
    }
  }
  return tasks;
}

/** 在指定 `- file: <fileRef>` 条目后插入 baidu（+ code）行（保持缩进） */
export function writeBack(mdPath, fileRef, link, code) {
  const text = fs.readFileSync(mdPath, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return false;
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      end = i;
      break;
    }
  }
  for (let i = 1; i < end; i++) {
    const m = lines[i].match(/^(\s*)-\s+file:\s*(.+?)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, "");
    if (val !== fileRef) continue;
    const keyIndent = " ".repeat(m[1].length + 2); // "- " 占两列
    const insert = [`${keyIndent}baidu: ${link}`];
    if (code) insert.push(`${keyIndent}code: ${code}`);
    lines.splice(i + 1, 0, ...insert);
    fs.writeFileSync(mdPath, lines.join("\n"), "utf8");
    return true;
  }
  return false;
}

// ---------- 网盘清单（前台 /disk/ 总览页与文章下载卡片共用的数据源） ----------

const MANIFEST_FILE = path.join(ROOT, "src", "data", "netdisk.json");

function loadManifest() {
  try {
    const j = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
    if (Array.isArray(j.files)) return j;
  } catch {}
  return { version: 1, generatedAt: "", remoteDir: "/apps/mynote", files: [] };
}

/** 内容无变化就不写文件（保留旧 generatedAt），避免 CI 提交噪音 */
function saveManifest(m) {
  m.version = 1;
  let prevText = null;
  try {
    prevText = fs.readFileSync(MANIFEST_FILE, "utf8");
  } catch {}
  if (prevText) {
    try {
      const p = JSON.parse(prevText);
      if (p.remoteDir === m.remoteDir && JSON.stringify(p.files) === JSON.stringify(m.files)) return false;
    } catch {}
  }
  m.generatedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(MANIFEST_FILE), { recursive: true });
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(m, null, 2) + "\n", "utf8");
  return true;
}

/** 扫描 src/files/*.md，收集 frontmatter 里已回写的网盘链接：basename -> {link, code} */
export function collectMdLinks() {
  const map = new Map();
  if (!fs.existsSync(FILES_DIR)) return map;
  for (const name of fs.readdirSync(FILES_DIR)) {
    if (!name.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(FILES_DIR, name), "utf8");
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== "---") continue;
    let end = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        end = i;
        break;
      }
    }
    if (end === -1) continue;
    for (let i = 1; i < end; i++) {
      const m = lines[i].match(/^\s*-\s+file:\s*(.+?)\s*$/);
      if (!m) continue;
      const fileVal = m[1].replace(/^["']|["']$/g, "");
      if (/^https?:\/\//i.test(fileVal)) continue;
      const basename = path.basename(fileVal);
      let link = null;
      let code = null;
      for (let j = i + 1; j < end; j++) {
        if (/^\s*-\s+file:/.test(lines[j]) || /^\S/.test(lines[j])) break;
        const b = lines[j].match(/^\s+baidu:\s*(.+?)\s*$/);
        if (b) link = b[1].replace(/^["']|["']$/g, "");
        const c = lines[j].match(/^\s+code:\s*(.+?)\s*$/);
        if (c) code = c[1].replace(/^["']|["']$/g, "");
      }
      if (link) map.set(basename, { link, code });
    }
  }
  return map;
}

/** 给网盘里有文件但没链接的条目补建分享（配额 BAIDU_MAX_SHARES_PER_RUN，默认 10，防分享上限风暴） */
async function shareMissingLinks(remoteList, mdLinks, prevFiles, syncLinks, { bduss, stoken, period }) {
  const prevMap = new Map((prevFiles || []).map((f) => [f.basename, f]));
  const quota = Math.max(0, parseInt(process.env.BAIDU_MAX_SHARES_PER_RUN || "10", 10) || 10);
  const candidates = remoteList.filter((f) => {
    if (f.isdir !== 0) return false;
    const b = f.server_filename;
    if (mdLinks.has(b) || syncLinks.has(b)) return false;
    if (prevMap.get(b)?.link) return false;
    return true;
  });
  if (candidates.length === 0) return;
  log(`\n→ 网盘清单补分享：${candidates.length} 个文件缺链接（单次配额 ${quota}）`);
  for (const f of candidates) {
    if (syncLinks.size >= quota) {
      log(`  · 已达单次配额 ${quota}，剩余 ${candidates.length - syncLinks.size} 个留待下次运行`);
      break;
    }
    try {
      const { link, pwd } = await createShareWeb(f.fs_id, { bduss, stoken, period });
      syncLinks.set(f.server_filename, { link, code: pwd });
      log(`  ✓ ${f.server_filename} → ${link}  提取码：${pwd}`);
    } catch (e) {
      warn(`${f.server_filename} 补分享失败（${e.message}），清单中保持待分享`);
    }
    await sleep(3000);
  }
}

/** 合并远端列表 + md 回写链接 + 本次新建分享 + 上次清单（优先级 sync > md > prev） */
function buildManifest(remoteList, mdLinks, syncLinks, prev, remoteDir) {
  const now = new Date().toISOString();
  const prevMap = new Map((prev.files || []).map((f) => [f.basename, f]));
  const files = remoteList
    .filter((f) => f.isdir === 0)
    .map((f) => {
      const b = f.server_filename;
      const prevEntry = prevMap.get(b);
      let link = null;
      let code = null;
      let source = "prev";
      let updatedAt = prevEntry?.updatedAt;
      const sync = syncLinks.get(b);
      const md = mdLinks.get(b);
      if (sync) {
        link = sync.link;
        code = sync.code;
        source = "sync";
        updatedAt = now;
      } else if (md) {
        link = md.link;
        code = md.code;
        source = "md";
        updatedAt = prevEntry?.updatedAt || now;
      } else if (prevEntry?.link) {
        link = prevEntry.link;
        code = prevEntry.code;
        source = prevEntry.source || "prev";
      }
      return {
        basename: b,
        dir: f.dir || "",
        size: f.size,
        fsId: f.fs_id,
        md5: f.md5 || "",
        link,
        code,
        source,
        updatedAt: updatedAt || now,
      };
    })
    .sort((a, z) => a.basename.localeCompare(z.basename));
  return { version: 1, remoteDir, files };
}

// ---------- 主流程 ----------

async function main() {
  loadEnv();
  const appKey = process.env.BAIDU_APP_KEY;
  const secret = process.env.BAIDU_SECRET_KEY;
  const dryRun = process.argv.includes("--dry-run");
  const authOnly = process.argv.includes("auth");
  const loginOnly = process.argv.includes("login");

  // 独立扫码登录：拿网页版凭证（BDUSS/STOKEN）写进 .env，分享全自动的开关
  if (loginOnly) {
    const saved = await qrLogin();
    const toSave = { BAIDU_BDUSS: saved.bduss };
    if (saved.stoken) toSave.BAIDU_STOKEN = saved.stoken;
    upsertEnvFile(toSave);
    log(`✓ 已保存到 .env：BAIDU_BDUSS=${maskKey(saved.bduss)}${saved.stoken ? `  BAIDU_STOKEN=${maskKey(saved.stoken)}` : ""}`);
    log("以后 npm run baidu:sync 无需再扫码（改密码/退出登录才会失效）。");
    return;
  }

  if (!appKey || !secret) {
    console.error("缺少 BAIDU_APP_KEY / BAIDU_SECRET_KEY。请复制 .env.example 为 .env 并填入百度开放平台凭证：https://pan.baidu.com/union");
    process.exit(1);
  }
  const credProblems = checkCredentials(appKey, secret);
  if (credProblems.length) {
    console.error("凭证检查未通过：");
    for (const p of credProblems) console.error("  - " + p);
    console.error(`\n实际读取到的值 → AppKey：${maskKey(appKey)}  SecretKey：${maskKey(secret)}`);
    console.error("请编辑 .env 修正后重跑（值不要加引号、不要带行内注释）。");
    process.exit(1);
  }
  log(`✓ 凭证读取正常：AppKey ${maskKey(appKey)}`);

  const token = await getToken(appKey, secret);
  log(`✓ 当前 access_token：${mask(token)}`);

  if (authOnly) {
    log("授权完成，token 已保存到 .baidu-token.json");
    return;
  }

  // 远端目录：默认 /apps/mynote（网盘应用专区下的专用目录，首次运行自动创建），
  // 不要自动拣 /apps 下已有目录——那里会有其他应用（如百度输入法 baidu_shurufa）的目录。
  const remoteDir = process.env.BAIDU_DIR?.trim() || "/apps/mynote";
  log(`✓ 网盘同步目录：${remoteDir}`);

  const tasks = collectTasks();
  if (tasks.length === 0) {
    log("没有需要上传的本地附件（全部已有百度网盘链接，或没有本地附件）——继续生成/刷新网盘清单。");
  } else {
    log(`\n共 ${tasks.length} 个文件待处理：`);
    for (const t of tasks) log(`  · [${t.mdName}] ${t.basename}`);
  }
  if (dryRun) {
    const remoteList = (await listDirAll(token, remoteDir)) || [];
    const prev = loadManifest();
    log(`\n--dry-run 模式：不实际上传、不分享、不回写、不写清单。`);
    log(`网盘 ${remoteDir} 现有文件 ${remoteList.filter((f) => f.isdir === 0).length} 个；现有清单 ${prev.files.length} 条（${prev.files.filter((f) => !f.link).length} 个待分享）。`);
    log("正式运行：填了 BAIDU_BDUSS 则分享全自动；否则按提示手动创建后粘贴链接。");
    return;
  }

  await ensureDir(token, remoteDir);
  // name -> { size, fsId }：size 用于跳过重复上传，fsId 用于网页端自动分享
  const buildMeta = (list) =>
    new Map(list.filter((f) => f.isdir === 0).map((f) => [f.server_filename, { size: f.size, fsId: f.fs_id }]));
  let remoteMeta = buildMeta((await listDirAll(token, remoteDir)) || []);

  const uploaded = [];
  let newUploads = 0;
  let fail = 0;
  for (const t of tasks) {
    const remotePath = `${remoteDir}/${t.basename}`;
    log(`\n→ [${t.mdName}] ${t.basename}`);
    try {
      const localSize = fs.statSync(t.localPath).size;
      if (remoteMeta.get(t.basename)?.size === localSize) {
        log("  · 网盘已存在同名同大小文件，跳过上传");
      } else {
        await uploadFile(token, remotePath, t.localPath);
        log("  · 上传完成");
        newUploads++;
      }
      uploaded.push(t);
    } catch (e) {
      warn(`${t.basename} 上传失败：${e.message}`);
      fail++;
    }
  }
  if (newUploads > 0) remoteMeta = buildMeta((await listDirAll(token, remoteDir)) || []);

  // 分享：有 BAIDU_BDUSS 走网页端接口全自动；没有时（交互终端）可现场扫码授权一次
  let bduss = process.env.BAIDU_BDUSS?.trim();
  let stoken = process.env.BAIDU_STOKEN?.trim() || "";
  if (!bduss && uploaded.length > 0 && process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const ans = (await rl.question("\n未配置 BAIDU_BDUSS。是否现在扫码授权（自动写入 .env，一次即可）？[Y/n] ")).trim().toLowerCase();
      if (ans === "" || ans === "y" || ans === "yes") {
        try {
          const saved = await qrLogin();
          const toSave = { BAIDU_BDUSS: saved.bduss };
          if (saved.stoken) toSave.BAIDU_STOKEN = saved.stoken;
          upsertEnvFile(toSave);
          process.env.BAIDU_BDUSS = saved.bduss;
          process.env.BAIDU_STOKEN = saved.stoken;
          bduss = saved.bduss;
          stoken = saved.stoken;
          log(`✓ 凭证已写入 .env（BDUSS ${maskKey(saved.bduss)}），长期有效，无需重复扫码`);
        } catch (e) {
          warn(e.message + "，本次转手动粘贴流程");
        }
      }
    } finally {
      rl.close();
    }
  }
  const period = process.env.BAIDU_SHARE_PERIOD?.trim() || "0";
  if (bduss && bduss.length < 100) {
    warn(`.env 里的 BAIDU_BDUSS 只有 ${bduss.length} 位，不像有效的 BDUSS（正常约 200+ 位，可能粘错值）——分享会失败，届时将自动弹出重新扫码`);
  }
  const manualTasks = [];
  let written = 0;

  if (bduss && uploaded.length > 0) {
    log(`\n→ 检测到 BAIDU_BDUSS（${maskKey(bduss)}），走网页端接口自动分享（period=${period} 天，0=永久）`);
    let reloginDone = false; // 凭证失效自动重新扫码，本次运行只自动试一次
    for (const t of uploaded) {
      const meta = remoteMeta.get(t.basename);
      if (!meta?.fsId) {
        warn(`${t.basename} 取不到网盘 fs_id，转手动流程`);
        manualTasks.push(t);
        continue;
      }
      let done = false;
      for (let attempt = 0; attempt < 2 && !done; attempt++) {
        try {
          const { link, pwd } = await createShareWeb(meta.fsId, { bduss, stoken, period });
          if (writeBack(t.mdPath, t.fileRef, link, pwd)) {
            log(`  ✓ [${t.mdName}] ${t.basename} → ${link}  提取码：${pwd}`);
            written++;
          } else {
            warn(`分享成功但回写失败：${t.basename}，请在 CMS 手填 ${link}（提取码 ${pwd}）`);
          }
          done = true;
        } catch (e) {
          if (e?.credInvalid && process.stdin.isTTY && !reloginDone) {
            reloginDone = true;
            warn("登录状态已失效，自动弹出二维码重新授权…");
            try {
              const saved = await qrLogin();
              const toSave = { BAIDU_BDUSS: saved.bduss };
              if (saved.stoken) toSave.BAIDU_STOKEN = saved.stoken;
              upsertEnvFile(toSave);
              process.env.BAIDU_BDUSS = saved.bduss;
              process.env.BAIDU_STOKEN = saved.stoken;
              bduss = saved.bduss;
              stoken = saved.stoken;
              log(`✓ 新凭证已写入 .env（BDUSS ${maskKey(saved.bduss)}），重试分享`);
              continue; // 用新凭证重试同一文件
            } catch (e2) {
              warn(`重新扫码失败（${e2.message}），转手动粘贴流程`);
              break;
            }
          }
          warn(`${t.basename} 自动分享失败（${e.message}），转手动粘贴流程`);
          break;
        }
      }
      if (!done) manualTasks.push(t);
      await sleep(3000); // 网页接口同样有频控，慢一点稳
    }
  } else if (uploaded.length > 0) {
    manualTasks.push(...uploaded);
  }

  const shares = await promptShareLinks(manualTasks, remoteDir);
  for (const s of shares) {
    if (writeBack(s.task.mdPath, s.task.fileRef, s.link, s.code)) {
      log(`✓ 已回写 [${s.task.mdName}] ${s.task.basename} → ${s.link}`);
      written++;
    } else {
      warn(`回写失败（未找到对应条目）：${s.task.basename}，请在 CMS 手动填写链接 ${s.link}`);
    }
  }

  // ---- 生成网盘清单（前台 /disk/ 总览页与文章下载卡片的数据源）----
  const finalList = await listDirAll(token, remoteDir);
  if (finalList) {
    const mdLinks = collectMdLinks(); // 回写完成后再扫，能拿到本次刚写入的链接
    const prevManifest = loadManifest();
    const syncLinks = new Map();
    if (bduss) {
      await shareMissingLinks(finalList, mdLinks, prevManifest.files, syncLinks, { bduss, stoken, period });
    }
    const manifest = buildManifest(finalList, mdLinks, syncLinks, prevManifest, remoteDir);
    const manifestChanged = saveManifest(manifest);
    log(`\n清单${manifestChanged ? "已更新" : "无变化"}：src/data/netdisk.json（${manifest.files.length} 个文件，${manifest.files.filter((f) => !f.link).length} 个待分享）`);
  } else {
    warn(`清单跳过：读不到网盘目录 ${remoteDir} 的文件列表`);
  }

  const pending = uploaded.length - written;
  log(`\n完成：网盘就绪 ${uploaded.length} 个（本次新上传 ${newUploads} 个），上传失败 ${fail} 个，已回写分享链接 ${written} 个，待补链接 ${pending} 个。`);
  if (pending > 0) {
    log("待补链接的文件：在网盘创建分享后，重跑 npm run baidu:sync，已上传文件会自动跳过并继续处理。");
  }
  if (written > 0) log("下一步：git 提交 src/files/ 的变更并推送，资料页即会显示百度网盘备用按钮。");
}

// 直接运行时才执行主流程；被 import 时仅导出函数（便于测试）
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
