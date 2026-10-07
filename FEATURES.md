# 功能清单

本文件记录 `aux-system` 当前已实现的全部功能，按模块分类，标注引入版本和最近一次功能性更新版本。

**维护规则**：
- 以当前源码为准；引入版本以首个包含该功能主文件的 tag 为准，不确定时先用 `git log --diff-filter=A` 与 `git tag --contains` 核对。
- 新功能上线后在对应模块追加条目，格式与现有条目一致；改造时原地更新描述，并更新括号中的「最近更新」版本。
- 本文件说明功能「是什么」，`CHANGELOG.md` 说明每个版本「改了什么」；不要在此复制变更细节、兼容性或升级步骤。
- 废弃功能在条目末尾标注 `[废弃于 vX.Y.Z：原因]`，不直接删除。
- 未发布的功能先标注 `未发布`，发版时改为实际版本号，并同步更新文末的「最后更新」。

---

## 1. 管理端核心

### 1.1 分析仪表盘 `/admin/dashboard` — `v0.1.0`
聚合当前注册页面（静态 registry + 数据库动态页）的访问量和功能使用度，计数来自后端埋点聚合。已删除页面的历史数据保留但不展示。

### 1.2 动态页面管理 `/admin/pages` — `v0.1.0`
管理员通过 Monaco 编辑器创建、编辑、启停和删除数据库驱动的页面，无需修改前端源码。
- 内容类型：HTML（`SandboxRenderer` 隔离 iframe，`sandbox="allow-scripts"`）和 React/TSX（运行时 Babel 编译，宿主上下文 `new Function` 执行，仅供受信任管理员）
- 可见性：公开（`/p/:slug`）或管理员（`/admin/p/:slug`），可启停
- 可配置元数据：描述、Logo、菜单图标、全屏模式、入口链接等
- 启用的页面可同步为 Sub2API `custom_menu_items` 菜单
- 附带 `tools/page-admin.py` 管理员 API 命令行工具和 `/admin/examples/*` 内容、交互、API 示例页

### 1.3 系统配置 `/admin/system-config` — `v0.5.0`（最近更新 `v0.13.0`）
分「基础配置」和「访问控制」两组四个板块，桌面端左侧吸顶目录、窄屏顶部横向目录，未保存的板块有标记。
- 基础配置：系统名称、系统 Logo（选择或拖拽上传）、系统定位（ToC/ToB）、系统域名、扩展系统公网地址、API 文档示例默认模型
- Sub2API 菜单上架开关：扩展系统管理员入口、客户端导入页、异步任务页（工单、发票、促销在各自管理页开关）
- 访问控制：客户端导入限制（按分组平台或具体分组设置客户端白名单）与多模型候选开关（Chatbox、ZCode、WorkBuddy、Pi）
- 扩展公网地址优先于环境变量 `SUB2API_EXTENSION_PUBLIC_URL`，保存后立即生效；地址变更时已上架的 `aux-*` 菜单在同一事务中迁移

### 1.4 文件管理 `/admin/files` — `v0.1.0`（图片资源）/ `v0.5.0`（统一文件管理）
集中展示图片和发票文件，支持图片上传、链接复制、发票下载、原始文件名展示和文件备注维护。
- 文件写入资源持久卷（容器内 `/app/data/assets`），数据库只保存安全相对路径和元数据
- 上传流式落盘、随机文件名、MIME 魔数校验（PNG/JPEG/GIF/WebP），无固定体积上限

### 1.5 工单管理 `/admin/tickets` — `v0.10.0`（最近更新 `v0.11.0`）
管理员查看、回复 Sub2API 用户工单并更新状态（待处理、处理中、已关闭）。
- 定高双栏工作台：列表与对话各自内部滚动，筛选、分页、状态切换和回复框固定可见
- Markdown 原文保存及安全展示（禁用原始 HTML 和危险链接），带头像的气泡对话
- 新工单提醒：通过 `ticket.created` 事件选择通知渠道和收件人

### 1.6 运维看板：首字延迟 `/admin/ops/ttft` — `v0.3.0`
首字延迟（TTFT）火焰图，直读 Sub2API PostgreSQL `usage_logs.first_token_ms`；支持日期、时间段、分组、账号筛选，以及分钟/小时/天三种时间粒度。

### 1.7 系统日志 `/admin/logs/system` — `v0.4.0`
持久化请求、运行状态和错误事件，支持级别/结果筛选、搜索和分页；错误同时输出到服务端日志。

### 1.8 操作日志 `/admin/logs/operation` — `v0.4.0`
管理员写操作审计（由 `OperationLogger` 记录），支持筛选、搜索和分页。

### 1.9 版本检测与控制台自更新 — `v0.6.0`（最近更新 `v0.6.6`）
控制台左上角显示真实构建版本，每小时检测最新正式 Release 并提示更新；一键下载当前平台二进制，校验后原子替换并保留 `.backup`，进程优雅退出后由 Docker/systemd 拉起，前端轮询健康检查后自动刷新。

---

## 2. 运营中心

### 2.1 消费核算 `/admin/ops/consumption` — `v0.5.0`（最近更新 `v0.7.7`）
基于 Sub2API `usage_logs` 的收入、成本与利润核算，支持日期范围筛选（单入口范围日历）。收入取 `usage_logs.actual_cost`，没有明确收费字段时利润相关列以不可用占位显示。
- 消费概览：区间总账合并 API 成本与 OAuth 一次性采购成本，按收入计提税点
- 每日明细：API / OAuth 账号类型页签，按日期倒序汇总；API 页签展示收入、毛利、税额、税后利润和利润率，OAuth 页签只展示当日收入
- OAuth 回本分析：账号创建/过期时间（含剩余天数）、请求数、收入、采购成本、利润、回本进度、待回本金额和状态
- 账号成本明细：账号名/计费组搜索、创建时间范围、账号类型和平台筛选
- OAuth 回本分析和账号成本明细默认按创建时间倒序，可按创建时间、收入、利润或请求数单列排序

### 2.2 成本配置 `/admin/ops/cost-config` — `v0.5.0`（最近更新 `v0.7.11`）
配置税点、OAuth 账号独立采购成本、API 账号独立倍率，并定时从 Sub2API 同步账号倍率（`SUB2API_EXTENSION_COST_SYNC_INTERVAL_SECONDS`，默认 300 秒）。
- 打开页面时只读获取 Sub2API `accounts`，无使用记录的新账号也可立即配置
- 可搜索平台下拉、OAuth/API 类型、成本配置状态、创建日期范围组合筛选；分页每页 10/20/50/100 条（默认 20）
- 默认隐藏已删除账号，按名称或 ID 搜索时可检索并标记「已删除」
- 合并计费组：同组采购成本只计一次，组内只需一个账号明确设置成本；合并弹窗账号下拉每次滚动加载 10 条
- OAuth 过期时间同步自 `accounts.expires_at`，缺失时读取订阅到期日期，取不到显示「未获取到」

---

## 3. 官网

### 3.1 ToC 官网 `/sub2api-home`（嵌入入口 `/embed`） — `v0.5.0`（最近更新 `v0.9.4`）
可配置的 Sub2API 官网，由管理端 `/admin/homepage`「ToC 官网配置」维护站点名称、控制台链接、导航菜单、首页内容、合作伙伴和集成应用；配置成功返回前不展示默认文案。

### 3.2 ToB 官网 `/tob-home`（嵌入入口 `/embed-tob`） — `v0.8.0`（最近更新 `v0.9.5`）
独立的企业版官网，由 `/admin/tob-homepage` 配置，配置保存在 `system_meta` 的 `homepage.tob.config`。
- 全球网络地图：多个主服务器、CDN 集群和客户位置，节点名称、连线曲度、节点大小、颜色、实线/虚线和数据流动效果可配置
- 顶部导航按 `navigationItems` 配置顺序和文案渲染

### 3.3 数据库动态官网 `/p/home` — `v0.1.0`（最近更新 `v0.9.0`）
约定的官网动态页，读取系统 Logo、文档按钮、控制台链接和顶部导航配置；`systemPosition` 决定文档页官网入口跳转 ToC 还是 ToB 官网。

---

## 4. 促销活动

### 4.1 促销管理 `/admin/promotions` 与用户端 `/promotions` — `v0.7.0`（最近更新 `v0.10.0`）
管理员创建返利活动，用户选择已完成的充值订单领取返利，入账通过 Sub2API 数据库事务增加用户余额。
- 返利规则：固定金额或支付金额百分比；活动时间窗、启停、Markdown 说明、单用户返利上限（0 表示不限）
- 每笔订单全局只能领取一次；超出剩余额度时部分返利，多订单按返利金额从小到大消耗额度
- 用户端提前展示未来 3 天内开始的活动，已结束活动默认折叠；领取成功后显示通知和到账金额弹窗
- 活动数据统计：参与用户、领取订单、支付金额和返利总额
- 入账后通过 `SUB2API_REDIS_*` 失效网关余额缓存；可上架为 Sub2API 用户菜单

---

## 5. 发票

### 5.1 发票申请与审核 `/admin/invoices` 与用户端 `/invoices`（`/invoice`） — `v0.4.0`（最近更新 `v0.4.3`）
Sub2API 用户基于已完成充值订单申请开票，管理员审核并上传发票文件。
- 用户端：每次申请一笔订单，申请记录滚动分页并区分线下支付记录
- 管理端：企业/税号模糊搜索、用户邮箱选择、日期范围和状态筛选
- 发票文件写入资源卷 `invoices/`；新申请可通过 `invoice.application.created` 事件通知；可上架为 Sub2API 用户菜单

---

## 6. 用户端工具

### 6.1 工单中心 `/tickets` — `v0.10.0`（最近更新 `v0.11.0`）
Sub2API 用户提交问题（Markdown）并跟进管理员回复；由工单管理页开关同步为 Sub2API 用户菜单 `aux-tickets`。

### 6.2 客户端导入 `/client-import` — `v0.11.0`（最近更新 `v0.14.0`）
用户选择有效 API Key，把密钥、网关地址和模型导入各 AI 客户端。
- CC Switch、Cherry Studio、Chatbox 深度链接一键唤起，保留 JSON 下载与复制
- 「配置文件」页签：Claude Code、Codex、Gemini CLI、Grok Build、OpenCode、OpenClaw、Pi 的一键配置命令（macOS / Linux bash、Windows PowerShell，先备份再合并，可重复运行）和原生配置预览/下载；ZCode 供应商参考文件与 WorkBuddy `models.json`
- 默认模型为可搜索下拉（所选密钥经网关 `GET /v1/models` 获取），按管理员开关支持多个候选模型
- 按管理员规则禁用受限客户端；未分组的 API Key 禁止导入
- 由系统配置开关同步为 Sub2API 用户菜单 `aux-client-import`

### 6.3 异步任务 `/async-tasks` — `v0.11.0`（最近更新 `v0.13.0`）
只读展示当前用户近期的异步生图、视频生成（Grok / Seedance）和批量生图任务。
- 关键字、创建日期范围、类型、状态、模型、API Key 筛选，表格分页；进行中任务每 15 秒静默刷新
- 未结束任务可逐条手动查询进度：视频任务由后端用创建任务的 API Key 代查网关（等价于调用端轮询，完成时可能计费）
- 数据来自 Sub2API Redis 任务快照与数据库 `usage_logs`、`batch_image_jobs`；由系统配置开关同步菜单 `aux-async-tasks`

### 6.4 用户使用指南 `/user-guide` — `v0.10.0`
面向普通用户的 API Key、分组切换、首次请求、客户端接入与故障排查指南。

---

## 7. 文档

### 7.1 API 文档 `/api-docs`（兼容 `/docs`） — `v0.5.0`（最近更新 `v0.9.3`）
Sub2API 接口说明，可挂载菜单或 iframe 嵌入。
- 覆盖模型列表、Chat Completions、Responses、文本向量、图片生成/同步编辑/异步任务、Anthropic Messages、Gemini Generate Content、异步视频生成/状态查询/MP4 下载
- 浅色/深色/跟随系统主题、多语言示例、代码复制、Markdown 导出、章节导航
- 埋点覆盖端点展开、参数页签、示例语言、章节导航、跨文档跳转和成功复制；`/docs` 的访问归入 `api-docs`

### 7.2 客户端接入文档 `/client-docs` — `v0.5.0`（最近更新 `v0.13.0`）
AI 客户端配置指南，目录按 Codex、Claude、Grok、Gemini、VS Code/Cursor 与其他客户端归类，具体客户端在页内切换。
- 多数客户端提供「CC Switch（推荐）/ 手动配置」两种方式，配套随地址和模型实时更新的界面草图
- 支持 `?client=xxx&method=manual` 直达和 `?embed=1` 嵌入
- 模型名称为可搜索下拉，来自公开接口 `GET /api/aux/client-docs/models`（Sub2API 模型广场），可输入自定义 ID
- 埋点覆盖章节导航、平台切换、安装下载、截图查看、前置指南跳转、客户端选择、复制和主题

---

## 8. 通知

### 8.1 通知渠道与投递日志 `/admin/notifications` — `v0.4.3`
管理员配置通知渠道，业务事件按配置投递；失败写入投递日志，不回滚业务操作。
- 渠道：SMTP 邮件、Resend、Webhook（`Authorization` / `X-Webhook-Secret`）、飞书应用、飞书机器人（可签名，兼容 Lark 别名）、企业微信机器人、钉钉机器人（可加签）
- 事件：`invoice.application.created`（发票申请）、`ticket.created`（新工单）；收件人在具体事件中配置
- 发送器 10 秒 HTTP 超时，Webhook 以任意 2xx 判定成功
- 消息通知日志支持开始/结束日期时间查询和分页

---

## 9. 集成与安全基础设施

### 9.1 管理员身份与会话 — `v0.1.0`
- iframe 会话交换 `POST /api/aux/admin/session`：用 `X-Aux-Token` 向 Sub2API 验证，仅为 `role=admin` 签发本系统 JWT
- 独立登录 `POST /api/aux/admin/login`（`/login`）：代理 Sub2API 登录后签发同一种 JWT
- `AdminGuard`：校验 `X-Aux-Session`（HS256），保护除上述两个端点外的全部 `/api/aux/admin/*`

### 9.2 用户端身份 `UserGuard` — `v0.4.0`
发票、工单、促销、客户端导入、异步任务等用户端点每次请求用 `X-Aux-Token` 向 Sub2API 验证，授权以返回的用户 ID 为准。

### 9.3 Sub2API 菜单同步 — `v0.2.0`（最近更新 `v0.12.0`）
受控写入 Sub2API `settings.custom_menu_items`，同步动态页面、管理员入口及发票、工单、促销、客户端导入、异步任务等 `aux-*` 用户菜单；服务重启时按持久化开关恢复或移除。

### 9.4 Sub2API PostgreSQL 集成 — `v0.3.0`
独立连接池（`SUB2API_DATABASE_*`），读取 `usage_logs`、`accounts`、`groups`、充值订单、批量生图任务等，并受控写入菜单和促销返利余额。不可用时本地功能继续工作，相关接口返回 503。

### 9.5 Sub2API Redis 集成 — `v0.7.0`（最近更新 `v0.11.0`）
可选（`SUB2API_REDIS_*`）：促销返利入账后失效网关余额缓存（`v0.7.0`），只读扫描 `image_task:*`、`grok_video_pending:*` 供异步任务页使用（`v0.11.0`）。

### 9.6 限流与匿名写保护 — `v0.1.0`（最近更新 `v0.13.0`）
- `TelemetryGuard`：匿名埋点请求体 4 KiB 上限、按 IP 令牌桶（默认 5 req/s、burst 10），超限返回 413/429
- 公开只读限流：客户端文档模型列表按 IP 限流并缓存匿名结果 60 秒（`v0.13.0`）
- 用户端限流：异步任务进度查询按 Sub2API 用户每 2 秒 1 次、突发 5 次（`v0.13.0`）

### 9.7 页面埋点 — `v0.1.0`（最近更新 `v0.6.9`）
`trackPageView` / `trackFeatureClick` fire-and-forget 上报页面访问和功能点击；静态页面身份以 `page-registry.ts` 为准，动态页面使用 `page:<slug>`。

---

## 10. 部署与运维

### 10.1 单镜像部署 — `v0.1.0`（最近更新 `v0.6.0`）
多阶段 Docker 构建，后端同源托管前端 dist；`v0.6.0` 起构建 `linux/amd64`、`linux/arm64` 镜像发布到 GHCR。生产 Compose 默认绑定 `127.0.0.1:8004`，由宿主机 NGINX 终止 HTTPS。

### 10.2 自动数据库迁移 — `v0.6.2`
启动时默认执行幂等 Ent `Schema.Create`；`AUTO_MIGRATE=false` 可禁用，此时需先执行 `make migrate`。

### 10.3 子路径部署 — `v0.8.1`（最近更新 `v0.8.2`）
前端通过 `VITE_BASE_PATH` 部署到非根路径，发布镜像默认 `/aux/`；静态资源、路由、API、埋点、下载和图片地址统一带基础路径，配置的根路径链接按同域名跳转 Sub2API。

### 10.4 CI/CD 与发布 — `v0.6.0`（最近更新 `v0.6.8`）
GitHub Actions 四条工作流：CI、安全扫描（Go 漏洞扫描、`pnpm audit`）、测试部署（`test` 分支）、Release 发布（tag 触发，产出镜像、amd64/arm64 二进制更新包、校验文件和中文 Release 说明）。发布结果支持飞书机器人和 SMTP 邮件通知，通知失败不影响主流程。

---

_最后更新：`v0.14.0`（2026-10-05）。每次发版前随 `CHANGELOG.md` 同步更新。_
