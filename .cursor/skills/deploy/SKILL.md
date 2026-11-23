---
name: deploy
description: >-
  Deploy this repository by committing main and pushing it to the remote. Use
  when the user says 部署, deploy, or asks to submit this repo's main branch
  to the remote. Do not use when the user explicitly names Wrangler,
  Cloudflare, or another hosting deploy command.
---

# 部署

我说的部署 就是把当前的工作区的 main 分支代码提交到远端就可以了。

只处理这个仓库。部署完成 = `main` 已推到远端。不要接着运行 `wrangler deploy`、Cloudflare、GitHub Actions，或任何托管平台的发布命令。远端 CI 会自己接这次推送。

用户说「部署」就是明确要求提交并推送。用户点名 Wrangler、Cloudflare 或其他发布命令时，按那个命令做，不要用本 skill。

## 步骤

在这个仓库根目录执行。

1. 并行查看状态、改动和近期提交说明：`git status`、`git diff`（含已暂存）、`git log -8 --oneline`。同时看 `main` 跟踪的远端：`git status -sb` 和 `git rev-parse --abbrev-ref main@{upstream}`。
2. 只处理 `main`。当前不在 `main` 时，先 `git checkout main`。未提交改动会跟着走；切换失败就停，说明原因。不要合并其他分支，不要新建分支，不要把其他分支上已有的提交带进 `main`。
3. 工作区有改动才提交。不要空提交。不要提交密钥或凭据（`.env`、`credentials.json` 一类）；用户点名要提交这些文件时，先警告再按用户的决定做。
4. 提交说明沿用 `git log` 里的风格，一两句，写清为什么改。用 HEREDOC 传入：

```bash
git add <相关文件>
git commit -m "$(cat <<'EOF'
提交说明

EOF
)"
git status
```

5. 把 `main` 推到它已经跟踪的远端。没有上游时推 `origin`，并执行 `git push -u origin main`。不要推送到名为 `upstream` 的远端，除非 `main` 本来就跟踪它。
6. 推送失败就原样报告远端错误并停止。不要 `--force`，不要改 git config，不要 `--no-verify`，不要改用平台发布命令补救。

## 做完之后

告诉用户：提交哈希、推送到哪个远端的哪条分支、工作区是否干净。没有新改动且 `main` 已经和远端一致时，直接说明已经是最新的，不要空提交。
