param (
    [int]$Scale = 1,
    [string[]]$Env = @(),
    [switch]$Down
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

if ($Down) {
    Write-Host "[*] Stopping and removing k6 containers..." -ForegroundColor Yellow
    docker compose down
    exit 0
}

if (-not (Test-Path .env)) {
    Write-Error "Chua co .env. Chay: Copy-Item .env.example .env  roi dien gia tri."
    exit 1
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  K6 LOAD TEST - $(Split-Path -Leaf $PSScriptRoot)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "[!] Chi chay tren ha tang ban so huu." -ForegroundColor Red
Write-Host ""

$runArgs = @('compose', 'run', '--rm')
foreach ($kv in $Env) {
    if ($kv) {
        $runArgs += @('-e', $kv)
        Write-Host "[+] $kv" -ForegroundColor Green
    }
}

if ($Scale -gt 1) {
    if ($Env.Count -gt 0) {
        Write-Warning "Scale > 1 chi doc cau hinh tu .env, bo qua -Env."
    }
    Write-Host "[*] Starting $Scale containers..." -ForegroundColor Yellow
    docker compose up --scale k6=$Scale
    docker compose down
} else {
    $runArgs += 'k6'
    & docker $runArgs
}
