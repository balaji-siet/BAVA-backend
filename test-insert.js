const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function runRehearsal() {
  console.log('--- STARTING DATABASE REHEARSAL ---');
  console.log('Target Database:', process.env.DB_NAME || 'BAVA');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'Balaji__5139',
    database: process.env.DB_NAME || 'BAVA'
  });

  try {
    // Check if test student already exists
    const testRoll = '25cy010';
    const testName = 'Balaji';
    const testEmail = 'balaji@college.edu';
    const testPassword = 'BalajiPassword123';

    const [rows] = await connection.query('SELECT id FROM students WHERE roll_number = ?', [testRoll]);
    
    if (rows.length > 0) {
      console.log(`Student with roll number ${testRoll} already exists. Removing old record for clean rehearsal...`);
      await connection.query('DELETE FROM students WHERE roll_number = ?', [testRoll]);
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(testPassword, salt);

    // Insert student
    console.log(`Inserting: Name="${testName}", Roll="${testRoll}" into BAVA.students...`);
    await connection.query(
      'INSERT INTO students (name, roll_number, department, hostel_block, mobile_number, email, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [testName, testRoll, 'CSE', 'Hostel-Block-A', '9876543210', testEmail, passwordHash, 'active']
    );
    console.log('Student Inserted Successfully!');

    // Fetch and display
    console.log('\n--- VERIFYING INSERTION (SELECT * FROM students) ---');
    const [students] = await connection.query('SELECT id, name, roll_number, email, department, status, created_at FROM students WHERE roll_number = ?', [testRoll]);
    console.log(JSON.stringify(students, null, 2));

  } catch (err) {
    console.error('Rehearsal failed with SQL Error:', err.message);
  } finally {
    await connection.end();
    console.log('--- REHEARSAL COMPLETED ---');
  }
}

runRehearsal();
