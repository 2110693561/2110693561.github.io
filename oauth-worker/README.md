# GitHub OAuth Worker

GitHub 的 OAuth 授权需要一个服务端，因此 GitHub Pages + Decap CMS 不能只靠静态页面完成登录。

Decap 官方文档建议使用一个 edge worker/serverless OAuth handler。

部署步骤：

1. 创建 GitHub OAuth App。
2. 设置 Authorization callback URL 为：
   `https://你的-worker域名/callback`
3. 在 Cloudflare Worker 中配置：
   - `GITHUB_CLIENT_ID`
   - `GITHUB_CLIENT_SECRET`
4. 把 Worker 地址填入 `public/admin/config.yml`：

```yaml
backend:
  name: github
  repo: YOUR_USERNAME/YOUR_REPO
  branch: main
  base_url: https://你的-worker域名
  auth_endpoint: auth
```

注意：不要把 `GITHUB_CLIENT_SECRET` 写进 GitHub 仓库。
