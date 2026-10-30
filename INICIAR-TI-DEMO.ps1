$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
try { $state=Invoke-RestMethod 'http://127.0.0.1:3001/api/health' -TimeoutSec 2; if($state.status -eq 'ok') { Write-Host 'Sistema já disponível: http://127.0.0.1:3001'; return } } catch {}
$env:APP_ENV='demonstracao'
$env:PGLITE_PATH='./data/demo-ti-facilitado'
$env:PORT='3001'
$env:APP_ORIGIN='http://127.0.0.1:3001'
$env:DEMO_TI_FULL_ACCESS='true'
$env:DEMO_DISABLE_TI_MFA='true'
if (-not (Test-Path -LiteralPath 'data/demo-ti-facilitado/PG_VERSION')) { throw 'Base demonstrativa preparada não encontrada. Consulte o registro de progresso.' }
$runtime=Get-Command node -ErrorAction SilentlyContinue
if ($runtime) { & $runtime.Source 'dist/server/main.js' } else {
 $bundledNode=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
 & $bundledNode 'dist/server/main.js'
}
