// Test script: All requests via FlareSolverr (proper way)
const https = require('https');

const FLARESOLVERR_URL = 'https://fs.duongle.dev';
const TARGET_URL = 'https://thanhhuyreal.com';
const USERNAME = 'lonussystem';
const PASSWORD = 'lonussystem123@';

// Helper: Call FlareSolverr
function callFlareSolverr(cmd, url, method = 'GET', postData = null, cookies = []) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      cmd: cmd,
      url: url,
      postData: postData,
      cookies: cookies,
      maxTimeout: 60000
    });
    
    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(FLARESOLVERR_URL + '/v1', options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result.status === 'ok') {
            resolve(result.solution);
          } else {
            reject(new Error(`FlareSolverr error: ${result.message}`));
          }
        } catch (err) {
          reject(err);
        }
      });
    });
    
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  try {
    console.log('=== Step 1: GET login page via FlareSolverr ===');
    
    const loginPage = await callFlareSolverr('request.get', TARGET_URL + '/?auth=login');
    
    console.log(`Status: ${loginPage.status}`);
    console.log(`Cookies: ${loginPage.cookies.map(c => c.name).join(', ')}`);
    
    // Extract CSRF
    const csrfMatch = loginPage.response.match(/name="csrf_token"\s+value="([^"]+)"/);
    if (!csrfMatch) {
      throw new Error('CSRF token not found!');
    }
    const csrfToken = csrfMatch[1];
    console.log(`CSRF: ${csrfToken.substring(0, 20)}...`);
    
    // Get session cookies
    const sessionCookies = loginPage.cookies;
    console.log(`Session cookies count: ${sessionCookies.length}`);
    sessionCookies.forEach(c => {
      console.log(`  - ${c.name}: ${c.value.substring(0, 20)}...`);
    });
    
    console.log('\n=== Step 2: POST login via FlareSolverr ===');
    
    const loginPayload = `csrf_token=${encodeURIComponent(csrfToken)}&identifier=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`;
    
    const loginResult = await callFlareSolverr(
      'request.post',
      TARGET_URL + '/model/login',
      'POST',
      loginPayload,
      sessionCookies
    );
    
    console.log(`Login status: ${loginResult.status}`);
    console.log(`Response preview: ${loginResult.response.substring(0, 200)}`);
    
    try {
      const loginJson = JSON.parse(loginResult.response);
      if (loginJson.status === true) {
        console.log('\n✅ LOGIN SUCCESS via FlareSolverr!');
        console.log('Cookies after login:', loginResult.cookies.map(c => c.name).join(', '));
        
        console.log('\n=== Step 3: Test authenticated API call ===');
        
        const apiPayload = `csrf_token=${csrfToken}&account_id=12345&category_id=100&price=50000`;
        const apiResult = await callFlareSolverr(
          'request.post',
          TARGET_URL + '/model/account/purchase',
          'POST',
          apiPayload,
          loginResult.cookies
        );
        
        console.log(`API status: ${apiResult.status}`);
        console.log(`API response: ${apiResult.response.substring(0, 300)}`);
        
        console.log('\n🎉 Full flow working via FlareSolverr!');
        console.log('\n⚠️  NOTE: k6 PHẢI gọi mọi request qua FlareSolverr, KHÔNG thể dùng cookie riêng lẻ!');
        
      } else {
        console.error('\n❌ Login failed!');
        console.error('Response:', loginJson);
      }
    } catch (err) {
      console.error('Failed to parse login response:', err);
      console.error('Raw:', loginResult.response);
    }
    
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
