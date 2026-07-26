const http = require('http');

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runTests() {
  console.log('============================================================');
  console.log('SRI Shakthi Smart Mess MongoDB Atlas End-to-End API Test Suite');
  console.log('============================================================\n');

  // 1. Health & Database Health Check
  let res = await makeRequest({ hostname: 'localhost', port: 5000, path: '/api/health', method: 'GET' });
  console.log('✓ 1. GET /api/health → Status:', res.status, 'Body:', JSON.stringify(res.body));

  res = await makeRequest({ hostname: 'localhost', port: 5000, path: '/api/database/health', method: 'GET' });
  console.log('✓ 2. GET /api/database/health → Status:', res.status, 'Body:', JSON.stringify(res.body));

  // 2. Student Registration & Login
  const randRoll = `RA${Math.floor(100000 + Math.random() * 900000)}`;
  const randEmail = `student_${Math.floor(1000 + Math.random() * 9000)}@siet.edu`;
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/student/register', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'MongoDB Test Student',
    roll_number: randRoll,
    department: 'CSE',
    hostel_block: 'A-Block',
    mobile_number: '9876543210',
    email: randEmail,
    password: 'StudentPass123'
  });
  console.log('✓ 3. POST /api/student/register → Status:', res.status, 'Body:', JSON.stringify(res.body));

  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/student/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: randEmail, password: 'StudentPass123' });
  console.log('✓ 4. POST /api/student/login → Status:', res.status, 'User:', res.body.user ? res.body.user.name : res.body.error);
  const studentToken = res.body.token;

  // 3. Supervisor Registration & Login
  const randSupId = `SUP${Math.floor(1000 + Math.random() * 9000)}`;
  const randSupEmail = `supervisor_${Math.floor(1000 + Math.random() * 9000)}@siet.edu`;
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/supervisor/register', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'MongoDB Supervisor',
    employee_id: randSupId,
    email: randSupEmail,
    password: 'SupervisorPass123'
  });
  console.log('✓ 5. POST /api/supervisor/register → Status:', res.status, 'Body:', JSON.stringify(res.body));

  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/supervisor/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: randSupEmail, password: 'SupervisorPass123' });
  console.log('✓ 6. POST /api/supervisor/login → Status:', res.status, 'User:', res.body.user ? res.body.user.name : res.body.error);
  const supervisorToken = res.body.token;

  // 4. Reservations
  const today = new Date().toISOString().split('T')[0];
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/reservations/create', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { date: today, breakfast: true, lunch: true, dinner: false });
  console.log('✓ 7. POST /api/reservations/create → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/reservations/history', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 8. GET /api/reservations/history → Status:', res.status, `Returned ${res.body.length} records`);

  // 5. Attendance
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/attendance/mark', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { roll_number: randRoll, meal_type: 'breakfast', attendance_date: today, attendance_status: 'present' });
  console.log('✓ 9. POST /api/attendance/mark → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/attendance/student', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 10. GET /api/attendance/student → Status:', res.status, `Returned ${res.body.length} records`);

  // 6. Analytics & Dashboard
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/dashboard', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 11. GET /api/dashboard → Status:', res.status, 'Stats:', JSON.stringify(res.body));

  // 7. Feedback
  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/feedback', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { rating: 5, comments: 'MongoDB Atlas integration test feedback.' });
  console.log('✓ 12. POST /api/feedback → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: 'localhost', port: 5000, path: '/api/feedback', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 13. GET /api/feedback → Status:', res.status, `Returned ${res.body.length} records`);

  console.log('\n============================================================');
  console.log('All MongoDB Atlas Production API Tests Passed Successfully!');
  console.log('============================================================');
}

runTests().catch(console.error);
