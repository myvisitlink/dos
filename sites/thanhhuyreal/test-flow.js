// Test script: FlareSolverr → Login → Get PHPSESSID
const https = require('https');
const http = require('http');

const FLARESOLVERR_URL = 'https://fs.duongle.dev';
const TARGET_URL = 'https://thanhhuyreal.com';
const USERNAME = 'lonussystem';
const PASSWORD = 'lonussystem123@';

// Step 1: Get cf_clearance from FlareSolverr
console.log('=== Step 1: Get cf_clearance from FlareSolverr ===');

const flarePayload = JSON.stringify({
  cmd: "request.get",
  url: TARGET_URL,
  maxTimeout: 60000
});

const flareOptions = {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(flarePayload)
  }
};

const flareReq = https.request(FLARESOLVERR_URL + '/v1', flareOptions, (res) => {
  let data = '';
  
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log(`FlareSolverr status: ${res.statusCode}`);
    
    if (res.statusCode !== 200) {
      console.error('FlareSolverr failed!');
      console.error(data);
      process.exit(1);
    }
    
    const result = JSON.parse(data);
    console.log(`Status: ${result.status}`);
    console.log(`Message: ${result.message}`);
    
    if (result.status !== 'ok') {
      console.error('FlareSolverr error!');
      process.exit(1);
    }
    
    const cookies = result.solution.cookies || [];
    const cfCookie = cookies.find(c => c.name === 'cf_clearance');
    const userAgent = result.solution.userAgent;
    
    console.log(`Cookies found: ${cookies.map(c => c.name).join(', ')}`);
    console.log(`cf_clearance: ${cfCookie ? cfCookie.value.substring(0, 50) + '...' : 'NOT FOUND'}`);
    console.log(`User-Agent: ${userAgent.substring(0, 80)}...`);
    
    if (!cfCookie) {
      console.error('No cf_clearance cookie!');
      process.exit(1);
    }
    
    // Step 2: Get login page with cf_clearance
    console.log('\n=== Step 2: GET login page with cf_clearance ===');
    
    const loginPageOptions = {
      method: 'GET',
      headers: {
        'User-Agent': userAgent,
        'Cookie': `cf_clearance=${cfCookie.value}`,
        'Accept': 'text/html,application/xhtml+xml'
      }
    };
    
    https.get(TARGET_URL + '/?auth=login', loginPageOptions, (res2) => {
      let html = '';
      
      res2.on('data', (chunk) => {
        html += chunk;
      });
      
      res2.on('end', () => {
        console.log(`Login page status: ${res2.statusCode}`);
        
        if (res2.statusCode !== 200) {
          console.error('Failed to get login page!');
          console.error('Body preview:', html.substring(0, 500));
          process.exit(1);
        }
        
        // Extract CSRF token
        const csrfMatch = html.match(/name="csrf_token"\s+value="([^"]+)"/);
        if (!csrfMatch) {
          console.error('CSRF token not found in HTML!');
          console.error('HTML preview:', html.substring(0, 1000));
          process.exit(1);
        }
        const csrfToken = csrfMatch[1];
        console.log(`CSRF token: ${csrfToken.substring(0, 20)}...`);
        
        // Extract PHPSESSID from Set-Cookie
        const setCookies = res2.headers['set-cookie'] || [];
        console.log(`Set-Cookie headers: ${setCookies.length}`);
        
        let phpSessId = '';
        setCookies.forEach(cookie => {
          const match = cookie.match(/PHPSESSID=([^;]+)/);
          if (match) {
            phpSessId = match[1];
          }
        });
        
        if (!phpSessId) {
          console.error('PHPSESSID not found in Set-Cookie!');
          console.error('Set-Cookie:', setCookies);
          process.exit(1);
        }
        
        console.log(`PHPSESSID: ${phpSessId.substring(0, 16)}...`);
        
        // Step 3: POST login
        console.log('\n=== Step 3: POST login ===');
        
        const loginPayload = `csrf_token=${encodeURIComponent(csrfToken)}&identifier=${encodeURIComponent(USERNAME)}&password=${encodeURIComponent(PASSWORD)}`;
        
        const loginOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Content-Length': Buffer.byteLength(loginPayload),
            'Cookie': `PHPSESSID=${phpSessId}; cf_clearance=${cfCookie.value}`,
            'User-Agent': userAgent,
            'Accept': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': TARGET_URL + '/?auth=login',
            'Origin': TARGET_URL
          }
        };
        
        const loginReq = https.request(TARGET_URL + '/model/login', loginOptions, (res3) => {
          let loginData = '';
          
          res3.on('data', (chunk) => {
            loginData += chunk;
          });
          
          res3.on('end', () => {
            console.log(`Login POST status: ${res3.statusCode}`);
            console.log(`Login response: ${loginData}`);
            
            try {
              const loginResult = JSON.parse(loginData);
              if (loginResult.status === true) {
                console.log('\n✅ LOGIN SUCCESS!');
                console.log(`Session: PHPSESSID=${phpSessId.substring(0, 16)}...`);
                console.log(`Cookie: cf_clearance=${cfCookie.value.substring(0, 50)}...`);
                console.log('\n🎉 Full flow working! Ready for k6 test!');
              } else {
                console.error('\n❌ Login failed!');
                console.error('Response:', loginResult);
              }
            } catch (err) {
              console.error('Failed to parse login response:', err);
              console.error('Raw response:', loginData);
            }
          });
        });
        
        loginReq.on('error', (err) => {
          console.error('Login request error:', err);
        });
        
        loginReq.write(loginPayload);
        loginReq.end();
      });
    }).on('error', (err) => {
      console.error('Login page request error:', err);
    });
  });
});

flareReq.on('error', (err) => {
  console.error('FlareSolverr request error:', err);
});

flareReq.write(flarePayload);
flareReq.end();
