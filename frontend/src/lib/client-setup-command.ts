/** 一键配置命令的运行环境：macOS / Linux 使用 bash，Windows 使用 PowerShell。 */
export type SetupPlatform = 'unix' | 'windows'

/** 用户主目录下的配置文件位置；路径段均为常量，不包含用户输入。 */
export interface SetupPath {
  /** 展示给用户的路径，例如 ~/.claude/settings.json。 */
  display: string
  /** 相对用户主目录的路径段，最后一段为文件名。 */
  home: readonly string[]
  /** 客户端支持的位置覆盖变量：dir 覆盖所在目录（如 CODEX_HOME），file 覆盖完整文件路径。 */
  env?: { name: string; type: 'dir' | 'file' }
}

export type SetupStep =
  /** 把 value 深度合并进已有 JSON（对象递归合并，数组和标量整体替换），合并前先删除 deletes 中的键路径。 */
  | { kind: 'merge-json'; path: SetupPath; value: unknown; deletes?: readonly (readonly string[])[] }
  /** 用 content 整体替换文件。 */
  | { kind: 'write'; path: SetupPath; content: string }
  /**
   * 按行编辑 TOML / .env：删除 dropTables 整张表和 dropKeys 指定的键（table 为空表示根级），
   * 在 setTable 表头后插入 lines（表不存在时追加），再把 prepend 放在文件开头、append 放在末尾。
   */
  | {
    kind: 'edit-text'
    path: SetupPath
    prepend?: readonly string[]
    append?: readonly string[]
    dropTables?: readonly string[]
    dropKeys?: readonly { table: string; key: string }[]
    setTable?: { name: string; lines: readonly string[] }
  }
  /** 通过 openclaw config set --batch-file 写入，由 OpenClaw 校验 JSON5 配置后原子保存。 */
  | { kind: 'openclaw-config'; path: SetupPath; entries: readonly unknown[] }

export interface ClientSetupPlan {
  /** 客户端名称，用于命令输出。 */
  name: string
  steps: readonly SetupStep[]
  /** 已导出时可能覆盖或冲突新配置的环境变量，命令运行时给出提示。 */
  warnEnv?: readonly string[]
  /** 配置完成后提示用户的下一步。 */
  nextStep: string
}

/** 命令会写入的配置文件，用于界面提示。 */
export function setupPlanPaths(plan: ClientSetupPlan): string[] {
  return plan.steps.map((step) => step.path.display)
}

/** macOS / Linux 合并已有 JSON 时需要 Node.js 或 Python 3；Windows 由 PowerShell 自带的 JSON 命令处理。 */
export function setupPlanMergesJSON(plan: ClientSetupPlan): boolean {
  return plan.steps.some((step) => step.kind === 'merge-json')
}

/** 按浏览器所在系统选择默认运行环境，无法识别时使用 macOS / Linux。 */
export function detectSetupPlatform(): SetupPlatform {
  if (typeof navigator === 'undefined') return 'unix'
  const hint = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform || navigator.platform || ''
  return /^win|windows/i.test(hint) || /Windows NT/.test(navigator.userAgent) ? 'windows' : 'unix'
}

export function renderSetupCommand(plan: ClientSetupPlan, platform: SetupPlatform): string {
  return platform === 'windows' ? renderPowerShell(plan) : renderBash(plan)
}

const bashQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`
const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`
const jsonText = (value: unknown) => JSON.stringify(value, null, 2)
const keyLine = (key: { table: string; key: string }) => `${key.table}|${key.key}`

// 生成内容逐行写入 heredoc / here-string；JSON、TOML 与 .env 的每一行都以键、括号或空白开头，
// 不会与 AUX_EOF、AUX_SETUP 定界符或 PowerShell 的 '@ 结束符冲突。
const HEREDOC = 'AUX_EOF'

function bashPath(path: SetupPath): string {
  const segments = path.home
  if (path.env?.type === 'dir') return `"\${${path.env.name}:-$HOME/${segments.slice(0, -1).join('/')}}/${segments[segments.length - 1]}"`
  if (path.env?.type === 'file') return `"\${${path.env.name}:-$HOME/${segments.join('/')}}"`
  return `"$HOME/${segments.join('/')}"`
}

function bashWriteTemp(file: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [`: > "${file}"`] : [`cat > "${file}" <<'${HEREDOC}'`, ...lines, HEREDOC]
}

// 合并逻辑以 node 优先、python3 兜底；两段程序都不含单引号，可整体放在 bash 单引号中。
const NODE_MERGE = [
  'const fs = require("fs");',
  'const [file, patchFile, deletes] = process.argv.slice(1);',
  'const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);',
  'let current;',
  'try { current = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\\uFEFF/, "")); } catch (error) { current = undefined; }',
  'if (!isObject(current)) { console.error("无法解析 " + file + "（可能包含注释或格式错误），未做修改。"); process.exit(1); }',
  'for (const path of JSON.parse(deletes)) { let node = current; for (const key of path.slice(0, -1)) node = isObject(node) ? node[key] : undefined; if (isObject(node)) delete node[path[path.length - 1]]; }',
  'const merge = (target, patch) => { for (const key of Object.keys(patch)) target[key] = isObject(patch[key]) && isObject(target[key]) ? merge(target[key], patch[key]) : patch[key]; return target; };',
  'fs.writeFileSync(file, JSON.stringify(merge(current, JSON.parse(fs.readFileSync(patchFile, "utf8"))), null, 2) + "\\n");',
]

const PYTHON_MERGE = [
  'import json, sys',
  'file, patch_file, deletes = sys.argv[1:4]',
  'try:',
  '    with open(file, encoding="utf-8-sig") as handle:',
  '        current = json.load(handle)',
  'except Exception:',
  '    current = None',
  'if not isinstance(current, dict):',
  '    sys.exit("无法解析 " + file + "（可能包含注释或格式错误），未做修改。")',
  'for path in json.loads(deletes):',
  '    node = current',
  '    for key in path[:-1]:',
  '        node = node.get(key) if isinstance(node, dict) else None',
  '    if isinstance(node, dict):',
  '        node.pop(path[-1], None)',
  'def merge(target, patch):',
  '    for key, value in patch.items():',
  '        target[key] = merge(target[key], value) if isinstance(value, dict) and isinstance(target.get(key), dict) else value',
  '    return target',
  'with open(patch_file, encoding="utf-8") as handle:',
  '    patch = json.load(handle)',
  'with open(file, "w", encoding="utf-8") as handle:',
  '    json.dump(merge(current, patch), handle, ensure_ascii=False, indent=2)',
  '    handle.write("\\n")',
]

// awk 参数经由 ENVIRON 传入，避免 -v 对反斜杠转义；只比较完整字符串，不把用户数据当正则。
// 空行先暂存，输出下一行内容时再补上，文件末尾的空行丢弃，避免重复运行时空行越积越多。
const AWK_EDIT = [
  'function trim(s) { sub(/^[ \\t]+/, "", s); sub(/[ \\t\\r]+$/, "", s); return s }',
  'function flush() { while (blank > 0) { print ""; blank-- } }',
  'BEGIN {',
  '  n = split(ENVIRON["AUX_DROP_TABLES"], items, "\\n"); for (i = 1; i <= n; i++) if (items[i] != "") droptable[items[i]] = 1',
  '  n = split(ENVIRON["AUX_DROP_KEYS"], items, "\\n"); for (i = 1; i <= n; i++) if (items[i] != "") dropkey[items[i]] = 1',
  '  settable = ENVIRON["AUX_SET_TABLE"]; setlines = ENVIRON["AUX_SET_LINES"]; table = ""; skip = 0; done = 0; blank = 0; printed = 0',
  '}',
  '/^[ \\t]*\\[/ {',
  '  header = trim($0); sub(/^\\[+[ \\t]*/, "", header); sub(/[ \\t]*\\].*$/, "", header)',
  '  table = header; skip = (header in droptable)',
  '  if (skip) next',
  '  flush(); print; printed = 1',
  '  if (settable != "" && header == settable) { print setlines; done = 1 }',
  '  next',
  '}',
  'skip { next }',
  'trim($0) == "" { blank++; next }',
  'index($0, "=") > 0 {',
  '  key = $0; sub(/=.*/, "", key); key = trim(key); sub(/^export[ \\t]+/, "", key); gsub(/"/, "", key)',
  '  if ((table "|" key) in dropkey) next',
  '}',
  '{ flush(); print; printed = 1 }',
  'END { if (settable != "" && !done) { if (printed) print ""; print "[" settable "]"; print setlines } }',
]

function renderBash(plan: ClientSetupPlan): string {
  const kinds = new Set(plan.steps.map((step) => step.kind))
  const lines: string[] = [
    `bash <<'AUX_SETUP'`,
    `# ${plan.name} 一键配置：已有配置文件会先备份为 .bak-时间戳，再合并写入。`,
    'set -eu',
    'umask 077',
    'AUX_TMP="$(mktemp -d)"',
    `trap 'rm -rf "$AUX_TMP"' EXIT`,
    // 同一秒内重复运行时追加序号，避免后一次备份覆盖最初的配置。
    'aux_backup() {',
    '  if [ -f "$1" ]; then',
    '    backup="$1.bak-$(date +%Y%m%d%H%M%S)"; base="$backup"; n=1',
    '    while [ -e "$backup" ]; do backup="$base-$n"; n=$((n + 1)); done',
    '    cp -p "$1" "$backup"',
    '    echo "已备份 $1"',
    '  fi',
    '}',
    'aux_install() {',
    '  if [ -e "$1" ]; then cat "$2" > "$1"; else mv "$2" "$1"; fi',
    '}',
  ]
  if (kinds.has('merge-json')) {
    lines.push(
      'aux_merge_json() {',
      '  if [ ! -s "$1" ]; then aux_install "$1" "$2"; return; fi',
      '  if command -v node >/dev/null 2>&1; then',
      `    node -e '`,
      ...NODE_MERGE,
      `' "$1" "$2" "$3" </dev/null`,
      '  elif command -v python3 >/dev/null 2>&1; then',
      `    python3 -c '`,
      ...PYTHON_MERGE,
      `' "$1" "$2" "$3" </dev/null`,
      '  else',
      '    echo "合并 $1 需要 Node.js 或 Python 3，未做修改；请改用页面中的配置文件手动合并。" >&2',
      '    exit 1',
      '  fi',
      '}',
    )
  }
  if (kinds.has('edit-text')) {
    lines.push(
      'aux_edit_text() {',
      '  src="$1"; [ -f "$src" ] || src=/dev/null',
      '  { cat "$2"; AUX_DROP_TABLES="$4" AUX_DROP_KEYS="$5" AUX_SET_TABLE="$6" AUX_SET_LINES="$7" awk \'',
      ...AWK_EDIT,
      `' "$src"; cat "$3"; } > "$AUX_TMP/edited"`,
      '  aux_install "$1" "$AUX_TMP/edited"',
      '}',
    )
  }
  if (plan.warnEnv?.length) {
    lines.push(
      `for name in ${plan.warnEnv.join(' ')}; do`,
      '  if [ -n "${!name:-}" ]; then echo "注意：当前终端已设置环境变量 $name，可能与新配置冲突；不再需要时请从 ~/.zshrc、~/.bashrc 等 shell 配置中删除。"; fi',
      'done',
    )
  }
  plan.steps.forEach((step, index) => {
    const temp = `$AUX_TMP/${index + 1}`
    lines.push(`f=${bashPath(step.path)}`)
    switch (step.kind) {
      case 'merge-json':
        lines.push(
          'mkdir -p "$(dirname "$f")"',
          ...bashWriteTemp(`${temp}.json`, jsonText(step.value).split('\n')),
          'aux_backup "$f"',
          `aux_merge_json "$f" "${temp}.json" ${bashQuote(JSON.stringify(step.deletes ?? []))}`,
          'echo "已写入 $f"',
        )
        break
      case 'write':
        lines.push(
          'mkdir -p "$(dirname "$f")"',
          ...bashWriteTemp(temp, step.content.replace(/\n$/, '').split('\n')),
          'aux_backup "$f"',
          `aux_install "$f" "${temp}"`,
          'echo "已写入 $f"',
        )
        break
      case 'edit-text':
        lines.push(
          'mkdir -p "$(dirname "$f")"',
          ...bashWriteTemp(`${temp}.pre`, step.prepend ?? []),
          ...bashWriteTemp(`${temp}.post`, step.append ?? []),
          'aux_backup "$f"',
          `aux_edit_text "$f" "${temp}.pre" "${temp}.post" ${[
            (step.dropTables ?? []).join('\n'),
            (step.dropKeys ?? []).map(keyLine).join('\n'),
            step.setTable?.name ?? '',
            (step.setTable?.lines ?? []).join('\n'),
          ].map(bashQuote).join(' ')}`,
          'echo "已写入 $f"',
        )
        break
      case 'openclaw-config':
        lines.push(
          'if ! command -v openclaw >/dev/null 2>&1; then echo "未找到 openclaw 命令：请先安装 OpenClaw 并重新打开终端。" >&2; exit 1; fi',
          'aux_backup "$f"',
          ...bashWriteTemp(`${temp}.json`, jsonText(step.entries).split('\n')),
          `openclaw config set --batch-file "${temp}.json" </dev/null || { echo "OpenClaw 未保存配置，请查看上方的校验信息。" >&2; exit 1; }`,
        )
        break
    }
  })
  lines.push('echo ""', `echo ${bashQuote(`${plan.name} 配置完成。`)}`, `echo ${bashQuote(`下一步：${plan.nextStep}`)}`, 'AUX_SETUP')
  return `${lines.join('\n')}\n`
}

function psPath(path: SetupPath): string {
  const segments = path.home
  if (path.env?.type === 'dir') {
    return `$f = Join-Path $(if ($env:${path.env.name}) { $env:${path.env.name} } else { Join-Path $HOME ${psQuote(segments.slice(0, -1).join('\\'))} }) ${psQuote(segments[segments.length - 1])}`
  }
  if (path.env?.type === 'file') return `$f = if ($env:${path.env.name}) { $env:${path.env.name} } else { Join-Path $HOME ${psQuote(segments.join('\\'))} }`
  return `$f = Join-Path $HOME ${psQuote(segments.join('\\'))}`
}

function psHereString(variable: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [`${variable} = ''`] : [`${variable} = @'`, ...lines, `'@`]
}

const psArray = (items: readonly string[]) => `@(${items.map(psQuote).join(', ')})`

// 兼容 Windows PowerShell 5.1：不使用 ??、三元运算符和 ConvertFrom-Json -AsHashtable，文件按无 BOM 的 UTF-8 写入。
const PS_HELPERS = [
  'function Backup-AuxFile([string]$Path) {',
  '  if (Test-Path -LiteralPath $Path -PathType Leaf) {',
  `    $base = $Path + '.bak-' + (Get-Date -Format 'yyyyMMddHHmmss'); $backup = $base; $n = 1`,
  `    while (Test-Path -LiteralPath $backup) { $backup = $base + '-' + $n; $n++ }`,
  '    Copy-Item -LiteralPath $Path -Destination $backup',
  '    Write-Host "已备份 $Path"',
  '  }',
  '}',
  'function Write-AuxFile([string]$Path, [string]$Text) {',
  '  $dir = Split-Path -Parent $Path',
  '  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }',
  '  [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))',
  '}',
]

const PS_JSON_HELPERS = [
  'function Test-AuxObject($Value) { return $Value -is [System.Management.Automation.PSCustomObject] }',
  'function Merge-AuxObject($Target, $Patch) {',
  '  foreach ($property in $Patch.PSObject.Properties) {',
  '    $current = $Target.PSObject.Properties[$property.Name]',
  '    if ((Test-AuxObject $property.Value) -and $current -and (Test-AuxObject $current.Value)) { Merge-AuxObject $current.Value $property.Value }',
  '    else { $Target | Add-Member -NotePropertyName $property.Name -NotePropertyValue $property.Value -Force }',
  '  }',
  '}',
  'function Merge-AuxJson([string]$Path, [string]$Patch, [string[]]$Deletes) {',
  '  if (-not (Test-Path -LiteralPath $Path -PathType Leaf) -or ((Get-Item -LiteralPath $Path).Length -eq 0)) { Write-AuxFile $Path ($Patch + "`n"); return }',
  `  try { $current = [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json } catch { $current = $null }`,
  `  if (-not (Test-AuxObject $current)) { throw ('无法解析 ' + $Path + '（可能包含注释或格式错误），未做修改。') }`,
  '  foreach ($item in $Deletes) {',
  `    $keys = $item -split '/'`,
  '    $node = $current',
  '    for ($i = 0; $i -lt $keys.Count - 1; $i++) {',
  '      if ((Test-AuxObject $node) -and $node.PSObject.Properties[$keys[$i]]) { $node = $node.PSObject.Properties[$keys[$i]].Value } else { $node = $null }',
  '    }',
  '    if (Test-AuxObject $node) { $node.PSObject.Properties.Remove($keys[$keys.Count - 1]) }',
  '  }',
  '  Merge-AuxObject $current ($Patch | ConvertFrom-Json)',
  '  Write-AuxFile $Path (($current | ConvertTo-Json -Depth 32) + "`n")',
  '}',
]

const PS_TEXT_HELPERS = [
  'function Edit-AuxText([string]$Path, [string]$Prepend, [string]$Append, [string[]]$DropTables, [string[]]$DropKeys, [string]$SetTable, [string]$SetLines) {',
  '  $lines = @()',
  '  if (Test-Path -LiteralPath $Path -PathType Leaf) { $lines = [System.IO.File]::ReadAllLines($Path) }',
  '  $out = New-Object System.Collections.Generic.List[string]',
  `  if ($Prepend) { foreach ($line in ($Prepend -split '\\r?\\n')) { $out.Add($line) } }`,
  `  $table = ''; $skip = $false; $done = $false; $blank = 0; $printed = $false`,
  '  foreach ($line in $lines) {',
  `    if ($line -match '^\\s*\\[') {`,
  `      $header = ($line.Trim() -replace '^\\[+\\s*', '') -replace '\\s*\\].*$', ''`,
  '      $table = $header; $skip = $DropTables -contains $header',
  '      if ($skip) { continue }',
  `      for (; $blank -gt 0; $blank--) { $out.Add('') }`,
  '      $out.Add($line); $printed = $true',
  `      if ($SetTable -and $header -eq $SetTable) { foreach ($setLine in ($SetLines -split '\\r?\\n')) { $out.Add($setLine) }; $done = $true }`,
  '      continue',
  '    }',
  '    if ($skip) { continue }',
  '    if ($line.Trim() -eq \'\') { $blank++; continue }',
  `    if ($line -match '^\\s*(?:export\\s+)?"?([^"=\\s]+)"?\\s*=' -and ($DropKeys -contains ($table + '|' + $Matches[1]))) { continue }`,
  `    for (; $blank -gt 0; $blank--) { $out.Add('') }`,
  '    $out.Add($line); $printed = $true',
  '  }',
  '  if ($SetTable -and -not $done) {',
  `    if ($printed) { $out.Add('') }`,
  `    $out.Add('[' + $SetTable + ']')`,
  `    foreach ($setLine in ($SetLines -split '\\r?\\n')) { $out.Add($setLine) }`,
  '  }',
  `  if ($Append) { foreach ($line in ($Append -split '\\r?\\n')) { $out.Add($line) } }`,
  '  Write-AuxFile $Path (($out -join "`n") + "`n")',
  '}',
]

function renderPowerShell(plan: ClientSetupPlan): string {
  const kinds = new Set(plan.steps.map((step) => step.kind))
  const lines: string[] = [
    '& {',
    `# ${plan.name} 一键配置：已有配置文件会先备份为 .bak-时间戳，再合并写入。`,
    `$ErrorActionPreference = 'Stop'`,
    `$auxTmp = Join-Path ([System.IO.Path]::GetTempPath()) ('aux-setup-' + [guid]::NewGuid().ToString('N'))`,
    'New-Item -ItemType Directory -Path $auxTmp | Out-Null',
    ...PS_HELPERS,
    // Windows PowerShell 5.1 会把带扩展类型数据的数组序列化为 {"value":[...],"Count":n}，移除后与 PowerShell 7 一致。
    ...(kinds.has('merge-json') ? ['Remove-TypeData System.Array -ErrorAction SilentlyContinue', ...PS_JSON_HELPERS] : []),
    ...(kinds.has('edit-text') ? PS_TEXT_HELPERS : []),
    'try {',
  ]
  if (plan.warnEnv?.length) {
    lines.push(
      `foreach ($name in ${psArray(plan.warnEnv)}) {`,
      `  if ([Environment]::GetEnvironmentVariable($name)) { Write-Host ('注意：当前已设置环境变量 ' + $name + '，可能与新配置冲突；不再需要时请在系统环境变量中删除。') -ForegroundColor Yellow }`,
      '}',
    )
  }
  for (const step of plan.steps) {
    lines.push(psPath(step.path))
    switch (step.kind) {
      case 'merge-json':
        lines.push(
          ...psHereString('$content', jsonText(step.value).split('\n')),
          'Backup-AuxFile $f',
          `Merge-AuxJson $f $content ${psArray((step.deletes ?? []).map((path) => path.join('/')))}`,
          'Write-Host "已写入 $f"',
        )
        break
      case 'write':
        lines.push(
          ...psHereString('$content', step.content.replace(/\n$/, '').split('\n')),
          'Backup-AuxFile $f',
          'Write-AuxFile $f ($content + "`n")',
          'Write-Host "已写入 $f"',
        )
        break
      case 'edit-text':
        lines.push(
          ...psHereString('$prepend', step.prepend ?? []),
          ...psHereString('$append', step.append ?? []),
          'Backup-AuxFile $f',
          `Edit-AuxText -Path $f -Prepend $prepend -Append $append -DropTables ${psArray(step.dropTables ?? [])} -DropKeys ${psArray((step.dropKeys ?? []).map(keyLine))} -SetTable ${psQuote(step.setTable?.name ?? '')} -SetLines ${psQuote((step.setTable?.lines ?? []).join('\n'))}`,
          'Write-Host "已写入 $f"',
        )
        break
      case 'openclaw-config':
        // npm 在 Windows 同时生成 .cmd 与 .ps1；优先 .cmd，避免默认执行策略拦截 .ps1。
        lines.push(
          '$openclaw = Get-Command openclaw.cmd -ErrorAction SilentlyContinue',
          'if (-not $openclaw) { $openclaw = Get-Command openclaw -ErrorAction SilentlyContinue }',
          `if (-not $openclaw) { throw '未找到 openclaw 命令：请先安装 OpenClaw 并重新打开 PowerShell。' }`,
          'Backup-AuxFile $f',
          ...psHereString('$content', jsonText(step.entries).split('\n')),
          `$batch = Join-Path $auxTmp 'openclaw-batch.json'`,
          'Write-AuxFile $batch $content',
          '& $openclaw.Source config set --batch-file $batch',
          `if ($LASTEXITCODE -ne 0) { throw 'OpenClaw 未保存配置，请查看上方的校验信息。' }`,
        )
        break
    }
  }
  lines.push(
    `Write-Host ''`,
    `Write-Host ${psQuote(`${plan.name} 配置完成。`)} -ForegroundColor Green`,
    `Write-Host ${psQuote(`下一步：${plan.nextStep}`)}`,
    '} catch {',
    `  Write-Host ('配置失败：' + $_.Exception.Message) -ForegroundColor Red`,
    '} finally {',
    '  Remove-Item -LiteralPath $auxTmp -Recurse -Force -ErrorAction SilentlyContinue',
    '}',
    '}',
  )
  return `${lines.join('\n')}\n`
}
