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

## 提交信息规范

博客仓库建议用简单前缀区分类型：

- `docs:` 新文章 / 内容修改
- `feat:` 站点新功能
- `fix:` 修复问题
- `style:` 样式调整
