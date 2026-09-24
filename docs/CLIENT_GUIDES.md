# 客户端接入文档维护

公开入口：`/client-docs`。控制台侧栏和 API 文档导航均提供入口。页面按静态身份 `client-docs` 统计访问；客户端选择、章节导航、平台切换、安装下载和成功复制使用功能点击埋点，不上报用户填写的地址或模型。事件标识、API 文档埋点和仪表盘口径见 [文档页埋点与统计](DOCS_TELEMETRY.md)。

页尾站点名称读取「系统配置 → Sub2API 系统名称」，通过公开接口 `/api/aux/homepage/config` 获取 `siteName`，兼容旧配置的 `heroTitle`。保存系统名称后重新打开或刷新文档页即可更新，无需重新部署；配置读取失败时显示通用的「客户端接入文档」。

页头「官网」按钮读取同一接口的 `systemPosition`：`toc`（默认）跳转 `/sub2api-home`，`tob` 跳转 `/tob-home`；按钮会保留当前 aux-system 的挂载前缀并在顶层窗口打开。

接入文档的「API 基础地址」默认使用浏览器当前访问站点的 origin；如果文档页与 API 网关使用不同域名，请在 URL 中显式传入 `api_base`，或在页面中临时编辑地址。页面不会把管理端配置中的内部/旧域名自动带入用户示例。

可用参数：

- `client=claude-code|claude-desktop|codex|grok-build|gemini-cli|vscode-codex|vscode-claude|openai-compatible|ide-plugins|pi|hermes|openclaw|paseo|zcode|deepseek-harness|obsidian`：直达对应客户端；未知值回退到 Claude Code。Codex 页面展示面向新手的 Desktop 路径；`vscode-*` 同时覆盖 VS Code 和 Cursor；Obsidian 使用 Claudian 插件（YishenTu/claudian）。
- `method=cc-switch|manual`：支持 CC Switch 的客户端默认展示 CC Switch Tab；`manual` 直达手动配置。Claude Desktop 只提供 CC Switch 流程，其他不支持 CC Switch 的客户端忽略此参数。旧的 `method=cc-switch&client=...` 入口仍有效。
- `api_base=https%3A%2F%2Fapi.example.com`：预填与文档页不同域名的实际网关地址；缺省使用当前访问站点的 origin。
- `embed=1` 或 `ui_mode=embedded`：嵌入入口；页面处于真实 iframe 时也会自动识别。嵌入态不渲染顶部菜单栏。
- `theme=system|light|dark`：指定跟随系统、浅色或深色；兼容宿主传入的主题参数。

独立访问时，页头提供三种外观选项；嵌入态隐藏整个页头并使用 URL、已保存偏好或系统设置决定主题。首次访问默认跟随系统，并实时响应系统的深浅色切换。手动选择保存在本地 `aux-client-docs-theme` 中，刷新后保留。有效 URL 主题参数优先于本地偏好；仅打开带主题参数的链接不会覆盖保存的偏好。手动切换会同时更新本地偏好和当前 URL，切换客户端时继续保留。浏览器禁止存储时仍可在当前页面切换。

主题样式以页面根元素的 `data-theme` 为依据，不修改全局主题或其他页面的主题设置。

## 页面结构与交互

页面以直接阅读指南为主：桌面左侧固定展示 Codex、Claude、Grok、Gemini、VS Code/Cursor 与其他客户端六个主题，无折叠交互。Claude 和编辑器扩展在正文使用客户端 Tab，其他客户端在正文选择具体工具；可搜索全部 16 个客户端及别名。支持 CC Switch 的客户端在正文使用配置方式 Tab，默认 CC Switch，手动配置作为备选。一般客户端正文展示准备、安装、配置、验证与常见问题；Codex Desktop 直接从配置模块填写地址和模型，省略独立的准备与安装模块。宽屏右侧提供章节导航；无搜索结果时可清空并继续选择。

小于 960px 时，接入目录变为按上述六个主题分组的 shadcn/ui 下拉选择；小于 1280px 时，章节导航收进「本页内容」。标题下显示当前指南适用的实际客户端，并可直接跳到配置或验证。FAQ 使用独立展开项，页尾在所有宽度下提供 API 参考入口。切换入口时保留网关地址、各客户端填写的模型与主题，并支持浏览器前进、后退。

样式由 `frontend/src/pages/ClientDocsPage.css` 和 `frontend/tokens.css` 管理，使用 Geist、中性暖白与酒红色，所有颜色通过命名的 OKLCH 变量提供深浅主题。切换指南时正文立即显示，GSAP 只用于复制和平台配置的局部反馈；减少动态效果偏好会关闭空间动效。复制提供进行中、成功和手动复制回退反馈；等待复制期间修改配置，不会把旧内容的完成状态显示在新配置上。

菜单挂载示例：Codex 推荐配置使用 `https://aux.example.com/client-docs?embed=1&client=codex&api_base=https%3A%2F%2Fapi.example.com`；手动配置使用 `https://aux.example.com/client-docs?embed=1&client=codex&method=manual&api_base=https%3A%2F%2Fapi.example.com`。

## 界面操作示意

`/client-docs` 的新客户端指南及 Codex 导入主流程不再使用客户端配置截图；部分既有指南仍保留原有截图。Codex 的 CC Switch 主流程共五步：前四步使用 HTML/CSS 绘制 Sub2API 用户端密钥管理、创建弹窗和 CC Switch 界面草图；CC Switch 参照官网首页 Codex 产品预览的窗口栏、客户端图标切换、功能工具组和供应商卡片结构重绘，呈现供应商名称、地址、用量、启用状态及行操作，不嵌入官网页面或截图。①—④只标在对应草图的操作控件上，不另设步骤编号图例或在标题重复编号。第五步「重启 Codex 客户端」仅以文字说明，不绘制客户端界面。Sub2API 草图仅展示用户可见的「我的账户」导航，不包含管理板块，并保留完整密钥管理页面框架。CC Switch、Paseo、ZCode 和 DeepSeek Harness 的部分界面操作由 `frontend/src/pages/ClientSetupDiagram.tsx` 绘制。草图不是客户端真实界面，不绘制浏览器或操作系统外框。Codex 导入路径不要求在本页手工填写密钥、地址或模型；手动配置示例中的 API Key 仍只使用占位值。配置文件、命令和验证结果继续使用可复制代码与文字。

仓库仍保留 `backend/data/assets/client-docs/` 中的旧资源文件，供既有指南、静态资源接口及历史链接使用；新增客户端指南不必上传截图。若客户端设置项或入口路径改变，应同步调整 `ClientSetupDiagram.tsx` 与测试，并核对官方文档。


## 新增客户端

在 `frontend/src/lib/client-guides.ts` 的 `ClientId` 和 `CLIENT_GUIDES` 中登记客户端，补齐 `getInstallCommand`、`getConfigExample`、`getVerifyCommand`；还需在 `ClientDocsPage.tsx` 的 `CLIENT_TOPICS` 中归入对应主题。桌面搜索、移动端下拉选择、步骤、页尾数量与下一个客户端入口由数据生成；若新增界面操作示意，再按需扩展 `ClientSetupDiagram.tsx`。

客户端 `icon` 字段引用系统统一资源目录 `client-icons/`（默认 `backend/data/assets/client-icons/`）下的本地品牌图标，供选择区、目录和标题共用。图标来源与许可记录在该目录的 `README.md`。没有可确认许可的品牌资源时使用 `mark` 字段选择 Lucide 语义图标，不下载或复刻第三方页面图标，也不使用字母占位。黑白图标需同时检查深浅主题。

桌面应用或插件可通过 `installSteps` 提供自身的下载链接与安装步骤，`installTitle` 标明安装或启动命令的用途，`configSteps` 提供界面操作步骤。依赖另一个客户端时，通过 `prerequisiteClients` 登记可选客户端并链接到各自的配置指南，在 `prerequisite` 中说明前置要求，不把底层 CLI 的安装命令当作当前客户端的安装方法。链接保留网关地址与嵌入、主题参数。没有终端安装、配置或验证命令时返回 `null`，页面自动隐藏相应命令块；完全沿用其他客户端配置时，`endpoint` 设为 `null`，准备步骤展示前置指南入口。所有客户端统一提供可复制的「当前时间」验证消息，不要求输入 `/status`。

API 地址会规范化去除尾部斜线和末尾 `/v1`；配置再按协议添加所需路径。Codex 手动配置的 `base_url` 使用网关根地址，不要加 `/v1`，实际 Responses 请求使用 `/v1/responses`。非法地址阻止配置生成。模型 ID 不写入浏览器存储；手动配置示例中的 API Key 始终使用 `sk-YOUR_API_KEY` 占位，由用户复制后在本地替换。

Claude Code 提供官方安装器与 npm 两种安装方式，任选其一。npm 方式要求 Node.js 22 或更新版本，执行 `npm install -g @anthropic-ai/claude-code`；安装后重新打开终端并继续配置。额外安装方式通过 `installAlternatives` 登记说明与可复制命令。

Claude Desktop 从官网下载桌面安装包，通过其文档页内的 CC Switch 指南配置，支持 macOS 与 Windows。它使用独立的 3P profile，无需先安装 Claude Code。默认以 `claude-opus-5` 和 Anthropic Messages 直连；如需非 Claude 角色模型或协议转换，可开启模型映射并保持 CC Switch 本地路由运行。切换后必须完全退出并重启 Claude Desktop。

Codex 的 CC Switch 主流程由 `CC_SWITCH_GUIDES` 登记五步说明，`ClientSetupDiagram.tsx` 为前四步展示界面草图；重启 Codex Desktop 是纯文字步骤，不配界面图。步骤依次为：在平台创建 API Key、点击新密钥所在行的「导入到 CCS」、确认导入、在 CC Switch 启用配置、重启 Codex Desktop；Codex 扩展用户最后一步改为重载 VS Code/Cursor。①—④只作为草图内部控件定位标记，不额外解释“第几步”，也不将⑤用于无界面的重启文字。CC Switch 草图参照官网首页 Codex 产品预览绘制窗口栏、客户端图标栏、管理工具组和供应商卡片；导入确认弹窗与待启用配置用于定位③、④。Sub2API 草图使用用户端导航，不展示管理板块，并分别呈现密钥创建弹窗和密钥行操作。该流程不显示手工填写参数块，手动配置页签仍保留 `config.toml` 与 `auth.json` 示例。Claude Code、Claude Desktop 与 Grok Build 的 CC Switch 内容也由 `CC_SWITCH_GUIDES` 登记步骤、验证和排错内容；Pi 与 Hermes 使用各自 `ccSwitch` 字段。其他客户端的 `getCCSwitchExample` 仍按协议生成填写参考：Claude 使用根地址，Grok Build、Pi、Hermes 使用 `/v1` 地址；Claude Desktop 额外提示模型映射与本地路由。参数无效时隐藏参考内容。Pi 从 `/model` 中选择实际保存的供应商，启动命令不强制覆盖为手动示例的 `gateway`。

Codex Desktop 的手动配置备选方式使用两份文件：`~/.codex/config.toml` 配置模型与网关，并设置顶层 `cli_auth_credentials_store = "file"` 及提供方的 `requires_openai_auth = true`；API Key 写入 `~/.codex/auth.json` 的 `OPENAI_API_KEY` 字段。Desktop 不需要安装 Codex CLI、Node.js 或 npm，也不使用 `GATEWAY_API_KEY` 环境变量方式。手动配置页签以可复制代码块展示两份文件；若用户自定义了 `CODEX_HOME`，两份文件都应位于该目录。

官方 Codex IDE 扩展可读取同一组 `config.toml` 和 `auth.json`。Claude Code CLI 与官方 IDE 扩展共享 Anthropic 环境变量或 `~/.claude/settings.json`；Claude Desktop 是独立配置，不能把 Claude Code 的一键导入当成桌面版配置。VS Code/Cursor 中必须核对扩展发布者，保存共享配置后重载编辑器窗口。

Grok Build 使用 `~/.grok/config.toml`，Base URL 以 `/v1` 结尾并保持 `api_backend = "chat_completions"`。Gemini CLI 使用站点根地址作为 `GOOGLE_GEMINI_BASE_URL`，由客户端自行追加 `/v1beta`；已有 Google 登录可能覆盖 `GEMINI_API_KEY`。通用 OpenAI 客户端与 Cline、Roo Code 等 IDE 插件选择 OpenAI Compatible，填写 `/v1` Base URL、API Key 与完整模型 ID，不选择只直连厂商的内置提供方。

Paseo 的准备步骤提供 Claude Code、Codex、Pi、Hermes 四份现有接入文档的入口，用户只需在运行 Paseo 后台服务的主机上配置所选客户端，并发送「当前时间」确认可用，再返回安装 Paseo Desktop、选择对应提供方与工作区。Claude Code、Codex、Pi 为官方原生支持，Hermes 通过提供方目录启用；更多客户端链接至官方支持列表。Paseo 页面不再重复 Codex 配置文件，也不固定某一种模型 API 协议。

Obsidian 示例以已配置可用的 Claude Code 为前置条件，安装步骤下载 Obsidian，并在第三方插件中安装、启用 Claudian；变量填写在插件的 Claude → Environment → Custom variables 中。ZCode 使用桌面界面的自定义供应商，示意以 Anthropic Messages 为例，Base URL 填网关根地址；DeepSeek Harness 使用 Web UI 内置的 DeepSeek（deepseek-official）提供方，在「自定义设置」中将 API 地址改为网关的 /v1 地址，并核对模型目录，使用 OpenAI Chat Completions 兼容接口。

## 内容来源与验证范围

接入方式于 2026-09-22 对照以下资料核对。HeyRoute 的 Clients 集合作为客户端覆盖范围和操作顺序参考，所有文案均按本站接口、品牌和安全边界重新编写，未复制其截图、令牌链接或品牌内容。模型名称、账号权限、运行时版本要求以服务方与客户端当前版本为准；示例中的 `your-model-id` 必须替换为平台实际开放的模型。

- Claude Code：<https://code.claude.com/docs/en/llm-gateway-connect> 与 <https://code.claude.com/docs/en/setup#install-with-npm>
- Claude Desktop：<https://claude.ai/download>，CC Switch 的桌面接入说明见 <https://github.com/farion1231/cc-switch/blob/v3.20.3/docs/user-manual/zh/2-providers/2.6-claude-desktop.md>
- CC Switch：以 v3.20.3 文档核对 `docs/user-manual/zh/2-providers/2.1-add.md`、`2.2-switch.md` 与 `2.6-claude-desktop.md`；下载入口使用官方站点 <https://ccswitch.io/>。
- Codex：<https://developers.openai.com/codex/config-advanced>，提供方字段另对照 <https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json>
- Grok Build：<https://x.ai/cli> 与 xAI CLI 安装、`config.toml` 说明。
- Gemini CLI：<https://github.com/google-gemini/gemini-cli>；原生端点同时对照本站 API 文档的 `/v1beta/models/{model}:generateContent`。
- VS Code / Cursor：OpenAI Codex 与 Anthropic Claude Code 的官方扩展页；两者分别复用 Codex 与 Claude Code 用户配置。
- OpenAI 兼容客户端与 IDE 插件：本站 `/v1/chat/completions` 契约及各客户端的 OpenAI Compatible 提供方设置。
- Pi：<https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent> 与其 `docs/models.md`。当前官方快速开始使用 `@earendil-works/pi-coding-agent`。
- Hermes Agent：<https://hermes-agent.nousresearch.com/docs/integrations/providers>
- OpenClaw：<https://docs.openclaw.ai/concepts/model-providers> 与 <https://docs.openclaw.ai/start/getting-started>
- Paseo：<https://paseo.sh/docs>、<https://paseo.sh/docs/providers>、<https://paseo.sh/docs/supported-providers> 与 <https://paseo.sh/docs/custom-providers>
- ZCode：<https://zcode.z.ai/cn/docs/configuration> 的「自定义供应商」与 <https://zcode.z.ai/cn/docs/install>
- DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness> 与其 `docs/user/guide/providers.md`、`docs/user/guide/index.md`
- Obsidian Claudian：<https://github.com/YishenTu/claudian>；环境变量入口另对照 `src/providers/claude/ui/ClaudeSettingsTab.ts`，安装入口为 <https://community.obsidian.md/plugins/realclaudian>

本地验证覆盖配置生成、路由、客户端切换、复制反馈、无效输入、深浅主题和移动端布局。未使用真实 API Key 安装运行这些客户端或发起计费模型调用。
