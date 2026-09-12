# Claude 兼容入口

本文件仅用于兼容仍从 `.claude/CLAUDE.md` 加载项目说明的工具。项目统一规范已经迁移到根目录：

- 完整开发规范：[AGENTS.md](../AGENTS.md)
- Claude 快速入口：[CLAUDE.md](../CLAUDE.md)

每个新任务必须从当前工作区实际打开上述两份文件；会话粘贴、历史记忆和本摘要不能替代读取，未实际打开不得声称已读取。同一任务可复用未变化的已读内容，文件变更后重新核对。以根目录 `AGENTS.md` 为项目事实和工程约束的唯一入口。若本文件与根目录内容不一致，以根目录文件和当前源码为准。

规范持续优化中；用户提出额外通用细节时，先询问是否更新根目录规范，确认后再同步相关入口文件。临时任务要求不自动写入规范。

关键约束摘要：

- 全局新增或改造的业务控件必须使用现有 shadcn/ui 组件和标准交互，执行根目录 `AGENTS.md` 第 6.5 节；不得以裸原生控件、自绘控件或旧代码先例替代。组件底层、隐藏文件输入与必要表单桥接除外；各页面保留自己的 token。
- 日期范围必须使用单个范围按钮和同一 `Popover + Calendar mode="range"`，区间连续高亮、桌面双月、窄屏单月并支持清除；除用户明确要求分开输入外，不得拆成两个日期框或单日弹层。交付前检查控件 diff，并完成浏览器样式、键盘与移动端验收。
- 根路径 `/` 跳转 `/admin/dashboard`；数据库动态官网使用 `/p/<slug>`。
- `X-Aux-Token` 用于 iframe 管理员会话交换，也由发票用户端点的 `UserGuard` 验证；管理员 API 使用 `X-Aux-Session`。
- 除登录和会话交换端点外，管理员 API 必须经过 `AdminGuard`；发票用户端点必须经过 `UserGuard`；匿名埋点必须经过 `TelemetryGuard`。
- 后端响应使用统一 envelope；数据库 HTML 通过 `SandboxRenderer` 渲染；动态 React/TSX 仅供受信任管理员使用。
- 图片、发票和客户端文档写入资源持久卷，数据库只保存元数据；不要提交凭据、token、生产环境变量或宿主机绝对路径。

常用检查命令：

```bash
cat AGENTS.md
cat CLAUDE.md
git status --short
cd backend && make test-unit && make vet
cd ../frontend && pnpm run typecheck && pnpm run test && pnpm run build
```
