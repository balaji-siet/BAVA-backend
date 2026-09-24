const { exec, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MATRIX_CONFIGS = [
  { id: '1P_P20',  workers: 1, maxPoolSize: 20,  theoreticalMax: 20  },
  { id: '1P_P50',  workers: 1, maxPoolSize: 50,  theoreticalMax: 50  },
  { id: '1P_P100', workers: 1, maxPoolSize: 100, theoreticalMax: 100 },
  { id: '2W_P15',  workers: 2, maxPoolSize: 15,  theoreticalMax: 30  },
  { id: '2W_P25',  workers: 2, maxPoolSize: 25,  theoreticalMax: 50  },
  { id: '2W_P50',  workers: 2, maxPoolSize: 50,  theoreticalMax: 100 },
  { id: '4W_P10',  workers: 4, maxPoolSize: 10,  theoreticalMax: 40  },
  { id: '4W_P15',  workers: 4, maxPoolSize: 15,  theoreticalMax: 60  },
  { id: '4W_P25',  workers: 4, maxPoolSize: 25,  theoreticalMax: 100 },
  { id: '4W_P50',  workers: 4, maxPoolSize: 50,  theoreticalMax: 200 }
];

function execPromise(cmd, cwd = process.cwd()) {
  return new Promise((resolve) => {
    exec(cmd, { cwd }, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

function stopBackendProcess() {
  return new Promise((resolve) => {
    exec('cmd /c "netstat -ano | findstr :5000"', async (err, stdout) => {
      if (!stdout || !stdout.trim()) return resolve();
      const lines = stdout.trim().split('\n');
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(pid) && pid !== '0' && parseInt(pid, 10) !== process.pid) {
          await execPromise(`taskkill /F /PID ${pid}`);
        }
      }
      setTimeout(resolve, 2000);
    });
  });
}

function waitForHealth(maxWaitMs = 15000) {
  const startTime = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      http.get('http://localhost:5000/health', (res) => {
        if (res.statusCode === 200) return resolve(true);
        if (Date.now() - startTime > maxWaitMs) return resolve(false);
        setTimeout(check, 500);
      }).on('error', () => {
        if (Date.now() - startTime > maxWaitMs) return resolve(false);
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function fetchDiagnostics() {
  return new Promise((resolve) => {
    http.get('http://localhost:5000/api/diagnostics', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function runMatrixExperiment() {
  console.log("============================================================");
  console.log("STARTING DATABASE CONNECTION POOL MATRIX EXPERIMENT");
  console.log("============================================================");

  const experimentResults = [];

  for (let i = 0; i < MATRIX_CONFIGS.length; i++) {
    const cfg = MATRIX_CONFIGS[i];
    console.log(`\n------------------------------------------------------------`);
    console.log(`[MATRIX RUN ${i + 1}/${MATRIX_CONFIGS.length}] Config: ${cfg.id}`);
    console.log(`  Workers: ${cfg.workers} | maxPoolSize per worker: ${cfg.maxPoolSize} | Theoretical Max DB Conns: ${cfg.theoreticalMax}`);
    console.log(`------------------------------------------------------------`);

    // 1. Stop old server cleanly
    await stopBackendProcess();

    // 2. Start server process with exact env variables
    const env = {
      ...process.env,
      USE_CLUSTER: cfg.workers > 1 ? 'true' : 'false',
      WORKER_COUNT: String(cfg.workers),
      MONGO_MAX_POOL_SIZE: String(cfg.maxPoolSize),
      UV_THREADPOOL_SIZE: '16',
      MONGODB_URI: 'mongodb://localhost:27017/smartmess_test',
      PORT: '5000'
    };

    const serverProc = spawn('node', ['src/server.js'], {
      cwd: path.join(__dirname, '..'),
      env,
      stdio: 'inherit'
    });

    const isHealthy = await waitForHealth();
    if (!isHealthy) {
      console.error(`❌ Failed to start backend for config ${cfg.id}! Skipping...`);
      serverProc.kill();
      continue;
    }

    const diagBefore = await fetchDiagnostics();
    console.log("   Diagnostics Before Run:", diagBefore ? `Active Conns: ${diagBefore.mongoStats?.activeConnections}` : 'N/A');

    // 3. Run realistic load test suite
    console.log(`   Executing Realistic Load Test Suite for ${cfg.id}...`);
    const loadTestRes = await execPromise('node scripts/realistic_load_test.js', path.join(__dirname, '..'));

    const diagAfter = await fetchDiagnostics();

    // 4. Read load test summary results
    let summary = null;
    try {
      const summaryPath = path.join(__dirname, 'realistic_load_test_summary.json');
      if (fs.existsSync(summaryPath)) {
        summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      }
    } catch (e) {}

    const runData = {
      config: cfg,
      diagnosticsBefore: diagBefore,
      diagnosticsAfter: diagAfter,
      summary: summary,
      rawOutputSnippet: loadTestRes.stdout ? loadTestRes.stdout.split('\n').slice(-15).join('\n') : ''
    };

    experimentResults.push(runData);

    // Stop process for next run
    serverProc.kill();
    await stopBackendProcess();
  }

  // 5. Save results to JSON file
  const resultsPath = path.join(__dirname, 'matrix_experiment_results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(experimentResults, null, 2));

  console.log("\n============================================================");
  console.log("✅ DATABASE POOL MATRIX EXPERIMENT COMPLETED SUCCESSFULLY");
  console.log(`Report saved to: ${resultsPath}`);
  console.log("============================================================");
}

runMatrixExperiment().catch(console.error);
