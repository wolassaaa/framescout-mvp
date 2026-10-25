$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$service = Join-Path $repo "target\release\framescout-local-service.exe"
$aiPython = Join-Path $repo "apps\ai-worker\.venv\Scripts\python.exe"
$aiModel = Join-Path $repo "models\yolox_s.onnx"
$serviceHealth = "http://127.0.0.1:4310/api/health"
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
        [int]$TimeoutSeconds = 30,
        [System.Diagnostics.Process]$Process
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-Http -Url $Url) {
            Write-Host "[OK] $Name is ready: $Url" -ForegroundColor Green
            return
        }
        if ($Process -and $Process.HasExited) {
            throw "$Name stopped during startup. Check its terminal output."
        }
        Start-Sleep -Milliseconds 500
    }
    throw "$Name did not become ready within $TimeoutSeconds seconds: $Url"
}

function Stop-OwnedService {
    $listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 4310 -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $listener) {
        return
    }
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
    $processPath = $process.Path
    if (-not $processPath -or (Resolve-Path -LiteralPath $processPath).Path -ne (Resolve-Path -LiteralPath $service).Path) {
        throw "Port 4310 is occupied by another program ($($process.ProcessName), PID $($process.Id)). Close it before starting FrameScout."
    }
    Write-Host "Stopping the previous FrameScout local service..." -ForegroundColor Yellow
    Stop-Process -Id $process.Id
    $process.WaitForExit(5000)
}

Push-Location $repo
try {
    foreach ($command in @("cargo", "npm")) {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Required development command is unavailable: $command"
        }
    }

    if (-not (Test-Path -LiteralPath $aiPython)) {
        Write-Warning "AI Python environment is missing: $aiPython"
    }
    if (-not (Test-Path -LiteralPath $aiModel)) {
        Write-Warning "AI model is missing: $aiModel"
    }

    Write-Host "Building the current FrameScout local service..." -ForegroundColor Cyan
    cargo build -p framescout-local-service --release
    if ($LASTEXITCODE -ne 0) {
        throw "The FrameScout local service build failed."
    }

    Write-Host "Building the current FrameScout Web UI..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "The FrameScout Web UI build failed."
    }

    Stop-OwnedService
    $serviceProcess = Start-Process powershell -PassThru -ArgumentList @(
        "-NoExit",
        "-Command",
        "Set-Location '$repo'; & '$service'"
    )
    Wait-ForHttp -Url $serviceHealth -Name "FrameScout local service" -Process $serviceProcess

    $webProcess = $null
    if (-not (Test-Http -Url $webUrl)) {
        $webProcess = Start-Process powershell -PassThru -ArgumentList @(
            "-NoProfile",
            "-Command",
            "Set-Location '$repo'; npm --workspace @framescout/desktop exec vite -- preview --host 127.0.0.1 --port 5173 --strictPort"
        ) -WindowStyle Hidden
    }
    Wait-ForHttp -Url $webUrl -Name "FrameScout Web UI" -Process $webProcess

    Write-Host "FrameScout is ready. Opening the system browser..." -ForegroundColor Green
    Start-Process $webUrl
} catch {
    Write-Host ""
    Write-Host "FrameScout could not start:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host "Source photos were not changed." -ForegroundColor Yellow
    exit 1
} finally {
    Pop-Location
}
