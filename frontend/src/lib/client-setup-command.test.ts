import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildClientConfigFiles, buildClientSetupCommand, buildClientSetupPlan, SETUP_COMMAND_TARGET_IDS, type SetupCommandTargetId } from './client-import'
import { renderSetupCommand, setupPlanMergesJSON, setupPlanPaths, type ClientSetupPlan, type SetupPlatform } from './client-setup-command'

// 密钥和供应商名称包含引号、$ 与反引号，用来确认命令不会被 shell 展开或截断。
const key = {
  id: 3,
  key: "sk-test-'quote$HOME`x`",
  name: '测试密钥',
  group_id: 5,
  status: 'active',
  expires_at: null,
  created_at: '2026-09-24T00:00:00Z',
  group: { name: 'OpenAI 主组', platform: 'openai' },
}
const baseURL = 'https://api.example.com'
const providerName = '本地 "网关"'
const modelFor = (id: SetupCommandTargetId) => (id === 'gemini' ? 'gemini-3-pro' : 'gpt-5.5')
const command = (id: SetupCommandTargetId, platform: SetupPlatform) => buildClientSetupCommand(id, key, baseURL, modelFor(id), providerName, ['gpt-5.5-mini'], platform)

describe('renderSetupCommand', () => {
  const plan: ClientSetupPlan = {
    name: '示例',
    steps: [{ kind: 'merge-json', path: { display: '~/.demo/a.json', home: ['.demo', 'a.json'], env: { name: 'DEMO_HOME', type: 'dir' } }, value: { token: key.key }, deletes: [['env', 'OLD']] }],
    nextStep: '重新打开示例。',
  }

  it('runs bash on a quoted heredoc so user data is never expanded', () => {
    const script = renderSetupCommand(plan, 'unix')
    expect(script.startsWith("bash <<'AUX_SETUP'\n")).toBe(true)
    expect(script.trimEnd().endsWith('\nAUX_SETUP')).toBe(true)
    expect(script).toContain('f="${DEMO_HOME:-$HOME/.demo}/a.json"')
    expect(script).toContain(`cat > "$AUX_TMP/1.json" <<'AUX_EOF'\n{\n  "token": "sk-test-'quote$HOME\`x\`"\n}\nAUX_EOF`)
    expect(script).toContain(`aux_merge_json "$f" "$AUX_TMP/1.json" '[["env","OLD"]]'`)
    expect(script).toContain('aux_merge_json()')
    // 没有文本编辑步骤时不附带 awk 程序。
    expect(script).not.toContain('aux_edit_text()')
    expect(script).toContain("echo '下一步：重新打开示例。'")
  })

  it('wraps PowerShell in a script block that never exits the user session', () => {
    const script = renderSetupCommand(plan, 'windows')
    expect(script.startsWith('& {\n')).toBe(true)
    expect(script).toContain("$f = Join-Path $(if ($env:DEMO_HOME) { $env:DEMO_HOME } else { Join-Path $HOME '.demo' }) 'a.json'")
    expect(script).toContain(`$content = @'\n{\n  "token": "sk-test-'quote$HOME\`x\`"\n}\n'@`)
    expect(script).toContain("Merge-AuxJson $f $content @('env/OLD')")
    expect(script).toContain('Remove-TypeData System.Array')
    expect(script).not.toMatch(/\bexit\b/)
    expect(script).not.toContain('Edit-AuxText([string]$Path')
  })

  it('lists the files each client command writes', () => {
    const paths = (id: SetupCommandTargetId) => setupPlanPaths(buildClientSetupPlan(id, key, baseURL, modelFor(id), providerName))
    expect(paths('claude-code')).toEqual(['~/.claude/settings.json'])
    expect(paths('codex')).toEqual(['~/.codex/config.toml', '~/.codex/auth.json'])
    expect(paths('gemini')).toEqual(['~/.gemini/.env', '~/.gemini/settings.json'])
    expect(paths('openclaw')).toEqual(['~/.openclaw/openclaw.json'])
    expect(setupPlanMergesJSON(buildClientSetupPlan('grok-build', key, baseURL, 'grok-4.5', providerName))).toBe(false)
    expect(setupPlanMergesJSON(buildClientSetupPlan('pi', key, baseURL, 'gpt-5.5', providerName))).toBe(true)
  })

  it('removes conflicting Claude Code provider variables and the stale model when none is chosen', () => {
    const [step] = buildClientSetupPlan('claude-code', key, baseURL, '', providerName).steps
    expect(step).toMatchObject({ kind: 'merge-json', value: { env: { ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: key.key } } })
    expect(step.kind === 'merge-json' && step.deletes?.map((path) => path.join('.'))).toEqual(expect.arrayContaining(['env.ANTHROPIC_API_KEY', 'env.ANTHROPIC_DEFAULT_HAIKU_MODEL', 'env.ANTHROPIC_MODEL']))
  })

  it('applies OpenClaw changes through its validated batch command', () => {
    const [step] = buildClientSetupPlan('openclaw', key, baseURL, 'gpt-5.5', providerName).steps
    expect(step).toEqual({
      kind: 'openclaw-config',
      path: { display: '~/.openclaw/openclaw.json', home: ['.openclaw', 'openclaw.json'], env: { name: 'OPENCLAW_CONFIG_PATH', type: 'file' } },
      entries: [
        { path: 'models.mode', value: 'merge' },
        { path: 'models.providers.gateway', value: { baseUrl: `${baseURL}/v1`, apiKey: key.key, api: 'openai-completions', models: [{ id: 'gpt-5.5', name: 'gpt-5.5' }] } },
        { path: 'agents.defaults.model.primary', value: 'gateway/gpt-5.5' },
        { path: 'agents.defaults.models', value: { 'gateway/gpt-5.5': {} }, merge: true },
      ],
    })
    expect(command('openclaw', 'unix')).toContain('openclaw config set --batch-file')
    expect(command('openclaw', 'windows')).toContain('Get-Command openclaw.cmd')
  })
})

const hasBash = process.platform !== 'win32' && spawnSync('bash', ['--version'], { stdio: 'ignore' }).status === 0
const PWSH = process.env.PWSH || 'pwsh'
const hasPwsh = process.platform !== 'win32' && spawnSync(PWSH, ['-NoProfile', '-Command', '1'], { stdio: 'ignore' }).status === 0
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'aux-setup-test-'))
  roots.push(home)
  return home
}

function put(home: string, path: string, content: string, mode?: number) {
  mkdirSync(dirname(join(home, path)), { recursive: true })
  writeFileSync(join(home, path), content)
  if (mode) chmodSync(join(home, path), mode)
}

const read = (home: string, path: string) => readFileSync(join(home, path), 'utf8')
const readJSON = (home: string, path: string) => JSON.parse(read(home, path))

/** 预置用户已有的配置，覆盖保留其他设置、替换旧供应商和重复运行的场景。 */
function seed(home: string) {
  put(home, '.claude/settings.json', JSON.stringify({ permissions: { allow: ['Bash(ls)'] }, env: { ANTHROPIC_API_KEY: 'old', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'kimi', FOO: 'bar' }, model: 'opus' }))
  put(home, '.codex/config.toml', 'model = "o3"\nmodel_reasoning_effort = "high"\nmodel_provider = "openai"\n\n[model_providers.gateway]\nname = "old"\nbase_url = "https://old/v1"\n\n[projects."/x"]\ntrust_level = "trusted"\n')
  put(home, '.codex/auth.json', '{"tokens":{"access_token":"chatgpt"}}', 0o600)
  put(home, '.gemini/.env', 'FOO=1\nexport GEMINI_API_KEY=old\nGEMINI_MODEL = x')
  put(home, '.gemini/settings.json', JSON.stringify({ ui: { theme: 'Dark' }, security: { auth: { selectedType: 'oauth-personal' }, folderTrust: { enabled: true } } }))
  put(home, '.grok/config.toml', '[models]\ndefault = "other"\nfast = "x"\n\n[model."gpt-5.5"]\nmodel = "old"\n\n[model."other"]\nmodel = "other"\n')
  put(home, '.config/opencode/opencode.json', JSON.stringify({ $schema: 'https://opencode.ai/config.json', provider: { gateway: { models: { 'old-model': { name: 'old' } }, options: { timeout: 1 } }, anthropic: { x: 1 } }, theme: 'tokyo' }))
  put(home, '.pi/agent/models.json', JSON.stringify({ providers: { anthropic: { apiKey: 'x' }, gateway: { headers: { a: 'b' }, models: [{ id: 'old' }] } } }))
  mockOpenClaw(home)
}

/** 模拟 openclaw CLI：记录参数和批量文件，用于确认命令的调用方式。 */
function mockOpenClaw(home: string) {
  put(home, 'bin/openclaw', '#!/bin/sh\necho "$@" > "$HOME/openclaw-args"\ncp "$4" "$HOME/openclaw-batch.json"\n', 0o755)
}

function runBash(home: string, script: string, path = `${join(home, 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`) {
  const file = join(home, 'setup.sh')
  writeFileSync(file, script)
  return spawnSync('bash', [file], { env: { HOME: home, PATH: path }, encoding: 'utf8' })
}

// 生成的命令面向 Windows，路径段使用反斜杠；在 macOS / Linux 上运行 pwsh 时只把 Join-Path 的路径参数换成正斜杠。
const posixPaths = (script: string) => script.replace(/(Join-Path [^\n]*?)'([^'\n]*)'/g, (_, prefix: string, path: string) => `${prefix}'${path.replace(/\\/g, '/')}'`)

function runPwsh(home: string, script: string) {
  const file = join(home, 'setup.ps1')
  writeFileSync(file, posixPaths(script))
  return spawnSync(PWSH, ['-NoProfile', '-NonInteractive', '-File', file], { env: { HOME: home, PATH: `${join(home, 'bin')}:/usr/bin:/bin` }, encoding: 'utf8' })
}

function runAll(home: string, platform: SetupPlatform) {
  for (const id of SETUP_COMMAND_TARGET_IDS) {
    const result = platform === 'windows' ? runPwsh(home, command(id, 'windows')) : runBash(home, command(id, 'unix'))
    expect(result.status, `${id}: ${result.stderr}`).toBe(0)
    expect(result.stdout, `${id}: ${result.stdout}${result.stderr}`).toContain('配置完成')
  }
}

function expectMergedConfigs(home: string) {
  expect(readJSON(home, '.claude/settings.json')).toEqual({
    permissions: { allow: ['Bash(ls)'] },
    env: { FOO: 'bar', ANTHROPIC_BASE_URL: baseURL, ANTHROPIC_AUTH_TOKEN: key.key, ANTHROPIC_MODEL: 'gpt-5.5' },
    model: 'opus',
  })
  expect(read(home, '.codex/config.toml')).toBe([
    'model = "gpt-5.5"',
    'model_provider = "gateway"',
    'cli_auth_credentials_store = "file"',
    'model_reasoning_effort = "high"',
    '',
    '[projects."/x"]',
    'trust_level = "trusted"',
    '',
    '[model_providers.gateway]',
    'name = "本地 \\"网关\\""',
    `base_url = "${baseURL}/v1"`,
    'wire_api = "responses"',
    'requires_openai_auth = true',
    '',
  ].join('\n'))
  expect(readJSON(home, '.codex/auth.json')).toEqual({ OPENAI_API_KEY: key.key })
  expect(read(home, '.gemini/.env')).toBe(`FOO=1\nGOOGLE_GEMINI_BASE_URL="${baseURL}"\nGEMINI_API_KEY="${key.key}"\nGEMINI_MODEL="gemini-3-pro"\n`)
  expect(readJSON(home, '.gemini/settings.json')).toEqual({ ui: { theme: 'Dark' }, security: { auth: { selectedType: 'gemini-api-key' }, folderTrust: { enabled: true } } })
  expect(read(home, '.grok/config.toml')).toBe([
    '[models]',
    'default = "gpt-5.5"',
    'fast = "x"',
    '',
    '[model."other"]',
    'model = "other"',
    '',
    '[model."gpt-5.5"]',
    'model = "gpt-5.5"',
    `base_url = "${baseURL}/v1"`,
    'name = "本地 \\"网关\\""',
    `api_key = ${JSON.stringify(key.key)}`,
    'api_backend = "chat_completions"',
    '',
  ].join('\n'))
  expect(readJSON(home, '.config/opencode/opencode.json')).toEqual({
    $schema: 'https://opencode.ai/config.json',
    provider: {
      gateway: { npm: '@ai-sdk/openai-compatible', name: providerName, options: { timeout: 1, baseURL: `${baseURL}/v1`, apiKey: key.key }, models: { 'gpt-5.5': { name: 'gpt-5.5' } } },
      anthropic: { x: 1 },
    },
    theme: 'tokyo',
    model: 'gateway/gpt-5.5',
  })
  expect(readJSON(home, '.pi/agent/models.json')).toEqual({
    providers: {
      anthropic: { apiKey: 'x' },
      gateway: { headers: { a: 'b' }, baseUrl: `${baseURL}/v1`, api: 'openai-completions', apiKey: key.key, models: [{ id: 'gpt-5.5', name: 'gpt-5.5' }, { id: 'gpt-5.5-mini', name: 'gpt-5.5-mini' }] },
    },
  })
  expect(read(home, 'openclaw-args').trim()).toMatch(/^config set --batch-file \S+$/)
  expect(readJSON(home, 'openclaw-batch.json')).toEqual((buildClientSetupPlan('openclaw', key, baseURL, 'gpt-5.5', providerName).steps[0] as { entries: readonly unknown[] }).entries)
}

describe.skipIf(!hasBash)('bash setup commands', () => {
  it('merges into existing configs, keeps other settings and stays stable when run again', () => {
    const home = tempHome()
    seed(home)
    runAll(home, 'unix')
    runAll(home, 'unix')
    expectMergedConfigs(home)
    // 两次运行各备份一次；即使在同一秒内完成，最早的备份仍是用户原来的文件。
    const backups = (prefix: string) => readdirSync(join(home, '.codex')).filter((name) => name.startsWith(prefix)).sort()
    expect(backups('config.toml.bak-')).toHaveLength(2)
    expect(backups('auth.json.bak-')).toHaveLength(2)
    expect(readJSON(home, `.codex/${backups('auth.json.bak-')[0]}`)).toEqual({ tokens: { access_token: 'chatgpt' } })
  })

  it('writes the same content as the downloadable files into a fresh home', () => {
    const home = tempHome()
    mockOpenClaw(home)
    runAll(home, 'unix')
    const fileContent = (id: 'claude-code' | 'codex' | 'gemini' | 'grok-build' | 'opencode' | 'pi', index = 0) => buildClientConfigFiles(id, key, baseURL, modelFor(id), providerName, ['gpt-5.5-mini'])[index].content
    expect(read(home, '.claude/settings.json')).toBe(fileContent('claude-code'))
    expect(read(home, '.codex/config.toml')).toBe(fileContent('codex'))
    expect(read(home, '.codex/auth.json')).toBe(fileContent('codex', 1))
    expect(read(home, '.gemini/.env')).toBe(fileContent('gemini'))
    expect(read(home, '.grok/config.toml')).toBe(fileContent('grok-build'))
    expect(read(home, '.config/opencode/opencode.json')).toBe(fileContent('opencode'))
    expect(read(home, '.pi/agent/models.json')).toBe(fileContent('pi'))
    expect(existsSync(join(home, '.claude/settings.json.bak'))).toBe(false)
  })

  it('leaves a JSON file with comments untouched and exits with an error', () => {
    const home = tempHome()
    put(home, '.claude/settings.json', '{\n  // 用户注释\n  "model": "opus"\n}\n')
    const result = runBash(home, command('claude-code', 'unix'))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('未做修改')
    expect(read(home, '.claude/settings.json')).toBe('{\n  // 用户注释\n  "model": "opus"\n}\n')
  })

  it('stops before writing when OpenClaw is not installed', () => {
    const home = tempHome()
    const result = runBash(home, command('openclaw', 'unix'), '/usr/bin:/bin')
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('未找到 openclaw 命令')
    expect(existsSync(join(home, '.openclaw'))).toBe(false)
  })
})

describe.skipIf(!hasPwsh)('PowerShell setup commands', () => {
  it('produces the same merged configs as the bash commands', () => {
    const home = tempHome()
    seed(home)
    runAll(home, 'windows')
    runAll(home, 'windows')
    expectMergedConfigs(home)
    expect(readFileSync(join(home, '.claude/settings.json')).subarray(0, 3)).not.toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
  }, 60_000)

  it('reports a missing OpenClaw command without throwing out of the session', () => {
    const home = tempHome()
    const result = runPwsh(home, command('openclaw', 'windows'))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('配置失败：未找到 openclaw 命令')
  }, 30_000)
})
