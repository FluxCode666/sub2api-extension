import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { getConfigExample, getVerifyCommand, normalizeGatewayURL, quoteShell } from './client-guides'

describe('client guide configuration', () => {
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

  it('uses Messages at the root and Responses at the versioned Codex provider', () => {
    const claude = getConfigExample('claude-code', 'https://gateway.test', 'claude-model', 'unix')
    expect(claude.code).toContain("ANTHROPIC_BASE_URL='https://gateway.test'")
    const codex = getConfigExample('codex', 'https://gateway.test', 'model-id', 'unix')
    expect(codex.code).toContain('base_url = "https://gateway.test/v1"')
    expect(codex.code).toContain('wire_api = "responses"')
    expect(codex.code).toContain('cli_auth_credentials_store = "file"')
    expect(codex.code).toContain('requires_openai_auth = true')
    expect(codex.code).not.toContain('env_key')
    expect(getVerifyCommand('codex', 'model-id', 'windows')).toBe('codex')
    expect(getVerifyCommand('codex', 'model-id', 'unix')).toBe('codex')
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
