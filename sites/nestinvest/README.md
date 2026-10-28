# nestinvest — `POST /api/v1/auth/login`

## Target

```
POST https://mice.3nestinvest.com/api/v1/auth/login
{"email":"...","password":"..."}
```

Endpoint login là đường **unauthenticated** duy nhất buộc backend phải query DB + bcrypt. Đánh vào đây có ý nghĩa hơn nhiều so với `/auth/refresh` (trả 404/401 ngay, không chạm DB).

## Chạy

```bash
# Linux / macOS
cp .env.example .env      # nếu chưa có
./run.sh

# Windows
.\run.ps1
```

Override:

```bash
./run.sh -e STAGES=30s:100,60s:500 -e MAX_VUS=500
```

```powershell
.\run.ps1 -Env STAGES=30s:100,60s:500,MAX_VUS=500
```

## Account

Để trống `TEST_EMAIL`/`TEST_PASSWORD` → dùng email random + sai mật khẩu (không cần account). Điền cả 2 → dùng account thật (mỗi lần login thành công tạo 1 session).

## Metric

| Metric | Ý nghĩa |
|---|---|
| `ban_first_at_s` (min) | Giây thứ mấy thì bị 403/429 lần đầu |
| `ban_at_rps` | Ước lượng req/s lúc bị ban |
| `banned_rate` | Tỷ lệ request bị chặn |
| `login_5xx_rate` | Lỗi server thật |
| `login_timeout_rate` | Request không phản hồi |
| `login_2xx / 400 / 401 / 403 / 429 / 5xx` | Phân bố status |

`401` là kết quả **đúng** khi dùng sai mật khẩu → bỏ qua `http_req_failed` (k6 tính 401 là failed nên metric đó ~100%).

## Ghi chú

- `SPOOF_HEADERS=true` chỉ có tác dụng nếu server tin header. Dùng `tools/probe-ban-bypass.sh` để kết luận.
- RTT từ máy bạn tới server ~250ms → 1 VU chỉ đạt ~4 req/s. Dùng `STAGES` theo rps, đừng nghĩ theo VU.
