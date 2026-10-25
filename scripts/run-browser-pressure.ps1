param(
  [Parameter(Mandatory = $true)]
  [string]$DatabasePath,
  [int]$ServicePort = 4316,
  [int]$WebPort = 5175
)

$ErrorActionPreference = "Stop"
$runRoot = Split-Path -Parent $DatabasePath
$env:FRAMESCOUT_BIND = "127.0.0.1:$ServicePort"
$env:FRAMESCOUT_DB = $DatabasePath
$env:FRAMESCOUT_WEB_ORIGIN = "http://127.0.0.1:$WebPort"
$env:VITE_FRAMESCOUT_API_URL = "http://127.0.0.1:$ServicePort"
$env:VITE_FRAMESCOUT_DEMO_MODE = "false"

$service = Start-Process `
  -FilePath (Join-Path (Get-Location) "target\release\framescout-local-service.exe") `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runRoot "browser-service.out.log") `
  -RedirectStandardError (Join-Path $runRoot "browser-service.err.log")
$web = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("--workspace", "@framescout/desktop", "run", "dev", "--", "--port", [string]$WebPort) `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput (Join-Path $runRoot "browser-web.out.log") `
  -RedirectStandardError (Join-Path $runRoot "browser-web.err.log")

try {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 300
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$ServicePort/api/health" -TimeoutSec 2
      $webStatus = (Invoke-WebRequest "http://127.0.0.1:$WebPort/" -UseBasicParsing -TimeoutSec 2).StatusCode
    } catch {
      $health = $null
      $webStatus = $null
    }
  } until (($health -and $webStatus -eq 200) -or (Get-Date) -gt $deadline)
  if (-not $health -or $webStatus -ne 200) {
    throw "Pressure browser services did not become healthy."
  }
  $browserResult = node scripts\browser-memory-smoke.cjs "http://127.0.0.1:$WebPort/"
  if ($LASTEXITCODE -ne 0) {
    throw "Browser memory smoke test failed."
  }
  $serviceProcess = Get-Process -Id $service.Id
  [pscustomobject]@{
    browser = $browserResult | ConvertFrom-Json
    serviceWorkingMB = [math]::Round($serviceProcess.WorkingSet64 / 1MB, 1)
  } | ConvertTo-Json -Depth 8 -Compress
} finally {
  foreach ($port in @($WebPort, $ServicePort)) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id $_ -ErrorAction SilentlyContinue }
  }
  if (Get-Process -Id $web.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $web.Id -ErrorAction SilentlyContinue
  }
  if (Get-Process -Id $service.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $service.Id -ErrorAction SilentlyContinue
  }
}
