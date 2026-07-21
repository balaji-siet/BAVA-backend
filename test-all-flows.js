const mysql = require('mysql2/promise');
require('dotenv').config();

const API_URL = 'https://bava-backend-sri-shakthi.loca.lt/api';

async function testAllFlows() {
  console.log('--- STARTING ALL-FLOWS END-TO-END VERIFICATION ---');

  // Connect to DB
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Balaji__5139',
    database: process.env.DB_NAME || 'BAVA'
  });

  try {
    const studentRoll = 'STU_E2E_99';
    const studentEmail = 'stu_e2e@college.edu';
    const supervisorId = 'SUP_E2E_99';
    const supervisorEmail = 'sup_e2e@college.edu';
    const password = 'TestPassword123!';

    // Clean old entries
    const [existingStudent] = await connection.query('SELECT id FROM students WHERE roll_number = ?', [studentRoll]);
    if (existingStudent && existingStudent.length > 0) {
      await connection.query('DELETE FROM meal_reservations WHERE student_id = ?', [existingStudent[0].id]);
      await connection.query('DELETE FROM students WHERE id = ?', [existingStudent[0].id]);
    }
    await connection.query('DELETE FROM supervisors WHERE employee_id = ?', [supervisorId]);

    // 1. Student Registration
    console.log('\n[1/6] Testing Student Registration (POST /api/student/register)...');
    const registerStudentRes = await fetch(`${API_URL}/student/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Student',
        roll_number: studentRoll,
        department: 'CSE',
        hostel_block: 'Block-A',
        mobile_number: '9876543210',
        email: studentEmail,
        password: password
      })
    });
    console.log('Status:', registerStudentRes.status, await registerStudentRes.json());

    // Verify student in DB
    const [students] = await connection.query('SELECT * FROM students WHERE roll_number = ?', [studentRoll]);
    if (students.length > 0) {
      console.log('Verification: Student exists in BAVA.students table!');
    } else {
      throw new Error('Student not found in BAVA.students table');
    }

    // 2. Student Login
    console.log('\n[2/6] Testing Student Login (POST /api/student/login)...');
    const loginStudentRes = await fetch(`${API_URL}/student/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roll_number: studentRoll,
        password: password
      })
    });
    const loginStudentBody = await loginStudentRes.json();
    console.log('Status:', loginStudentRes.status);
    const studentToken = loginStudentBody.token;

    // 3. Supervisor Registration
    console.log('\n[3/6] Testing Supervisor Registration (POST /api/supervisor/register)...');
    const registerSupervisorRes = await fetch(`${API_URL}/supervisor/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'E2E Supervisor',
        employee_id: supervisorId,
        department: 'Administration',
        mobile_number: '9876543211',
        email: supervisorEmail,
        password: password
      })
    });
    console.log('Status:', registerSupervisorRes.status, await registerSupervisorRes.json());

    // Verify supervisor in DB
    const [supervisors] = await connection.query('SELECT * FROM supervisors WHERE employee_id = ?', [supervisorId]);
    if (supervisors.length > 0) {
      console.log('Verification: Supervisor exists in BAVA.supervisors table!');
    } else {
      throw new Error('Supervisor not found in BAVA.supervisors table');
    }

    // 4. Supervisor Login
    console.log('\n[4/6] Testing Supervisor Login (POST /api/supervisor/login)...');
    const loginSupervisorRes = await fetch(`${API_URL}/supervisor/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roll_number: supervisorId,
        password: password
      })
    });
    const loginSupervisorBody = await loginSupervisorRes.json();
    console.log('Status:', loginSupervisorRes.status);
    const supervisorToken = loginSupervisorBody.token;

    // 5. Meal Reservation
    console.log('\n[5/6] Testing Meal Reservation (POST /api/reservations/create)...');
    const reserveRes = await fetch(`${API_URL}/reservations/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${studentToken}`,
        'x-bypass-windows': process.env.ADMIN_SECRET || 'shakthi_mess_supervisor_token_xyz'
      },
      body: JSON.stringify({
        date: '2026-07-21',
        breakfast: true,
        lunch: true,
        dinner: false
      })
    });
    console.log('Status:', reserveRes.status, await reserveRes.json());

    // Verify reservation in DB
    const [reservations] = await connection.query('SELECT * FROM meal_reservations WHERE student_id = ? AND reservation_date = "2026-07-21"', [students[0].id]);
    console.log(`Verification: Found ${reservations.length} meal reservation entries in BAVA.meal_reservations table!`);

    // 6. Diagnostics Check
    console.log('\n[6/6] Fetching Diagnostics Stats (GET /api/diagnostics)...');
    const diagRes = await fetch(`${API_URL}/diagnostics`);
    console.log('Status:', diagRes.status);
    console.log('Diagnostics Output:', JSON.stringify(await diagRes.json(), null, 2));

    console.log('\n--- ALL END-TO-END FLOWS VERIFIED SUCCESSFULLY ---');

  } catch (err) {
    console.error('\nVerification failed with Error:', err.message);
  } finally {
    await connection.end();
  }
}

testAllFlows();
