export type ClientId = 'claude-code' | 'claude-desktop' | 'codex' | 'pi' | 'hermes' | 'openclaw' | 'paseo' | 'zcode' | 'deepseek-harness' | 'obsidian'
export type GuidePlatform = 'unix' | 'windows'

export interface GuideScreenshot {
  src: string
  alt: string
  caption: string
}

export interface ClientGuide {
  id: ClientId
  name: string
  icon: string
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
  ccSwitch?: { description: string; steps: string[] }
  configPath: string
  configDescription: string
  configSteps?: string[]
  authFile?: { path: string; description: string; code: string }
  verification: string
  troubleshooting: string
  screenshots: { configure: GuideScreenshot; verify: GuideScreenshot }
}

// 补图：随文档发布的截图放在 public/client-docs/；后台上传的截图填写完整 HTTP(S) URL。
// 留空时显示截图占位；新客户端的文案与图片统一在此登记。
export const CLIENT_GUIDES: readonly ClientGuide[] = [
  {
    id: 'claude-code', name: 'Claude Code', icon: '/client-icons/claude-code.svg', category: '终端编程',
    description: '把 Claude 带进终端，从理解代码到完成修改。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'claude-opus-5',
    officialUrl: 'https://code.claude.com/docs/en/llm-gateway-connect',
    installUrl: 'https://code.claude.com/docs/en/setup',
    prerequisite: '支持 macOS、Linux 与 Windows。可选择官方安装器或 npm，任选一种方式即可；安装后重新打开终端。',
    installTitle: '通过官方安装器安装 Claude Code',
    installAlternatives: [
      {
        title: '通过 npm 安装 Claude Code',
        description: '也可以通过 npm 安装：先安装 Node.js 22 或更新版本（建议使用当前 LTS，包含 npm），再执行下方命令。macOS、Linux 与 Windows PowerShell 均可使用。',
        command: 'npm install -g @anthropic-ai/claude-code',
      },
    ],
    configPath: '终端环境变量',
    configDescription: '在当前终端设置网关根地址、API Key 和 Claude 模型。ANTHROPIC_BASE_URL 不加 /v1；请把 sk-YOUR_API_KEY 换成控制台创建的密钥。如需持久化，可将这些变量合并到 ~/.claude/settings.json 的 env 对象中，下方截图展示这种方式。',
    verification: '在同一个终端启动 Claude Code，直接发送「当前时间」。收到正常回复后，在控制台核对本次用量。',
    troubleshooting: '如果仍使用原来的账号或提示凭据冲突，请检查环境变量与 ~/.claude/settings.json 中的配置，清理冲突的 ANTHROPIC_API_KEY 或旧网关变量。终端变量只对当前终端及其启动的程序生效；需要持久化时，按官方说明合并到 ~/.claude/settings.json 的 env 中。',
    screenshots: {
      configure: { src: '/client-docs/claude-code/configure.png', alt: 'Claude Code 的 settings.json：在 env 中配置网关地址、认证令牌与模型，密钥已遮盖', caption: 'settings.json 持久化环境变量配置' },
      verify: { src: '/client-docs/claude-code/verify.png', alt: 'Claude Code 使用 Opus 5，发送「当前时间」后收到回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'claude-desktop', name: 'Claude Desktop', icon: '/client-icons/claude-desktop.svg', category: '桌面助手',
    description: '在桌面应用中使用 Claude，适合长文档与日常对话。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'claude-opus-5',
    officialUrl: 'https://support.anthropic.com/en/articles/10065433-installing-claude-for-desktop',
    installUrl: 'https://claude.ai/download',
    prerequisite: '支持 macOS 与 Windows。Claude Desktop 与 Claude Code 是两个独立客户端，配置和生效方式也不同。',
    installSteps: [
      { text: '下载并安装 Claude Desktop，打开应用并完成首次启动。', href: 'https://claude.ai/download', linkLabel: '下载 Claude Desktop' },
      { text: '准备好平台 API 基础地址、API Key 和模型 ID；使用 CC Switch 时，这些信息会在供应商表单中填写。' },
    ],
    configPath: 'Claude Desktop 供应商参数参考',
    configDescription: '推荐使用下方的 CC Switch 快捷配置，由 CC Switch 写入 Claude Desktop 的 3P profile。手动配置时请按平台提供的 Claude Desktop 接入方式填写网关、密钥和模型；Claude Desktop 切换供应商后需要完全退出并重新打开。',
    configSteps: [
      'Claude Desktop 的原生直连通常需要 Anthropic Messages API，并使用 Claude Desktop 能识别的 Sonnet、Opus 或 Haiku 角色模型。',
      '如果平台模型 ID 不是 Claude Desktop 可识别的角色名，使用 CC Switch 的模型映射模式，将角色模型映射到平台实际模型。',
    ],
    verification: '完全退出并重新打开 Claude Desktop，确认当前供应商和模型后发送「当前时间」。收到正常回复后，在平台控制台核对请求用量。',
    troubleshooting: '如果 Claude Desktop 仍使用原账号或提示认证失败，请在 CC Switch 中确认供应商已启用、API 地址和密钥无误，并检查模型映射是否指向可用模型。修改供应商后需要完全退出并重新打开 Claude Desktop。',
    ccSwitch: {
      description: 'CC Switch 可直接管理 Claude Desktop 的供应商、模型映射和切换，不需要手动编辑 3P profile 文件。',
      steps: [
        '安装并打开 CC Switch，在应用切换器中选择「Claude Desktop」。',
        '点击「添加供应商」；已有 Claude Code 配置时，可选择从 Claude Code 导入，减少重复填写。',
        '填写 API 基础地址、API Key 和模型；非 Claude 角色模型开启「需要模型映射」，保存后点击「启用」。',
        '完全退出并重新打开 Claude Desktop，再发送「当前时间」验证。模型映射模式需要保持 CC Switch 的本地路由运行。',
      ],
    },
    screenshots: {
      configure: { src: '', alt: 'Claude Desktop 在 CC Switch 中配置供应商与模型映射', caption: 'CC Switch 配置 Claude Desktop' },
      verify: { src: '', alt: 'Claude Desktop 发送「当前时间」后的正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'codex', name: 'Codex', icon: '/client-icons/codex.svg', category: '终端编程',
    description: '用自定义模型提供方，连接你的 Codex 工作流。',
    protocol: 'OpenAI Responses', endpoint: '/v1/responses', defaultModel: 'gpt-6-astra',
    officialUrl: 'https://developers.openai.com/codex/config-advanced',
    installUrl: 'https://developers.openai.com/codex/cli',
    prerequisite: '先安装当前受支持的 Node.js LTS 与 npm。以下配置面向 Codex CLI；Windows 也可在 WSL2 中选择 macOS / Linux 指引。',
    configPath: '~/.codex/config.toml',
    configDescription: '先把以下字段合并到 ~/.codex/config.toml，配置模型和网关。顶层字段放在 [model_providers.gateway] 表定义之前；保留已有的其他设置。Windows 原生路径为 %USERPROFILE%\\.codex\\config.toml。',
    authFile: {
      path: '~/.codex/auth.json',
      description: '再将 API Key 填入 ~/.codex/auth.json 的 OPENAI_API_KEY 字段，把 sk-YOUR_API_KEY 替换为平台控制台创建的密钥。已有登录配置时先备份 auth.json，再按下方示例配置。Windows 原生路径为 %USERPROFILE%\\.codex\\auth.json。',
      code: JSON.stringify({ OPENAI_API_KEY: 'sk-YOUR_API_KEY' }, null, 2),
    },
    ccSwitch: {
      description: 'CC Switch 可以直接管理 Codex 供应商并写入 auth.json 与 config.toml，适合在多个 API 供应商之间快速切换。',
      steps: [
        '安装并打开 CC Switch，在应用切换器中选择「Codex」。',
        '点击「添加供应商」，填写平台 API Key、API 地址和模型；Responses 供应商可直接使用，其他协议按 CC Switch 提示开启本地路由映射。',
        '点击「启用」完成写入，重新打开 Codex，再发送「当前时间」验证。',
      ],
    },
    verification: '保存 config.toml 和 auth.json 后，重新启动 codex，直接发送「当前时间」。收到正常回复后，在控制台检查用量。',
    troubleshooting: 'Codex 需要 Responses 接口。若出现 404，请检查网关是否提供 /v1/responses，以及 base_url 是否只包含一次 /v1。提示缺少 API Key 时，检查 ~/.codex/auth.json 中的 OPENAI_API_KEY，以及 config.toml 中的 cli_auth_credentials_store = "file" 和 requires_openai_auth = true。迁移旧配置时移除提供方中的 env_key；若设置了 CODEX_HOME，两个文件都应放在该目录下。',
    screenshots: {
      configure: { src: '/client-docs/codex/configure.png', alt: '并排展示 Codex 的 auth.json 和 config.toml：API Key 配置在 auth.json 中，模型与 Responses 提供方配置在 config.toml 中，密钥已遮盖', caption: 'config.toml 与 auth.json 配置' },
      verify: { src: '/client-docs/codex/verify.png', alt: 'Codex 桌面客户端发送「当前时间」后收到正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'pi', name: 'Pi', icon: '/client-icons/pi.svg', category: '可扩展编程',
    description: '轻量、可组合，保留你习惯的终端工作方式。',
    protocol: 'OpenAI Chat Completions', endpoint: '/v1/chat/completions', defaultModel: 'your-model-id',
    officialUrl: 'https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/models.md',
    installUrl: 'https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#quick-start',
    prerequisite: '先安装当前受支持的 Node.js LTS 与 npm。这里的 Pi 指 pi-mono 项目中的 coding agent，安装包以官方快速开始文档为准。',
    configPath: '~/.pi/agent/models.json',
    configDescription: '在 models.json 的 providers 中新增 gateway，保留其他提供方。将 sk-YOUR_API_KEY 替换为你的密钥；Windows 路径为 %USERPROFILE%\\.pi\\agent\\models.json。',
    ccSwitch: {
      description: 'CC Switch 可管理 Pi 的供应商预设和模型配置，减少手动编辑 models.json 的步骤。',
      steps: [
        '安装并打开 CC Switch，在应用切换器中选择「Pi」。',
        '添加或选择供应商，填写 API Key、API 地址和模型；确认 API 格式与平台兼容。',
        '点击「启用」写入 Pi 配置，重新打开 Pi 或刷新 /model，再发送「当前时间」验证。',
      ],
    },
    verification: '启动 Pi 后，输入 /model，选择 gateway 下的目标模型。发送「当前时间」，确认收到回复，并在控制台检查请求用量。修改 models.json 后，重新打开 /model 即可重新读取。',
    troubleshooting: '模型没有显示时，先检查 JSON 格式和 API Key，再打开 /model。若返回接口不支持，请检查 api 字段与网关协议；此示例的 openai-completions 对应 /v1/chat/completions。',
    screenshots: {
      configure: { src: '', alt: 'Pi models.json 中的 gateway 配置', caption: 'models.json 自定义模型' },
      verify: { src: '', alt: 'Pi 的 /model 菜单选择 gateway 模型', caption: '/model 选择与首次对话' },
    },
  },
  {
    id: 'hermes', name: 'Hermes', icon: '/client-icons/hermes.svg', category: '通用智能体',
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
        '安装并打开 CC Switch，在应用切换器中选择「Hermes」。',
        '添加或选择供应商，填写 API Key、API 地址和模型；保存后点击「启用」。',
        '重新打开 Hermes，在会话中确认当前模型，再发送「当前时间」验证。',
      ],
    },
    verification: '完成向导后运行 hermes，在会话中用 /model 检查当前模型，然后发送「当前时间」。回复正常后，去控制台核对用量记录。',
    troubleshooting: '自定义端点应通过 hermes model 保存，或配置 config.yaml 的 model.base_url。不要依赖旧的 LLM_MODEL 环境变量。启动异常可运行 hermes doctor；工具本身的额外服务可能需要单独配置。',
    screenshots: {
      configure: { src: '', alt: 'Hermes 选择 Custom endpoint 并填写网关信息的向导', caption: 'Custom endpoint 配置向导' },
      verify: { src: '', alt: 'Hermes 当前模型与首次成功回复', caption: '确认模型与首次对话' },
    },
  },
  {
    id: 'openclaw', name: 'OpenClaw', icon: '/client-icons/openclaw.svg', category: '个人智能体',
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
    id: 'paseo', name: 'Paseo', icon: '/client-icons/paseo.svg', category: '远程编程',
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
    id: 'zcode', name: 'ZCode', icon: '/client-icons/zcode.png', category: '桌面编程',
    description: '在桌面工作区中，接入团队自己的模型通道。',
    protocol: 'Anthropic Messages', endpoint: '/v1/messages', defaultModel: 'your-model-id',
    officialUrl: 'https://zcode.z.ai/cn/docs/configuration',
    installUrl: 'https://zcode.z.ai/cn/docs/install',
    prerequisite: '从 ZCode 官网下载适用于 macOS、Windows 或 Linux 的桌面安装包。以下使用自定义供应商接入平台网关。',
    installSteps: [
      { text: '下载并安装适合当前系统的 ZCode。', href: 'https://zcode.z.ai/cn', linkLabel: '下载 ZCode' },
      { text: '打开应用。首次欢迎页可选择「使用 API Key」；已进入工作区时，从模型选择器底部进入「管理模型」。' },
    ],
    configPath: 'ZCode 自定义供应商填写参考',
    configDescription: '进入「设置 → 模型设置」，添加自定义供应商。本示例与下方截图一致，使用 Anthropic Messages 接口连接 Claude 模型。截图中的地址与模型仅作示例，请替换为你的网关地址和平台实际开放的模型 ID。',
    configSteps: [
      '在供应商列表底部点击「添加供应商」，为通道命名，例如 FluxCode Claude。',
      'Base URL 填写网关根地址，不加 /v1；API 格式选择「Anthropic Messages (/v1/messages)」，API Key 填写平台控制台创建的密钥。',
      '点击「添加模型」，填写完整的 Claude 模型 ID，保存并确认供应商显示「已启用」。',
    ],
    verification: '回到工作区，新建任务，在模型选择器中选择刚添加的供应商及其模型（截图中为 FluxCode Claude/claude-opus-5），直接发送「当前时间」。收到正常回复后，在平台控制台核对请求用量。',
    troubleshooting: '模型未出现时，检查供应商是否启用、模型是否已添加并保存。出现 404 时，确认 Base URL 为网关根地址、API 格式为 Anthropic Messages，且密钥和模型支持 /v1/messages。若模型返回推理参数错误，先按模型实际能力调整思考强度。',
    screenshots: {
      configure: { src: '/client-docs/zcode/configure.png', alt: 'ZCode 模型设置中配置 FluxCode Claude 供应商，Base URL 使用网关根地址，API 格式为 Anthropic Messages，密钥已遮盖', caption: '添加供应商与模型' },
      verify: { src: '/client-docs/zcode/verify.png', alt: 'ZCode 选择 FluxCode Claude/claude-opus-5 并发送「当前时间」后的正常回复', caption: '发送「当前时间」验证接入' },
    },
  },
  {
    id: 'deepseek-harness', name: 'DeepSeek Harness', icon: '/client-icons/deepseek-harness.svg', category: '插件化智能体',
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
    id: 'obsidian', name: 'Obsidian', icon: '/client-icons/obsidian.svg', category: 'Claudian 笔记助手',
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

export function getClientGuide(id: string | null): ClientGuide {
  return CLIENT_GUIDES.find(guide => guide.id === id) ?? CLIENT_GUIDES[0]
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
    case 'codex': return 'npm install -g @openai/codex'
    case 'pi': return 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent'
    case 'hermes': return platform === 'windows' ? 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)' : 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash'
    case 'openclaw': return platform === 'windows' ? 'iwr -useb https://openclaw.ai/install.ps1 | iex' : 'curl -fsSL https://openclaw.ai/install.sh | bash'
    case 'paseo':
    case 'obsidian':
    case 'zcode': return null
    case 'deepseek-harness': return 'npx @deepseek-ai/dsh web'
  }
}

export function getConfigExample(id: Exclude<ClientId, 'paseo'>, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string }
export function getConfigExample(id: ClientId, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string } | null
export function getConfigExample(id: ClientId, baseURL: string, model: string, platform: GuidePlatform): { language: string; code: string } | null {
  const apiKey = 'sk-YOUR_API_KEY'
  const apiURL = `${baseURL}/v1`
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
    case 'claude-desktop': return { language: '界面填写参考', code: JSON.stringify({ inferenceProvider: 'gateway', inferenceGatewayBaseUrl: baseURL, inferenceGatewayAuthScheme: 'bearer', inferenceGatewayApiKey: apiKey, model }, null, 2) }
    case 'paseo': return null
    case 'codex': return {
      language: 'TOML',
      code: `model = ${JSON.stringify(model)}\nmodel_provider = "gateway"\ncli_auth_credentials_store = "file"\n\n[model_providers.gateway]\nname = "Gateway"\nbase_url = ${JSON.stringify(apiURL)}\nwire_api = "responses"\nrequires_openai_auth = true`,
    }
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
    case 'codex': return 'codex'
    case 'pi': return `pi --provider gateway --model ${quoteShell(model, platform)}`
    case 'hermes': return 'hermes'
    case 'openclaw': return 'openclaw models list\nopenclaw gateway restart\nopenclaw dashboard'
    case 'paseo':
    case 'zcode':
    case 'deepseek-harness':
    case 'obsidian': return null
  }
}
