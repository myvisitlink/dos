# K6 Distributed Load Testing với Xoay IP Ngẫu Nhiên

Hệ thống kiểm thử tải (Stress test / Load test) phân tán bằng Docker với k6, tích hợp cơ chế xoay IP header ngẫu nhiên (`X-Forwarded-For`, `CF-Connecting-IP`, `X-Real-IP`, `True-Client-IP`, `Fastly-Client-IP`) để kiểm tra cơ chế chặn IP (Rate Limiting) của hạ tầng web.

---

## 📁 Cấu trúc thư mục

*   [docker-compose.yml](file:///c:/Work/dos/docker-compose.yml): Cấu hình chạy k6 service, hỗ trợ scale đa container.
*   [test-script.js](file:///c:/Work/dos/test-script.js): Kịch bản k6, tự động sinh Public IPv4 ngẫu nhiên cho mỗi request và thu thập metrics (2xx, 429, 403, 5xx).
*   [.env](file:///c:/Work/dos/.env): File cấu hình mục tiêu (Target URL, số lượng Virtual Users, thời gian test, phương thức HTTP).
*   [run.ps1](file:///c:/Work/dos/run.ps1): Script PowerShell hỗ trợ chạy nhanh với 1 dòng lệnh.

---

## 🚀 Hướng dẫn sử dụng

### Cách 1: Sử dụng script `run.ps1` (Khuyên dùng trên Windows)

1. **Chạy test cơ bản (1 instance, đọc cấu hình từ .env):**
   ```powershell
   .\run.ps1
   ```

2. **Chạy phân tán với 4 instances (mỗi instance chạy VUs độc lập):**
   ```powershell
   .\run.ps1 -Scale 4
   ```

3. **Chạy test nhanh với URL cụ thể:**
   ```powershell
   .\run.ps1 -Scale 3 -Url "https://your-website.com/api/test" -Vus 20 -Duration "1m"
   ```

4. **Dọn dẹp container:**
   ```powershell
   .\run.ps1 -Down
   ```

---

### Cách 2: Sử dụng Docker Compose trực tiếp

1. **Chỉnh sửa file `.env`:**
   Mở file [.env](file:///c:/Work/dos/.env) và điền URL trang web của bạn:
   ```env
   TARGET_URL=https://your-website.com
   VUS=10
   DURATION=30s
   ```

2. **Chạy 1 instance đơn:**
   ```powershell
   docker compose run --rm k6-runner
   ```

3. **Scale phân tán nhiều container song song (ví dụ: 4 instances):**
   ```powershell
   docker compose up --scale k6-runner=4
   ```

---

## 📊 Các chỉ số được theo dõi trong báo cáo k6

Khi test kết thúc, k6 sẽ xuất bảng thống kê gồm:
*   `success_2xx`: Tổng số request thành công (Mã 200 - 299).
*   `rate_limited_429`: Số request bị hệ thống chặn do chạm giới hạn Rate Limit (Mã 429).
*   `blocked_403`: Số request bị tường lửa/WAF cấm (Mã 403).
*   `errors_5xx`: Số request gây sập/lỗi server (Mã 500 - 504).
*   `http_req_duration`: Thời gian phản hồi trung bình (p90, p95).
