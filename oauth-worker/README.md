# GitHub OAuth Worker

GitHub 的 OAuth 授权需要一个服务端，因此 GitHub Pages + Decap CMS 不能只靠静态页面完成登录。
此外，本 Worker 还托管「网盘管理」端点（`/disk/*`），供后台 [/admin/disk/](../public/admin/disk/index.html) 调用。

部署步骤（均在本地终端执行）：

1. 创建 GitHub OAuth App。
2. 设置 Authorization callback URL 为：
   `https://你的-worker域名/callback`
3. 在 Cloudflare Worker 中配置 Secrets：

   | Secret | 用途 |
   | --- | --- |
   | `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | OAuth 登录（Decap + 网盘管理页共用） |
   | `GITHUB_ALLOWED_OWNER` | 网盘管理鉴权：允许的 GitHub 用户名（或数字 ID） |
   | `BAIDU_ACCESS_TOKEN` | **【推荐】** 直接用 access_token，跳过 OAuth 刷新（日常零风控）。30 天有效，从本地 `.baidu-token.json` 取值，过期前更新即可 |
   | `BAIDU_APP_KEY` / `BAIDU_SECRET_KEY` | xpan 开放平台凭证（降级刷新用） |
   | `BAIDU_REFRESH_TOKEN` | 降级用：`BAIDU_ACCESS_TOKEN` 未设或过期时自动刷新；百度风控拦截刷新接口时无法降级 |
   | `BAIDU_BDUSS`（可选 `BAIDU_STOKEN`） | 扫码登录凭证，创建分享用（`npm run baidu:login` 获取） |

   ```bash
   npx wrangler secret put GITHUB_CLIENT_ID
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler secret put GITHUB_ALLOWED_OWNER
   npx wrangler secret put BAIDU_ACCESS_TOKEN        # 推荐：日常跳过刷新
   npx wrangler secret put BAIDU_APP_KEY
   npx wrangler secret put BAIDU_SECRET_KEY
   npx wrangler secret put BAIDU_REFRESH_TOKEN        # 降级备用
   npx wrangler secret put BAIDU_BDUSS
   npx wrangler secret put BAIDU_STOKEN
   npx wrangler deploy
   ```

   非敏感 vars 在 [wrangler.toml](wrangler.toml) 的 `[vars]`：`BAIDU_DIR`（网盘目录）、`MANIFEST_RAW_URL`（公开清单地址，用于展示分享状态）。

4. 把 Worker 地址填入 `public/admin/config.yml`：

```yaml
backend:
  name: github
  repo: YOUR_USERNAME/YOUR_REPO
  branch: main
  base_url: https://你的-worker域名
  auth_endpoint: auth
```

## 端点

| 端点 | 说明 |
| --- | --- |
| `GET /auth` → `GET /callback` | Decap CMS 标准 OAuth 握手（勿动） |
| `GET /disk/list` | 网盘 `/apps/mynote` 文件列表 + 合并公开清单的分享状态 |
| `POST /disk/share` | body `{fsId}` → 网页端接口创建 4 位提取码分享，返回 `{link, code}` |
| `POST /disk/upload` | multipart `file`（≤64MB）→ precreate/秒传/8MB 分片/create |

除 `/auth`、`/callback` 外，所有请求：

- 需带 `Authorization: Bearer <github-token>`，token 对应的账号必须是 `GITHUB_ALLOWED_OWNER`，否则 401；
- CORS 白名单：`https://<owner>.github.io`、`http://localhost:8080`（本地 CMS）、`http://127.0.0.1:8787`（wrangler dev）。

注意：不要把任何 Secret 写进 GitHub 仓库。
