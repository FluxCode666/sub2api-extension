# 客户端接入文档维护

公开入口：`/client-docs`。控制台侧栏和 API 文档导航均提供入口。页面按静态身份 `client-docs` 统计访问；客户端选择和成功复制使用功能点击埋点，不上报用户填写的地址或模型。

页尾站点名称读取「系统配置 → Sub2API 系统名称」，通过公开接口 `/api/aux/homepage/config` 获取 `siteName`，兼容旧配置的 `heroTitle`。保存系统名称后重新打开或刷新文档页即可更新，无需重新部署；配置读取失败时显示通用的「客户端接入文档」。

「系统配置 → Sub2API 系统域名」保存到公开配置的 `systemDomain` 字段。接入文档加载配置后，会将该 HTTP(S) 地址作为「API 基础地址」默认值；URL 中显式传入 `api_base`，或用户在当前页面手动编辑过地址时优先使用用户值。未配置域名时仍使用示例地址 `https://api.example.com`。

可用参数：

- `client=claude-code|claude-desktop|codex|pi|hermes|openclaw|paseo|zcode|deepseek-harness|obsidian`：直达对应客户端；未知值回退到 Claude Code。Obsidian 使用 Claudian 插件（YishenTu/claudian）。
- `api_base=https%3A%2F%2Fapi.example.com`：预填实际网关地址。缺省使用示例域名，避免将附属系统域名误当作模型网关。
- `embed=1` 或 `ui_mode=embedded`：嵌入入口。
- `theme=system|light|dark`：指定跟随系统、浅色或深色；兼容宿主传入的主题参数。

页头提供三种外观选项，首次访问默认跟随系统，并实时响应系统的深浅色切换。手动选择保存在本地 `aux-client-docs-theme` 中，刷新后保留。有效 URL 主题参数优先于本地偏好；仅打开带主题参数的链接不会覆盖保存的偏好。手动切换会同时更新本地偏好和当前 URL，切换客户端时继续保留。浏览器禁止存储时仍可在当前页面切换。

主题样式以页面根元素的 `data-theme` 为依据，不修改全局主题或其他页面的主题设置。

## 页面结构与交互

页面以直接阅读指南为主：桌面左侧提供可搜索的客户端目录，正文展示当前客户端的准备、安装、配置、验证与常见问题，宽屏右侧提供随阅读位置更新的章节导航。搜索支持客户端名称、用途、Claudian 插件名称与 DSH 别名；无结果时可清空并继续选择。

小于 960px 时，客户端目录变为原生下拉选择；小于 1280px 时，章节导航收进「本页内容」。标题下可直接跳到配置或验证，FAQ 使用独立展开项，页尾在所有宽度下提供 API 参考入口。切换客户端保留网关地址、各客户端填写的模型与主题，并支持浏览器前进、后退。

样式由 `frontend/src/pages/ClientDocsPage.css` 和 `frontend/tokens.css` 管理，使用 Geist、中性暖白与酒红色，所有颜色通过命名的 OKLCH 变量提供深浅主题。GSAP 只用于客户端标题切换的短暂反馈，正文不依赖滚动动画才能显示；减少动态效果偏好会关闭空间动效。复制提供进行中、成功和手动复制回退反馈；等待复制期间修改配置，不会把旧内容的完成状态显示在新配置上。

菜单挂载示例：`https://aux.example.com/client-docs?embed=1&client=codex&api_base=https%3A%2F%2Fapi.example.com`。

## 补充截图

随静态文档发布的截图放在系统统一资源目录的 `client-docs/<客户端>/`（默认 `backend/data/assets/client-docs/<客户端>/`，生产镜像首启自动灌入持久卷），在 `frontend/src/lib/client-guides.ts` 对应客户端的 `screenshots.configure.src` 和 `screenshots.verify.src` 中填写 `/client-docs/<客户端>/<文件名>`。后台管理的截图则在 `/admin/files` 上传并复制完整 HTTP(S) 图片 URL 填入。10 个客户端各有「配置」与「验证」两个位置，共 20 个；Claude Code、Codex、Pi、Hermes 的 CC Switch 快捷配置另各预留一张图，在 `ccSwitch.screenshot.src` 中填写路径（例如 `/client-docs/codex/cc-switch.png`）。Claude Desktop 的配置图直接展示 CC Switch。根据实际截图调整 `alt` 和 `caption`，截图中的密钥应遮盖。

Claude Code、ZCode、Codex、DeepSeek Harness 与 Paseo 已各补齐用户提供的两张原图，共 10 张；Pi 已补齐 4 张配置与验证原图；其余位置继续保留占位。截图中的域名、供应商名称与模型为示例，实际接入使用用户自己的配置。

- `backend/data/assets/client-docs/claude-code/configure.png` 展示 `~/.claude/settings.json` 的 `env` 持久化配置，密钥已遮盖；`verify.png` 展示 Claude Code 使用 Opus 5 发送「当前时间」后的回复。
- `backend/data/assets/client-docs/claude-code/cc-switch.png` 展示 CC Switch 编辑 Claude Code 供应商：网关地址、API Key、Anthropic Messages 格式与模型映射，密钥已遮盖。
- `backend/data/assets/client-docs/zcode/configure.png` 展示 Anthropic Messages 供应商配置，`verify.png` 展示发送「当前时间」后的回复。
- `backend/data/assets/client-docs/codex/configure.png` 并排展示 `auth.json` 密钥文件与 `config.toml` 提供方配置，`verify.png` 展示 Codex 桌面客户端发送「当前时间」后的回复。
- `backend/data/assets/client-docs/codex/cc-switch.png` 展示 CC Switch 编辑 Codex 供应商时填写完整 API 请求地址、API Key 和保存操作，密钥已遮盖。
- `backend/data/assets/client-docs/pi/models.png` 展示 Pi 的 `models.json` 配置，`verify.png` 展示发送「当前时间」后的工具调用和回复；`cc-switch-provider.png` 与 `cc-switch-models.png` 展示 CC Switch 中配置 Pi 供应商和模型列表。
- `backend/data/assets/client-docs/deepseek-harness/configure.png` 展示内置 DeepSeek 提供方的 API 密钥、自定义 API 地址与模型目录，`verify.png` 展示在工作区发送「当前时间」后的回复。
- `backend/data/assets/client-docs/paseo/configure.png` 展示当前主机的 Providers 设置，Claude、Codex 与 Pi 显示可用；`verify.png` 展示通过 Codex 提供方发送「当前时间」后的回复，前置指南仍可按所选客户端进入。

`src` 留空或加载失败时显示紧凑的图示待补充提示，不会出现破图或大块空白。填写 URL 后自动渲染图片，保留原图比例，支持点击放大、Escape 关闭与返回原按钮。截图文件本身位于资源目录，替换文件即可生效无需重建；修改 `client-guides.ts` 中的路径或文案才需要重新构建部署。

## 新增客户端

在 `frontend/src/lib/client-guides.ts` 的 `ClientId` 和 `CLIENT_GUIDES` 中登记客户端，补齐 `getInstallCommand`、`getConfigExample`、`getVerifyCommand`。桌面搜索目录、移动端下拉选择、步骤、截图、页尾数量与下一个客户端入口由数据生成，无需按客户端数量修改布局。

客户端 `icon` 字段引用系统统一资源目录 `client-icons/`（默认 `backend/data/assets/client-icons/`）下的本地品牌图标，供选择区、目录和标题共用。图标来源与许可记录在该目录的 `README.md`，新增时补齐实际品牌图标，不使用字母占位。黑白图标需同时检查深浅主题。

桌面应用或插件可通过 `installSteps` 提供自身的下载链接与安装步骤，`installTitle` 标明安装或启动命令的用途，`configSteps` 提供界面操作步骤。依赖另一个客户端时，通过 `prerequisiteClients` 登记可选客户端并链接到各自的配置指南，在 `prerequisite` 中说明前置要求，不把底层 CLI 的安装命令当作当前客户端的安装方法。链接保留网关地址与嵌入、主题参数。没有终端安装、配置或验证命令时返回 `null`，页面自动隐藏相应命令块；完全沿用其他客户端配置时，`endpoint` 设为 `null`，准备步骤展示前置指南入口。所有客户端统一提供可复制的「当前时间」验证消息，不要求输入 `/status`。

API 地址会规范化去除尾部斜线和末尾 `/v1`；配置再按协议添加所需路径。非法地址阻止配置生成。模型 ID 不写入浏览器存储；API Key 始终使用 `sk-YOUR_API_KEY` 占位，由用户复制后在本地替换。

Claude Code 提供官方安装器与 npm 两种安装方式，任选其一。npm 方式要求 Node.js 22 或更新版本，执行 `npm install -g @anthropic-ai/claude-code`；安装后重新打开终端并继续配置。额外安装方式通过 `installAlternatives` 登记说明与可复制命令。

Claude Desktop 从官网下载桌面安装包，通过其文档页内的 CC Switch 指南配置，支持 macOS 与 Windows。它使用独立的 3P profile，无需先安装 Claude Code。默认以 `claude-opus-5` 和 Anthropic Messages 直连；如需非 Claude 角色模型或协议转换，可开启模型映射并保持 CC Switch 本地路由运行。切换后必须完全退出并重启 Claude Desktop。

Claude Code、Claude Desktop、Codex、Hermes 与 Pi 各自在「配置连接」中展示 CC Switch 快捷配置，不增加 CC Switch 独立路由或客户端条目。`ccSwitch` 字段登记各应用的步骤与可选截图，`getCCSwitchExample` 复用已校验的地址和当前模型生成填写参考：Claude 使用根地址，Codex、Pi、Hermes 使用 `/v1` 地址。参数变为无效时隐藏参考内容。原有手动方式继续保留，快捷配置完成后可直接跳到验证。Pi 从 `/model` 中选择实际保存的供应商，启动命令不强制覆盖为手动示例的 `gateway`。

Codex 使用两份文件：`~/.codex/config.toml` 配置模型与网关，并设置顶层 `cli_auth_credentials_store = "file"` 及提供方的 `requires_openai_auth = true`；API Key 写入 `~/.codex/auth.json` 的 `OPENAI_API_KEY` 字段。文档不再使用 `GATEWAY_API_KEY` 环境变量方式。截图可同时展示两份文件；若用户自定义了 `CODEX_HOME`，两份文件都应位于该目录。

Paseo 的准备步骤提供 Claude Code、Codex、Pi、Hermes 四份现有接入文档的入口，用户只需在运行 Paseo 后台服务的主机上配置所选客户端，并发送「当前时间」确认可用，再返回安装 Paseo Desktop、选择对应提供方与工作区。Claude Code、Codex、Pi 为官方原生支持，Hermes 通过提供方目录启用；更多客户端链接至官方支持列表。Paseo 页面不再重复 Codex 配置文件，也不固定某一种模型 API 协议。

Obsidian 示例以已配置可用的 Claude Code 为前置条件，安装步骤下载 Obsidian，并在第三方插件中安装、启用 Claudian；变量填写在插件的 Claude → Environment → Custom variables 中。ZCode 使用桌面界面的自定义供应商，按用户提供的截图选择 Anthropic Messages，Base URL 填网关根地址；DeepSeek Harness 按用户截图使用 Web UI 内置的 DeepSeek（deepseek-official）提供方，在「自定义设置」中将 API 地址改为网关的 /v1 地址，并核对模型目录，使用 OpenAI Chat Completions 兼容接口。

## 内容来源与验证范围

接入方式于 2026-09-09 对照以下官方资料核对。模型名称、账号权限、运行时版本要求以服务方与客户端当前版本为准；示例中的 `your-model-id` 必须替换为平台实际开放的模型。

- Claude Code：<https://code.claude.com/docs/en/llm-gateway-connect> 与 <https://code.claude.com/docs/en/setup#install-with-npm>
- Claude Desktop：<https://claude.ai/download>，CC Switch 的桌面接入说明见 <https://github.com/farion1231/cc-switch/blob/v3.20.2/docs/user-manual/zh/2-providers/2.6-claude-desktop.md>
- CC Switch：以当前正式版 v3.20.2 核对 <https://github.com/farion1231/cc-switch/releases/tag/v3.20.2>、`docs/user-manual/zh/2-providers/2.1-add.md`、`2.2-switch.md`、`src/config/piProviderPresets.ts` 与 `src/components/providers/forms/HermesFormFields.tsx`。下载入口固定为官方 Releases/latest。
- Codex：<https://developers.openai.com/codex/config-advanced>，提供方字段另对照 <https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json>
- Pi：<https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent> 与其 `docs/models.md`。当前官方快速开始使用 `@earendil-works/pi-coding-agent`。
- Hermes Agent：<https://hermes-agent.nousresearch.com/docs/integrations/providers>
- OpenClaw：<https://docs.openclaw.ai/concepts/model-providers> 与 <https://docs.openclaw.ai/start/getting-started>
- Paseo：<https://paseo.sh/docs>、<https://paseo.sh/docs/providers>、<https://paseo.sh/docs/supported-providers> 与 <https://paseo.sh/docs/custom-providers>
- ZCode：<https://zcode.z.ai/cn/docs/configuration> 的「自定义供应商」与 <https://zcode.z.ai/cn/docs/install>
- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness> 与其 `docs/user/guide/providers.md`、`docs/user/guide/index.md`
- Obsidian Claudian：<https://github.com/YishenTu/claudian>；环境变量入口另对照 `src/providers/claude/ui/ClaudeSettingsTab.ts`，安装入口为 <https://community.obsidian.md/plugins/realclaudian>

本地验证覆盖配置生成、路由、客户端切换、复制反馈、无效输入、深浅主题和移动端布局。未使用真实 API Key 安装运行这些客户端或发起计费模型调用。
