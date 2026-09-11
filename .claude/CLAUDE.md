# Claude 兼容入口

本文件仅用于兼容仍从 `.claude/CLAUDE.md` 加载项目说明的工具。项目统一规范已经迁移到根目录：

- 完整开发规范：[AGENTS.md](../AGENTS.md)
- Claude 快速入口：[CLAUDE.md](../CLAUDE.md)

执行任何任务前，先阅读上述两份文件，并以根目录 `AGENTS.md` 为项目事实和工程约束的唯一入口。若本文件与根目录内容不一致，以根目录文件和当前源码为准。

规范持续优化中；用户提出额外通用细节时，先询问是否更新根目录规范，确认后再同步相关入口文件。临时任务要求不自动写入规范。

关键约束摘要：

- 根路径 `/` 跳转 `/admin/dashboard`；数据库动态官网使用 `/p/<slug>`。
- `X-Aux-Token` 用于 iframe 管理员会话交换，也由发票用户端点的 `UserGuard` 验证；管理员 API 使用 `X-Aux-Session`。
- 除登录和会话交换端点外，管理员 API 必须经过 `AdminGuard`；发票用户端点必须经过 `UserGuard`；匿名埋点必须经过 `TelemetryGuard`。
- 后端响应使用统一 envelope；数据库 HTML 通过 `SandboxRenderer` 渲染；动态 React/TSX 仅供受信任管理员使用。
- 图片、发票和客户端文档写入资源持久卷，数据库只保存元数据；不要提交凭据、token、生产环境变量或宿主机绝对路径。

常用检查命令：

```bash
git status --short
cd backend && make test-unit && make vet
cd ../frontend && pnpm run typecheck && pnpm run test && pnpm run build
```
