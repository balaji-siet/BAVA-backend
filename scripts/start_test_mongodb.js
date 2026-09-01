const { MongoMemoryServer } = require('mongodb-memory-server');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const dataDir = path.join(__dirname, '..', '..', 'database', 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    console.log("Starting local test MongoDB server on port 27017...");
    const mongod = await MongoMemoryServer.create({
      spawn: {
        timeout: 60000
      },
      instance: {
        port: 27017,
        dbName: 'smartmess_test',
        ip: '127.0.0.1'
      }
    });

    const uri = mongod.getUri();
    console.log(`============================================================`);
    console.log(`✅ MongoDB local test server STARTED SUCCESSFULLY`);
    console.log(`URI: ${uri}`);
    console.log(`Port: 27017`);
    console.log(`Bind IP: 127.0.0.1`);
    console.log(`Database: smartmess_test`);
    console.log(`Data Directory: ${dataDir}`);
    console.log(`============================================================`);

    // Keep process alive while serving
    setInterval(() => {}, 1000 * 60 * 60);

    process.on('SIGINT', async () => {
      console.log('Stopping test MongoDB server...');
      await mongod.stop();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('Stopping test MongoDB server...');
      await mongod.stop();
      process.exit(0);
    });
  } catch (err) {
    console.error("❌ Failed to start MongoMemoryServer:", err);
    process.exit(1);
  }
})();
