import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

// Custom Metrics
const rateLimitedCount = new Counter('rate_limited_429');
const blockedCount = new Counter('blocked_403');
const successCount = new Counter('success_2xx');
const errorCount = new Counter('errors_5xx');
const successRate = new Rate('success_rate');

// Đọc cấu hình từ biến môi trường
const TARGET_URL = __ENV.TARGET_URL || 'https://httpbin.org/get';
const VUS = parseInt(__ENV.VUS || '10', 10);
const DURATION = __ENV.DURATION || '30s';
const REQUEST_DELAY = parseFloat(__ENV.REQUEST_DELAY || '0.05');
const HTTP_METHOD = (__ENV.HTTP_METHOD || 'GET').toUpperCase();

export const options = {
  scenarios: {
    stress_test: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: '10s', target: VUS },           // Tăng tải dần lên mức VUS
        { duration: DURATION, target: VUS },        // Duy trì tải trong DURATION
        { duration: '5s', target: 0 },              // Hạ tải về 0
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds: {
    // Cảnh báo nếu tỷ lệ request lỗi quá cao
    http_req_failed: ['rate<0.5'], // hơn 50% lỗi sẽ cảnh báo
  },
};

// Hàm sinh địa chỉ Public IPv4 ngẫu nhiên (tránh dải Private: 10.x, 192.168.x, 172.16-31.x, 127.x)
function generateRandomPublicIP() {
  let firstOctet;
  do {
    firstOctet = Math.floor(Math.random() * 223) + 1; // 1 -> 223
  } while (firstOctet === 10 || firstOctet === 127 || (firstOctet >= 172 && firstOctet <= 172) || firstOctet === 192);

  const second = Math.floor(Math.random() * 256);
  const third = Math.floor(Math.random() * 256);
  const fourth = Math.floor(Math.random() * 254) + 1;

  return `${firstOctet}.${second}.${third}.${fourth}`;
}

export default function () {
  const fakeIP = generateRandomPublicIP();

  // Header xoay IP phong phú tương thích nhiều loại WAF / Reverse Proxy (Cloudflare, Nginx, AWS ALB, Traefik)
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'X-Forwarded-For': fakeIP,
    'X-Real-IP': fakeIP,
    'CF-Connecting-IP': fakeIP,
    'True-Client-IP': fakeIP,
    'X-Client-IP': fakeIP,
    'Fastly-Client-IP': fakeIP,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const params = {
    headers: headers,
    timeout: '10s',
  };

  let res;
  if (HTTP_METHOD === 'POST') {
    const payload = JSON.stringify({
      timestamp: Date.now(),
      test_agent: 'k6-distributed',
    });
    headers['Content-Type'] = 'application/json';
    res = http.post(TARGET_URL, payload, params);
  } else {
    res = http.get(TARGET_URL, params);
  }

  // Đếm metrics phân loại trạng thái
  const is2xx = res.status >= 200 && res.status < 300;
  const is429 = res.status === 429;
  const is403 = res.status === 403;
  const is5xx = res.status >= 500;

  if (is2xx) successCount.add(1);
  if (is429) rateLimitedCount.add(1);
  if (is403) blockedCount.add(1);
  if (is5xx) errorCount.add(1);
  successRate.add(is2xx);

  check(res, {
    'Status 200-299 OK': (r) => r.status >= 200 && r.status < 300,
    'Status 429 Rate Limited': (r) => r.status === 429,
    'Status 403 Forbidden': (r) => r.status === 403,
  });

  // Nghỉ giữa các request (mặc định 0.05s)
  if (REQUEST_DELAY > 0) {
    sleep(REQUEST_DELAY);
  }
}
