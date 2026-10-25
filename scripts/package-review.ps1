param(
    [switch]$SkipBuild,
    [string]$OutputRoot
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) {
    $OutputRoot = Join-Path (Split-Path $repo -Parent) "framescout-review-bundles"
}

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed with exit code $LASTEXITCODE."
    }
}

Push-Location $repo
try {
    if (-not $SkipBuild) {
        Write-Host "Building local service..." -ForegroundColor Cyan
        Invoke-Checked "cargo" @("build", "-p", "framescout-local-service", "--release")
        Write-Host "Building Web UI..." -ForegroundColor Cyan
        Invoke-Checked "npm" @("run", "build")
    }

    $service = Join-Path $repo "target\release\framescout-local-service.exe"
    $web = Join-Path $repo "apps\desktop\dist"
    if (-not (Test-Path -LiteralPath $service)) { throw "Missing built local service: $service" }
    if (-not (Test-Path -LiteralPath (Join-Path $web "index.html"))) { throw "Missing built Web UI: $web" }

    New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $bundle = Join-Path $OutputRoot "FrameScout-review-$stamp"
    $source = Join-Path $bundle "source"
    New-Item -ItemType Directory -Force -Path $source, (Join-Path $bundle "runtime"), (Join-Path $bundle "web") | Out-Null

    $excludedDirs = @(
        (Join-Path $repo ".git"),
        (Join-Path $repo "node_modules"),
        (Join-Path $repo "target"),
        (Join-Path $repo "tmp"),
        (Join-Path $repo "test-results"),
        (Join-Path $repo ".pytest_cache"),
        (Join-Path $repo ".playwright-cli"),
        (Join-Path $repo ".superpowers"),
        (Join-Path $repo "apps\ai-worker\.pytest_cache"),
        (Join-Path $repo "apps\ai-worker\.venv"),
        (Join-Path $repo "apps\ai-worker\src\framescout_ai\__pycache__"),
        (Join-Path $repo "apps\ai-worker\tests\__pycache__"),
        (Join-Path $repo "src\framescout\__pycache__"),
        (Join-Path $repo "tests\__pycache__"),
        (Join-Path $repo "apps\desktop\node_modules"),
        (Join-Path $repo "apps\desktop\dist"),
        (Join-Path $repo "apps\desktop\test-results")
    )
    Write-Host "Copying reviewable source without dev dependencies, test caches or model weights..." -ForegroundColor Cyan
    & robocopy $repo $source /E /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD $excludedDirs /XF "*.onnx" "*.db" "*.sqlite" "*.sqlite3" "*.pyc" ".env.local" | Out-Null
    if ($LASTEXITCODE -gt 7) { throw "Source copy failed. robocopy exit code: $LASTEXITCODE" }

    Copy-Item -LiteralPath $service -Destination (Join-Path $bundle "runtime\framescout-local-service.exe") -Force
    Copy-Item -Path (Join-Path $web "*") -Destination (Join-Path $bundle "web") -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repo "scripts\start-review.ps1") -Destination (Join-Path $bundle "START-REVIEW.ps1") -Force
    Copy-Item -LiteralPath (Join-Path $repo "docs\review-package.zh-CN.md") -Destination (Join-Path $bundle "REVIEW.md") -Force

    $manifest = [ordered]@{
        product = "FrameScout"
        packageType = "browser-review"
        createdAt = (Get-Date).ToUniversalTime().ToString("o")
        service = "runtime/framescout-local-service.exe"
        web = "web/index.html"
        source = "source/"
        sourcePhotosIncluded = $false
        modelWeightsIncluded = $false
        excluded = @("node_modules", ".venv", "target", "tmp", "test-results", "*.onnx", "*.db", ".env.local")
        start = "START-REVIEW.ps1"
    }
    $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $bundle "PACKAGE-MANIFEST.json") -Encoding UTF8

    $archive = "$bundle.zip"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Compress-Archive -Path $bundle -DestinationPath $archive -CompressionLevel Optimal
    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        $hashBytes = $sha256.ComputeHash([IO.File]::ReadAllBytes($archive))
    } finally {
        $sha256.Dispose()
    }
    $hashValue = ([BitConverter]::ToString($hashBytes)).Replace("-", "")
    $hashValue | Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII

    $size = (Get-Item -LiteralPath $archive).Length
    Write-Host "Review package created: $archive" -ForegroundColor Green
    Write-Host ("Archive size: {0:N1} MB" -f ($size / 1MB)) -ForegroundColor Green
    Write-Host "SHA-256: $hashValue" -ForegroundColor DarkGray
} finally {
    Pop-Location
}
