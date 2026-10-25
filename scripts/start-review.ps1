$ErrorActionPreference = "Stop"

$bundleRoot = Split-Path -Parent $PSScriptRoot
$service = Join-Path $bundleRoot "runtime\framescout-local-service.exe"
$webRoot = Join-Path $bundleRoot "web"
$serviceUrl = "http://127.0.0.1:4310/api/health"
$webUrl = "http://127.0.0.1:5173/"

function Test-Http {
    param([Parameter(Mandatory = $true)][string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
    } catch {
        return $false
    }
}

function Wait-ForHttp {
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [Parameter(Mandatory = $true)][string]$Name,
        [System.Diagnostics.Process]$Process
    )
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
        if (Test-Http -Url $Url) {
            Write-Host "[OK] $Name ready: $Url" -ForegroundColor Green
            return
        }
        if ($Process -and $Process.HasExited) {
            throw "$Name failed to start. Check the local service terminal."
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not become ready within 30 seconds: $Url"
}

function Assert-PortFree {
    param([int]$Port, [string]$Name)
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($listener) {
        throw "$Name port $Port is already in use. Close the existing FrameScout service first."
    }
}

$serviceProcess = $null
$webProcess = $null
try {
    if (-not (Test-Path -LiteralPath $service)) {
        throw "Missing local service: $service"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $webRoot "index.html"))) {
        throw "Missing web build: $webRoot"
    }
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "Python 3 is required to serve the bundled Web UI."
    }

    Assert-PortFree -Port 4310 -Name "local service"
    Assert-PortFree -Port 5173 -Name "Web UI"

    $env:FRAMESCOUT_WEB_ORIGIN = $webUrl.TrimEnd('/')
    $serviceProcess = Start-Process powershell -PassThru -ArgumentList @(
        "-NoExit",
        "-NoProfile",
        "-Command",
        "Set-Location '$bundleRoot'; & '$service'"
    )
    Wait-ForHttp -Url $serviceUrl -Name "FrameScout local service" -Process $serviceProcess

    $webProcess = Start-Process python -PassThru -WindowStyle Hidden -ArgumentList @(
        "-m", "http.server", "5173", "--bind", "127.0.0.1", "--directory", $webRoot
    )
    Wait-ForHttp -Url $webUrl -Name "FrameScout Web UI" -Process $webProcess

    Write-Host "FrameScout review package is running." -ForegroundColor Green
    Write-Host "Web UI: $webUrl" -ForegroundColor Cyan
    Write-Host "The local service terminal shows live progress. Source photos stay read-only." -ForegroundColor Yellow
    Start-Process $webUrl
} catch {
    if ($webProcess -and -not $webProcess.HasExited) { Stop-Process -Id $webProcess.Id -Force -ErrorAction SilentlyContinue }
    if ($serviceProcess -and -not $serviceProcess.HasExited) { Stop-Process -Id $serviceProcess.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "FrameScout review package failed to start: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
