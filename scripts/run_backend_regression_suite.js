const { MongoMemoryServer } = require('mongodb-memory-server');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function waitForHealth(port, maxAttempts = 30) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
      });
      req.on('error', () => {});
      req.end();
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        reject(new Error(`Timeout waiting for http://127.0.0.1:${port}/health`));
      }
    }, 1000);
  });
}

function runScript(scriptRelativePath) {
  return new Promise((resolve, reject) => {
    const fullPath = path.join(__dirname, '..', scriptRelativePath);
    console.log(`\n>>> RUNNING: node ${scriptRelativePath} ...`);
    const child = spawn(process.execPath, [fullPath], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:27017/smartmess_test', NODE_ENV: 'test', PORT: '5000' },
      stdio: 'inherit'
    });
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Script ${scriptRelativePath} failed with code ${code}`));
      }
    });
  });
}

(async () => {
  let mongod = null;
  let serverProcess = null;
  try {
    console.log('1. Starting isolated MongoMemoryServer on port 27017...');
    mongod = await MongoMemoryServer.create({
      instance: { port: 27017, dbName: 'smartmess_test', ip: '127.0.0.1' }
    });
    console.log('✅ MongoMemoryServer started successfully on port 27017');

    console.log('2. Starting backend server on port 5000...');
    serverProcess = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:27017/smartmess_test', NODE_ENV: 'test', PORT: '5000' },
      stdio: 'inherit'
    });

    console.log('3. Waiting for GET /health to be ready...');
    await waitForHealth(5000);
    console.log('✅ Backend server is ONLINE and HEALTHY on port 5000');

    console.log('\n============================================================');
    console.log('EXECUTING COMPLETE BACKEND REGRESSION SUITES');
    console.log('============================================================');

    await runScript('scripts/role_routing_regression_test.js');
    await runScript('scripts/remember_login_regression_test.js');
    await runScript('scripts/password_security_regression_test.js');
    await runScript('scripts/concurrency_integrity_test.js');

    console.log('\n============================================================');
    console.log('✅ ALL BACKEND REGRESSION SUITES COMPLETED SUCCESSFULLY!');
    console.log('============================================================');
  } catch (err) {
    console.error('\n❌ Regression Suite Error:', err.message);
    process.exitCode = 1;
  } finally {
    if (serverProcess) {
      console.log('Tearing down backend server...');
      serverProcess.kill('SIGINT');
    }
    if (mongod) {
      console.log('Stopping MongoMemoryServer...');
      await mongod.stop();
    }
    process.exit(process.exitCode || 0);
  }
})();
