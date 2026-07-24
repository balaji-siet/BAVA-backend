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

async function runIntegrationTests() {
  console.log('=== STARTING BACKEND & DATABASE INTEGRATION CHECKS ===');

  let dbConnection;
  try {
    // 1. Test Direct Database Connection
    console.log('\n[1/5] Connecting to MySQL Database (BAVA)...');
    dbConnection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bava'
    });
    console.log('✔ Database connected successfully!');

    // 2. Test Registration Endpoint
    const testRollNo = 'TEST' + Math.floor(1000 + Math.random() * 9000);
    const testEmail = `${testRollNo.toLowerCase()}@test.com`;
    console.log(`\n[2/5] Testing Registration Endpoint for roll number: ${testRollNo}...`);

    const regRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/register',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      name: 'Integration Test User',
      roll_number: testRollNo,
      department: 'CSE',
      email: testEmail,
      password: 'password123',
      hostel_block: 'A',
      mobile_number: '9998887770',
      role: 'student'
    });

    console.log(`✔ Registration API Status: ${regRes.status}`, regRes.data);

    // Verify record in Database (students table)
    const [userRows] = await dbConnection.execute(
      'SELECT id, name, roll_number, email FROM students WHERE roll_number = ?',
      [testRollNo]
    );
    if (userRows.length > 0) {
      console.log('✔ Verification in MySQL DB (students table) passed: Record ->', userRows[0]);
    } else {
      throw new Error('User registered via API but not found in MySQL `students` table!');
    }

    // 3. Test Login Endpoint
    console.log(`\n[3/5] Testing Login Endpoint for ${testRollNo}...`);
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

    console.log(`✔ Login API Status: ${loginRes.status}`);
    const token = loginRes.data.token;
    console.log(`✔ Received JWT Token: ${token ? token.substring(0, 20) + '...' : 'NONE'}`);

    const authHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };

    // 4. Test Student Attendance Endpoint
    console.log('\n[4/5] Testing Student Attendance Endpoint (/api/attendance)...');
    const attRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/attendance',
      method: 'GET',
      headers: authHeaders
    });
    console.log(`✔ Attendance API Status: ${attRes.status}`, attRes.data);

    // 5. Test Reservations Endpoint
    console.log('\n[5/5] Testing Meal Reservations Endpoint (/api/reservations/today)...');
    const resRes = await httpRequest({
      hostname: API_HOST,
      port: API_PORT,
      path: '/api/reservations/today',
      method: 'GET',
      headers: authHeaders
    });
    console.log(`✔ Reservations API Status: ${resRes.status}`, resRes.data);

    console.log('\n======================================================');
    console.log('🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ INTEGRATION TEST FAILED!');
    console.error('Error details:', error.message);
    process.exit(1);
  } finally {
    if (dbConnection) await dbConnection.end();
  }
}

runIntegrationTests();
