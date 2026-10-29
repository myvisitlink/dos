# FlareSolverr Server Setup - Ubuntu + Cloudflare Tunnel

Hướng dẫn cài FlareSolverr trên Ubuntu homelab và expose ra ngoài qua Cloudflare Tunnel để GitHub Actions gọi được.

---

## 1. Cài Docker trên Ubuntu Server

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Cài Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user vào docker group (không cần sudo)
sudo usermod -aG docker $USER
newgrp docker

# Test Docker
docker run hello-world
```

---

## 2. Cài FlareSolverr

```bash
# Tạo thư mục cho FlareSolverr
mkdir -p ~/flaresolverr
cd ~/flaresolverr

# Tạo docker-compose.yml
cat > docker-compose.yml << 'EOF'
version: '3.8'

services:
  flaresolverr:
    image: ghcr.io/flaresolverr/flaresolverr:latest
    container_name: flaresolverr
    restart: unless-stopped
    ports:
      - "8191:8191"
    environment:
      - LOG_LEVEL=info
      - LOG_HTML=false
      - CAPTCHA_SOLVER=none
      - TZ=Asia/Ho_Chi_Minh
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8191/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Start FlareSolverr
docker compose up -d

# Xem logs
docker compose logs -f
```

**Test local:**
```bash
curl http://localhost:8191/health
# Phải trả về: {"status":"ok"}

# Test bypass Cloudflare
curl -X POST http://localhost:8191/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "request.get",
    "url": "https://thanhhuyreal.com",
    "maxTimeout": 60000
  }'
```

---

## 3. Cài Cloudflare Tunnel (cloudflared)

### 3.1. Cài cloudflared

```bash
# Download cloudflared
wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb

# Cài đặt
sudo dpkg -i cloudflared-linux-amd64.deb

# Verify
cloudflared --version
```

### 3.2. Login Cloudflare

```bash
# Login vào Cloudflare account
cloudflared tunnel login
```

**Lệnh này sẽ:**
1. Mở browser để login Cloudflare
2. Chọn domain bạn muốn dùng
3. Tạo cert file tại `~/.cloudflared/cert.pem`

### 3.3. Tạo Tunnel

```bash
# Tạo tunnel mới
cloudflared tunnel create flaresolverr-tunnel

# Lưu lại TUNNEL_ID từ output
# Ví dụ: Created tunnel flaresolverr-tunnel with id a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

### 3.4. Tạo config file

```bash
# Tạo config directory
sudo mkdir -p /etc/cloudflared

# Tạo config file
sudo nano /etc/cloudflared/config.yml
```

**Paste nội dung này vào `config.yml`:**

```yaml
tunnel: TUNNEL_ID_CUA_BAN
credentials-file: /home/YOUR_USERNAME/.cloudflared/TUNNEL_ID_CUA_BAN.json

ingress:
  - hostname: flaresolverr.YOUR_DOMAIN.com
    service: http://localhost:8191
  - service: http_status:404
```

**Thay thế:**
- `TUNNEL_ID_CUA_BAN` → tunnel ID từ bước 3.3
- `YOUR_USERNAME` → username Ubuntu của bạn
- `YOUR_DOMAIN.com` → domain Cloudflare của bạn

### 3.5. Tạo DNS record

```bash
# Tạo DNS CNAME record trỏ về tunnel
cloudflared tunnel route dns flaresolverr-tunnel flaresolverr.YOUR_DOMAIN.com
```

### 3.6. Chạy tunnel như systemd service

```bash
# Install service
sudo cloudflared service install

# Start service
sudo systemctl start cloudflared

# Enable auto-start
sudo systemctl enable cloudflared

# Check status
sudo systemctl status cloudflared

# Xem logs
sudo journalctl -u cloudflared -f
```

---

## 4. Test từ bên ngoài

```bash
# Test health endpoint
curl https://flaresolverr.YOUR_DOMAIN.com/health

# Test bypass Cloudflare
curl -X POST https://flaresolverr.YOUR_DOMAIN.com/v1 \
  -H "Content-Type: application/json" \
  -d '{
    "cmd": "request.get",
    "url": "https://thanhhuyreal.com",
    "maxTimeout": 60000
  }'
```

**Nếu thành công, bạn sẽ thấy response có:**
```json
{
  "status": "ok",
  "message": "",
  "solution": {
    "url": "https://thanhhuyreal.com",
    "status": 200,
    "cookies": [
      {
        "name": "cf_clearance",
        "value": "..."
      }
    ],
    "userAgent": "..."
  }
}
```

---

## 5. Bảo mật (IMPORTANT!)

### Option 1: Cloudflare Access (FREE - RECOMMENDED)

```bash
# Vào Cloudflare Dashboard → Zero Trust → Access → Applications
# Tạo Application mới:
# - Name: FlareSolverr API
# - Subdomain: flaresolverr
# - Domain: YOUR_DOMAIN.com
# - Policy: Allow GitHub IPs only
```

**GitHub Actions IP ranges:** https://api.github.com/meta
```json
{
  "actions": [
    "4.175.114.51/32",
    "13.64.0.0/11",
    "20.*.*.*/14",
    ...
  ]
}
```

### Option 2: API Key authentication

Thêm vào docker-compose.yml:
```yaml
environment:
  - API_KEY=YOUR_SECRET_API_KEY_HERE
```

Khi gọi API phải thêm header:
```bash
curl -H "X-API-Key: YOUR_SECRET_API_KEY_HERE" ...
```

### Option 3: Firewall chỉ cho GitHub IPs

```bash
# Cài ufw
sudo apt install ufw -y

# Allow SSH trước (QUAN TRỌNG!)
sudo ufw allow 22/tcp

# Allow GitHub Actions IPs (ví dụ)
sudo ufw allow from 4.175.114.0/24 to any port 8191
sudo ufw allow from 13.64.0.0/11 to any port 8191

# Enable firewall
sudo ufw enable
```

---

## 6. Monitoring & Maintenance

### Check logs
```bash
# FlareSolverr logs
docker compose logs -f flaresolverr

# Cloudflared logs
sudo journalctl -u cloudflared -f
```

### Restart services
```bash
# Restart FlareSolverr
cd ~/flaresolverr
docker compose restart

# Restart cloudflared
sudo systemctl restart cloudflared
```

### Update FlareSolverr
```bash
cd ~/flaresolverr
docker compose pull
docker compose up -d
```

---

## 7. Usage trong GitHub Actions

Sau khi setup xong, URL FlareSolverr của bạn sẽ là:

```
https://flaresolverr.YOUR_DOMAIN.com
```

**Test từ GitHub Actions:**

```yaml
- name: Test FlareSolverr
  run: |
    curl -X POST https://flaresolverr.YOUR_DOMAIN.com/v1 \
      -H "Content-Type: application/json" \
      -d '{
        "cmd": "request.get",
        "url": "https://thanhhuyreal.com",
        "maxTimeout": 60000
      }'
```

---

## Troubleshooting

### FlareSolverr không start
```bash
docker compose logs flaresolverr
# Check RAM: FlareSolverr cần ít nhất 2GB RAM
free -h
```

### Cloudflare Tunnel không connect
```bash
# Check config
sudo cat /etc/cloudflared/config.yml

# Check credentials file có tồn tại không
ls -la ~/.cloudflared/

# Restart tunnel
sudo systemctl restart cloudflared
sudo journalctl -u cloudflared -n 50
```

### DNS không resolve
```bash
# Check DNS record
nslookup flaresolverr.YOUR_DOMAIN.com

# Xóa và tạo lại DNS
cloudflared tunnel route dns flaresolverr-tunnel flaresolverr.YOUR_DOMAIN.com
```

### Timeout khi gọi API
- Tăng `maxTimeout` trong request (max 60000)
- Check RAM server (FlareSolverr cần nhiều RAM khi load)
- Check logs: `docker compose logs -f`

---

## Hoàn tất!

Sau khi setup xong, bạn có:
- ✅ FlareSolverr chạy 24/7 trên homelab
- ✅ Public API qua Cloudflare Tunnel (HTTPS, không cần open port)
- ✅ GitHub Actions gọi được từ bất cứ đâu
- ✅ Bypass Cloudflare tự động cho bất kỳ website nào

**URL của bạn:** `https://flaresolverr.YOUR_DOMAIN.com/v1`

Cho t biết URL này, t sẽ update workflow để dùng server này thay vì start FlareSolverr mỗi lần!
