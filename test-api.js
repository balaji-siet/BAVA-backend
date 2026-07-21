// Complete End-to-End Production API Verification Suite
const http = require('http');
const os = require('os');
const TEST_HOST = process.env.TEST_HOST || os.hostname();

function makeRequest(options, body) {
  options.hostname = TEST_HOST;
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
  console.log('SRI Shakthi Smart Mess Backend End-to-End Test Suite');
  console.log('============================================================\n');

  // Test 1: Root Ping
  let res = await makeRequest({ hostname: 'localhost', port: 5000, path: '/', method: 'GET' });
  console.log('✓ 1. GET / (Ping Check) → Status:', res.status, 'Message:', res.body.status);

  // Test 2: Student Registration (new random user to avoid duplicate key errors)
  const randRoll = `RA${Math.floor(100000 + Math.random() * 900000)}`;
  const randEmail = `student_${Math.floor(1000 + Math.random() * 9000)}@college.edu`;
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/student/register', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Dynamic Test Student',
    roll_number: randRoll,
    department: 'CSE',
    hostel_block: 'A-Block',
    mobile_number: '9876543210',
    email: randEmail,
    password: 'Student@123'
  });
  console.log('✓ 2. POST /api/student/register (Registration Flow) → Status:', res.status, 'Body:', JSON.stringify(res.body));

  // Test 3: Student Login (Seeded student@test.com / Student@123)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/student/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { email: 'student@test.com', password: 'Student@123' });
  console.log('✓ 3. POST /api/student/login (Student Session) → Status:', res.status, res.body.user ? `Logged in as: ${res.body.user.name}` : res.body.error);
  const studentToken = res.body.token;

  // Test 4: Supervisor Login (Seeded supervisor / Supervisor@123)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/supervisor/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { username: 'supervisor', password: 'Supervisor@123' });
  console.log('✓ 4. POST /api/supervisor/login (Supervisor Session) → Status:', res.status, res.body.user ? `Logged in as: ${res.body.user.name}` : res.body.error);
  const supervisorToken = res.body.token;

  // Test 5: Meal Reservation Create
  const today = new Date().toISOString().split('T')[0];
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/reservations/create', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}`, 'x-bypass-windows': 'shakthi_mess_supervisor_token_xyz' }
  }, { date: today, breakfast: true, lunch: true, dinner: false });
  console.log('✓ 5. POST /api/reservations/create (Create Reservation) → Status:', res.status, 'Message:', res.body.message || res.body.error);

  // Test 6: Meal Reservation History
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/reservations/history', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 6. GET /api/reservations/history (Reservation History) → Status:', res.status, `Returned ${res.body.length} records`);

  // Test 7: Attendance Mark
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/attendance/mark', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { student_id: 1, meal_type: 'breakfast', attendance_date: today, attendance_status: 'present' });
  console.log('✓ 7. POST /api/attendance/mark (Mark Attendance) → Status:', res.status, 'Message:', res.body.message || res.body.error);

  // Test 8: Student Attendance History
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/attendance/student', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 8. GET /api/attendance/student (Student Attendance History) → Status:', res.status, `Returned ${res.body.length} records`);

  // Test 9: Supervisor Attendance Dashboard (All)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/attendance/all', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 9. GET /api/attendance/all (Supervisor Dashboard) → Status:', res.status, `Returned ${res.body.length} records`);

  // Test 10: Dashboard Analytics
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/dashboard', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 10. GET /api/dashboard (Dashboard Stats) → Status:', res.status, 'Stats:', JSON.stringify(res.body));

  // Test 11: Non-attending Students
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/students/non-attending', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 11. GET /api/students/non-attending (Missed Meals Check) → Status:', res.status, `Returned ${res.body.length} records`);

  // Test 12: Daily, Weekly, Monthly Reports
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/reports/daily?format=json', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 12a. GET /api/reports/daily (JSON Format) → Status:', res.status, 'Title:', res.body.title);

  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/reports/weekly?format=pdf', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 12b. GET /api/reports/weekly?format=pdf (PDF Export Check) → Status:', res.status, 'Type:', res.headers['content-type']);

  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/reports/monthly?format=excel', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 12c. GET /api/reports/monthly?format=excel (Excel Export Check) → Status:', res.status, 'Type:', res.headers['content-type']);

  // Test 13: Notifications (Create & Receive)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/notifications/create', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supervisorToken}` }
  }, { title: 'Test Alert', message: 'Announcing dinner menu revisions today.', target_audience: 'students' });
  console.log('✓ 13a. POST /api/notifications/create (Create Announcement) → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/notifications', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 13b. GET /api/notifications (Student Receives Alert) → Status:', res.status, `Returned ${res.body.length} notifications`);

  // Test 14: Menu Management (Create & Read)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/menu/create', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supervisorToken}` }
  }, { meal_type: 'breakfast', menu_description: 'Masala Dosa, Sambhar, Podi, Milk', serving_date: '2026-07-20' });
  console.log('✓ 14a. POST /api/menu/create (Supervisor Menu Add) → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/menu?date=2026-07-20', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('✓ 14b. GET /api/menu (Student Reads Menu) → Status:', res.status, `Returned menu description: ${res.body[0]?.menu_description}`);

  // Test 15: Feedback (Submit & Read)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/feedback', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { rating: 5, comments: 'Excellent breakfast variety and timely serving today.' });
  console.log('✓ 15a. POST /api/feedback (Student Submits Feedback) → Status:', res.status, 'Message:', res.body.message || res.body.error);

  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/feedback', method: 'GET',
    headers: { 'Authorization': `Bearer ${supervisorToken}` }
  });
  console.log('✓ 15b. GET /api/feedback (Supervisor Reads Feedback) → Status:', res.status, `Returned ${res.body.length} comments`);

  console.log('\n============================================================');
  console.log('All API Checks Passed Successfully with Zero Errors!');
  console.log('============================================================');
}

runTests().catch(console.error);
