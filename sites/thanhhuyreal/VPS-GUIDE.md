# VPS Load Testing Guide - thanhhuyreal.com

Hướng dẫn setup và chạy k6 load test trên VPS (Ubuntu) với FlareSolverr local để bypass Cloudflare.

---

## Yêu cầu VPS

- **OS**: Ubuntu 22.04 LTS (hoặc tương tự)
- **RAM**: Tối thiểu 4GB (khuyên dùng 8GB+ cho 10k VUs)
- **CPU**: 4 cores+ (càng nhiều càng tốt)
- **Network**: 1Gbps+ bandwidth
- **Provider gợi ý**: Vultr, DigitalOcean, Hetzner, AWS EC2

---

## Setup VPS (1 lần duy nhất)

### Bước 1: Tải repo

```bash
cd ~
git clone https://github.com/myvisitlink/dos.git
cd dos/sites/thanhhuyreal
```

### Bước 2: Chạy setup script

```bash
chmod +x vps-setup.sh
bash vps-setup.sh
```

Script sẽ:
- Cài Docker
- Cài k6
- Tune network parameters (ulimit, sysctl)
- Start FlareSolverr container
- Cấu hình system

### Bước 3: Logout và login lại

```bash
exit
# SSH lại vào VPS
ssh user@your-vps-ip
```

### Bước 4: Verify setup

```bash
# Check Docker
docker ps | grep flaresolverr

# Check FlareSolverr
curl http://localhost:8191/health
# Expected: {"status":"ok"}

# Check k6
k6 version

# Check ulimit
ulimit -n
# Expected: 1048576
```

---

## Chạy Load Test

### Cách 1: Chạy với config mặc định

```bash
cd ~/dos/sites/thanhhuyreal
chmod +x vps-run.sh
bash vps-run.sh
```

### Cách 2: Custom config

```bash
# 20k VUs, 30 phút ramp-up, 6 giờ sustained
STAGES="30m:20000,360m:20000" \
MAX_VUS="20000" \
PRE_VUS="2000" \
bash vps-run.sh
```

### Cách 3: Chạy nhiều instance song song

```bash
# Terminal 1
bash vps-run.sh &

# Terminal 2
bash vps-run.sh &

# Terminal 3
bash vps-run.sh &

# => 3x traffic
```

---

## Config Parameters

| Variable | Default | Description |
|----------|---------|-------------|
| `STAGES` | `30s:500,60s:2000,120s:5000,360m:5000` | k6 stages (ramp-up pattern) |
| `START_RATE` | `100` | Initial requests/second |
| `PRE_VUS` | `500` | Pre-allocated VUs |
| `MAX_VUS` | `10000` | Max VUs |
| `REQUEST_TIMEOUT` | `30s` | Request timeout |
| `MAX_ERR_RATE` | `0.9` | Max error rate threshold (0-1) |

---

## Stages Examples

### Test nhẹ (warmup)
```bash
STAGES="10s:10,20s:50,30s:100" \
MAX_VUS="100" \
bash vps-run.sh
```

### Test trung bình
```bash
STAGES="30s:500,60s:2000,300s:2000" \
MAX_VUS="2000" \
bash vps-run.sh
```

### Test nặng (6 giờ liên tục)
```bash
STAGES="2m:1000,5m:5000,10m:10000,360m:10000" \
MAX_VUS="10000" \
PRE_VUS="1000" \
bash vps-run.sh
```

### Test cực nặng (20k VUs)
```bash
STAGES="5m:5000,10m:15000,15m:20000,360m:20000" \
MAX_VUS="20000" \
PRE_VUS="2000" \
bash vps-run.sh
```

---

## Monitoring

### Realtime metrics (terminal)

k6 sẽ hiển thị metrics mỗi 10 giây:
```
     data_received..................: 1.2 GB  15 MB/s
     data_sent......................: 180 MB  2.2 MB/s
     http_req_duration..............: avg=1.2s    min=100ms   max=10s
     http_reqs......................: 450000  5000/s
     vus............................: 5000    min=500     max=5000
```

### Check system resources

```bash
# CPU & RAM
htop

# Network
iftop

# Connections
ss -s
```

### View results file

```bash
# JSON results
cat results-*.json | jq '.metrics.http_reqs'

# Summary
cat results-*.json | jq '.metrics | to_entries[] | select(.value.type == "counter")'
```

---

## Troubleshooting

### FlareSolverr không chạy

```bash
docker logs flaresolverr
docker restart flaresolverr
```

### k6 báo lỗi "too many open files"

```bash
ulimit -n 1048576
# Hoặc logout/login lại
```

### Cookie cf_clearance hết hạn giữa chừng

```bash
# Stop test (Ctrl+C)
# Restart - script sẽ tự get cookie mới
bash vps-run.sh
```

### VPS bị lag/chậm

```bash
# Check CPU
top

# Check RAM
free -h

# Check disk I/O
iostat -x 1

# Giảm MAX_VUS xuống
```

### Target website down/timeout

- Giảm `MAX_VUS`
- Tăng `REQUEST_TIMEOUT`
- Kiểm tra xem website có block IP VPS không

---

## Advanced: Multiple VPS

Nếu muốn tăng traffic x10, thuê nhiều VPS:

```bash
# VPS 1: 20k VUs
STAGES="15m:20000,360m:20000" MAX_VUS="20000" bash vps-run.sh

# VPS 2: 20k VUs  
STAGES="15m:20000,360m:20000" MAX_VUS="20000" bash vps-run.sh

# VPS 3: 20k VUs
STAGES="15m:20000,360m:20000" MAX_VUS="20000" bash vps-run.sh

# => 60k VUs total
```

**Lưu ý**: Mỗi VPS có IP khác nhau → bypass Cloudflare tốt hơn

---

## Cost Estimate

| Provider | Spec | Cost | Max VUs |
|----------|------|------|---------|
| Vultr | 4 vCPU, 8GB RAM | $24/mo | ~10k |
| DigitalOcean | 8 vCPU, 16GB RAM | $96/mo | ~20k |
| Hetzner | 8 vCPU, 32GB RAM | $30/mo | ~30k |
| AWS EC2 (c5.2xlarge) | 8 vCPU, 16GB RAM | ~$0.34/hr | ~20k |

**Gợi ý**: Dùng AWS EC2 spot instance (rẻ hơn 70%) cho test ngắn hạn.

---

## So sánh: VPS vs GitHub Actions

| | VPS | GitHub Actions |
|---|-----|----------------|
| **Max VUs/runner** | 10k-20k | 2k-5k |
| **Thời gian** | Không giới hạn | 6h max |
| **IP stability** | Static IP | Random Azure IPs |
| **Cookie validity** | 30 phút+ | 30 phút |
| **Cost** | $24-100/tháng | Free (quota) |
| **Setup** | 10 phút | Config YAML |
| **Control** | Full control | Limited |

**Kết luận**: VPS tốt hơn cho serious load testing, GitHub Actions tốt cho quick tests.

---

## Done!

Workflow hoàn chỉnh:
1. ✅ Setup VPS với `vps-setup.sh`
2. ✅ Chạy test với `vps-run.sh`
3. ✅ Monitor realtime metrics
4. ✅ Scale lên nhiều VPS nếu cần

Questions? Check logs hoặc DM.
