const fs = require('fs');
const path = require('path');
require('dotenv').config();

const mysql = require('mysql2/promise');

async function run() {
  try {
    // Connect without specifying database to ensure it exists
    const adminPool = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      multipleStatements: true,
    });
    await adminPool.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\`;`);
    await adminPool.end();

    // Now connect to the target database
    const pool = mysql.createPool({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });

    const schemaPath = path.resolve(__dirname, '../../../database/schema.sql');
    const seedsPath = path.resolve(__dirname, '../../../database/seeds.sql');
    if (!fs.existsSync(schemaPath)) {
      console.error('Schema file not found at', schemaPath);
      process.exit(1);
    }
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    const statements = schemaSql.split(';').map(s => s.trim()).filter(s => s.length);
    for (const stmt of statements) {
      try {
        await pool.query(stmt);
      } catch (e) {
        console.warn('Schema stmt error (may be benign):', e.message);
      }
    }
    console.log('✅ Schema applied.');

    if (fs.existsSync(seedsPath)) {
      const seedsSql = fs.readFileSync(seedsPath, 'utf8');
      const seedStmts = seedsSql.split(';').map(s => s.trim()).filter(s => s.length);
      for (const stmt of seedStmts) {
        try {
          await pool.query(stmt);
        } catch (e) {
          console.warn('Seed stmt error (may be duplicate):', e.message);
        }
      }
      console.log('✅ Seeds applied (if any).');
    }
    await pool.end();
  } catch (err) {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  }
}

run();
