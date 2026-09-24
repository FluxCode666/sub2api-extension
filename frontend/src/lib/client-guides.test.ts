import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { CC_SWITCH_DOWNLOAD_URL, CC_SWITCH_GUIDES, CLIENT_GUIDES, findCCSwitchGuide, getCCSwitchExample, getCCSwitchGuide, getClientGuide, getConfigExample, getInstallCommand, getVerifyCommand, normalizeGatewayURL, quoteShell } from './client-guides'

describe('client guide configuration', () => {
  it('uses the official CC Switch homepage for downloads', () => {
    expect(CC_SWITCH_DOWNLOAD_URL).toBe('https://ccswitch.io/')
  })

  it('does not register screenshots for the new client guides or Codex import flow', () => {
    const newClients = ['codex', 'grok-build', 'gemini-cli', 'vscode-codex', 'vscode-claude', 'openai-compatible', 'ide-plugins']
    expect(CLIENT_GUIDES.filter(guide => newClients.includes(guide.id)).every(guide => !guide.screenshots)).toBe(true)
    expect(getCCSwitchGuide('codex').screenshots).toBeUndefined()
  })
  it.each([
    ['https://api.example.com/', 'https://api.example.com'],
    ['https://api.example.com/proxy/v1/', 'https://api.example.com/proxy'],
    ['http://localhost:8000/v1', 'http://localhost:8000'],
  ])('normalizes %s without duplicating the API version', (input, expected) => {
    expect(normalizeGatewayURL(input)).toBe(expected)
  })

  it.each(['', 'javascript:alert(1)', '//example.com', 'https://user:secret@api.example.com', 'https://api.example.com?token=secret', 'https://api.example.com/#key', 'https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/responses', 'https://api.example.com/\nmalformed'])('rejects invalid or unsuitable gateway URLs: %s', input => {
    expect(normalizeGatewayURL(input)).toBeNull()
  })

  it('uses root provider addresses for Messages and Codex Responses', () => {
    const claude = getConfigExample('claude-code', 'https://gateway.test', 'claude-model', 'unix')
    expect(claude.language).toBe('Bash / Zsh')
    expect(claude.code).toContain("export ANTHROPIC_BASE_URL='https://gateway.test'")
    expect(claude.code).toContain("export ANTHROPIC_MODEL='claude-model'")
    const codex = getConfigExample('codex', 'https://gateway.test', 'model-id', 'unix')
    expect(codex.code).toContain('base_url = "https://gateway.test"')
    expect(codex.code).not.toContain('base_url = "https://gateway.test/v1"')
    expect(codex.code).toContain('wire_api = "responses"')
    expect(codex.code).toContain('cli_auth_credentials_store = "file"')
    expect(codex.code).toContain('requires_openai_auth = true')
    expect(codex.code).not.toContain('env_key')
    expect(getCCSwitchExample('codex', 'https://gateway.test', 'model-id')?.code).toContain('接口地址      https://gateway.test\n')
    expect(getCCSwitchExample('codex', 'https://gateway.test', 'model-id')?.code).toContain('应用          Codex Desktop')
    expect(getInstallCommand('codex', 'unix')).toBeNull()
    expect(getVerifyCommand('codex', 'model-id', 'windows')).toBeNull()
    expect(getVerifyCommand('codex', 'model-id', 'unix')).toBeNull()
  })

  it('associates CC Switch setup with supported clients only', () => {
    expect(getClientGuide('codex').ccSwitch).toBeUndefined()
    expect(getClientGuide('claude-code').ccSwitch).toBeUndefined()
    expect(getClientGuide('claude-desktop').ccSwitch).toBeUndefined()
    expect(CC_SWITCH_GUIDES.map(guide => guide.id)).toEqual(['codex', 'claude-code', 'claude-desktop', 'grok-build'])
    expect(getCCSwitchGuide('codex')).toMatchObject({ id: 'codex', clientId: 'codex' })
    expect(getCCSwitchGuide('codex').steps).toHaveLength(5)
    expect(getCCSwitchGuide('codex').steps[0]).toContain('创建一个 API Key')
    expect(getCCSwitchGuide('codex').steps[1]).toContain('导入到 CCS')
    expect(getCCSwitchGuide('codex').steps[2]).toContain('确认导入')
    expect(getCCSwitchGuide('codex').steps[3]).toContain('启用')
    expect(getCCSwitchGuide('codex').steps[4]).toContain('重新打开 Codex Desktop')
    expect(getCCSwitchGuide('claude-desktop').steps.join(' ')).toContain('需要模型映射')
    expect(findCCSwitchGuide('codex')?.clientId).toBe('codex')
    expect(findCCSwitchGuide('vscode-codex')?.clientId).toBe('codex')
    expect(getCCSwitchExample('vscode-codex', 'https://gateway.test', 'model-id')?.code).toContain('接口地址      https://gateway.test\n')
    expect(findCCSwitchGuide('gemini-cli')).toBeUndefined()
  })

  it('generates the added client configurations with the correct base URL rules', () => {
    expect(getConfigExample('grok-build', 'https://gateway.test', 'grok-model', 'unix').code)
      .toContain('base_url = "https://gateway.test/v1"')
    expect(getConfigExample('grok-build', 'https://gateway.test', 'grok-model', 'unix').code)
      .toContain('api_backend = "chat_completions"')
    expect(getConfigExample('gemini-cli', 'https://gateway.test', 'gemini-model', 'windows').code)
      .toContain("$env:GOOGLE_GEMINI_BASE_URL = 'https://gateway.test'")
    expect(getConfigExample('vscode-codex', 'https://gateway.test', 'codex-model', 'unix').code)
      .toContain('base_url = "https://gateway.test"')
    expect(getConfigExample('vscode-claude', 'https://gateway.test', 'claude-model', 'unix').code)
      .toContain("ANTHROPIC_BASE_URL='https://gateway.test'")
    expect(getConfigExample('openai-compatible', 'https://gateway.test', 'model-id', 'unix').code)
      .toContain('Base URL       https://gateway.test/v1')
    expect(getConfigExample('ide-plugins', 'https://gateway.test', 'model-id', 'unix').code)
      .toContain('API Provider    OpenAI Compatible')
  })

  it('keeps JSON valid and OpenClaw model references aligned for custom IDs', () => {
    const model = 'vendor/a"model\\revision'
    const pi = JSON.parse(getConfigExample('pi', 'https://gateway.test', model, 'unix').code)
    expect(pi.providers.gateway.models[0].id).toBe(model)
    const claw = JSON.parse(getConfigExample('openclaw', 'https://gateway.test', model, 'unix').code)
    const primary = claw.agents.defaults.model.primary
    expect(primary).toBe(`gateway/${claw.models.providers.gateway.models[0].id}`)
    expect(claw.agents.defaults.models).toHaveProperty(primary)
  })

  it('defers Paseo configuration to its client and uses root Messages configuration for Claudian', () => {
    expect(getConfigExample('paseo', 'https://gateway.test', 'custom-model', 'unix'))
      .toBeNull()
    const obsidian = getConfigExample('obsidian', 'https://gateway.test', 'custom-model', 'windows')
    expect(obsidian.code).toContain('ANTHROPIC_BASE_URL="https://gateway.test"')
    expect(obsidian.code).toContain('ANTHROPIC_MODEL="custom-model"')
    expect(obsidian.code).not.toContain('$env:')
  })

  it.each(['pi', 'zcode'] as const)('documents all three API formats for %s', id => {
    const guide = getClientGuide(id)
    expect(guide.protocol).toContain('Anthropic Messages')
    expect(guide.protocol).toContain('Chat Completions')
    expect(guide.protocol).toContain('Responses')
    expect(guide.configDescription).toContain('/v1/messages')
    expect(guide.configDescription).toContain('/v1/chat/completions')
    expect(guide.configDescription).toContain('/v1/responses')
  })

  it.each([
    ['zcode', 'https://gateway.test/proxy', 'Anthropic Messages (/v1/messages)'],
    ['deepseek-harness', 'https://gateway.test/proxy/v1', 'DeepSeek (deepseek-official)'],
  ] as const)('generates %s form values for the documented provider setup', (id, baseURL, selection) => {
    const example = getConfigExample(id, 'https://gateway.test/proxy', 'vendor/model-id', 'unix')
    expect(example.language).toBe('界面填写参考')
    expect(example.code.match(/https:\/\/\S+/)?.[0]).toBe(baseURL)
    expect(example.code).toContain(selection)
    expect(example.code).toContain('vendor/model-id')
    expect(getVerifyCommand(id, 'vendor/model-id', 'unix')).toBeNull()
  })

  it('quotes shell metacharacters as literal data', () => {
    const model = 'model\'s $(printf INJECTED) `printf INJECTED` "name"'
    const output = execFileSync('/bin/bash', ['-c', `printf '%s' ${quoteShell(model, 'unix')}`], { encoding: 'utf8' })
    expect(output).toBe(model)
    expect(quoteShell("model's", 'windows')).toBe("'model''s'")
  })
})
