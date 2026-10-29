import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/* ==================================================================
   K6 BROWSER TEST - Login qua Cloudflare với Chromium thật
   - Bypass CF JS challenge hoàn toàn (real browser TLS + JS engine)
   - Tự động xử lý CSRF, cookie, redirect
   - Chạy được qua https://thanhhuyreal.com (có Cloudflare)

   Giới hạn: mỗi VU = 1 Chromium process (~200MB RAM)
   => Max ~20-50 VU trên máy thường
   ================================================================== */

const BASE_URL    = (__ENV.PHP_BASE_URL   || 'https://thanhhuyreal.com').replace(/\/+$/, '');
const LOGIN_URL   = BASE_URL + (__ENV.PHP_LOGIN_PAGE || '/?auth=login');
const IDENTIFIER  = __ENV.PHP_IDENTIFIER || 'lonussystem';
const PASSWORD    = __ENV.PHP_PASSWORD   || 'lonussystem123@';

const MAX_5XX_RATE     = parseFloat(__ENV.MAX_5XX_RATE     || '0.5');
const MAX_TIMEOUT_RATE = parseFloat(__ENV.MAX_TIMEOUT_RATE || '0.5');
const VUS              = parseInt(__ENV.BROWSER_VUS || '5', 10);
const DURATION         = __ENV.BROWSER_DURATION || '2m';

// ===== Metrics =====
const loginOk     = new Counter('browser_login_ok');
const loginFail   = new Counter('browser_login_fail');
const cfBlocked   = new Counter('browser_cf_blocked');
const errRate     = new Rate('browser_error_rate');
const loginDur    = new Trend('browser_login_duration_ms');

export const options = {
  scenarios: {
    browser_flood: {
      executor:    'constant-vus',
      vus:         VUS,
      duration:    DURATION,
      options: {
        browser: {
          type: 'chromium',
          // Stealth: ẩn dấu hiệu headless/automation với Cloudflare
          args: [
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--window-size=1920,1080',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
          ],
        },
      },
    },
  },
  thresholds: {
    browser_error_rate: [`rate<${MAX_5XX_RATE}`],
  },
};

export default async function () {
  const page = await browser.newPage();

  try {
    const t0 = Date.now();

    // Bước 1: Mở trang login — Chromium tự xử lý CF JS challenge
    const resp = await page.goto(LOGIN_URL, {
      waitUntil: 'networkidle',
      timeout:   30000,
    });

    const status = resp ? resp.status() : 0;

    // Phát hiện CF block (403, 503 từ CF)
    if (status === 403 || status === 503) {
      cfBlocked.add(1);
      errRate.add(true);
      console.warn(`CF blocked: status=${status}`);
      return;
    }

    // Bước 2: Điền form login
    const identifierField = page.locator('input[name="identifier"], input[name="email"], input[type="email"], #identifier');
    const passwordField   = page.locator('input[name="password"], input[type="password"], #password');
    const submitBtn       = page.locator('button[type="submit"], input[type="submit"], .btn-login, #btn-login');

    // Kiểm tra form có tồn tại không
    const hasForm = await identifierField.count() > 0;
    if (!hasForm) {
      // Thử selector rộng hơn
      const inputs = await page.locator('input').count();
      console.warn(`Form không tìm thấy. Số input trên page: ${inputs}, URL: ${page.url()}`);
      errRate.add(true);
      loginFail.add(1);
      return;
    }

    await identifierField.first().fill(IDENTIFIER);
    await passwordField.first().fill(PASSWORD);

    // Bước 3: Submit và đợi response
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {}),
      submitBtn.first().click(),
    ]);

    const elapsed = Date.now() - t0;
    loginDur.add(elapsed);

    // Bước 4: Kiểm tra login thành công
    const currentUrl = page.url();
    const pageTitle  = await page.title();

    // Login OK nếu redirect ra khỏi trang login
    const loginSuccess = !currentUrl.includes('auth=login') && !currentUrl.includes('login');

    errRate.add(!loginSuccess);
    if (loginSuccess) {
      loginOk.add(1);
    } else {
      loginFail.add(1);
      // Log body để debug
      const bodyText = await page.locator('body').textContent().catch(() => '');
      if (bodyText.includes('cf-') || bodyText.includes('cloudflare')) {
        cfBlocked.add(1);
        console.warn('CF challenge detected in body');
      }
    }

    check(null, {
      'login thanh cong': () => loginSuccess,
    });

  } catch (e) {
    console.error(`Error: ${e.message}`);
    errRate.add(true);
    loginFail.add(1);
  } finally {
    await page.close();
  }
}
