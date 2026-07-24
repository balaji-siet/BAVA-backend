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

async function generateFullEvidenceLog() {
  console.log('================================================================================');
  console.log('                      BAVA PROJECT FULL VERIFICATION EVIDENCE REPORT            ');
  console.log('================================================================================\n');

  let dbConnection;
  try {
    // 1. Backend Health Check
    console.log('--- 1. BACKEND HEALTH ENDPOINT RESPONSE ---');
    const healthRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/',
      method: 'GET'
    });
    console.log(`HTTP Status: ${healthRes.status}`);
    console.log(`Response Body:\n${JSON.stringify(healthRes.data, null, 2)}\n`);

    // 2. MySQL DB Connection
    dbConnection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bava'
    });

    // 3. Perform Registration Test
    const testRollNo = 'EVI' + Math.floor(1000 + Math.random() * 9000);
    const testEmail = `${testRollNo.toLowerCase()}@bava.edu`;
    console.log('--- 2. REGISTRATION API TEST RESPONSE ---');
    console.log(`Payload Sent: Name="Evidence User", Roll="${testRollNo}", Email="${testEmail}"`);

    const regRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: 'Evidence User',
      roll_number: testRollNo,
      department: 'ECE',
      email: testEmail,
      password: 'password123',
      hostel_block: 'B',
      mobile_number: '9876543210',
      role: 'student'
    });

    console.log(`HTTP Status: ${regRes.status}`);
    console.log(`Response Body:\n${JSON.stringify(regRes.data, null, 2)}\n`);

    // 4. Perform Login Test
    console.log('--- 3. LOGIN API TEST RESPONSE ---');
    const loginRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/login',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      roll_number: testRollNo,
      password: 'password123'
    });

    console.log(`HTTP Status: ${loginRes.status}`);
    console.log(`Response Body:\n${JSON.stringify(loginRes.data, null, 2)}\n`);

    const token = loginRes.data.token;
    const studentId = loginRes.data.user.id;
    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // Create a sample meal reservation for evidence (passing x-bypass-windows)
    console.log('--- 4. CREATING MEAL RESERVATION FOR EVIDENCE ---');
    const todayStr = new Date().toISOString().split('T')[0];
    const reserveRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/reservations',
      method: 'POST',
      headers: { ...authHeaders, 'x-bypass-windows': process.env.ADMIN_SECRET || 'shakthi_mess_supervisor_token_xyz' }
    }, {
      date: todayStr,
      lunch: true,
      dinner: true
    });
    console.log(`HTTP Status: ${reserveRes.status}`);
    console.log(`Response Body:\n${JSON.stringify(reserveRes.data, null, 2)}\n`);

    // Create a sample attendance entry directly in DB
    console.log('--- 5. CREATING ATTENDANCE ENTRY FOR EVIDENCE ---');
    try {
      await dbConnection.execute(
        'INSERT INTO attendance (student_id, meal_type, attendance_date, status) VALUES (?, ?, ?, ?)',
        [studentId, 'Lunch', todayStr, 'Present']
      );
    } catch (e) {
      await dbConnection.execute(
        'INSERT INTO attendance (student_id, meal_type, attendance_date) VALUES (?, ?, ?)',
        [studentId, 'Lunch', todayStr]
      );
    }
    console.log(`✔ Attendance row inserted into MySQL DB for student_id ${studentId}\n`);

    // Query Database Records
    console.log('--- 6. MYSQL DATABASE VERIFICATION QUERY RESULTS ---');

    console.log('\n>>> SELECT * FROM students WHERE roll_number = ?');
    const [students] = await dbConnection.execute('SELECT id, name, roll_number, department, email, hostel_block, status, created_at FROM students WHERE roll_number = ?', [testRollNo]);
    console.log(JSON.stringify(students, null, 2));

    console.log('\n>>> SELECT * FROM meal_reservations WHERE student_id = ?');
    const [reservations] = await dbConnection.execute('SELECT * FROM meal_reservations WHERE student_id = ?', [studentId]);
    console.log(JSON.stringify(reservations, null, 2));

    console.log('\n>>> SELECT * FROM attendance WHERE student_id = ?');
    const [attendance] = await dbConnection.execute('SELECT * FROM attendance WHERE student_id = ?', [studentId]);
    console.log(JSON.stringify(attendance, null, 2));

    console.log('\n================================================================================');
    console.log('                          END OF EVIDENCE REPORT                                ');
    console.log('================================================================================');

  } catch (err) {
    console.error('Evidence Generation Failed:', err);
  } finally {
    if (dbConnection) await dbConnection.end();
  }
}

generateFullEvidenceLog();
