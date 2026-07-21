const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
  try {
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 1,
      queueLimit: 0,
    });
    const [rows] = await pool.query('SELECT 1 AS test');
    console.log('✅ MySQL connection successful. Test query result:', rows);
    await pool.end();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    console.error(err);
    process.exit(1);
  }
}

testConnection();
