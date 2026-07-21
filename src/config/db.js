const fs = require('fs');
const path = require('path');
require('dotenv').config();

let pool;
let isSQLite = false;
let sqliteDb = null;

// Determine if we should use MySQL or fallback to SQLite
const useMySQL = process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME;

if (useMySQL) {
  const mysql = require('mysql2/promise');
  console.log('Database Config: Connecting to MySQL database...');
  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  
  // Test connection on startup
  pool.query('SELECT 1')
    .then(() => {
      console.log('Connected to BAVA Database');
    })
    .catch((err) => {
      console.error('Database Connection Error:', err.message);
    });

  initializeMySQLDb(pool);
} else {
  isSQLite = true;
  console.log('Database Config: MySQL credentials not found in env. Falling back to local SQLite...');
  
  const sqlite3 = require('sqlite3').verbose();
  const dbDir = path.resolve(__dirname, '../../../database');
  
  // Create database folder if it doesn't exist
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  
  const dbPath = path.join(dbDir, 'smart_mess.db');
  sqliteDb = new sqlite3.Database(dbPath);
  
  // Enable foreign keys in SQLite
  sqliteDb.run('PRAGMA foreign_keys = ON;');
  
  // Promisified initialization
}

async function initializeMySQLDb(poolInstance) {
  try {
    // 1. Ensure students table columns exist
    try {
      await poolInstance.query("ALTER TABLE students ADD COLUMN status VARCHAR(20) DEFAULT 'active'");
    } catch (e) { /* ignore duplicate column error */ }

    try {
      await poolInstance.query("ALTER TABLE students ADD COLUMN points INT DEFAULT 0");
    } catch (e) { /* ignore duplicate column error */ }

    // 2. Ensure supervisors table columns exist
    try {
      await poolInstance.query("ALTER TABLE supervisors ADD COLUMN role VARCHAR(50) DEFAULT 'supervisor'");
    } catch (e) { /* ignore duplicate column error */ }

    // 3. Adapt columns in meal_reservations or supervisors
    console.log('Database Config: MySQL schema columns verified successfully.');
  } catch (err) {
    console.error('MySQL schema initialization error:', err.message);
  }
}

// Convert MySQL SQL dialect to SQLite SQL dialect
function convertMySQLToSQLite(mysqlSql) {
  return mysqlSql
    // Remove AUTO_INCREMENT constructs
    .replace(/INT NOT NULL AUTO_INCREMENT/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/INT AUTO_INCREMENT/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    // Remove individual PRIMARY KEY constraints since we inline them above
    .replace(/PRIMARY KEY\s*\(id\),?/gi, '')
    // Replace MySQL ENUMs with SQLite TEXT
    .replace(/ENUM\([^)]+\)/gi, "TEXT")
    // Replace TIME or TIMESTAMP fields if needed
    .replace(/TIME NOT NULL/gi, "TEXT NOT NULL")
    // Clean up trailing commas in table definition lists
    .replace(/,\s*\n\s*\)/g, '\n)')
    .replace(/,\s*\r\n\s*\)/g, '\r\n)');
}

async function initializeSQLiteDb(dbPath) {
  const schemaPath = path.resolve(__dirname, '../../../database/schema.sql');
  const seedsPath = path.resolve(__dirname, '../../../database/seeds.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found at ${schemaPath}`);
    return;
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf8');
  const sqliteSchema = convertMySQLToSQLite(schemaContent);
  
  // Split statements by semicolon and filter out empty ones
  const statements = sqliteSchema
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // Execute schema creation
  sqliteDb.serialize(() => {
    statements.forEach(stmt => {
      sqliteDb.run(stmt, (err) => {
        if (err) {
          console.error('Error running schema statement:', stmt, err.message);
        }
      });
    });
    
    // Ensure points column exists in Students
    sqliteDb.run("ALTER TABLE Students ADD COLUMN points INT DEFAULT 0", (err) => {
      if (err && !err.message.includes("duplicate column name") && !err.message.includes("already exists")) {
        // SQLite throws "duplicate column name: points" if it already exists
        // Just ignore it, otherwise log error
      }
    });
    
    // Check if database needs seeding
    sqliteDb.get("SELECT COUNT(*) as count FROM students", (err, row) => {
      if (err || (row && row.count === 0)) {
        console.log('Seeding SQLite database with initial data...');
        if (fs.existsSync(seedsPath)) {
          const seedsContent = fs.readFileSync(seedsPath, 'utf8');
          const seedStatements = seedsContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);
            
          sqliteDb.serialize(() => {
            seedStatements.forEach(stmt => {
              sqliteDb.run(stmt, (seedErr) => {
                if (seedErr) {
                  // Ignore unique constraint errors on seeding if it runs multiple times
                  if (!seedErr.message.includes('UNIQUE constraint failed')) {
                    console.error('Error running seed statement:', stmt, seedErr.message);
                  }
                }
              });
            });
            console.log('SQLite database seeded successfully.');
          });
        } else {
          console.log(`Seeds file not found at ${seedsPath}`);
        }
      }
    });
  });
}

// Unified query wrapper
function query(sql, params = []) {
  if (!useMySQL) {
    return new Promise((resolve, reject) => {
      const trimmedSql = sql.trim().toUpperCase();
      const isInsert = trimmedSql.startsWith('INSERT');
      const isUpdateOrDelete = trimmedSql.startsWith('UPDATE') || trimmedSql.startsWith('DELETE');
      
      if (isInsert || isUpdateOrDelete) {
        sqliteDb.run(sql, params, function(err) {
          if (err) return reject(err);
          // Return the layout expected by mysql2: [ResultObject, Fields]
          resolve([{ insertId: this.lastID, affectedRows: this.changes }, null]);
        });
      } else {
        sqliteDb.all(sql, params, (err, rows) => {
          if (err) return reject(err);
          // Return the layout expected by mysql2: [Rows, Fields]
          resolve([rows, null]);
        });
      }
    });
  } else {
    return pool.query(sql, params);
  }
}

module.exports = {
  query,
  isSQLite,
  useMySQL
};
