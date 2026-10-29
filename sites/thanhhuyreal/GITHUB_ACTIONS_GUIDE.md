# Load Testing GitHub Actions - thanhhuyreal.com

## ✨ Hoàn toàn tự động - Zero config!

**FlareSolverr tự động bypass Cloudflare + refresh cookie mỗi 25 phút**

---

## 🚀 Cách dùng (2 bước)

### 1. Vào GitHub Repository → Actions → "HTTP Flood — thanhhuyreal"

### 2. Click "Run workflow" → Chọn config:

```yaml
Mode: login_flood        # hoặc auth_api_flood
Runners: 5               # Số runner (mỗi runner = 1 IP Azure)
Max VUs: 2000            # VUs mỗi runner
Stages: (để trống)       # Dùng default
```

### 3. Click "Run workflow" → **Done!**

**Zero manual work:**
- ✅ FlareSolverr tự động bypass Cloudflare
- ✅ Cookie refresh mỗi 25 phút
- ✅ Credentials hardcoded (lonussystem)
- ✅ Test chạy 6 giờ liên tục

---

## 🎯 2 Modes

### Mode: **login_flood**

**Spam login endpoint**
- 10,000 VUs (5 runners × 2000)
- ~2,500 login/giây
- Mỗi VU: GET login page → POST login

**Load tạo:**
- bcrypt password verify (CPU intensive)
- Session creation (DB writes)
- CSRF token generation

**Khi nào dùng:**
- Test login rate limit
- Test bcrypt performance
- Warm-up trước test nặng

---

### Mode: **auth_api_flood**

**Spam 3 POST APIs thực tế**
- 25,000 VUs (5 runners × 5000)
- ~15,000 API requests/giây
- 70% POST APIs + 30% GET pages

**API targets:**
```
POST /model/account/purchase  - Mua account
  → Check stock, create transaction, update DB
  → Nặng nhất: 3-5 DB queries/request

POST /model/discount/apply    - Apply discount code
  → Verify code, calculate price, check usage limit
  → 2-3 DB queries + business logic

POST /model/login             - Login spam
  → bcrypt verify (CPU), session create
  → Same as login_flood but concurrent với APIs khác
```

**Load tạo:**
- **Database writes** (INSERT transactions)
- **bcrypt CPU load** (login spam)
- **Business logic** (stock check, discount validation)
- **Race conditions** (concurrent purchase same item)

**Khi nào dùng:**
- **Stress test thật sự**
- Test transaction isolation
- Tìm race conditions
- Test concurrent writes

---

## 🔄 Auto Cloudflare Bypass

### Workflow tự động:

```
[Setup FlareSolverr]
     ↓
[Get cf_clearance initial]
     ↓
[Start refresh daemon]
    while true; do
      sleep 1500  # 25 phút
      refresh cookie → save to file
    done
     ↓
[k6 test đọc cookie từ file mỗi request]
```

**Result:** Test 6h không bị 403!

---

## 📊 Metrics

### Login flood:
```
php_login_ok      - Success
php_403/429       - Banned
php_login_duration- Latency
```

### Auth API flood:
```
req_2xx           - Success
req_5xx           - Server error
error_rate        - Error ratio
req_duration      - Latency
```

---

## 🎛️ Custom Stages

### Quick (5 phút):
```
10s:100,30s:500,60s:1000,3m:1000
```

### Stress (1 giờ):
```
1m:500,5m:2000,10m:5000,44m:5000
```

### Max (6 giờ):
```
30s:1000,1m:3000,358m:3000
```

### Extreme (phá server):
```yaml
Runners: 10
Max VUs: 8000
Stages: 1m:2000,5m:5000,354m:5000
```
→ **80,000 VUs = ~50,000 API requests/giây!**

---

## ⚠️ Troubleshooting

### Cookie refresh fail
```
[12:25:00] ✗ Failed to refresh cookie
```
→ Sau 30p sẽ 403, chạy lại workflow

### Server overload
```
req_5xx > 50%
req_duration > 10s
```
→ **Success!** Tìm ra giới hạn

### Cloudflare ban
```
php_403 > 90%
```
→ Giảm runners hoặc max_vus

---

## 📈 Expected Results

### ✅ Server ổn:
```
error_rate: <10%
req_duration: avg <1s
→ Can handle 15,000 rps
```

### ⚠️ Server quá tải:
```
error_rate: >50%
req_5xx: high
req_duration: >5s
→ Bottleneck found! Scale server
```

### ❌ Cloudflare chặn:
```
php_403: >90%
→ Lower rate or more IPs
```

---

## 🎯 Why auth_api_flood "nặng hơn"?

### login_flood:
```
2 endpoints × simple query = Light
GET /login + POST /login
→ 1 bcrypt verify per request
```

### auth_api_flood:
```
3 POST APIs × complex logic = Heavy
POST /purchase → 5 DB queries + transaction
POST /discount → 3 DB queries + calculation  
POST /login → bcrypt + session

→ 70% traffic spam APIs
→ Database writes (not just reads)
→ Race conditions testing
→ 3-5x database load
```

---

## 🚀 Ready?

1. GitHub Actions
2. "HTTP Flood — thanhhuyreal"
3. Pick mode
4. Run! 🔥

**Zero config, maximum damage!** ✨
