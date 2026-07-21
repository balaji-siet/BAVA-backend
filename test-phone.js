// Quick phone-scenario test: POST /api/login with { roll_number, password }
const http = require('http');
const os = require('os');
const TEST_HOST = process.env.TEST_HOST || os.hostname();

function req(opts, body) {
  opts.hostname = TEST_HOST;
  return new Promise((resolve, reject) => {
    const r = http.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve({ s: res.statusCode, b: JSON.parse(d) }); } catch(e) { resolve({ s: res.statusCode, b: d }); } });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function run() {
  console.log('=== Phone Login Scenario Tests ===\n');
  console.log(`Using Test Host: ${TEST_HOST}\n`);

  // 1. Student login via /api/login with roll_number field (what the phone sends)
  let r = await req({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'student@test.com', password: 'Student@123' });
  console.log('1. POST /api/login {roll_number} (Student) →', r.s, r.b.user ? `OK: ${r.b.user.name}` : `FAIL: ${r.b.error}`);

  // 2. Student login via /api/login with RA roll number
  r = await req({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'RA1001', password: 'Secret123' });
  console.log('2. POST /api/login {roll_number: RA1001} →', r.s, r.b.user ? `OK: ${r.b.user.name}` : `FAIL: ${r.b.error}`);

  // 3. Supervisor login via /api/login with roll_number field (admin username)
  r = await req({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'supervisor', password: 'Supervisor@123' });
  console.log('3. POST /api/login {roll_number: supervisor} →', r.s, r.b.user ? `OK: ${r.b.user.name} (role: ${r.b.user.role})` : `FAIL: ${r.b.error}`);

  // 4. Supervisor login via /api/login with admin credentials
  r = await req({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'admin', password: 'shakthi_mess_supervisor_token_xyz' });
  console.log('4. POST /api/login {roll_number: admin} →', r.s, r.b.user ? `OK: ${r.b.user.name} (role: ${r.b.user.role})` : `FAIL: ${r.b.error}`);

  // 5. Registration via /api/register (what the phone sends)
  const rr = `RA${Math.floor(100000+Math.random()*900000)}`;
  r = await req({
    hostname: TEST_HOST, port: 5000, path: '/api/register', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { name: 'Phone User', roll_number: rr, department: 'IT', email: `phone_${Date.now()}@test.com`, password: 'Phone@123' });
  console.log('5. POST /api/register (New User) →', r.s, JSON.stringify(r.b));

  console.log('\n=== All Phone Scenarios Complete ===');
}

run().catch(console.error);
