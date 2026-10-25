param(
    [switch]$NoBundle
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = "x86_64-pc-windows-msvc"
$sidecarDir = Join-Path $repo "apps\desktop\src-tauri\binaries"
$sidecar = Join-Path $sidecarDir "framescout-local-service-$target.exe"

Push-Location $repo
try {
    New-Item -ItemType Directory -Force -Path $sidecarDir | Out-Null
    cargo build -p framescout-local-service --release
    Copy-Item (Join-Path $repo "target\release\framescout-local-service.exe") $sidecar -Force

    $env:VITE_FRAMESCOUT_API_URL = "http://127.0.0.1:4310"
    if ($NoBundle) {
        npm --workspace @framescout/desktop exec tauri -- build --no-bundle
    } else {
        npm --workspace @framescout/desktop exec tauri -- build
    }
} finally {
    Pop-Location
}
