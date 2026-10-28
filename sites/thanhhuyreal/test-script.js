import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

/* ==================================================================
   K6 LOAD TEST - PHP login có CSRF (thanhhuyreal.com)

   Flow đúng của site:
     GET  /?auth=login   -> Set-Cookie PHPSESSID + csrf_token trong HTML
     POST /model/login    -> form-urlencoded: csrf_token, identifier, password

   Vì sao phải GET trước:
     - csrf_token gắn với session, không dùng chéo session được.
     - Nếu nhiều VU dùng chung 1 PHPSESSID, PHP session lock sẽ
       serialize các request -> kết quả đo sai hoàn toàn.
     => Mỗi VU (và mỗi iteration nếu FRESH_SESSION=true) có session riêng.

   CHỈ CHẠY TRÊN HỆ THỐNG BẠN SỞ HỮU.
   ================================================================== */

const BASE_URL = (__ENV.PHP_BASE_URL || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const LOGIN_PAGE = __ENV.PHP_LOGIN_PAGE || '/?auth=login';
const LOGIN_PATH = __ENV.PHP_LOGIN_PATH || '/model/login';

const IDENTIFIER = __ENV.PHP_IDENTIFIER || '';
const PASSWORD = __ENV.PHP_PASSWORD || '';

// true  = mỗi lần login dùng session mới (giống người dùng thật / kẻ tấn công)
//         -> 2 request mỗi iteration (GET trang + POST login)
// false = dùng lại session của VU (chỉ đo POST, nhanh hơn)
const FRESH_SESSION = (__ENV.PHP_FRESH_SESSION || 'true').toLowerCase() === 'true';

// ===== Tải (giống bản kia) =====
const STAGES_RAW = __ENV.STAGES || '30s:100,60s:300,60s:600,15s:0';
const START_RATE = parseInt(__ENV.START_RATE || '50', 10);
const PRE_VUS = parseInt(__ENV.PRE_VUS || '100', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '800', 10);

const TIMEOUT = __ENV.REQUEST_TIMEOUT || '15s';
const REQUEST_DELAY = parseFloat(__ENV.REQUEST_DELAY || '0');

const MAX_5XX_RATE = parseFloat(__ENV.MAX_5XX_RATE || '0.02');
const MAX_TIMEOUT_RATE = parseFloat(__ENV.MAX_TIMEOUT_RATE || '0.05');
const ABORT_ON_BAN = (__ENV.ABORT_ON_BAN || 'false').toLowerCase() === 'true';

if (!IDENTIFIER || !PASSWORD) {
  throw new Error(
    'Thiếu PHP_IDENTIFIER / PHP_PASSWORD. Điền vào .env (đừng commit file .env).'
  );
}

// ===== Parse STAGES =====
function toSeconds(d) {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(d).trim());
  if (!m) throw new Error(`Duration không hợp lệ: "${d}" (dùng 30s, 1m, 2h)`);
  const v = parseFloat(m[1]);
  if (m[2] === 'ms') return v / 1000;
  if (m[2] === 's') return v;
  if (m[2] === 'm') return v * 60;
  return v * 3600;
}

const STAGES = STAGES_RAW.split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => {
    const [duration, target] = p.split(':');
    if (!duration || !target) throw new Error(`STAGES không hợp lệ: "${p}"`);
    return { duration: duration.trim(), target: parseInt(target, 10) };
  });

const STAGE_SECONDS = STAGES.map((s) => toSeconds(s.duration));

function scheduledRateAt(t) {
  let elapsed = 0;
  let prevRate = START_RATE;
  for (let i = 0; i < STAGES.length; i++) {
    const dur = STAGE_SECONDS[i];
    if (t <= elapsed + dur) {
      const frac = dur > 0 ? (t - elapsed) / dur : 1;
      return prevRate + (STAGES[i].target - prevRate) * frac;
    }
    elapsed += dur;
    prevRate = STAGES[i].target;
  }
  return prevRate;
}

// ===== Metrics =====
const loginOk = new Counter('php_login_ok');
const loginDenied = new Counter('php_login_denied');
const loginTwoFa = new Counter('php_login_2fa_required');
const csrfFail = new Counter('php_csrf_fail');
const pageFail = new Counter('php_page_fail');
const status429 = new Counter('php_429');
const status403 = new Counter('php_403');
const status5xx = new Counter('php_5xx');
const timeouts = new Counter('php_timeout');

const okRate = new Rate('php_login_ok_rate');
const err5xxRate = new Rate('php_5xx_rate');
const timeoutRate = new Rate('php_timeout_rate');
const bannedRate = new Rate('php_banned_rate');

const loginDuration = new Trend('php_login_duration');
const pageDuration = new Trend('php_page_duration');
const banFirstAt = new Trend('ban_first_at_s');
const banAtRps = new Trend('ban_at_rps');

export const options = {
  discardResponseBodies: false,
  scenarios: {
    flood: {
      executor: 'ramping-arrival-rate',
      startRate: START_RATE,
      timeUnit: '1s',
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      stages: STAGES,
    },
  },
  thresholds: {
    php_5xx_rate: [`rate<${MAX_5XX_RATE}`],
    php_timeout_rate: [`rate<${MAX_TIMEOUT_RATE}`],
  },
};

export function setup() {
  return { startTime: Date.now() };
}

const CSRF_RE = /name="csrf_token"\s+value="([^"]+)"/;
const CSRF_META_RE = /name="csrf-token"\s+content="([^"]+)"/;

function fetchCsrf() {
  const res = http.get(`${BASE_URL}${LOGIN_PAGE}`, {
    headers: { Accept: 'text/html,application/xhtml+xml' },
    timeout: TIMEOUT,
    tags: { name: 'login_page' },
  });
  pageDuration.add(res.timings.duration);

  if (res.status !== 200 || !res.body) {
    pageFail.add(1);
    return '';
  }
  const m = CSRF_RE.exec(res.body) || CSRF_META_RE.exec(res.body);
  if (!m) {
    pageFail.add(1);
    return '';
  }
  return m[1];
}

let testStartMs = 0;
let vuBanned = false;
let csrfToken = '';

function detectBan(s, data) {
  const banned = s === 403 || s === 429;
  bannedRate.add(banned);
  if (!banned || vuBanned) return;
  vuBanned = true;

  if (testStartMs === 0) testStartMs = data.startTime;
  const elapsed = (Date.now() - testStartMs) / 1000;
  banFirstAt.add(elapsed);
  banAtRps.add(scheduledRateAt(elapsed));

  if (ABORT_ON_BAN) {
    exec.test.abort(
      `Bị chặn (status ${s}) sau ${elapsed.toFixed(1)}s, ~${Math.round(scheduledRateAt(elapsed))} req/s`
    );
  }
}

export default function (data) {
  if (testStartMs === 0) testStartMs = data.startTime;

  if (FRESH_SESSION) {
    http.cookieJar().clear(BASE_URL);
    csrfToken = '';
  }

  if (!csrfToken) {
    csrfToken = fetchCsrf();
    if (!csrfToken) {
      sleep(1);
      return;
    }
  }

  const body = [
    `csrf_token=${encodeURIComponent(csrfToken)}`,
    `identifier=${encodeURIComponent(IDENTIFIER)}`,
    `password=${encodeURIComponent(PASSWORD)}`,
  ].join('&');

  const res = http.post(`${BASE_URL}${LOGIN_PATH}`, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE_URL,
      Referer: `${BASE_URL}${LOGIN_PAGE}`,
    },
    timeout: TIMEOUT,
    tags: { name: 'login' },
  });

  const s = res.status;
  loginDuration.add(res.timings.duration);

  let json = null;
  try {
    json = res.json();
  } catch (e) {
    json = null;
  }

  const message = json && json.message ? String(json.message) : '';

  if (s === 403) status403.add(1);
  if (s === 429) status429.add(1);
  if (s >= 500) status5xx.add(1);
  if (s === 0) timeouts.add(1);

  err5xxRate.add(s >= 500);
  timeoutRate.add(s === 0);
  detectBan(s, data);

  // CSRF bị từ chối -> lấy token mới cho lần sau
  const csrfBroken = s === 419 || /csrf/i.test(message);
  if (csrfBroken) {
    csrfFail.add(1);
    csrfToken = '';
  }

  const ok = !!(json && json.status === true);
  okRate.add(ok);

  if (ok) {
    loginOk.add(1);
  } else if (/2fa|otp|mã xác|xác thực 2/i.test(message)) {
    loginTwoFa.add(1);
  } else if (json && json.status === false) {
    loginDenied.add(1);
  }

  check(res, {
    'server không lỗi 5xx': (r) => r.status < 500,
    'không timeout': (r) => r.status !== 0,
  });

  if (REQUEST_DELAY > 0) sleep(REQUEST_DELAY);
}
