param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(500, 1000)]
  [int]$Count,
  [int]$Port = 4315,
  [string]$Source = "G:\F1"
)

$ErrorActionPreference = "Stop"
$testRoot = Join-Path (Get-Location) ("tmp\pressure-{0}-{1}" -f $Count, [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $testRoot | Out-Null
$databasePath = Join-Path $testRoot "framescout.db"
$stdoutPath = Join-Path $testRoot "service.out.log"
$stderrPath = Join-Path $testRoot "service.err.log"
$sourceBefore = Get-Item -LiteralPath $Source

$env:FRAMESCOUT_BIND = "127.0.0.1:$Port"
$env:FRAMESCOUT_DB = $databasePath
$env:FRAMESCOUT_IMPORT_LIMIT = [string]$Count
$env:FRAMESCOUT_WEB_ORIGIN = "http://127.0.0.1:5175"

$service = Start-Process `
  -FilePath (Join-Path (Get-Location) "target\release\framescout-local-service.exe") `
  -PassThru `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath

try {
  $deadline = (Get-Date).AddSeconds(30)
  do {
    Start-Sleep -Milliseconds 250
    try {
      $health = Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
    } catch {
      $health = $null
    }
  } until ($health -or (Get-Date) -gt $deadline)
  if (-not $health) {
    throw "Local service health check timed out. See $stderrPath"
  }

  $body = @{
    input = @{
      name = "G-F1 read-only $Count"
      preset = "motorsport"
      roots = @($Source)
      rawRoots = @()
      settings = @{
        keepOriginalsUntouched = $true
        cacheLimitMb = 2048
        selectionTargetCount = 50
      }
    }
  } | ConvertTo-Json -Depth 8

  $started = Get-Date
  $created = Invoke-RestMethod `
    "http://127.0.0.1:$Port/api/commands/project_create" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body `
    -TimeoutSec 30
  $projectId = $created.project.id
  $firstPreviewMs = $null
  $peakWorkingSet = 0
  $lastStatus = $null
  $deadline = (Get-Date).AddMinutes(12)

  do {
    Start-Sleep -Milliseconds 500
    $statusBody = @{ projectId = $projectId } | ConvertTo-Json
    $lastStatus = Invoke-RestMethod `
      "http://127.0.0.1:$Port/api/commands/project_index_status" `
      -Method Post `
      -ContentType "application/json" `
      -Body $statusBody `
      -TimeoutSec 10
    $process = Get-Process -Id $service.Id -ErrorAction Stop
    $peakWorkingSet = [math]::Max($peakWorkingSet, [double]$process.WorkingSet64)
    if ($null -eq $firstPreviewMs -and $lastStatus.previewsReady -gt 0) {
      $firstPreviewMs = [int]((Get-Date) - $started).TotalMilliseconds
    }
  } until ($lastStatus.state -ne "indexing" -or (Get-Date) -gt $deadline)

  $sourceAfter = Get-Item -LiteralPath $Source
  [pscustomobject]@{
    projectId = $projectId
    state = $lastStatus.state
    discovered = $lastStatus.discovered
    indexed = $lastStatus.indexed
    previewsReady = $lastStatus.previewsReady
    failed = $lastStatus.failed
    firstPreviewMs = $firstPreviewMs
    elapsedSeconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    peakServiceMB = [math]::Round($peakWorkingSet / 1MB, 1)
    sourceDirectoryTimestampUnchanged = $sourceBefore.LastWriteTimeUtc -eq $sourceAfter.LastWriteTimeUtc
    databasePath = $databasePath
    serviceLog = $stdoutPath
  } | ConvertTo-Json -Compress
} finally {
  if (Get-Process -Id $service.Id -ErrorAction SilentlyContinue) {
    Stop-Process -Id $service.Id
  }
}
