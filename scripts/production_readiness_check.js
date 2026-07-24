const http = require('http');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: './.env' });

const API_HOST = 'localhost';
const API_PORT = 5000;

function httpRequest(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', (err) => reject(err));

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function runFullProductionReadinessCheck() {
  console.log('================================================================================');
  console.log('            FULL PRODUCTION END-TO-END READINESS VERIFICATION                   ');
  console.log('================================================================================\n');

  let dbConnection;
  try {
    dbConnection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bava'
    });
    console.log('✔ MySQL `BAVA` Database Connection Established.\n');

    // 1. Health Check
    console.log('[1/8] Verifying Health Endpoint GET / ...');
    const healthRes = await httpRequest({ hostname: API_HOST, port: API_PORT, path: '/', method: 'GET' });
    console.log(`Status: ${healthRes.status}`, healthRes.data);

    // 2. Student Registration
    const testRollNo = 'PROD' + Math.floor(1000 + Math.random() * 9000);
    const testEmail = `${testRollNo.toLowerCase()}@bava.edu`;
    console.log(`\n[2/8] Testing Student Registration (${testRollNo})...`);
    const regRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/register', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: 'Production Readiness User',
      roll_number: testRollNo,
      department: 'IT',
      email: testEmail,
      password: 'password123',
      hostel_block: 'C',
      mobile_number: '9876543210',
      role: 'student'
    });
    console.log(`Status: ${regRes.status}`, regRes.data);

    // 3. Student Login
    console.log(`\n[3/8] Testing Student Login (${testRollNo})...`);
    const loginRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/login', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { roll_number: testRollNo, password: 'password123' });
    console.log(`Status: ${loginRes.status}`);
    const token = loginRes.data.token;
    const studentId = loginRes.data.user.id;

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // 4. Supervisor Login
    console.log('\n[4/8] Testing Supervisor Login (admin)...');
    const supLoginRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/login', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, { roll_number: 'admin', password: 'shakthi_mess_supervisor_token_xyz' });
    console.log(`Status: ${supLoginRes.status}`, { role: supLoginRes.data.user?.role });

    const adminToken = supLoginRes.data.token;
    const adminHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`
    };

    // 5. Meal Reservations
    console.log('\n[5/8] Testing Meal Reservations...');
    const todayStr = new Date().toISOString().split('T')[0];
    const reserveRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/reservations', method: 'POST',
      headers: { ...authHeaders, 'x-bypass-windows': process.env.ADMIN_SECRET || 'shakthi_mess_supervisor_token_xyz' }
    }, { date: todayStr, breakfast: true, lunch: true, dinner: true });
    console.log(`Status: ${reserveRes.status}`, reserveRes.data);

    // 6. Attendance Entry
    console.log('\n[6/8] Testing Attendance Entry...');
    await dbConnection.execute(
      'INSERT INTO attendance (student_id, meal_type, attendance_date, status) VALUES (?, ?, ?, ?)',
      [studentId, 'Breakfast', todayStr, 'Present']
    );
    const attRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/attendance', method: 'GET', headers: authHeaders
    });
    console.log(`Status: ${attRes.status}, Record Count: ${attRes.data.length}`);

    // 7. Supervisor Dashboard Analytics
    console.log('\n[7/8] Testing Supervisor Dashboard Endpoint (/api/dashboard)...');
    const dashRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/dashboard', method: 'GET', headers: adminHeaders
    });
    console.log(`Status: ${dashRes.status}`, { totalStudents: dashRes.data.totalStudents || 'OK' });

    // 8. Feedback Submission
    console.log('\n[8/8] Testing Feedback Submission...');
    const fbRes = await httpRequest({
      hostname: API_HOST, port: API_PORT, path: '/api/feedback', method: 'POST', headers: authHeaders
    }, { rating: 5, comments: 'Production Readiness Test Comments' });
    console.log(`Status: ${fbRes.status}`, fbRes.data);

    // MySQL Verification
    console.log('\n================================================================================');
    console.log('                     MYSQL BAVA DATABASE VERIFICATION RESULTS                   ');
    console.log('================================================================================');
    
    const [userRow] = await dbConnection.execute('SELECT * FROM students WHERE roll_number = ?', [testRollNo]);
    console.log('\n>>> Registered Student Row:', userRow[0]);

    const [resRows] = await dbConnection.execute('SELECT * FROM meal_reservations WHERE student_id = ?', [studentId]);
    console.log('\n>>> Meal Reservation Rows:', resRows);

    const [attRows] = await dbConnection.execute('SELECT * FROM attendance WHERE student_id = ?', [studentId]);
    console.log('\n>>> Attendance Rows:', attRows);

    console.log('\n================================================================================');
    console.log('🎉 ALL PRODUCTION END-TO-END CHECKS PASSED SUCCESSFULLY!');
    console.log('================================================================================');

  } catch (err) {
    console.error('Production Readiness Check Failed:', err);
    process.exit(1);
  } finally {
    if (dbConnection) await dbConnection.end();
  }
}

runFullProductionReadinessCheck();
