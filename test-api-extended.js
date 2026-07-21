// Extended API Tests
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
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runExtendedTests() {
  console.log('=== Extended API Tests ===\n');

  // Get admin token first
  let res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'admin', password: 'shakthi_mess_supervisor_token_xyz' });
  const adminToken = res.body.token;

  // Get student token
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/login', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { roll_number: 'RA1001', password: 'Secret123' });
  const studentToken = res.body.token;

  // Test: Register new student
  const ts = Date.now();
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/register', method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, {
    name: 'Test Student',
    roll_number: `RTEST${ts}`,
    department: 'CSE',
    email: `test${ts}@college.edu`,
    password: 'Test@123'
  });
  console.log('1. POST /api/register →', res.status, res.body.message || res.body.error);

  // Test: NFC scan with valid NFC UID (Alice's NFC: 04A12B34C56D)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/scan', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nfc-device-key': 'shakthi_nfc_hardware_device_secret_key_12345' }
  }, { nfc_uid: '04A12B34C56D' });
  console.log('2. POST /api/nfc/scan (Alice) →', res.status, res.body.success ? `Marked ${res.body.meal_type}` : res.body.error);

  // Test: NFC scan with invalid key
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/scan', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nfc-device-key': 'wrong-key' }
  }, { nfc_uid: '04A12B34C56D' });
  console.log('3. POST /api/nfc/scan (bad key) →', res.status, res.body.error);

  // Test: NFC scan with invalid UID
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/scan', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-nfc-device-key': 'shakthi_nfc_hardware_device_secret_key_12345' }
  }, { nfc_uid: 'FAKEID00' });
  console.log('4. POST /api/nfc/scan (unknown UID) →', res.status, res.body.error);

  // Test: Student attendance (me)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/attendance/me', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('5. GET /api/nfc/attendance/me →', res.status, `status=${res.body.today_status}, %=${res.body.attendance_percentage}`);

  // Test: NFC today dashboard stats (admin)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/attendance/today', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('6. GET /api/nfc/attendance/today (admin) →', res.status, JSON.stringify(res.body));

  // Test: Non-attending students
  const today = new Date().toISOString().split('T')[0];
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: `/api/nfc/non-attending?date=${today}&meal_type=lunch`, method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('7. GET /api/nfc/non-attending →', res.status, `${(res.body || []).length} students`);

  // Test: Save food rating
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/ratings', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${studentToken}` }
  }, { meal_type: 'lunch', rating: 4, comment: 'Good food today!' });
  console.log('8. POST /api/ratings →', res.status, res.body.message || res.body.error);

  // Test: Get today's ratings
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/ratings/today', method: 'GET',
    headers: { 'Authorization': `Bearer ${studentToken}` }
  });
  console.log('9. GET /api/ratings/today →', res.status, `${(res.body || []).length} ratings`);

  // Test: Rating analytics (admin)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/ratings/analytics', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('10. GET /api/ratings/analytics (admin) →', res.status, `${(res.body.summary || []).length} meal types`);

  // Test: Attendance reports
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/reports?mode=daily', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('11. GET /api/nfc/reports?mode=daily →', res.status, JSON.stringify(res.body));

  // Test: Waste analytics
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/waste-analytics', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('12. GET /api/nfc/waste-analytics →', res.status, JSON.stringify(res.body));

  // Test: Student attendance by roll number (admin)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/attendance/student/RA1001', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('13. GET /api/nfc/attendance/student/RA1001 →', res.status, `${res.body.student_name}, status=${res.body.today_status}`);

  // Test: Award points (admin)
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/admin/award-points', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
  }, { rollNumber: 'RA1001', points: 20 });
  console.log('14. POST /api/admin/award-points →', res.status, res.body.message || res.body.error);

  // Test: Save forecast (admin)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/forecasts', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminToken}` }
  }, { date: tomorrowStr, meal_type: 'breakfast', predicted_count: 175 });
  console.log('15. POST /api/forecasts (admin) →', res.status, res.body.message || res.body.error);

  // Test: Unauthorized access
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/attendance/today', method: 'GET',
    headers: { 'Authorization': 'Bearer faketoken' }
  });
  console.log('16. GET /api/attendance/today (bad token) →', res.status, res.body.error);

  // Test: Export CSV
  res = await makeRequest({
    hostname: TEST_HOST, port: 5000, path: '/api/nfc/reports/export', method: 'GET',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  console.log('17. GET /api/nfc/reports/export →', res.status, typeof res.body === 'string' ? `CSV (${res.body.length} chars)` : JSON.stringify(res.body));

  console.log('\n=== All Extended Tests Complete ===');
}

runExtendedTests().catch(console.error);
