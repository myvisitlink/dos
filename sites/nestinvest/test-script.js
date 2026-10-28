import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import exec from 'k6/execution';

/* ==================================================================
   K6 MAX-THROUGHPUT TEST - POST /api/v1/auth/login

   Mục đích: leo tải theo req/s (không theo VU) để tìm:
     1. Điểm gãy của hệ thống (rps bắt đầu sinh 5xx / timeout)
     2. IP ban có hoạt động không, và ban ở mức tải nào

   Cách đọc kết quả:
     - ban_first_at_s : giây thứ mấy thì request đầu tiên bị 403/429
     - ban_at_rps     : ước lượng req/s tại thời điểm bị ban
     - banned_rate    : tỷ lệ request bị chặn
     - login_5xx_rate : lỗi server thật

   LƯU Ý:
   - 401 là kết quả ĐÚNG (sai mật khẩu), k6 coi là failed nên
     http_req_failed sẽ ~100%. Bỏ qua metric đó.
   - Không có cơ chế xoay/spoof IP. Né ban thì không kiểm chứng được ban.
   - Chỉ chạy trên hạ tầng bạn sở hữu.
   ================================================================== */

// ===== Endpoint =====
const BASE_URL = (__ENV.BASE_URL || 'https://mice.3nestinvest.com/api/v1').replace(/\/+$/, '');
const LOGIN_URL = `${BASE_URL}/auth/login`;

// ===== Tải =====
// Định dạng STAGES: "<thời gian giữ>:<rps mục tiêu>", phân cách bằng dấu phẩy
// Ví dụ: "30s:500,60s:1500,60s:3000,60s:3000,15s:0"
const STAGES_RAW = __ENV.STAGES || '30s:500,60s:1500,60s:3000,60s:3000,15s:0';
const START_RATE = parseInt(__ENV.START_RATE || '100', 10);
const PRE_VUS = parseInt(__ENV.PRE_VUS || '300', 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || '2000', 10);

const TIMEOUT = __ENV.REQUEST_TIMEOUT || '10s';
const REQUEST_DELAY = parseFloat(__ENV.REQUEST_DELAY || '0');

// ===== Ngưỡng =====
const MAX_5XX_RATE = parseFloat(__ENV.MAX_5XX_RATE || '0.02');
const MAX_TIMEOUT_RATE = parseFloat(__ENV.MAX_TIMEOUT_RATE || '0.05');
const ABORT_ON_BAN = (__ENV.ABORT_ON_BAN || 'false').toLowerCase() === 'true';

// ===== Spoof header (A/B test) =====
// Bật lên chỉ có ý nghĩa nếu nginx/backend TIN các header này
// (real_ip_header + set_real_ip_from, hoặc Express `trust proxy`).
// Nếu không tin => header bị bỏ qua, kết quả y hệt khi tắt.
// Cách dùng đúng: chạy 2 lần (false / true) rồi so ban_at_rps + banned_rate.
const SPOOF_HEADERS = (__ENV.SPOOF_HEADERS || 'false').toLowerCase() === 'true';
// all | xff | cf | forwarded
const SPOOF_STRATEGY = (__ENV.SPOOF_STRATEGY || 'all').toLowerCase();

// ===== Account =====
const FIXED_EMAIL = __ENV.TEST_EMAIL || '';
const FIXED_PASSWORD = __ENV.TEST_PASSWORD || '';
const USE_FIXED_ACCOUNT = FIXED_EMAIL !== '' && FIXED_PASSWORD !== '';
const EMAIL_DOMAIN = __ENV.EMAIL_DOMAIN || 'loadtest.example.com';
const WRONG_PASSWORD = __ENV.WRONG_PASSWORD || 'WrongPass123!';

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
  .map((part) => part.trim())
  .filter(Boolean)
  .map((part) => {
    const [duration, target] = part.split(':');
    if (!duration || !target) {
      throw new Error(`STAGES không hợp lệ: "${part}" (đúng dạng "30s:500,60s:1500")`);
    }
    return { duration: duration.trim(), target: parseInt(target, 10) };
  });

const STAGE_SECONDS = STAGES.map((s) => toSeconds(s.duration));

// Tính rps theo lịch tại giây thứ t (để biết bị ban ở mức tải nào)
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
const status2xx = new Counter('login_2xx');
const status400 = new Counter('login_400');
const status401 = new Counter('login_401');
const status403 = new Counter('login_403');
const status429 = new Counter('login_429');
const status5xx = new Counter('login_5xx');
const statusOther = new Counter('login_other');
const timeouts = new Counter('login_timeout');

const err5xxRate = new Rate('login_5xx_rate');
const timeoutRate = new Rate('login_timeout_rate');
const bannedRate = new Rate('banned_rate');
const loginDuration = new Trend('login_duration');

// Chỉ ghi 1 lần / VU khi bị chặn -> min() cho ra thời điểm ban đầu tiên
const banFirstAt = new Trend('ban_first_at_s');
const banAtRps = new Trend('ban_at_rps');

export const options = {
  discardResponseBodies: true,
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
    login_5xx_rate: [`rate<${MAX_5XX_RATE}`],
    login_timeout_rate: [`rate<${MAX_TIMEOUT_RATE}`],
  },
};

// setup() chạy 1 lần, cung cấp mốc thời gian chung cho mọi VU
export function setup() {
  return { startTime: Date.now() };
}

function randomEmail() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `lt-${__VU}-${__ITER}-${rand}@${EMAIL_DOMAIN}`;
}

function randomPublicIp() {
  let a;
  do {
    a = 1 + Math.floor(Math.random() * 223);
  } while (a === 10 || a === 127 || a === 172 || a === 192 || a === 169);
  return `${a}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${1 + Math.floor(Math.random() * 254)}`;
}

function spoofHeaders() {
  if (!SPOOF_HEADERS) return {};
  const ip = randomPublicIp();
  const h = {};
  if (SPOOF_STRATEGY === 'all' || SPOOF_STRATEGY === 'xff') {
    h['X-Forwarded-For'] = ip;
    h['X-Real-IP'] = ip;
  }
  if (SPOOF_STRATEGY === 'all' || SPOOF_STRATEGY === 'cf') {
    h['CF-Connecting-IP'] = ip;
    h['True-Client-IP'] = ip;
  }
  if (SPOOF_STRATEGY === 'forwarded') {
    h['Forwarded'] = `for=${ip}`;
  }
  return h;
}

let testStartMs = 0;
let vuBanned = false;

export default function (data) {
  if (testStartMs === 0) testStartMs = data.startTime;

  const email = USE_FIXED_ACCOUNT ? FIXED_EMAIL : randomEmail();
  const password = USE_FIXED_ACCOUNT ? FIXED_PASSWORD : WRONG_PASSWORD;

  const headers = Object.assign(
    { 'Content-Type': 'application/json', Accept: 'application/json' },
    spoofHeaders()
  );

  const res = http.post(LOGIN_URL, JSON.stringify({ email, password }), {
    headers: headers,
    timeout: TIMEOUT,
    tags: { name: 'login' },
  });

  const s = res.status;
  loginDuration.add(res.timings.duration);

  if (s >= 200 && s < 300) status2xx.add(1);
  else if (s === 400) status400.add(1);
  else if (s === 401) status401.add(1);
  else if (s === 403) status403.add(1);
  else if (s === 429) status429.add(1);
  else if (s >= 500) status5xx.add(1);
  else if (s === 0) timeouts.add(1);
  else statusOther.add(1);

  err5xxRate.add(s >= 500);
  timeoutRate.add(s === 0);

  // ===== Phát hiện ban =====
  const banned = s === 403 || s === 429;
  bannedRate.add(banned);

  if (banned && !vuBanned) {
    vuBanned = true;
    const elapsed = (Date.now() - testStartMs) / 1000;
    banFirstAt.add(elapsed);
    banAtRps.add(scheduledRateAt(elapsed));

    if (ABORT_ON_BAN) {
      exec.test.abort(
        `Bị chặn (status ${s}) sau ${elapsed.toFixed(1)}s, ~${Math.round(scheduledRateAt(elapsed))} req/s`
      );
    }
  }

  check(res, {
    'server không lỗi 5xx': (r) => r.status < 500,
    'không timeout': (r) => r.status !== 0,
  });

  if (REQUEST_DELAY > 0) sleep(REQUEST_DELAY);
}
