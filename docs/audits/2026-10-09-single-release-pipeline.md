# 主分支单通道生产发布策略（2026-10-09）

## 原问题

项目的 `vercel.json` 在 `main` 上启用了 Git 自动部署，同时 `.github/workflows/production-deploy.yml` 又在 `main` push 时测试通过后运行 `vercel deploy --prod`。同一个 SHA 因此产生两份生产部署：重复构建数据库迁移、浪费构建分钟，且 Git 自动部署可能在 GitHub Actions 检查完成之前提前上线。

## 修改

- `git.deploymentEnabled.main = false`：仅关闭 `main` 分支的 Vercel Git 自动部署；未匹配的 feature/PR 分支默认仍允许预览部署。
- GitHub Actions 的 `Production Deploy` 仍由 `main` push 触发，并在前端测试/构建、后端测试、Vercel/Cloudflare 环境预检查成功后执行唯一生产部署。
- Actions 正式部署后仍校验 `/`、`/health`、`/health/db`。
- 添加前端构建流水线内的配置回归测试，确保以后不会意外开启主分支双重部署。

## 回退与注意事项

- 若 GitHub Actions 失败，自动 Git 生产发布不会替代它；请先查看 GitHub Actions 日志并修复后再发布。
- 在紧急情况下，可以使用具备权限的 Vercel 控制台手动回滚已有正常版本，或执行受控的手动 CLI 生产部署。
- 本次更改仅影响未来的部署机制，不改变当前生产数据库或业务记录。
