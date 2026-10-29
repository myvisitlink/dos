import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

/* ==================================================================
   K6 LOAD TEST - PHP login có CSRF + Cloudflare bypass
   Flow: cf_clearance cookie inject → GET login page → POST login

   CHỈ CHẠY TRÊN HỆ THỐNG BẠN SỞ HỮU.
   ================================================================== */

const BASE_URL = (__ENV.PHP_BASE_URL || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const LOGIN_PAGE = __ENV.PHP_LOGIN_PAGE || '/?auth=login';
const LOGIN_PATH = __ENV.PHP_LOGIN_PATH || '/model/login';

const IDENTIFIER = __ENV.PHP_IDENTIFIER || '';
const PASSWORD   = __ENV.PHP_PASSWORD   || '';

// cf_clearance từ env var (updated externally by wrapper script)
const CF_CLEARANCE_FILE = __ENV.CF_CLEARANCE_FILE || '';
const CF_UA_FILE = __ENV.CF_UA_FILE || '';

let CF_CLEARANCE = __ENV.CF_CLEARANCE || '';
let CF_UA = __ENV.CF_UA || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

// Note: k6 cannot read files dynamically, so we rely on env vars updated externally
console.log(`Using CF_CLEARANCE: ${CF_CLEARANCE ? CF_CLEARANCE.substring(0, 50) + '...' : 'not set'}`);

const FRESH_SESSION = (__ENV.PHP_FRESH_SESSION || 'true').toLowerCase() === 'true';

const STAGES_RAW      = __ENV.STAGES              || '30s:100,60s:500,60s:1000,15s:0';
const START_RATE      = parseInt(__ENV.START_RATE  || '50',  10);
const PRE_VUS         = parseInt(__ENV.PRE_VUS     || '200', 10);
const MAX_VUS         = parseInt(__ENV.MAX_VUS     || '2000', 10);
const TIMEOUT         = __ENV.REQUEST_TIMEOUT      || '15s';
const REQUEST_DELAY   = parseFloat(__ENV.REQUEST_DELAY || '0');
const MAX_5XX_RATE    = parseFloat(__ENV.MAX_5XX_RATE  || '0.5');
const MAX_TIMEOUT_RATE= parseFloat(__ENV.MAX_TIMEOUT_RATE || '0.5');
const ABORT_ON_BAN    = (__ENV.ABORT_ON_BAN || 'false').toLowerCase() === 'true';

if (!IDENTIFIER || !PASSWORD) {
  throw new Error('Thieu PHP_IDENTIFIER / PHP_PASSWORD trong .env');
}

// ===== Parse STAGES =====
const STAGES = STAGES_RAW.split(',')
  .map(p => p.trim()).filter(Boolean)
  .map(p => {
    const [duration, target] = p.split(':');
    return { duration: duration.trim(), target: parseInt(target, 10) };
  });

// ===== Metrics =====
const loginOk      = new Counter('php_login_ok');
const loginDenied  = new Counter('php_login_denied');
const csrfFail     = new Counter('php_csrf_fail');
const status429    = new Counter('php_429');
const status403    = new Counter('php_403');
const status5xx    = new Counter('php_5xx');
const timeouts     = new Counter('php_timeout');

const okRate      = new Rate('php_login_ok_rate');
const err5xxRate  = new Rate('php_5xx_rate');
const timeoutRate = new Rate('php_timeout_rate');
const bannedRate  = new Rate('php_banned_rate');

const loginDuration = new Trend('php_login_duration');
const pageDuration  = new Trend('php_page_duration');

export const options = {
  discardResponseBodies: false,
  scenarios: {
    flood: {
      executor:        'ramping-arrival-rate',
      startRate:       START_RATE,
      timeUnit:        '1s',
      preAllocatedVUs: PRE_VUS,
      maxVUs:          MAX_VUS,
      stages:          STAGES,
    },
  },
  thresholds: {
    php_5xx_rate:     [`rate<${MAX_5XX_RATE}`],
    php_timeout_rate: [`rate<${MAX_TIMEOUT_RATE}`],
  },
};

// ===== Inject cf_clearance vào cookie jar trước mỗi request =====
function setCfCookie() {
  if (!CF_CLEARANCE || CF_CLEARANCE === 'none') return;
  
  http.cookieJar().set(BASE_URL, 'cf_clearance', CF_CLEARANCE, {
    domain: 'thanhhuyreal.com',
    path:   '/',
  });
}

const CSRF_RE      = /name="csrf_token"\s+value="([^"]+)"/;
const CSRF_META_RE = /name="csrf-token"\s+content="([^"]+)"/;

function fetchCsrf() {
  setCfCookie();
  const res = http.get(`${BASE_URL}${LOGIN_PAGE}`, {
    headers: { 
      'User-Agent': CF_UA,
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    timeout: TIMEOUT,
    tags: { name: 'login_page' },
  });
  pageDuration.add(res.timings.duration);

  if (res.status !== 200 || !res.body) return '';
  const m = CSRF_RE.exec(res.body) || CSRF_META_RE.exec(res.body);
  if (!m) return '';
  return m[1];
}

let vuBanned   = false;
let csrfToken  = '';

function detectBan(s) {
  const banned = s === 403 || s === 429;
  bannedRate.add(banned);
  if (!banned || vuBanned) return;
  vuBanned = true;
  if (ABORT_ON_BAN) exec.test.abort(`Ban: status ${s}`);
}

export default function () {
  if (FRESH_SESSION) {
    http.cookieJar().clear(BASE_URL);
    csrfToken = '';
  }

  if (!csrfToken) {
    csrfToken = fetchCsrf();
    if (!csrfToken) { sleep(1); return; }
  }

  setCfCookie();

  const body = [
    `csrf_token=${encodeURIComponent(csrfToken)}`,
    `identifier=${encodeURIComponent(IDENTIFIER)}`,
    `password=${encodeURIComponent(PASSWORD)}`,
  ].join('&');

  const res = http.post(`${BASE_URL}${LOGIN_PATH}`, body, {
    headers: {
      'Content-Type':     'application/x-www-form-urlencoded; charset=UTF-8',
      'Accept':           'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent':       CF_UA,
      'Origin':           BASE_URL,
      'Referer':          `${BASE_URL}${LOGIN_PAGE}`,
    },
    timeout: TIMEOUT,
    tags: { name: 'login' },
  });

  const s = res.status;
  loginDuration.add(res.timings.duration);

  if (s === 403) status403.add(1);
  if (s === 429) status429.add(1);
  if (s >= 500)  status5xx.add(1);
  if (s === 0)   timeouts.add(1);

  err5xxRate.add(s >= 500);
  timeoutRate.add(s === 0);
  detectBan(s);

  let json = null;
  try { json = res.json(); } catch (e) {}

  const message = json && json.message ? String(json.message) : '';
  const csrfBroken = s === 419 || /csrf/i.test(message);
  if (csrfBroken) { csrfFail.add(1); csrfToken = ''; }

  const ok = !!(json && json.status === true);
  okRate.add(ok);
  if (ok) loginOk.add(1);
  else    loginDenied.add(1);

  check(res, {
    'khong 5xx':    r => r.status < 500,
    'khong timeout': r => r.status !== 0,
  });

  if (REQUEST_DELAY > 0) sleep(REQUEST_DELAY);
}
