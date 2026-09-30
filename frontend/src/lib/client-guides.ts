export type ClientId = 'claude-code' | 'claude-desktop' | 'codex' | 'grok-build' | 'gemini-cli' | 'vscode-codex' | 'vscode-claude' | 'openai-compatible' | 'ide-plugins' | 'pi' | 'hermes' | 'openclaw' | 'paseo' | 'zcode' | 'deepseek-harness' | 'obsidian'
export type CCSwitchGuideId = 'codex' | 'claude-code' | 'claude-desktop' | 'grok-build' | 'pi'
export type GuidePlatform = 'unix' | 'windows'
export type ClientDirectoryGroup = 'primary' | 'extended'
export type ClientMarkKind = 'terminal' | 'gemini' | 'editor' | 'api' | 'plugin'

export interface GuideScreenshot {
  src: string
  alt: string
  caption: string
}

export interface ClientGuide {
  id: ClientId
  name: string
  icon?: string
  mark?: ClientMarkKind
  directoryGroup?: ClientDirectoryGroup
  aliases?: readonly string[]
  appliesTo?: readonly string[]
  category: string
  description: string
  protocol: string
  endpoint: string | null
  defaultModel: string
  officialUrl: string
  installUrl: string
  prerequisite: string
  prerequisiteClients?: ClientId[]
  installTitle?: string
  installSteps?: { text: string; href?: string; linkLabel?: string }[]
  installAlternatives?: { title: string; description: string; command: string }[]
  ccSwitchGuideId?: CCSwitchGuideId
  ccSwitch?: { description: string; steps: string[]; screenshot?: GuideScreenshot; screenshots?: GuideScreenshot[] }
  configPath: string
  configDescription: string
  configSteps?: string[]
  authFile?: { path: string; description: string; code: string }
  verification: string
  troubleshooting: string
  screenshots?: { configure: GuideScreenshot; verify: GuideScreenshot }
}

export interface CCSwitchGuide {
  id: CCSwitchGuideId
  clientId: ClientId
  description: string
  steps: string[]
  screenshots?: GuideScreenshot[]
  docsPath?: string
  verification: string
  troubleshooting: string
}

// 界面操作示意由客户端与当前网关参数生成；配置文件和命令使用可复制示例。
export const CLIENT_GUIDES: readonly ClientGuide[] = [
  {
    id: 'claude-code', name: 'Claude Code', icon: '/client-icons/claude-code.svg', category: '终端编程',
    aliases: ['Claude Code CLI', 'claude 命令'], appliesTo: ['Claude Code CLI'],
    description: '把 Claude 带进终端，从理解代码到完成修改。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'claude-opus-5',
    officialUrl: 'https://code.claude.com/docs/en/llm-gateway-connect',
    installUrl: 'https://code.claude.com/docs/en/setup',
    prerequisite: '支持 macOS、Linux 与 Windows。可选择官方安装器或 npm，任选一种方式即可；安装后重新打开终端。',
    installTitle: '通过官方安装器安装 Claude Code',
    ccSwitchGuideId: 'claude-code',
    installAlternatives: [
      {
        title: '通过 npm 安装 Claude Code',
        description: '也可以通过 npm 安装：先安装 Node.js 22 或更新版本（建议使用当前 LTS，包含 npm），再执行下方命令。macOS、Linux 与 Windows PowerShell 均可使用。',
        command: 'npm install -g @anthropic-ai/claude-code',
      },
    ],
    configPath: '终端环境变量',
    configDescription: '在当前终端设置网关根地址、API Key 和 Claude 模型。ANTHROPIC_BASE_URL 不加 /v1；请把 sk-YOUR_API_KEY 换成控制台创建的密钥。如需持久化，可将这些变量合并到 ~/.claude/settings.json 的 env 对象中。',
    verification: '在同一个终端启动 Claude Code，直接发送「当前时间」。收到正常回复后，在控制台核对本次用量。',
    troubleshooting: '如果仍使用原来的账号或提示凭据冲突，请检查环境变量与 ~/.claude/settings.json 中的配置，清理冲突的 ANTHROPIC_API_KEY 或旧网关变量。终端变量只对当前终端及其启动的程序生效；需要持久化时，按官方说明合并到 ~/.claude/settings.json 的 env 中。',
    screenshots: {
      configure: { src: '/client-docs/claude-code/configure.png', alt: 'Claude Code 的 settings.json：在 env 中配置网关地址、认证令牌与模型，密钥已遮盖', caption: 'settings.json 持久化环境变量配置' },
      verify: { src: '/client-docs/claude-code/verify.png', alt: 'Claude Code 使用 Opus 5，发送「当前时间」后收到回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', icon: '/client-icons/claude-desktop.svg', category: '桌面助手',
    aliases: ['Claude 桌面版'], appliesTo: ['Claude Desktop'],
    description: '在 Claude Desktop 中使用平台模型，无需安装 Claude Code，适合长文档与日常对话。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'claude-opus-5',
    officialUrl: 'https://claude.com/docs/third-party/claude-desktop/gateway',
    installUrl: 'https://claude.ai/download',
    prerequisite: 'Claude Desktop 是独立的桌面应用，无需安装 Claude Code、Node.js 或 npm。下载安装并打开后即可继续。',
    installSteps: [
      { text: '下载并安装 Claude Desktop，打开应用并完成首次启动；已经安装可直接继续。', href: 'https://claude.ai/download', linkLabel: '下载 Claude Desktop' },
      { text: '准备好平台 API 基础地址、API Key 和模型 ID；CC Switch 导入与手动配置写入的都是 Claude Desktop 的第三方推理配置。' },
    ],
    ccSwitchGuideId: 'claude-desktop',
    configPath: 'Configure Third-Party Inference · Gateway',
    configDescription: 'Claude Desktop 通过应用内的第三方推理配置窗口直连 Anthropic Messages 网关，配置只写入本机，不需要安装 Claude Code 或 CC Switch。按以下步骤打开配置窗口，并参照下方参数填写。',
    configSteps: [
      '在 macOS 菜单栏（Windows 为登录页左上角 ☰ 应用菜单）依次选择「Help → Troubleshooting → Enable Developer Mode」，启用开发者模式。',
      '选择「Developer → Configure Third-Party Inference…」，在 Connection 中将 Inference provider 设为 Gateway。',
      'Gateway base URL 填写网关根地址，不加 /v1；Gateway API key 填写平台 API Key；Credential kind 保持 Static API key，Gateway auth scheme 保持 Bearer。',
      '网关提供 /v1/models 时模型会自动读取；未显示本页模型时，在 Models 中手动添加模型 ID。确认后点击「Apply Changes」，应用会写入本机配置并重新启动。',
    ],
    verification: '点击「Apply Changes」后等待 Claude Desktop 重新启动，在模型菜单确认本页模型，新建对话并发送「当前时间」。收到正常回复后，在平台控制台核对请求用量。',
    troubleshooting: '找不到 Developer 菜单时，先在「Help → Troubleshooting」中启用开发者模式。返回 404 时，确认 Gateway base URL 为网关根地址、不包含 /v1 或 /v1/messages。模型菜单为空时，检查网关 /v1/models，或在 Models 中手动添加 claude-opus-*、claude-sonnet-* 等 Claude 模型 ID。配置窗口为只读时，说明设备已有 MDM 托管配置，需要由管理员修改。配置只在启动时读取，修改后请完全退出并重新打开 Claude Desktop。',
  },
  {
    id: 'codex', name: 'Codex', icon: '/client-icons/codex.svg', category: '桌面编程',
    aliases: ['Codex Desktop', 'ChatGPT Codex'], appliesTo: ['Codex Desktop'],
    description: '在 Codex Desktop 中使用平台模型，适合不熟悉命令行的用户。',
    protocol: 'OpenAI Responses', endpoint: '/v1/responses', defaultModel: 'gpt-6-astra',
    officialUrl: 'https://developers.openai.com/codex/config-advanced',
    installUrl: 'https://openai.com/codex/',
    prerequisite: 'Codex Desktop 是独立的桌面应用，无需安装 Codex CLI、Node.js 或 npm。下载安装并打开后即可继续。',
    installSteps: [
      { text: '从 OpenAI 官方页面下载并安装 Codex Desktop，打开应用完成首次启动；已经安装可直接继续。', href: 'https://openai.com/codex/', linkLabel: '获取 Codex Desktop' },
      { text: '准备好平台 API 基础地址、API Key 和模型 ID；CC Switch 与手动配置都使用同一组 Codex 配置文件。' },
    ],
    ccSwitchGuideId: 'codex',
    configPath: '~/.codex/config.toml',
    configDescription: '先把以下字段合并到 ~/.codex/config.toml，配置模型和网关。顶层字段放在 [model_providers.gateway] 表定义之前；保留已有的其他设置。Windows 原生路径为 %USERPROFILE%\\.codex\\config.toml。',
    authFile: {
      path: '~/.codex/auth.json',
      description: '再将 API Key 填入 ~/.codex/auth.json 的 OPENAI_API_KEY 字段，把 sk-YOUR_API_KEY 替换为平台控制台创建的密钥。已有登录配置时先备份 auth.json，再按下方示例配置。Windows 原生路径为 %USERPROFILE%\\.codex\\auth.json。',
      code: JSON.stringify({ OPENAI_API_KEY: 'sk-YOUR_API_KEY' }, null, 2),
    },
    verification: '保存 config.toml 和 auth.json 后，打开或重新打开 Codex Desktop，新建任务并发送「当前时间」。收到正常回复后，在控制台检查用量。',
    troubleshooting: 'Codex 需要 Responses 接口。若出现 404，请检查网关是否提供 /v1/responses，并确认 base_url 填写网关根地址、不包含 /v1。提示缺少 API Key 时，检查 ~/.codex/auth.json 中的 OPENAI_API_KEY，以及 config.toml 中的 cli_auth_credentials_store = "file" 和 requires_openai_auth = true。迁移旧配置时移除提供方中的 env_key；若设置了 CODEX_HOME，两个文件都应放在该目录下。',
  },
  {
    id: 'grok-build', name: 'Grok Build', mark: 'terminal', category: '终端编程',
    aliases: ['Grok CLI', 'xAI CLI', 'grok 命令'], appliesTo: ['Grok Build CLI'],
    description: '在终端中通过 OpenAI Chat Completions 网关运行 Grok 编程任务。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-grok-model-id',
    officialUrl: 'https://docs.x.ai/docs/grok-code-fast-1',
    installUrl: 'https://x.ai/cli',
    prerequisite: '支持 Windows、macOS 与 Linux。安装后先运行 grok --version；命令已可用时可直接配置。',
    installTitle: '安装 Grok Build',
    ccSwitchGuideId: 'grok-build',
    configPath: '~/.grok/config.toml',
    configDescription: '在 ~/.grok/config.toml（Windows 为 %USERPROFILE%\\.grok\\config.toml）登记默认模型与自定义提供方。Base URL 必须以 /v1 结尾，api_backend 保持 chat_completions；模型 ID 应与当前 API Key 可用列表完全一致。',
    configSteps: [
      '创建 Grok 可用分组的 API Key，并复制完整模型 ID。',
      '把下方示例合并进 config.toml；若文件已有同名模型，先备份并修改提供方名称。',
      '保存后退出正在运行的 Grok Build，再从项目目录重新运行 grok。',
    ],
    verification: '在项目目录运行 grok，先发送一条简短任务。客户端能启动且模型正常回复后，再开始长任务，并在平台控制台核对用量。',
    troubleshooting: '解析配置失败时检查 TOML 引号与表名。出现 404 时确认 Base URL 只有一个 /v1、api_backend 为 chat_completions，并核对模型 ID 与 API Key 所属分组。修改后需要重新启动 Grok Build。',
  },
  {
    id: 'gemini-cli', name: 'Gemini CLI', mark: 'gemini', category: '终端助手',
    aliases: ['Google Gemini CLI', 'gemini 命令'], appliesTo: ['Gemini CLI'],
    description: '使用 Gemini 原生 API 地址，在终端中调用平台开放的 Gemini 模型。',
    protocol: 'Gemini Generate Content', endpoint: '/v1beta/models/{model}:generateContent', defaultModel: 'your-gemini-model-id',
    officialUrl: 'https://github.com/google-gemini/gemini-cli',
    installUrl: 'https://github.com/google-gemini/gemini-cli#quickstart',
    prerequisite: '先安装 Gemini CLI；命令已可用时无需重复安装。原生 Gemini 接入使用站点根地址，客户端会自行追加 /v1beta 路径。',
    installTitle: '安装 Gemini CLI',
    configPath: '终端环境变量',
    configDescription: '在新终端中设置 GOOGLE_GEMINI_BASE_URL 与 GEMINI_API_KEY。基础地址只填写站点根地址，不追加 /v1 或 /v1beta；模型名称通过 gemini -m 传入，并与平台模型列表完全一致。',
    verification: '打开新终端，在项目目录运行下方命令。Gemini CLI 返回模型回复后，在平台控制台核对用量。',
    troubleshooting: '如果请求没有进入当前平台，先在 Gemini CLI 中退出已有 Google 账号登录，让客户端回退使用 GEMINI_API_KEY。404 通常表示模型 ID 不可用，或基础地址错误地附加了 /v1beta。',
  },
  {
    id: 'vscode-codex', name: 'IDE · Codex', mark: 'editor', category: '编辑器扩展',
    aliases: ['VS Code Codex', 'Cursor Codex', 'Codex extension'], appliesTo: ['VS Code', 'Cursor'],
    description: '在 VS Code 或 Cursor 中使用 OpenAI 官方 Codex 扩展。',
    protocol: 'OpenAI Responses', endpoint: '/v1/responses', defaultModel: 'gpt-6-astra',
    officialUrl: 'https://developers.openai.com/codex/ide',
    installUrl: 'https://marketplace.visualstudio.com/items?itemName=openai.chatgpt',
    prerequisite: '先在扩展市场安装由 OpenAI 发布的 Codex 扩展。扩展与 Codex Desktop、CLI 共用 ~/.codex 下的配置。',
    installSteps: [
      { text: '打开 VS Code 或 Cursor 的扩展市场，搜索 Codex，确认发布者为 OpenAI 后安装。', href: 'https://marketplace.visualstudio.com/items?itemName=openai.chatgpt', linkLabel: '打开扩展页面' },
      { text: '安装后打开 Codex 侧栏；配置文件尚未就绪时，继续完成下方两个文件。' },
    ],
    configPath: '~/.codex/config.toml',
    configDescription: 'Codex IDE 扩展读取与 Desktop、CLI 相同的 ~/.codex/config.toml 和 ~/.codex/auth.json。配置 Responses 提供方后，重载编辑器窗口即可，无需在 VS Code 设置里重复填写网关。',
    authFile: {
      path: '~/.codex/auth.json',
      description: '将平台 API Key 写入 OPENAI_API_KEY。Windows 原生路径为 %USERPROFILE%\\.codex\\auth.json；若设置了 CODEX_HOME，两份配置都放在该目录。',
      code: JSON.stringify({ OPENAI_API_KEY: 'sk-YOUR_API_KEY' }, null, 2),
    },
    verification: '重载 VS Code 或 Cursor 窗口，打开 Codex 侧栏并新建会话，发送「当前时间」。收到正常回复后，在平台控制台核对用量。',
    troubleshooting: '扩展没有读取新配置时，完全重载编辑器窗口，并确认它与 Codex CLI 使用同一用户和 CODEX_HOME。404 时检查 Responses 端点与模型权限，密钥错误时核对 auth.json。',
  },
  {
    id: 'vscode-claude', name: 'IDE · Claude', mark: 'editor', category: '编辑器扩展',
    aliases: ['VS Code Claude', 'Cursor Claude', 'Claude Code extension'], appliesTo: ['VS Code', 'Cursor'],
    description: '让 Claude Code 官方扩展复用 CLI 的网关与认证配置。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'claude-opus-5',
    officialUrl: 'https://docs.anthropic.com/en/docs/claude-code/ide-integrations',
    installUrl: 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code',
    prerequisite: '先在扩展市场安装 Anthropic 发布的 Claude Code 扩展。扩展与 Claude Code CLI 读取同一组环境变量或 ~/.claude/settings.json。',
    installSteps: [
      { text: '打开 VS Code 或 Cursor 的扩展市场，搜索 Claude Code，确认发布者为 Anthropic 后安装。', href: 'https://marketplace.visualstudio.com/items?itemName=anthropic.claude-code', linkLabel: '打开扩展页面' },
      { text: '完成下方配置后重载编辑器窗口，再从侧边栏打开 Claude Code 面板。' },
    ],
    configPath: 'Claude Code 共享环境变量',
    configDescription: '设置 ANTHROPIC_BASE_URL、ANTHROPIC_AUTH_TOKEN 与 ANTHROPIC_MODEL。基础地址填写站点根地址，不加 /v1；也可把相同变量保存到 ~/.claude/settings.json 的 env 对象中。',
    verification: '重载编辑器窗口或重启扩展，打开 Claude Code 侧栏并新建会话，发送「当前时间」。收到正常回复后，在平台控制台核对用量。',
    troubleshooting: '扩展仍使用旧账号时，检查系统环境变量与 ~/.claude/settings.json 是否冲突。GUI 编辑器不一定继承后来修改的终端变量，保存配置后应重载整个编辑器窗口。',
  },
  {
    id: 'openai-compatible', name: 'OpenAI 兼容客户端', mark: 'api', category: '通用客户端',
    aliases: ['Cherry Studio', 'NextChat', 'OpenCode', 'LangChain', '脚本', '机器人', 'OpenAI compatible'], appliesTo: ['OpenCode', 'LangChain', 'Cherry Studio', 'NextChat', '脚本与机器人'],
    description: '通用 OpenAI 兼容入口适用于能自定义 Base URL、API Key 和模型 ID 的客户端、SDK 与自动化脚本。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://platform.openai.com/docs/api-reference/chat',
    installUrl: 'https://platform.openai.com/docs/libraries',
    prerequisite: '适用于能够自定义 OpenAI Base URL、API Key 与模型 ID 的客户端或 SDK。界面名称可能不同，但三项值的含义一致。',
    installSteps: [
      { text: '安装你选择的客户端，并进入模型提供方或 API 设置。' },
      { text: '选择 OpenAI Compatible、自定义 OpenAI 或等价选项；不要选择只允许登录官方账号的提供方。' },
    ],
    configPath: 'OpenAI 兼容填写参考',
    configDescription: 'Base URL 填写以 /v1 结尾的地址，API Key 填写平台密钥，模型填写当前密钥可用的完整模型 ID。客户端会在 Base URL 后调用 /chat/completions。',
    verification: '保存提供方后新建对话，选择刚配置的模型并发送「当前时间」。收到回复后，在平台控制台核对请求用量。',
    troubleshooting: '若请求地址出现 /v1/v1，请从 Base URL 中去掉重复的一段。401/403 时检查 Authorization 是否使用 Bearer 密钥；404 时核对模型 ID、分组权限和客户端实际调用的协议。',
  },
  {
    id: 'ide-plugins', name: 'IDE 插件', mark: 'plugin', category: '编辑器插件',
    aliases: ['Cline', 'Roo Code', 'Continue', 'VS Code plugins'], appliesTo: ['Cline', 'Roo Code', '其他 IDE 插件'],
    description: '在 Cline、Roo Code 等插件中通过 OpenAI 兼容提供方使用平台模型。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://docs.cline.bot/provider-config/openai-compatible',
    installUrl: 'https://marketplace.visualstudio.com/search?term=AI%20coding&target=VSCode&category=All%20categories&sortBy=Relevance',
    prerequisite: '先安装目标 IDE 插件并打开其 API Provider 设置。即使使用 Gemini 等模型，也应选择 OpenAI Compatible，而不是直连厂商官方服务的内置提供方。',
    installSteps: [
      { text: '在 VS Code 或兼容编辑器中安装目标插件，例如 Cline 或 Roo Code。' },
      { text: '打开插件的模型设置，选择 OpenAI Compatible 或自定义 OpenAI 提供方。' },
    ],
    configPath: 'IDE 插件填写参考',
    configDescription: '将 Base URL 设为以 /v1 结尾的网关地址，填写平台 API Key 和完整模型 ID。插件内置的 Google Gemini 或 Anthropic 官方提供方通常直连厂商，不能替代自定义网关设置。',
    verification: '保存设置，在插件中新建任务并发送一条简短请求。收到回复后检查平台用量，再开始需要文件读写或工具调用的任务。',
    troubleshooting: '请求未进入当前平台时，先确认选择的是 OpenAI Compatible。出现 404 时核对 Base URL 是否重复 /v1、模型 ID 是否可用，以及插件是否实际调用 /v1/chat/completions。',
  },
  {
    id: 'pi', name: 'Pi', icon: '/client-icons/pi.svg', directoryGroup: 'extended', category: '可扩展编程',
    description: '轻量、可组合，保留你习惯的终端工作方式。',
    protocol: 'Anthropic Messages · Chat Completions · Responses', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md',
    installUrl: 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#quick-start',
    prerequisite: '先安装当前受支持的 Node.js LTS 与 npm。这里的 Pi 指 pi-mono 项目中的 coding agent，安装包以官方快速开始文档为准。',
    configPath: '~/.pi/agent/models.json',
    configDescription: '在 models.json 的 providers 中新增 gateway，保留其他提供方。Pi Agent 支持 Anthropic Messages（/v1/messages）、Chat Completions（/v1/chat/completions）和 Responses（/v1/responses），请选择与网关和模型匹配的 API 格式；下方可复制示例使用 Chat Completions。将 sk-YOUR_API_KEY 替换为你的密钥；Windows 路径为 %USERPROFILE%\\.pi\\agent\\models.json。',
    ccSwitchGuideId: 'pi',
    verification: '启动 Pi 后，输入 /model，选择刚配置的供应商与目标模型（手动配置示例中的供应商为 gateway）。发送「当前时间」，确认收到回复，并在控制台检查请求用量。修改 models.json 后，重新打开 /model 即可重新读取。',
    troubleshooting: '模型没有显示时，先检查 JSON 格式和 API Key，再打开 /model。若返回接口不支持，请检查 api 字段与网关协议：openai-completions 对应 /v1/chat/completions，Responses 与 Anthropic Messages 请选择对应适配器和端点。',
  },
  {
    id: 'hermes', name: 'Hermes', icon: '/client-icons/hermes.svg', directoryGroup: 'extended', category: '通用智能体',
    description: '从对话到任务执行，为你的智能体接好模型。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://hermes-agent.nousresearch.com/docs/integrations/providers',
    installUrl: 'https://github.com/NousResearch/hermes-agent#quick-install',
    prerequisite: '这里的 Hermes 指 Nous Research 的 Hermes Agent。官方安装器负责安装运行依赖；安装后重新打开终端。',
    configPath: 'hermes model 配置向导',
    configDescription: '在终端运行 hermes model，选择 Custom endpoint，依次填写下方的 API 地址、密钥和模型名称并保存。会话内的 /model 只用于切换已配置的模型。',
    ccSwitch: {
      description: 'CC Switch 可直接管理 Hermes 的供应商与模型，适合快速切换不同网关。',
      steps: [
        '先完成上方 Hermes 安装，再安装并打开最新版本 CC Switch，选择「Hermes」面板，点击右上角「+」添加自定义供应商。',
        '填写平台 API Key、下方以 /v1 结尾的 API 地址和本页模型 ID，API 模式选择 OpenAI Chat Completions。',
        '保存后点击供应商卡片的「启用」，重新打开 Hermes，在 /model 中确认刚配置的供应商与模型，再按下方步骤验证。',
      ],
      screenshot: { src: '', alt: 'CC Switch 的 Hermes 面板配置 Chat Completions 供应商与模型', caption: 'CC Switch 快捷配置 Hermes' },
    },
    verification: '完成配置后运行 hermes，在会话中用 /model 检查当前模型，然后发送「当前时间」。回复正常后，去控制台核对用量记录。',
    troubleshooting: '自定义端点应通过 hermes model 保存，或配置 config.yaml 的 model.base_url。不要依赖旧的 LLM_MODEL 环境变量。启动异常可运行 hermes doctor；工具本身的额外服务可能需要单独配置。',
    screenshots: {
      configure: { src: '', alt: 'Hermes 选择 Custom endpoint 并填写网关信息的向导', caption: 'Custom endpoint 配置向导' },
      verify: { src: '', alt: 'Hermes 当前模型与首次成功回复', caption: '确认模型与首次对话' },
    },
  },
  {
    id: 'openclaw', name: 'OpenClaw', icon: '/client-icons/openclaw.svg', directoryGroup: 'extended', category: '个人智能体',
    description: '为常驻助手配置模型，让对话延伸到日常任务。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://docs.openclaw.ai/concepts/model-providers',
    installUrl: 'https://docs.openclaw.ai/start/getting-started',
    prerequisite: '使用官方安装器安装，并按向导完成本地 Gateway 初始化。Node.js 版本要求以官方安装页为准。已有安装可直接进入配置步骤。',
    configPath: '~/.openclaw/openclaw.json',
    configDescription: '把示例合并到现有 openclaw.json，保留 channels、gateway 和其他设置。替换 API Key，并确保 primary 中的 gateway/模型 ID 与 providers 中的模型一致。Windows 路径位于 %USERPROFILE%\\.openclaw。',
    verification: '运行 openclaw models list，确认 gateway 下的模型。已安装 Gateway 服务时重启使配置生效，再打开 dashboard 发送「当前时间」，并在控制台检查用量。',
    troubleshooting: '如果提示模型不在允许列表中，检查 agents.defaults.models 是否包含 gateway/模型 ID。Gateway 启动失败时运行 openclaw doctor；若尚未安装服务，先按官方安装指引完成初始化。',
    screenshots: {
      configure: { src: '', alt: 'OpenClaw 自定义提供方与默认模型配置，密钥已遮盖', caption: '提供方与默认模型配置' },
      verify: { src: '', alt: 'OpenClaw dashboard 中的首次成功对话', caption: 'Dashboard 首次对话' },
    },
  },
  {
    id: 'paseo', name: 'Paseo', icon: '/client-icons/paseo.svg', directoryGroup: 'extended', category: '远程编程',
    description: '在桌面与手机之间，继续同一个编程任务。',
    protocol: '沿用所选客户端配置', endpoint: null, defaultModel: 'your-model-id',
    officialUrl: 'https://paseo.sh/docs/supported-providers',
    installUrl: 'https://paseo.sh/download',
    prerequisite: '先选择你要在 Paseo 中使用的客户端，按对应接入指南完成安装、网关与 API Key 配置，并发送「当前时间」确认可用，再回到本页继续。只需配置你要使用的客户端；本地或远程使用时，前置配置都应在运行 Paseo 后台服务的电脑上完成。以下提供本站已有的接入指南，更多支持的客户端可查看上方官方文档。',
    prerequisiteClients: ['claude-code', 'codex', 'pi', 'hermes'],
    installSteps: [
      { text: '前往 Paseo 官网，下载适用于当前操作系统的 Paseo Desktop 安装包。', href: 'https://paseo.sh/download', linkLabel: '下载 Paseo' },
      { text: '完成安装并打开 Paseo。桌面端自带本地后台服务，会随应用自动启动。' },
      { text: '在 Paseo 中选择本机；如果使用远程主机，先连接已完成前置配置的那台电脑。' },
    ],
    configPath: 'Paseo 提供方设置',
    configDescription: '完成对应客户端的接入配置后，回到 Paseo 连接运行主机，并选择该客户端作为提供方。网关地址、API Key 与模型配置沿用对应客户端的设置。',
    configSteps: [
      '打开「Settings → 当前主机 → Providers」，选择已配置的 Claude Code、Codex 或 Pi，刷新并确认可用；使用 Hermes 时，在提供方目录中启用 Hermes 条目。',
      '选择工作区，新建任务，选择对应客户端和已配置的模型。',
      '使用环境变量配置的客户端，请按对应接入指南持久化设置，并确认运行主机上的 Paseo 能读取这些变量。',
    ],
    verification: '打开 Paseo，连接已配置的运行主机，选择工作区并新建任务。选择已配置的客户端与对应模型，直接发送「当前时间」。收到回复后，在平台控制台核对请求用量。',
    troubleshooting: '找不到客户端时，先在运行主机确认对应 CLI 已安装且可独立使用，再到 Paseo 的「Settings → 当前主机 → Providers」刷新或查看 Diagnostic。首次安装 CLI 后可能需要重新打开 Paseo。远程连接时，客户端配置和凭据应位于远程运行主机；鉴权或模型错误请回到对应客户端接入指南检查。',
    screenshots: {
      configure: { src: '/client-docs/paseo/configure.png', alt: 'Paseo 当前主机的 Providers 设置，Claude、Codex 与 Pi 显示可用，右侧开关已启用', caption: '选择已配置的客户端提供方' },
      verify: { src: '/client-docs/paseo/verify.png', alt: 'Paseo 工作区中选择 Codex 提供方的模型并发送「当前时间」后收到正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'zcode', name: 'ZCode', icon: '/client-icons/zcode.png', directoryGroup: 'extended', category: '桌面编程',
    description: '在桌面工作区中，接入团队自己的模型通道。',
    protocol: 'Anthropic Messages · Chat Completions · Responses', endpoint: '/v1/messages', defaultModel: 'your-model-id',
    officialUrl: 'https://zcode.z.ai/cn/docs/configuration',
    installUrl: 'https://zcode.z.ai/cn/docs/install',
    prerequisite: '从 ZCode 官网下载适用于 macOS、Windows 或 Linux 的桌面安装包。以下使用自定义供应商接入平台网关。',
    installSteps: [
      { text: '下载并安装适合当前系统的 ZCode。', href: 'https://zcode.z.ai/cn', linkLabel: '下载 ZCode' },
      { text: '打开应用。首次欢迎页可选择「使用 API Key」；已进入工作区时，从模型选择器底部进入「管理模型」。' },
    ],
    configPath: 'ZCode 自定义供应商填写参考',
    configDescription: '进入「设置 → 模型设置」，添加自定义供应商。ZCode 支持 Anthropic Messages（/v1/messages）、Chat Completions（/v1/chat/completions）和 Responses（/v1/responses），请选择与网关和模型匹配的 API 格式；下方截图示例使用 Anthropic Messages。截图中的地址与模型仅作示例，请替换为你的网关地址和平台实际开放的模型 ID。',
    configSteps: [
      '在供应商列表底部点击「添加供应商」，为通道命名，例如 FluxCode Claude。',
      'Base URL 填写网关根地址，不加 /v1；API 格式按实际接入方式选择「Anthropic Messages (/v1/messages)」「Chat Completions (/chat/completions)」或「Responses (/responses)」，API Key 填写平台控制台创建的密钥。',
      '点击「添加模型」，填写完整的 Claude 模型 ID，保存并确认供应商显示「已启用」。',
    ],
    verification: '回到工作区，新建任务，在模型选择器中选择刚添加的供应商及其模型（截图中为 FluxCode Claude/claude-opus-5），直接发送「当前时间」。收到正常回复后，在平台控制台核对请求用量。',
    troubleshooting: '模型未出现时，检查供应商是否启用、模型是否已添加并保存。出现 404 时，确认 Base URL 为网关根地址，并让 API 格式与实际端点匹配：Anthropic Messages 使用 /v1/messages，Chat Completions 使用 /chat/completions，Responses 使用 /responses。若模型返回推理参数错误，先按模型实际能力调整思考强度。',
    screenshots: {
      configure: { src: '/client-docs/zcode/configure.png', alt: 'ZCode 模型设置中配置 FluxCode Claude 供应商，Base URL 使用网关根地址，API 格式为 Anthropic Messages，密钥已遮盖', caption: '添加供应商与模型' },
      verify: { src: '/client-docs/zcode/verify.png', alt: 'ZCode 选择 FluxCode Claude/claude-opus-5 并发送「当前时间」后的正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'deepseek-harness', name: 'DeepSeek Harness', icon: '/client-icons/deepseek-harness.svg', directoryGroup: 'extended', category: '插件化智能体',
    description: '用可组合的智能体，在本地工作区开展任务。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/providers.md',
    installUrl: 'https://github.com/deepseek-ai/deepseek-harness#run',
    prerequisite: '先安装 Node.js 与 npm，在项目目录中执行下方命令。DeepSeek Harness（dsh）会启动本地 Web UI，默认地址为 http://127.0.0.1:3080。该项目目前处于开发者预览阶段，界面以当前版本为准。',
    installTitle: '启动 DeepSeek Harness Web UI',
    configPath: 'DeepSeek Harness · DeepSeek 提供方填写参考',
    configDescription: '打开 Web UI 的「设置 → 模型」，在 DeepSeek（deepseek-official）提供方中填写平台 API 密钥，再展开「自定义设置」修改 API 地址。下方截图使用这一方式接入；截图中的域名与模型仅作示例，请使用你的网关地址和平台实际开放的 DeepSeek 模型 ID。',
    configSteps: [
      '找到 DeepSeek 提供方；如果尚未添加，先点击「添加提供方」并选择 DeepSeek。将平台控制台创建的 API Key 填入「API 密钥」。',
      '展开「自定义设置」，在「API 地址」中填写下方以 /v1 结尾的网关地址。',
      '在「模型目录」中核对模型 ID；如果目标模型未列出，点击「添加模型」填写模型 ID 与显示名称，最后点击「保存」。',
    ],
    verification: '在 Web UI 的工作区中添加并选择项目目录，点击「新会话」，在模型选择器中选择已配置的 DeepSeek 模型，直接发送「当前时间」。收到正常回复后，在平台控制台检查请求用量。',
    troubleshooting: '默认模型目录不代表平台已开放全部模型，请核对实际模型 ID，并按需手动添加。提示 MISSING_CREDENTIAL 时在「设置 → 模型」中重新保存密钥；出现 404 时检查自定义 API 地址和模型 ID。输入框不可用时先选择工作区与模型；切换提供方后请新建会话。',
    screenshots: {
      configure: { src: '/client-docs/deepseek-harness/configure.png', alt: 'DeepSeek Harness 的 DeepSeek 提供方设置：API 密钥已遮盖，自定义 API 地址以 /v1 结尾，下方展示模型目录与保存按钮', caption: 'DeepSeek 提供方与自定义 API 地址' },
      verify: { src: '/client-docs/deepseek-harness/verify.png', alt: 'DeepSeek Harness 在工作区中选择 DeepSeek 模型并发送「当前时间」后的正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'obsidian', name: 'Obsidian', icon: '/client-icons/obsidian.svg', directoryGroup: 'extended', category: 'Claudian 笔记助手',
    description: '通过 Claudian，让模型协助整理与使用笔记。',
    protocol: 'Anthropic Messages · Claudian', endpoint: '/v1/messages', defaultModel: 'claude-sonnet-4-6',
    officialUrl: 'https://github.com/YishenTu/claudian#readme',
    installUrl: 'https://community.obsidian.md/plugins/realclaudian',
    prerequisite: '本指南通过 Claudian 的 Claude 提供方接入。请先按 Claude Code 接入指南完成配置并确认可用。Claudian 还支持 Codex 等智能体；以下步骤以 Claude Code 为例。',
    prerequisiteClients: ['claude-code'],
    installSteps: [
      { text: '下载并安装 Obsidian 桌面版，打开或创建笔记库。当前 Claudian 要求 Obsidian 1.13.0 或更新版本，支持 macOS、Linux 与 Windows。', href: 'https://obsidian.md/download', linkLabel: '下载 Obsidian' },
      { text: '打开「设置 → 第三方插件」，如处于受限模式，先启用第三方插件，再点击「浏览」。' },
      { text: '搜索 Claudian，确认作者为 Yishen Tu，点击「安装」，完成后点击「启用」。', href: 'https://community.obsidian.md/plugins/realclaudian', linkLabel: 'Claudian 插件页' },
      { text: '从侧边栏图标或命令面板打开 Claudian 聊天面板，然后进入插件设置配置连接。' },
    ],
    configPath: 'Claudian · Claude 环境变量',
    configDescription: '进入「设置 → Claudian」，选择 Claude 提供方，在 Environment → Custom variables 中粘贴下方内容并替换密钥。这里是插件的环境变量文本框，无需在终端执行；ANTHROPIC_BASE_URL 填写网关根地址。',
    configSteps: [
      '启用 Claude 提供方，将网关变量填入 Claude 自己的环境变量区域。',
      '填好后点击文本框外部保存；在模型设置中选择目标模型，未列出的模型可在 Custom models 中添加。',
    ],
    verification: '打开 Obsidian 的 Claudian 聊天侧栏，新建对话并选择已配置的 Claude 模型，直接发送「当前时间」。收到正常回复后，在平台控制台核对请求用量。',
    troubleshooting: '提示 Claude CLI not found 时，先确认 CLI 已安装；自动识别失败时，在 Claudian 的 Claude CLI path 中填写可执行文件路径。GUI 应用不一定继承终端变量，请使用插件中的 Claude 环境变量配置。Windows 优先使用原生 claude.exe，避免填写 .cmd 或 .ps1 包装脚本。',
    screenshots: {
      configure: { src: '', alt: 'Obsidian Claudian 的 Claude 环境变量与模型设置，密钥已遮盖', caption: 'Claudian 环境变量与模型' },
      verify: { src: '', alt: 'Obsidian Claudian 侧栏发送「当前时间」后的正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
]

export const CC_SWITCH_GUIDES: readonly CCSwitchGuide[] = [
  {
    id: 'codex',
    clientId: 'codex',
    description: '从平台 API Key 管理页将 Codex 配置导入 CC Switch，再启用并重启客户端；导入内容使用 OpenAI Responses 网关。',
    steps: [
      '先在平台控制台的 API Key 管理页创建一个 API Key。创建完成后回到该密钥所在行；不要把真实密钥粘贴到本指南。',
      '在刚创建的 API Key 所在行点击「导入到 CCS」，将该密钥对应的 Codex 配置导入 CC Switch。',
      '在确认弹窗核对操作后点击「确认导入」，等待导入完成并在 CC Switch 的 Codex 配置列表中找到新配置。',
      '在 CC Switch 的 Codex 配置列表中找到刚导入的配置，点击「启用」，并确认该配置显示为当前启用项。',
      '完全退出并重新打开 Codex Desktop，使配置生效。若使用 VS Code 或 Cursor 中的 Codex 扩展，请重载编辑器窗口。',
    ],
    verification: '完成导入、启用并重启 Codex Desktop 后，新建任务并发送「当前时间」。收到正常回复后，在平台控制台检查对应 API Key 的用量记录。',
    troubleshooting: 'CC Switch 中没有出现新配置时，重新检查 API Key 所在行的「导入到 CCS」操作及确认弹窗，并确认 CC Switch 已打开。重启后仍使用旧配置时，回到 CC Switch 的 Codex 面板确认刚导入的配置已启用，再完全退出并重新打开 Codex Desktop。',
  },
  {
    id: 'claude-code',
    clientId: 'claude-code',
    description: '从平台 API Key 管理页一键导入 Claude Code 配置，启用后打开客户端验证；无需手动填写密钥或网关地址。',
    steps: [
      '先在平台控制台的 API Key 管理页创建 API Key。创建后回到该密钥所在行；不要把真实密钥输入本指南。',
      '在刚创建的 API Key 所在行点击「导入到 CCS」，将 Claude Code 供应商配置导入 CC Switch。',
      '核对确认弹窗中的客户端、供应商名称和网关地址后，点击「确认导入」。',
      '在 CC Switch 的 Claude Code 面板找到刚导入的配置，点击「启用」，确认它已成为当前配置。',
      '重新打开终端并启动 Claude Code，发送「当前时间」；收到回复后检查平台控制台中的该 API Key 用量。',
    ],
    verification: '在新终端运行 claude，发送「当前时间」。收到正常回复后，在平台控制台核对刚创建的 API Key 用量。',
    troubleshooting: 'CC Switch 中没有新配置时，重新检查该 API Key 所在行的「导入到 CCS」与确认弹窗。若客户端仍使用旧账号或旧网关，确认导入的 Claude Code 配置已启用，重新打开终端并检查旧的 ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN 和 ANTHROPIC_BASE_URL 环境变量是否覆盖了新配置。',
  },
  {
    id: 'claude-desktop',
    clientId: 'claude-desktop',
    docsPath: '2.6-claude-desktop.md',
    description: '从平台 API Key 管理页将 Claude 供应商导入 CC Switch，再导入 Claude Desktop 面板启用；默认以 claude-opus-5 和 Anthropic Messages 直连接入。',
    steps: [
      '先在平台控制台的 API Key 管理页创建一个 API Key，分组选择 Anthropic / Claude 可用分组。创建完成后回到该密钥所在行；不要把真实密钥粘贴到本指南。',
      '在刚创建的 API Key 所在行点击「导入到 CCS」，将该密钥对应的 Claude 供应商配置导入 CC Switch。',
      '在确认弹窗核对客户端、供应商名称和网关地址后点击「确认导入」；配置会先保存到 CC Switch 的 Claude（Claude Code）面板。',
      '切换到 CC Switch 的「Claude Desktop」面板，点击「将 Claude Code 中已有的供应商导入」，在列表中找到刚导入的配置并点击「启用」。使用 claude-opus-5 等 Claude 模型时保持「需要模型映射」关闭；面板中没有导入入口时，点击右上角「+」添加自定义供应商，填写同一网关根地址与 API Key。',
      '完全退出并重新打开 Claude Desktop，使配置生效；在模型菜单确认本页模型后，按下方步骤发送验证消息。',
    ],
    verification: '启用配置后，完全退出并重新打开 Claude Desktop；确认当前模型后新建对话并发送「当前时间」。收到正常回复后，在平台控制台检查对应 API Key 的用量记录。',
    troubleshooting: 'CC Switch 中没有出现新配置时，重新检查 API Key 所在行的「导入到 CCS」操作及确认弹窗，并在 CC Switch 的 Claude 面板确认配置已导入。找不到 Claude Desktop 面板时，升级 CC Switch 并检查「设置 → 通用 → 应用可见性」；目前 CC Switch 的 Claude Desktop 配置写入支持 macOS 与 Windows。模型列表为空时，检查网关 /v1/models，或在直连设置的「手动指定 Claude Desktop 模型列表」中添加本页模型。使用非 Claude 模型时需开启「需要模型映射」，并保持 CC Switch 与 Claude Desktop 本地路由运行。每次切换供应商后都要完全退出并重启 Claude Desktop。',
  },
  {
    id: 'pi',
    clientId: 'pi',
    description: '在 CC Switch 的 Pi 面板添加自定义供应商和模型，再启用写入 Pi 配置。Pi 暂不支持从平台 API Key「导入到 CCS」，需要按本页地址和模型手动填写一次。',
    steps: [
      '先完成上方 Pi 安装，再安装并打开最新版本 CC Switch，在顶部应用切换栏选择「Pi」，点击右上角橙色「+」添加供应商。',
      '选择自定义配置，填写供应商名称和唯一的供应商标识（例如 gateway）；接口格式选择 OpenAI Chat Completions，再填写平台 API Key 与下方以 /v1 结尾的 Base URL。Pi 也支持 Anthropic Messages 与 Responses，选择其他格式时请使用对应端点。',
      '在「模型配置」中点击「添加模型」，填写本页选择的模型 ID 与显示名称；也可以点击「获取模型列表」读取网关模型后选择。确认无误后点击「保存」。',
      '回到 Pi 面板，在刚添加的供应商卡片上点击绿色「启用」，将它写入 Pi 配置。Pi 可以同时启用多个供应商，已启用的卡片会显示「移除」。',
      '重新打开 Pi，输入 /model 选择刚添加的供应商与模型，然后按下方步骤发送验证消息。',
    ],
    verification: '重新打开 Pi，输入 /model 选择刚启用的供应商与模型，发送「当前时间」。收到正常回复后，在平台控制台检查请求用量。',
    troubleshooting: '/model 中没有新供应商时，回到 CC Switch 的 Pi 面板确认卡片已「启用」并显示「移除」，再重新打开 Pi。提示供应商标识已存在时换一个标识。返回接口不支持或 404 时，检查接口格式与 Base URL：OpenAI Chat Completions 使用以 /v1 结尾的地址；改用 Anthropic Messages 或 Responses 时同步调整端点。模型未出现时，在模型配置中确认模型 ID 与平台完全一致。',
  },
  {
    id: 'grok-build',
    clientId: 'grok-build',
    description: '通过 CC Switch 导入 Grok Build 的 Chat Completions 提供方并激活配置。',
    steps: [
      '安装并打开 CC Switch，在应用切换器中选择「Grok Build」，点击「+」添加自定义供应商。',
      '填写平台 API Key、以 /v1 结尾的 Base URL 和当前 API Key 可用的 Grok 模型；API 模式选择 OpenAI Chat Completions。',
      '保存并启用供应商，确认它在 Grok Build 面板中标记为当前配置。',
      '退出正在运行的 grok 进程，从项目目录重新运行 grok，使配置重新加载。',
    ],
    verification: '在项目目录运行 grok，发送一条简短任务。客户端返回模型回复后，在平台控制台核对请求用量。',
    troubleshooting: '确认 API Key 分组支持所填模型、模型 ID 完全一致、Base URL 只有一个 /v1，并在修改配置后重新启动 Grok Build。',
  },
]

export function getClientGuide(id: string | null): ClientGuide {
  return CLIENT_GUIDES.find(guide => guide.id === id) ?? CLIENT_GUIDES[0]
}

export function getCCSwitchGuide(id: string | null): CCSwitchGuide {
  return CC_SWITCH_GUIDES.find(guide => guide.id === id) ?? CC_SWITCH_GUIDES[0]
}

export function findCCSwitchGuide(id: ClientId): CCSwitchGuide | undefined {
  return CC_SWITCH_GUIDES.find(guide => guide.clientId === (id === 'vscode-codex' ? 'codex' : id))
}

export const CC_SWITCH_DOWNLOAD_URL = 'https://ccswitch.io/'
export const CC_SWITCH_DOCS_URL = 'https://github.com/farion1231/cc-switch/blob/v3.20.3/docs/user-manual/zh/2-providers/'

export function getCCSwitchExample(id: ClientId, baseURL: string, model: string): { language: string; code: string } | null {
  const guide = getClientGuide(id)
  const hasDedicatedGuide = !!findCCSwitchGuide(id)
  if (!guide.ccSwitch && !hasDedicatedGuide) return null
  const app = id === 'claude-code' ? 'Claude（Claude Code）' : id === 'vscode-codex' ? 'Codex' : id === 'codex' ? 'Codex Desktop' : guide.name
  const apiURL = id === 'codex' || id === 'vscode-codex' || guide.endpoint === '/v1/messages' ? baseURL : `${baseURL}/v1`
  const providerKey = id === 'pi' ? '\n供应商标识    gateway（若已存在请换一个）' : ''
  const apiFormat = id === 'pi' ? 'OpenAI Chat Completions (openai-completions)' : guide.protocol
  return {
    language: '界面填写参考',
    code: `应用          ${app}\n供应商名称    Gateway${providerKey}\n接口地址      ${apiURL}\nAPI Key       sk-YOUR_API_KEY\nAPI 格式      ${apiFormat}\n模型 ID       ${model}`,
  }
}

export function normalizeGatewayURL(input: string): string | null {
  const value = input.trim()
  if (!value || /[\s\\]/.test(value)) return null
  try {
    const url = new URL(value)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
    const path = url.pathname.replace(/\/+$/, '').replace(/\/v1$/i, '')
    if (/\/(?:responses|messages|chat\/completions|models)$/i.test(path)) return null
    return `${url.origin}${path}`
  } catch {
    return null
  }
}

export function quoteShell(value: string, platform: GuidePlatform): string {
  return platform === 'windows' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, "'\\''")}'`
}

export function getInstallCommand(id: ClientId, platform: GuidePlatform): string | null {
  switch (id) {
    case 'claude-code': return platform === 'windows' ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash'
    case 'claude-desktop': return null
    case 'codex': return null
    case 'grok-build': return platform === 'windows' ? 'irm https://x.ai/cli/install.ps1 | iex' : 'curl -fsSL https://x.ai/cli/install.sh | bash'
    case 'gemini-cli': return 'npm install -g @google/gemini-cli'
    case 'pi': return 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'
    case 'hermes': return platform === 'windows' ? 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)' : 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
    case 'openclaw': return platform === 'windows' ? 'iwr -useb https://openclaw.ai/install.ps1 | iex' : 'curl -fsSL https://openclaw.ai/install.sh | bash'
    case 'paseo':
    case 'obsidian':
    case 'zcode':
    case 'vscode-codex':
    case 'vscode-claude':
    case 'openai-compatible':
    case 'ide-plugins': return null
    case 'deepseek-harness': return 'npx @deepseek-ai/dsh web'
  }
}

export function getConfigExample(id: Exclude<ClientId, 'paseo'>, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string }
export function getConfigExample(id: ClientId, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string } | null
export function getConfigExample(id: ClientId, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string } | null {
  const apiKey = 'sk-YOUR_API_KEY'
  const apiURL = id === 'codex' || id === 'vscode-codex' ? baseURL : `${baseURL}/v1`
  const json = (data: unknown) => ({ language: 'JSON', code: JSON.stringify(data, null, 2) })
  switch (id) {
    case 'claude-code': {
      const values = { ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_MODEL: model }
      return {
        language: platform === 'windows' ? 'PowerShell' : 'Bash / Zsh',
        code: Object.entries(values).map(([key, value]) => platform === 'windows'
          ? `$env:${key} = ${quoteShell(value, platform)}`
          : `export ${key}=${quoteShell(value, platform)}`).join('\n'),
      }
    }
    case 'vscode-claude': {
      const values = { ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: apiKey, ANTHROPIC_MODEL: model }
      return {
        language: platform === 'windows' ? 'PowerShell' : 'Bash / Zsh',
        code: Object.entries(values).map(([key, value]) => platform === 'windows'
          ? `$env:${key} = ${quoteShell(value, platform)}`
          : `export ${key}=${quoteShell(value, platform)}`).join('\n'),
      }
    }
    case 'claude-desktop': return {
      language: '界面填写参考',
      code: `Inference provider     Gateway\nGateway base URL       ${baseURL}\nGateway API key        ${apiKey}\nCredential kind        Static API key\nGateway auth scheme    Bearer\nModels                 ${model}`,
    }
    case 'paseo': return null
    case 'codex':
    case 'vscode-codex': return {
      language: 'TOML',
      code: `model = ${JSON.stringify(model)}\nmodel_provider = "gateway"\ncli_auth_credentials_store = "file"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = ${JSON.stringify(apiURL)}\nwire_api = "responses"\nrequires_openai_auth = true`,
    }
    case 'grok-build': return {
      language: 'TOML',
      code: `[models]\ndefault = ${JSON.stringify(model)}\n\n[model.${JSON.stringify(model)}]\nmodel = ${JSON.stringify(model)}\nbase_url = ${JSON.stringify(apiURL)}\nname = "Gateway"\napi_key = ${JSON.stringify(apiKey)}\napi_backend = "chat_completions"`,
    }
    case 'gemini-cli': {
      const values = { GOOGLE_GEMINI_BASE_URL: baseURL, GEMINI_API_KEY: apiKey }
      return {
        language: platform === 'windows' ? 'PowerShell' : 'Bash / Zsh',
        code: Object.entries(values).map(([key, value]) => platform === 'windows'
          ? `$env:${key} = ${quoteShell(value, platform)}`
          : `export ${key}=${quoteShell(value, platform)}`).join('\n'),
      }
    }
    case 'openai-compatible': return { language: '界面填写参考', code: `API Provider    OpenAI Compatible\nBase URL       ${apiURL}\nAPI Key        ${apiKey}\nModel ID       ${model}` }
    case 'ide-plugins': return { language: '界面填写参考', code: `API Provider    OpenAI Compatible\nBase URL       ${apiURL}\nAPI Key        ${apiKey}\nModel ID       ${model}\n提示            不要选择仅直连厂商的内置提供方` }
    case 'pi': return json({ providers: { gateway: { baseUrl: apiURL, api: 'openai-completions', apiKey, models: [{ id: model, name: model }] } } })
    case 'hermes': return { language: '向导填写参考', code: `Provider    Custom endpoint\nAPI base    ${apiURL}\nAPI key     ${apiKey}\nModel       ${model}` }
    case 'zcode': return { language: '界面填写参考', code: `供应商名称    FluxCode Claude\nBase URL      ${baseURL}\nAPI 格式      Anthropic Messages (/v1/messages)\nAPI Key       ${apiKey}\n模型 ID       ${model}` }
    case 'deepseek-harness': return { language: '界面填写参考', code: `提供方       DeepSeek (deepseek-official)\nAPI 密钥     ${apiKey}\nAPI 地址     ${apiURL}\n模型 ID      ${model}\n显示名称     ${model}` }
    case 'obsidian': return { language: '插件环境变量', code: `ANTHROPIC_BASE_URL="${baseURL}"\nANTHROPIC_AUTH_TOKEN="${apiKey}"\nANTHROPIC_MODEL="${model}"` }
    case 'openclaw': return json({
      models: { mode: 'merge', providers: { gateway: { baseUrl: apiURL, apiKey, api: 'openai-completions', models: [{ id: model, name: model }] } } },
      agents: { defaults: { model: { primary: `gateway/${model}` }, models: { [`gateway/${model}`]: {} } } },
    })
  }
}

export function getVerifyCommand(id: ClientId, model: string, platform: GuidePlatform): string | null {
  switch (id) {
    case 'claude-code': return 'claude'
    case 'claude-desktop': return null
    case 'codex': return null
    case 'grok-build': return 'grok'
    case 'gemini-cli': return `gemini -m ${quoteShell(model, platform)}`
    case 'pi': return 'pi'
    case 'hermes': return 'hermes'
    case 'openclaw': return 'openclaw models list\nopenclaw gateway restart\nopenclaw dashboard'
    case 'paseo':
    case 'vscode-codex':
    case 'vscode-claude':
    case 'openai-compatible':
    case 'ide-plugins':
    case 'zcode':
    case 'deepseek-harness':
    case 'obsidian': return null
  }
}
