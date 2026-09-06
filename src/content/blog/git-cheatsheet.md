---
title: Git 常用操作速查表
description: 博客写作常用的 Git 命令：提交、分支、回滚、远程同步，一份实用速查表。
date: 2026-08-20
category: 工具
tags: [Git, 效率]
draft: false
password: "123"

---

写博客用到的 Git 命令其实不多，这里整理一份速查表。

## 日常提交

```bash
git status                 # 查看改动
git add src/content/       # 添加新文章
git commit -m "docs: 新增 GD32 GPIO 笔记"
git push                   # 推送后 GitHub Actions 自动部署
```

## 撤销与回滚

```bash
git restore <file>         # 丢弃工作区改动（未 add）
git restore --staged <file>  # 取消暂存（已 add 未 commit）
git revert <commit>        # 生成一个反向提交，安全回滚
git reset --hard HEAD~1    # 危险：彻底丢弃最近一次提交
```

## 分支操作

```bash
git switch -c feat/search  # 新建并切换分支
git switch main            # 切回主分支
git merge feat/search      # 合并分支
git branch -d feat/search  # 删除已合并分支
```

## 远程同步

```bash
git pull --rebase          # 拉取并变基，保持历史线性
git remote -v              # 查看远程仓库
git log --oneline -5       # 最近 5 条提交
```

## 推送失败排查

`git push` 报错时，按错误类型对症下药：

### 1. `non-fast-forward` / `fetch first`

远程有别人（或 CI）新提交，本地落后了。先拉取再推：

```bash
git pull --rebase origin main
git push origin main
```

如果 rebase 有冲突，解决冲突后 `git add <文件>` 再 `git rebase --continue`。

### 2. `schannel: failed to receive handshake, SSL/TLS connection failed`

Windows 下 Git 用 schannel 做 SSL，到 GitHub 的网络不稳定时会握手失败（fetch 可能成功、push 失败，或时好时坏）。

- **先重试**：网络抖动时多试几次往往能成
  ```powershell
  for ($i=1; $i -le 5; $i++) { git push origin main; if ($?) { break }; Start-Sleep 3 }
  ```
- **换 SSL 后端**：schannel 不行就切 openssl
  ```powershell
  git config --global http.sslBackend openssl
  # 或单次：$env:GIT_SSL_BACKEND="openssl"; git push origin main
  ```
- **改用 HTTP/1.1**：HTTP/2 有时在不稳定网络下更脆
  ```powershell
  git config --global http.version HTTP/1.1
  ```
- **检查代理**：如果开了 VPN/代理，让 git 走代理
  ```powershell
  git config --global http.proxy http://127.0.0.1:7890   # 端口换成你的
  ```

### 3. 网络完全断连（连 api.github.com / raw 都 HTTP 000）

`git push` 彻底走不通时，用 GitHub REST API 直接传文件（需要 token，从 Windows 凭证管理器取）：

```powershell
# 取 token
$tok = ("protocol=https`nhost=github.com`n" | git credential fill | Select-String "^password=").Line.Substring(9)
$owner = "你的用户名"; $repo = "仓库名"; $branch = "main"; $path = "public/admin/index.html"

# 1. 取文件当前 sha
$r = Invoke-RestMethod "https://api.github.com/repos/$owner/$repo/contents/$path`?ref=$branch" -Headers @{Authorization="token $tok"; "User-Agent"="mynote"}
# 2. base64 编码本地文件
$content = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\public\admin\index.html"))
# 3. PUT 更新
$body = @{ message = "fix: 更新 admin 页面"; content = $content; sha = $r.sha; branch = $branch } | ConvertTo-Json -Compress
Invoke-RestMethod "https://api.github.com/repos/$owner/$repo/contents/$path" -Method Put -Headers @{Authorization="token $tok"; "User-Agent"="mynote"; "Content-Type"="application/json"} -Body $body
```

之后本地 `git pull` 同步一下，保持本地与远程一致。

### 4. 确认本地提交是否已就绪

推送前先看清楚本地是不是领先远程：

```bash
git status -sb          # 显示 [ahead N] 就是本地有 N 个提交没推
git log --oneline -3    # 确认最新提交内容对不对
```

## 提交信息规范

博客仓库建议用简单前缀区分类型：

- `docs:` 新文章 / 内容修改
- `feat:` 站点新功能
- `fix:` 修复问题
- `style:` 样式调整
