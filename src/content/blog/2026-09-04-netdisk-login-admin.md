---
title: 网盘后台登录管理：在 CMS 后台扫码维护百度凭证（状态检测 + 扫码登录）
date: 2026-09-04
category: 项目实战
tags: [Astro, Cloudflare Workers, 百度网盘, 静态博客]
description: 给网盘管理后台加上「🔑 网盘登录」：三类凭证（access_token / refresh_token / BDUSS）一键检测有效性，扫码登录拿 BDUSS/STOKEN 并生成 wrangler 命令一键复制；聊聊 Worker 不能自写 Secret 的设计妥协、cookie jar 无状态传递，以及频繁扫码触发百度风控的踩坑实录。
---

## 1. 背景：凭证不是配完就完

上篇「三件套」上线后，网盘资源链路已经跑通，但很快就暴露出一个运维层的麻烦：**百度那边的凭证是有寿命的，而且死法还不止一种**。

Worker（Cloudflare）里现在存着三类凭证，各管一摊：

| 凭证 | 用途 | 寿命 / 死法 |
| --- | --- | --- |
| `BAIDU_ACCESS_TOKEN` | xpan 开放 API：列表、上传、建目录 | 30 天有效期；过期后 xpan 全线报 `errno=-6` |
| `BAIDU_REFRESH_TOKEN` | 上者过期时降级刷新 | 百度可能轮换它（旧值作废），刷新接口还会被安全策略临时拦截 |
| `BAIDU_BDUSS` + `STOKEN` | 网页端接口：创建分享、浏览全盘 | 长期有效，但改密码 / 退出登录 / 触发风控都会失效 |

之前某天后台突然全线 `-6`，我得翻出本地 `.env`、对着文档拼 `wrangler secret put` 命令、手动粘贴——这还只是在**我自己电脑**上才能干的活。于是这次把这个维护动作直接搬进后台页面：**打开 `/admin/disk/` 就能看到每类凭证死活，坏了就扫码换新**。

## 2. 一个绕不开的设计约束

动手前先想清楚一个「不可能」：**Cloudflare Worker 不能在运行时修改自己的 Secrets**。Secrets 只能通过 `wrangler secret put`（CLI）或控制台写入，Worker 代码里没有任何 API 能改自己的环境变量。

所以「扫码成功 → 自动更新凭证」这条路天然走不通，最多做到：

```
扫码成功 → Worker 把 BDUSS/STOKEN 返回给前端 → 页面展示值 + 生成
wrangler secret put 命令 → 作者复制粘贴到本地终端执行 → 完成
```

从「全自动」退化成了「扫码 + 复制粘贴」，但对比旧流程（本地跑脚本 / 浏览器抓 Cookie / 手动拼命令）还是省了一大截。另一个备选方案是把凭证写进 Workers KV 让 Worker 运行时读 KV 而非 env，真正做到全自动——代价是凭证落盘到 KV 有泄露面，且要改 `getBaiduToken` 的读取顺序，这次先不上。

## 3. 最终效果

入口有三处，按使用场景各归各位：

- **网盘管理页顶栏**（`/admin/disk/`）：「🔑 网盘登录」按钮，登录 GitHub 后可见；
- **Decap CMS 后台**（`/admin/`）：右下角浮动按钮「☁️ 网盘管理」，一键跳转；
- **前台网盘总览页**（`/disk/`）：右上角「🔐 网盘管理」胶囊按钮——读者看不到意义，但作者自己在前台浏览时想传个文件不用绕回后台找入口。

点开后的弹窗分两段：

**上半段：凭证状态。** 三张状态卡片，点「↻ 重新检测」实时刷新：

```
access_token    ✓ 有效          （xpan API 用，30 天有效）
refresh_token   已配置          （access_token 失效时降级刷新）
BDUSS           ✗ 已失效        （创建分享 / 浏览全盘用）
```

绿色 = 有效，红色 = 失效，灰色 = 未配置。BDUSS 失效时还会给出原因提示（比如「长度不足，疑似临时值或粘贴错误」——这个坑我们真踩过）。

**下半段：扫码登录。** 点「显示二维码」→ 百度登录二维码直接内嵌在弹窗里 → 手机百度网盘 App 扫码确认 → 几秒后二维码下方直接出现结果框：

```
✓ 扫码成功！在本地 oauth-worker 目录执行命令，粘贴凭证值后回车：
① 更新 BDUSS（创建分享必须）
   npx wrangler secret put BAIDU_BDUSS   [复制命令] [复制值]
② 可选更新 STOKEN（部分接口需要）
   npx wrangler secret put BAIDU_STOKEN  [复制命令] [复制值]
```

「复制值」把约 190 字符的 BDUSS 上剪贴板，「复制命令」把命令行上剪贴板，本地终端一粘一回车，完事。回到页面点「重新检测」，BDUSS 那张卡变绿，全链路闭环。

## 4. 技术实现

### 4.1 三个端点

Worker 在原有 `/disk/*` 路由下新增一组 `/disk/auth/*`：

```
GET /disk/auth/status    检测三类凭证有效性
GET /disk/auth/qrlogin   生成扫码二维码（返回 imgurl + sign + 会话 cookie）
GET /disk/auth/qrpoll    轮询扫码结果，成功返回 BDUSS/STOKEN
```

鉴权与其它 `/disk/*` 端点完全一致：GitHub OAuth token + `GITHUB_ALLOWED_OWNER` 归属校验，无 token 一律 401。

### 4.2 状态检测：能不调的接口就不调

`/disk/auth/status` 的检测策略刻意「保守」：

- `access_token`：调一次 xpan `nas?method=uinfo`（轻量、无副作用），`errno=0` 有效 / `-6` 失效；
- `refresh_token`：**只检查是否配置，不主动调用**——刷新接口一调就真刷新，可能触发轮换甚至风控，检测功能本身不能反过来把凭证搞坏；
- `BDUSS`：调网页端 `gettemplatevariable` 取 `bdstoken`，`errno=0` 有效 / `-6` 失效；另外先做长度校验（约 190 字符），32 位的临时值直接标红并提示。

### 4.3 扫码流程：从 Node 脚本到 Worker 的移植

百度 passport 扫码登录的三步流程，本地 `baidu-sync.mjs` 里早就有能跑的实现：

```
1. GET  /v2/api/getqrcode          → 拿二维码图片 URL + sign
2. 轮询 /channel/unicast?channel_id=sign → 扫码确认后 channel_v.v 即临时 bduss
3. GET  /v3/login/main/qrbdusslogin?bduss=临时bduss
   → 正式 BDUSS/STOKEN 主要通过【响应的 Set-Cookie 头】下发
```

搬到 Worker 有两个要解决的点：

**① 会话保持。** Node 脚本里用手写 cookie jar（`Map`）跨请求带 `BAIDUID` 等 cookie，第 3 步不带回就拿不到正式 BDUSS。Worker 是无状态的，一个扫码会话要跨多次 HTTP 请求存在——解法是把 cookie 序列化成字符串，**响应头 `x-qr-cookie` 下发，前端存住，下次轮询通过请求头 `X-QR-Cookie` 原样回传**，等于把 jar 寄存在浏览器侧，Worker 依旧无状态。CORS 相应放行这两个自定义头（`Access-Control-Allow-Headers` 加 `X-QR-Cookie`，`Expose-Headers` 加 `x-qr-cookie`，不然前端跨域读不到）。

**② 不能长等。** 本地脚本是 `while` 循环 180 秒长轮询，Worker 单请求没这么长的执行预算。拆成两段：`qrlogin` 只出码，`qrpoll` 每次只探一次百度 `unicast`（百度侧本身就是 2~30s 的长轮询， errno=1 即未扫码），前端用 `setTimeout` 递归调度、2.5 秒一探——不用 `setInterval` 是避免上一次请求没返回时并发堆叠。

### 4.4 前端：一段与主题隔离的独立 HTML

`/admin/disk/` 是不参与 Astro 构建的独立 HTML（不受 Decap 配置缓存影响），弹窗、状态卡、二维码区都是手写 DOM，复用页面既有的 CSS 变量体系，明暗主题自动跟随。扫码成功的结果框里按钮事件用事件委托绑定，「复制值 / 复制命令」复用页面已有的 `copyText`（clipboard API + `execCommand` 降级）。

## 5. 踩坑实录

**① CSS 变量名张冠李戴 → 弹窗透明。** 文件夹选择弹窗用了 `background: var(--card)`——这是前台博客 `global.css` 的变量名，而这个独立页面定义的是 `--panel`。变量不存在时 CSS 背景解析失败，整个弹窗透明，底下的表格全透出来。教训：独立页面的变量体系要自洽，复制样式时先确认变量在当前作用域有定义。

**② 频繁扫码 = 触发百度风控。** 上线当天测试扫码次数过多，结果新扫出来的、完全合法的 BDUSS 调任何网页端接口都返回 `-6`（连 `quota` 查容量都拒）——百度在**账号级**把整个新会话拦了，与凭证本身对不对无关。而同一时刻，CI 里一枚更早的、来自浏览器 Cookie 的 BDUSS 依然工作正常。结论：

- 风控是临时的（几小时到一天），别急着反复重扫，越扫越久；
- 判断 `-6` 时先分清是「凭证真失效」还是「会话被风控」——用一个已知有效的会话交叉验证最靠谱；
- 多准备一条有效凭证通道（比如 CI 用的那枚）是很好的兜底。

**③ xpan 删除接口无权限（31296）。** 想给测试残留文件做 API 清理，`filemanager?method=filedelete` GET/POST、换参数、换 `async` 值全部 500 `internal error`——开放平台个人应用大概率没开放删除权限。反而是个安全特性：后台和脚本永远不可能误删你网盘里的文件。测试产物只能在 App 里手动删。

## 6. 日常维护节奏

这套东西上线后，凭证维护从「出了事翻文档救火」变成「看板 + 一次扫码」：

- **日常**：什么都不用做，`access_token` 有效期内后台零 OAuth 调用，风控概率最低；
- **每 30 天**：后台看板 `access_token` 变红时，本地跑一次 `npm run baidu:login`（或直接后台扫码），把新 token `wrangler secret put` 进去；
- **BDUSS 失效时**（改密 / 退出登录 / 风控）：后台点「🔑 网盘登录」→ 扫码 → 复制值 → 终端粘贴，两分钟恢复；
- **refresh_token 轮换**：响应头 `x-baidu-rotated: 1` 会触发页面横幅提醒，照着提示更新一次 Secret 即可。

## 7. 可以再往下做的

1. **KV 持久化**：把扫码结果写进 Workers KV，Worker 读凭证时 KV 优先，彻底去掉「本地终端粘贴」这一步（需要接受凭证落 KV 的安全取舍）；
2. **access_token 也能后台换**：目前 access_token 过期还得回本地跑脚本，理论上可以在 Worker 里用 appkey/secret 走完整 OAuth 授权码流程出码，让用户扫码授权一次拿齐三件套；
3. **风控自诊**：`-6` 时自动区分「真失效」与「临时风控」，后者在 UI 上给出「等一等再试」的提示而不是催用户重扫码——这次的教训值得写进产品逻辑。
