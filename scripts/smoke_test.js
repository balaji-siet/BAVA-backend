const http = require('http');

const BASE_URL = 'http://localhost:5000';

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method: method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const startTime = Date.now();
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const duration = Date.now() - startTime;
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch (e) {
          parsed = data;
        }
        resolve({
          status: res.statusCode,
          duration: duration,
          data: parsed
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

(async () => {
  console.log("============================================================");
  console.log("STARTING PHASE 3 — BASIC API SMOKE TEST");
  console.log("============================================================");

  const results = [];

  try {
    // 1. Health Checks
    const h1 = await request('GET', '/health');
    results.push({ test: 'GET /health', status: h1.status, ms: h1.duration, ok: h1.status === 200 && h1.data.database === 'connected' });

    const h2 = await request('GET', '/api/database/health');
    results.push({ test: 'GET /api/database/health', status: h2.status, ms: h2.duration, ok: h2.status === 200 && h2.data.database === 'connected' });

    // 2. Student Register
    const studentData = {
      name: 'Smoke Test Student',
      roll_number: 'STD_SMOKE_' + Date.now(),
      department: 'CSE',
      email: 'smoke_std_' + Date.now() + '@test.local',
      password: 'TestPassword123!',
      hostel_block: 'A',
      room_number: '202'
    };
    const sReg = await request('POST', '/api/student/register', studentData);
    results.push({ test: 'POST /api/student/register', status: sReg.status, ms: sReg.duration, ok: sReg.status === 201 });

    // 3. Student Login
    const sLogin = await request('POST', '/api/student/login', {
      email: studentData.email,
      password: studentData.password
    });
    const studentToken = sLogin.data && sLogin.data.token;
    results.push({ test: 'POST /api/student/login', status: sLogin.status, ms: sLogin.duration, ok: sLogin.status === 200 && !!studentToken });

    // 4. Authenticated Student Endpoints
    if (studentToken) {
      const menu = await request('GET', '/api/menu/today', null, studentToken);
      results.push({ test: 'GET /api/menu/today', status: menu.status, ms: menu.duration, ok: menu.status === 200 });

      const settings = await request('GET', '/api/meal-settings/today', null, studentToken);
      results.push({ test: 'GET /api/meal-settings/today', status: settings.status, ms: settings.duration, ok: settings.status === 200 });

      const todayStr = new Date().toISOString().split('T')[0];
      const resCreate = await request('POST', '/api/reservations/create', {
        date: todayStr,
        meals: ['breakfast', 'lunch']
      }, studentToken);
      results.push({ test: 'POST /api/reservations/create', status: resCreate.status, ms: resCreate.duration, ok: resCreate.status === 200 || resCreate.status === 201 });

      const resHist = await request('GET', '/api/reservations/history', null, studentToken);
      results.push({ test: 'GET /api/reservations/history', status: resHist.status, ms: resHist.duration, ok: resHist.status === 200 });

      const resCancel = await request('POST', '/api/cancel-reservation', {
        date: todayStr,
        mealType: 'breakfast'
      }, studentToken);
      results.push({ test: 'POST /api/cancel-reservation', status: resCancel.status, ms: resCancel.duration, ok: resCancel.status === 200 });
    }

    // 5. Supervisor Register & Login
    const supData = {
      name: 'Smoke Test Supervisor',
      employee_id: 'SUP_SMOKE_' + Date.now(),
      department: 'Mess Administration',
      email: 'smoke_sup_' + Date.now() + '@test.local',
      password: 'TestPassword123!',
      role: 'supervisor'
    };
    const supReg = await request('POST', '/api/supervisor/register', supData);
    results.push({ test: 'POST /api/supervisor/register', status: supReg.status, ms: supReg.duration, ok: supReg.status === 201 });

    const supLogin = await request('POST', '/api/supervisor/login', {
      email: supData.email,
      password: supData.password
    });
    const supToken = supLogin.data && supLogin.data.token;
    results.push({ test: 'POST /api/supervisor/login', status: supLogin.status, ms: supLogin.duration, ok: supLogin.status === 200 && !!supToken });

    if (supToken) {
      const dash = await request('GET', '/api/dashboard', null, supToken);
      results.push({ test: 'GET /api/dashboard (verifyAdmin)', status: dash.status, ms: dash.duration, ok: dash.status === 200 });
    }

    console.log("\nSMOKE TEST SUMMARY:");
    console.table(results);

    const allPassed = results.every(r => r.ok);
    if (allPassed) {
      console.log("\n✅ ALL API SMOKE TESTS PASSED");
      process.exit(0);
    } else {
      console.error("\n❌ SOME API SMOKE TESTS FAILED");
      process.exit(1);
    }
  } catch (err) {
    console.error("❌ Exception during smoke test:", err);
    process.exit(1);
  }
})();
