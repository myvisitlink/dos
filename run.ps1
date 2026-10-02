param (
    [int]$Scale = 1,
    [string]$Url = "",
    [int]$Vus = 0,
    [string]$Duration = "",
    [switch]$Down
)

if ($Down) {
    Write-Host "[*] Stopping and removing k6 containers..." -ForegroundColor Yellow
    docker compose down
    exit 0
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       K6 DISTRIBUTED LOAD TESTING - IP ROTATION         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Thiết lập biến môi trường tạm thời nếu được truyền vào tham số
if ($Url) {
    $env:TARGET_URL = $Url
    Write-Host "[+] Target URL : $Url" -ForegroundColor Green
}
if ($Vus -gt 0) {
    $env:VUS = $Vus
    Write-Host "[+] VUs per instance : $Vus" -ForegroundColor Green
}
if ($Duration) {
    $env:DURATION = $Duration
    Write-Host "[+] Duration : $Duration" -ForegroundColor Green
}

Write-Host "[+] Scaling instances : $Scale" -ForegroundColor Green
Write-Host "[*] Pulling / Starting k6 runners..." -ForegroundColor Yellow

if ($Scale -le 1) {
    docker compose run --rm k6-runner
} else {
    docker compose up --scale k6-runner=$Scale
    docker compose down
}
