# 文档页埋点与统计

客户端接入页和 API 文档页复用现有匿名埋点接口与分析仪表盘，无新增配置或数据库迁移。升级前端后，新事件开始累计；此前未采集的操作不会补算。旧版客户端选择、复制、主题事件标识保持兼容。

## 查看统计

管理员进入 `/admin/dashboard`，在「页面访问量」查看 `client-docs`（客户端接入）和 `api-docs`（API 文档），在「功能使用度」按页面 ID 与功能 ID 查看累计次数。操作后重新进入仪表盘或刷新浏览器页面即可读取最新聚合。页面没有访问时仍显示 0，功能在首次成功上报后出现。

后端 `GET /api/aux/admin/analytics/overview` 按 `page_id` 聚合访问量、按 `page_id + feature_id` 聚合功能次数；这两个页面与其他注册页面一起计入概览总数。

## 访问量口径

| 入口 | 页面 ID |
| --- | --- |
| `/client-docs` | `client-docs` |
| `/api-docs`、兼容入口 `/docs` | `api-docs` |

首次打开、刷新、从其他路径返回时，由全局 SDK 自动上报 `page_view`。独立访问和 iframe 嵌入使用相同页面 ID。主题、客户端查询参数和章节锚点变化不增加页面访问量；组件不重复手动上报。`/docs` 作为注册表中的兼容路由归入 API 文档，不额外增加仪表盘页面行。

访问量是累计 PV，不是去重访客数、阅读时长或模型调用次数。默认客户端和默认展开端点不会产生功能点击；直接打开某个客户端的链接只增加页面访问量。

## 客户端接入页功能 ID

下列事件的 `page_id` 均为 `client-docs`，`<client>` 来自 `CLIENT_GUIDES` 的稳定客户端 ID。

| 功能 ID | 触发行为 |
| --- | --- |
| `select-<client>` | 桌面目录、移动端下拉、下一个客户端和前置指南链接选择客户端 |
| `section-<client>-<section>` | 点击章节目录或配置、验证快捷链接；章节为 `prepare/install/configure/verify/troubleshooting` |
| `platform-<client>-<platform>` | 鼠标或键盘切换 `unix/windows`；重复选择当前平台不计数 |
| `copy-<client>-install`、`copy-<client>-install-alternative-<index>` | 成功复制安装命令或替代安装命令 |
| `copy-<client>-config/auth/cc-switch/verify/prompt` | 成功复制对应配置、密钥占位文件、CC Switch 参考、验证命令或验证消息；斜线表示不同后缀 |
| `copy-hermes-wizard` | 成功复制 Hermes 配置向导命令 |
| `open-<client>-official/install` | 打开官方文档或安装下载说明；安装步骤的外链归入同一个 `install` 事件 |
| `open-<client>-cc-switch-download/docs` | 打开 CC Switch 下载或配置文档 |
| `screenshot-<client>-configure/verify/cc-switch-<index>` | 放大对应截图；关闭大图不计数 |
| `open-api-docs`、`open-home`、`open-console` | 进入 API 文档、官网或控制台 |
| `theme-system/light/dark` | 手动选择外观；系统自动切换主题不计数 |

索引从 0 开始。不采集搜索词、用户填写的地址或模型。滚动造成的章节高亮变化不计作章节点击。

## API 文档页功能 ID

下列事件的 `page_id` 均为 `api-docs`，`<endpoint>` 为源码中的固定端点 ID，例如 `chat-completions`、`models`。

| 功能 ID | 触发行为 |
| --- | --- |
| `section-quickstart/authentication/endpoint-list/errors` | 点击快速开始、认证、端点列表或错误处理导航 |
| `section-endpoint-<endpoint>` | 从目录、能力入口或快捷链接导航到端点 |
| `expand-<endpoint>`、`collapse-<endpoint>` | 展开、收起端点详情 |
| `panel-<endpoint>-request/response/examples` | 切换请求参数、响应参数或调用示例页签 |
| `language-<endpoint>-curl/python/go/java` | 切换调用示例语言 |
| `copy-quickstart-curl/quickstart-response/error-response` | 成功复制快速开始请求、响应或错误示例 |
| `copy-<endpoint>-curl/python/go/java` | 成功复制端点调用示例 |
| `copy-<endpoint>-response-example`、`copy-<endpoint>-markdown` | 成功复制端点响应示例或完整 Markdown 文档 |
| `open-client-docs`、`open-home`、`open-console` | 进入客户端接入页、官网或控制台 |
| `theme-system/light/dark` | 手动选择外观 |

表中斜线表示不同固定后缀。重复点击已选参数页签或语言不计数；复制被浏览器拒绝时不计成功次数。

## 上报边界与验证

访问通过 `POST /api/aux/telemetry/page-view`，功能通过 `POST /api/aux/telemetry/feature-click` 上报。请求体仅含页面 ID、功能 ID（点击事件）、匿名访客 ID 和管理员标识，不包含 URL 查询参数、token、搜索词、输入内容或复制正文。埋点请求不附加 `X-Aux-Token` 或 `X-Aux-Session`。

上报使用现有 fire-and-forget SDK；网络故障、浏览器拦截和限流可能导致少计，不阻塞阅读、导航或复制。匿名端点继续使用现有 4 KiB 请求体限制与按 IP 限流，统计只用于使用分析。

前端验证命令：

```bash
cd frontend
pnpm run typecheck
pnpm run test
pnpm run build
```

回归覆盖两个页面的实际交互、复制成功与失败、事件内容边界、带查询参数及 `/docs` 入口的访问计数、仪表盘聚合展示。生产验收时，用浏览器网络面板核对上述两个上报端点返回 201，再在仪表盘刷新查看计数；本地组件测试不代表生产数据库已完成验收。
