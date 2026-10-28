# thanhhuyreal — PHP login có CSRF

## Flow thật của site

```
GET  /?auth=login    -> Set-Cookie PHPSESSID + csrf_token trong HTML
POST /model/login     -> form-urlencoded: csrf_token, identifier, password
```

Script làm đúng flow này: mỗi VU `GET` trang login để lấy `PHPSESSID` + `csrf_token` của riêng nó, rồi mới `POST`.

## Vì sao không replay thẳng cái curl đã bắt

1. `PHPSESSID` dùng chung → PHP **session lock** serialize các request → kết quả đo sai (server trông rất chậm nhưng thực chất là xếp hàng chờ lock).
2. `csrf_token` gắn với session; dùng chéo session sẽ bị từ chối.
3. Nếu `FRESH_SESSION=true` (mặc định) thì mỗi lần login là **2 request** (GET + POST) → rps thực tế gấp đôi `STAGES`.

## Chạy

```bash
# Linux / macOS
cp .env.example .env
# điền PHP_IDENTIFIER / PHP_PASSWORD
./run.sh
```

```powershell
# Windows
.\run.ps1
```

Override:

```bash
./run.sh -e STAGES=30s:50,60s:200 -e MAX_VUS=400
```

## Account

`PHP_IDENTIFIER` là email hoặc số điện thoại. `PHP_PASSWORD` là mật khẩu.

Nên dùng **account user riêng**, không dùng admin. Mỗi lần login thành công tạo một session mới — chạy dài sẽ làm phình bảng/file session.

Nếu account bật 2FA, script sẽ đếm vào `php_login_2fa_required` và không đăng nhập được.

## Metric

| Metric | Ý nghĩa |
|---|---|
| `php_login_ok` | Login thành công (`status:true`) |
| `php_login_denied` | Server từ chối (sai mật khẩu / không tồn tại) |
| `php_login_2fa_required` | Account đang bật 2FA |
| `php_csrf_fail` | Token bị từ chối (script tự lấy token mới) |
| `php_page_fail` | Không GET được trang login hoặc không parse được token |
| `php_429 / php_403` | Bị rate limit / chặn |
| `php_5xx` | Lỗi server thật |
| `php_login_duration` | Thời gian POST login |
| `php_page_duration` | Thời gian GET trang login |
| `ban_first_at_s`, `ban_at_rps` | Thời điểm và mức tải lúc bị chặn |

## Ghi chú

- `FRESH_SESSION=false` sẽ nhanh hơn (chỉ đo POST) nhưng sau lần login đầu VU đã ở trạng thái đăng nhập — kết quả ít giống thực tế.
- Trang login render nặng hơn POST login; nếu `php_page_duration` cao hơn nhiều thì điểm gãy nằm ở tầng render, không phải bcrypt.
