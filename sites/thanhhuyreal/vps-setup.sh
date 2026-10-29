#!/bin/bash
# VPS Setup Script - k6 Load Test for thanhhuyreal.com
# Tested on: Ubuntu 22.04 LTS

set -e

echo "===================================="
echo "VPS Setup for k6 Load Testing"
echo "===================================="

# 1. System update
echo "[1/6] Updating system..."
sudo apt update && sudo apt upgrade -y

# 2. Install Docker
echo "[2/6] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "Docker installed. You may need to logout and login again."
else
    echo "Docker already installed."
fi

# 3. Install k6
echo "[3/6] Installing k6..."
if ! command -v k6 &> /dev/null; then
    sudo gpg -k
    sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
    echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
    sudo apt-get update
    sudo apt-get install k6 -y
else
    echo "k6 already installed."
fi

# 4. Network tuning for high load
echo "[4/6] Tuning network parameters..."
sudo tee /etc/sysctl.d/99-k6-tuning.conf > /dev/null << 'EOF'
# Increase system file descriptor limit
fs.file-max = 2097152

# Increase network buffer sizes
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.ipv4.tcp_rmem = 4096 87380 67108864
net.ipv4.tcp_wmem = 4096 65536 67108864

# Increase connection tracking
net.netfilter.nf_conntrack_max = 1048576
net.nf_conntrack_max = 1048576

# Increase local port range
net.ipv4.ip_local_port_range = 1024 65535

# Enable TCP fast open
net.ipv4.tcp_fastopen = 3

# Reduce TIME_WAIT
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1

# Disable IPv6 (optional, reduces overhead)
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
EOF

sudo sysctl -p /etc/sysctl.d/99-k6-tuning.conf

# Increase ulimit for current session
ulimit -n 1048576

# Make ulimit persistent
sudo tee -a /etc/security/limits.conf > /dev/null << 'EOF'
*               soft    nofile          1048576
*               hard    nofile          1048576
root            soft    nofile          1048576
root            hard    nofile          1048576
EOF

echo "ulimit -n 1048576" >> ~/.bashrc

# 5. Start FlareSolverr
echo "[5/6] Starting FlareSolverr..."
docker run -d \
  --name flaresolverr \
  --restart unless-stopped \
  -p 8191:8191 \
  -e LOG_LEVEL=info \
  ghcr.io/flaresolverr/flaresolverr:latest

echo "Waiting for FlareSolverr to start..."
for i in {1..30}; do
  if curl -sf http://localhost:8191/health > /dev/null 2>&1; then
    echo "✓ FlareSolverr ready!"
    break
  fi
  echo "  Waiting... ($i/30)"
  sleep 2
done

# 6. Create working directory
echo "[6/6] Creating working directory..."
mkdir -p ~/k6-test
cd ~/k6-test

# Download test scripts (if Git not installed, use curl)
if command -v git &> /dev/null; then
  echo "Cloning test scripts..."
  git clone https://github.com/myvisitlink/dos.git
  cd dos/sites/thanhhuyreal
else
  echo "Git not installed. You'll need to upload test-script-auth.js manually."
fi

echo ""
echo "===================================="
echo "✓ VPS Setup Complete!"
echo "===================================="
echo ""
echo "Next steps:"
echo "1. Logout and login again (for Docker group)"
echo "2. Verify FlareSolverr: curl http://localhost:8191/health"
echo "3. Run test: bash vps-run.sh"
echo ""
echo "System info:"
echo "  CPU cores: $(nproc)"
echo "  RAM: $(free -h | awk '/Mem:/{print $2}')"
echo "  ulimit -n: $(ulimit -n)"
echo ""
