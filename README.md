# Load test — mỗi site một folder

Mỗi site là một folder tự chứa trong `sites/`: `.env` riêng, script k6 riêng, `docker-compose.yml` riêng, chạy độc lập và không ảnh hưởng nhau.

```
.
├── sites/
│   ├── nestinvest/          # POST /api/v1/auth/login (JSON)
│   │   ├── .env             # gitignored
│   │   ├── .env.example
│   │   ├── test-script.js
│   │   ├── docker-compose.yml
│   │   ├── run.sh           # Linux / macOS
│   │   ├── run.ps1          # Windows
│   │   └── README.md
│   └── thanhhuyreal/        # PHP login có CSRF
│       └── ... (cùng cấu trúc)
├── tools/
│   ├── probe-ban-bypass.sh
│   └── probe-ban-bypass.ps1
├── .gitignore
└── README.md
```

## Chạy

### Linux / macOS

```bash
cd sites/nestinvest
cp .env.example .env        # lần đầu
./run.sh
```

Nếu `permission denied`:

```bash
chmod +x run.sh
```

### Windows

```powershell
cd sites\nestinvest
Copy-Item .env.example .env  # lần đầu
.\run.ps1
```

### Override cấu hình mà không sửa `.env`

```bash
./run.sh -e STAGES=30s:100,60s:500 -e MAX_VUS=500
```

```powershell
.\run.ps1 -Env STAGES=30s:100,60s:500,MAX_VUS=500
```

### Scale nhiều container

```bash
./run.sh --scale 4     # chỉ đọc cấu hình từ .env
```

### Dừng / dọn dẹp

```bash
./run.sh --down
```

## Thêm site mới

1. Tạo folder: `sites/<ten-site>/`
2. Copy 5 file từ một site có sẵn: `test-script.js`, `docker-compose.yml`, `run.sh`, `run.ps1`, `.env.example`
3. Sửa `test-script.js` cho đúng flow của site (endpoint, body, cách lấy token…)
4. `cp .env.example .env` rồi điền
5. `chmod +x run.sh` (Linux)

Mỗi folder là một Docker Compose project riêng (tên project lấy theo tên folder), nên container/network không đụng nhau.

## Yêu cầu

- Docker + Docker Compose v2 (`docker compose`, không phải `docker-compose`)
- k6 chạy trong container, không cần cài trên máy

### Lưu ý trên Linux

- File `.sh` cần quyền thực thi: `chmod +x run.sh`
- Repo đã có `.gitattributes` buộc `*.sh` dùng LF, tránh lỗi `bad interpreter: /usr/bin/env: 'bash\r'`
- Nếu chạy trong WSL, Docker Desktop phải bật WSL integration

## Nguyên tắc chung của cả 2 site

- Đo theo **req/s** (`ramping-arrival-rate`), không theo số VU — VU chỉ là hệ quả của RTT.
- Chỉ chạy trên hạ tầng bạn sở hữu.
- `.env` chứa credential và đã được gitignore. Không commit.

## Tools

`tools/probe-ban-bypass.sh` (Linux) / `.ps1` (Windows): kiểm tra rate limit có bị bypass bằng `X-Forwarded-For` / `CF-Connecting-IP` / `Forwarded` hay không. Script này **cố tình** kích hoạt ban IP của máy đang chạy.

```bash
BASE_URL=https://example.com/api/v1 ./tools/probe-ban-bypass.sh
```
