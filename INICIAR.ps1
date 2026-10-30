$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.env')) { throw 'Instale conforme README.md e gere a configuração antes de iniciar.' }
if (-not (Test-Path -LiteralPath 'dist/server/main.js')) { throw 'Execute npm run build antes de iniciar.' }
$runtime = Get-Command node -ErrorAction SilentlyContinue
if ($runtime) { & $runtime.Source 'dist/server/main.js' } else {
  $bundledNode = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
  if (-not (Test-Path -LiteralPath $bundledNode)) { throw 'Instale Node.js 22 ou superior.' }
  & $bundledNode 'dist/server/main.js'
}
