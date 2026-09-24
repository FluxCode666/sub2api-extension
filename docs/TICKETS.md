# 工单系统

工单是 aux-system 自有数据，存放于扩展 PostgreSQL 的 `support_tickets` 和 `support_ticket_messages` 表，不写入 Sub2API 业务表。数据库 schema 由 Ent 管理；生产默认启动自动迁移，关闭 `AUTO_MIGRATE` 时需在发布前执行 `cd backend && make migrate`。

## 用户入口

管理员可在 `/admin/tickets` 的“上架到用户端”开关控制是否发布菜单。开关状态保存于附属系统 `system_meta` 的 `ticket.feature.enabled`，默认关闭；开启后，服务会在 Sub2API `settings.custom_menu_items` 中幂等创建/更新用户菜单 `id=aux-tickets`、`visibility=user`，目标为扩展 `/tickets`，关闭后会移除该菜单。服务启动时也会按已保存状态重新同步，避免重启后菜单状态漂移。菜单以 iframe 打开并由 Sub2API 注入 token，无需修改 Sub2API 源码。未配置 `SUB2API_DATABASE_*` 或浏览器可访问的 `SUB2API_EXTENSION_PUBLIC_URL` 时，开关状态仍可保存，但无法同步 Sub2API 菜单。

用户通过 `/tickets` 创建工单、查看对话和回复。用户身份由 `X-Aux-Token` 经 `UserGuard` 实时向 Sub2API 验证；请求不接受客户端指定的用户 ID。新工单初始为 `OPEN`，用户只能读取或回复自己的工单；关闭工单后用户不能继续回复。

## 管理功能

管理员通过当前系统 `/admin/tickets` 查看工单、搜索主题/用户名/邮箱、按状态筛选、回复用户，并将状态设为 `OPEN`、`IN_PROGRESS` 或 `CLOSED`。管理员 API 位于 `/api/aux/admin/tickets`，由 `AdminGuard` 校验 `X-Aux-Session`。管理员回复会将仍处于 `OPEN` 的工单推进到 `IN_PROGRESS`。

## API

所有端点使用标准响应 envelope。用户端端点均需要有效 `X-Aux-Token`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/aux/tickets?page=1&page_size=20` | 列出当前用户工单，最多每页 100 条 |
| `POST` | `/api/aux/tickets` | 创建工单，JSON 为 `{"subject":"主题","body":"描述"}` |
| `GET` | `/api/aux/tickets/:id` | 获取当前用户工单及对话 |
| `POST` | `/api/aux/tickets/:id/messages` | 回复工单，JSON 为 `{"body":"回复内容"}` |

管理员端点均需要有效 `X-Aux-Session`：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/aux/admin/tickets?page=1&page_size=20&status=OPEN&keyword=...` | 分页筛选工单；`status` 可省略或使用 `OPEN`、`IN_PROGRESS`、`CLOSED` |
| `GET` | `/api/aux/admin/tickets/:id` | 获取任意工单及对话 |
| `POST` | `/api/aux/admin/tickets/:id/messages` | 回复用户 |
| `PUT` | `/api/aux/admin/tickets/:id/status` | 更新状态，JSON 为 `{"status":"CLOSED"}` |

工单主题最多 200 个字符，消息正文最多 10,000 个字符；创建工单的主题和首条消息必填。问题描述和双方追加回复以 Markdown 原文存储，用户端与管理端展示时支持 GFM（列表、引用、代码块、表格、链接等）；展示层转义原始 HTML 并清理危险链接，不将用户输入当作 HTML 执行。

## 新工单提醒

管理员在 `/admin/notifications` 的「新工单提醒」中为 `ticket.created` 选择一个或多个现有通知渠道。SMTP/Resend 可单独填写工单提醒收件人；Webhook、飞书等渠道沿用各自配置。通知发送和投递日志复用现有通知服务；发送失败不会撤销已创建的工单，可在消息通知日志中查看失败原因。
