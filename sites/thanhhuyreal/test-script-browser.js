import { browser } from 'k6/browser';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

/* ==================================================================
   K6 BROWSER TEST - Simulate real user behavior
   Dùng Chrome headless để test giống user thật, bypass WAF
   
   Ưu điểm:
   - Execute JavaScript, render DOM
   - Bypass simple WAF rules (looks like real browser)
   - Measure frontend metrics (Web Vitals)
   
   Nhược điểm:
   - Nặng hơn HTTP test (cần nhiều CPU/RAM)
   - Chậm hơn (phải render page)
   - Giới hạn VUs thấp hơn
   ================================================================== */

const TARGET_URL = (__ENV.TARGET_URL || 'http://103.211.206.175/').replace(/\/+$/, '');

const VUS = parseInt(__ENV.VUS || '10', 10); // Browser tests need fewer VUs
const DURATION = __ENV.DURATION || '5m';

// Metrics
const pageLoaded = new Counter('browser_page_loaded');
const jsErrors = new Counter('browser_js_errors');
const failedRequests = new Counter('browser_failed_requests');
const pageLoadTime = new Trend('browser_page_load_time');
const successRate = new Rate('browser_success_rate');

export const options = {
  scenarios: {
    browser_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: Math.floor(VUS / 2) },
        { duration: DURATION, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
      options: {
        browser: {
          type: 'chromium',
        },
      },
    },
  },
  thresholds: {
    browser_success_rate: ['rate>0.95'],
    browser_page_load_time: ['p(95)<5000'],
  },
};

export default async function () {
  const context = await browser.newContext({
    userAgent: getRandomUserAgent(),
    viewport: { width: 1920, height: 1080 },
    javaScriptEnabled: true,
  });

  const page = await context.newPage();

  try {
    // Track console errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        jsErrors.add(1);
      }
    });

    // Track failed requests
    page.on('requestfailed', () => {
      failedRequests.add(1);
    });

    const startTime = Date.now();

    // Navigate to homepage
    const response = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const loadTime = Date.now() - startTime;
    pageLoadTime.add(loadTime);

    // Check response
    const success = response && response.status() >= 200 && response.status() < 400;
    successRate.add(success);

    if (success) {
      pageLoaded.add(1);
    }

    // Simulate user behavior
    if (success) {
      // Wait for page to stabilize
      await page.waitForTimeout(1000 + Math.random() * 2000);

      // Scroll down (simulate reading)
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight / 2);
      });
      await page.waitForTimeout(500);

      // Scroll more
      await page.evaluate(() => {
        window.scrollBy(0, window.innerHeight / 2);
      });
      await page.waitForTimeout(500);

      // Try to find and click a link (if exists)
      const links = await page.$$('a[href]');
      if (links.length > 0) {
        const randomLink = links[Math.floor(Math.random() * links.length)];
        const href = await randomLink.getAttribute('href');
        
        if (href && !href.startsWith('javascript:') && !href.startsWith('#')) {
          const linkStart = Date.now();
          await randomLink.click();
          await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
          pageLoadTime.add(Date.now() - linkStart);
        }
      }

      // Go back
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    }

    check(response || {}, {
      'page loaded': (r) => success,
      'status 200': (r) => r && r.status() === 200,
      'no timeout': (r) => r && r.status() !== 0,
    });

  } catch (error) {
    console.error(`Browser test error: ${error.message}`);
    successRate.add(false);
    failedRequests.add(1);
  } finally {
    await page.close();
    await context.close();
  }

  sleep(1 + Math.random() * 2); // Random delay between iterations
}

function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  ];
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}
