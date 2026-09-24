const { exec, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MATRIX_CONFIGS = [
  { id: '1W_P50',  workers: 1, maxPoolSize: 50,  theoreticalMax: 50  },
  { id: '2W_P25',  workers: 2, maxPoolSize: 25,  theoreticalMax: 50  },
  { id: '2W_P50',  workers: 2, maxPoolSize: 50,  theoreticalMax: 100 },
  { id: '2W_P75',  workers: 2, maxPoolSize: 75,  theoreticalMax: 150 },
  { id: '2W_P100', workers: 2, maxPoolSize: 100, theoreticalMax: 200 }
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

function getDiagnostics() {
  return new Promise((resolve) => {
    http.get('http://localhost:5000/api/diagnostics', (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

async function runMatrix() {
  console.log("============================================================");
  console.log("PHASE 14 — DATABASE CONNECTION POOL MATRIX BENCHMARK");
  console.log(`Evaluating ${MATRIX_CONFIGS.length} Database Pool Configurations`);
  console.log("============================================================");

  const finalResults = [];

  for (const cfg of MATRIX_CONFIGS) {
    console.log(`\n------------------------------------------------------------`);
    console.log(`▶ TESTING CONFIGURATION: ${cfg.id}`);
    console.log(`  Workers: ${cfg.workers} | Pool Size/Worker: ${cfg.maxPoolSize} | Theoretical Max DB Conns: ${cfg.theoreticalMax}`);
    console.log(`------------------------------------------------------------`);

    await stopBackendProcess();

    const env = {
      ...process.env,
      USE_CLUSTER: cfg.workers > 1 ? 'true' : 'false',
      WORKER_COUNT: String(cfg.workers),
      MONGO_MAX_POOL_SIZE: String(cfg.maxPoolSize)
    };

    const serverPath = path.join(__dirname, '..', 'src', 'server.js');
    const child = spawn('node', [serverPath], { env, cwd: path.join(__dirname, '..'), stdio: 'pipe' });

    child.stdout.on('data', d => {});
    child.stderr.on('data', d => {});

    const healthy = await waitForHealth();
    if (!healthy) {
      console.error(`❌ Server failed to start for config ${cfg.id}`);
      child.kill();
      continue;
    }

    const diagBefore = await getDiagnostics();
    console.log(`  Backend Health: ONLINE | DB Connections Active: ${diagBefore?.mongoStats?.activeConnections || 'N/A'}`);

    console.log(`  Executing Realistic Load Test (100, 250, 500, 1000 users)...`);
    const { stdout } = await execPromise('node scripts/realistic_load_test.js', path.join(__dirname, '..'));

    const diagAfter = await getDiagnostics();

    let summaryData = null;
    const summaryPath = path.join(__dirname, 'realistic_load_test_summary.json');
    if (fs.existsSync(summaryPath)) {
      try {
        summaryData = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
      } catch (e) {}
    }

    const configResult = {
      config: cfg,
      diagnosticsBefore: diagBefore,
      diagnosticsAfter: diagAfter,
      summary: summaryData,
      rawOutputSnippet: stdout.slice(-800)
    };

    finalResults.push(configResult);
    console.log(`  ✅ Config ${cfg.id} Completed Successfully.`);

    child.kill();
    await stopBackendProcess();
  }

  const resultPath = path.join(__dirname, 'phase14_matrix_results.json');
  fs.writeFileSync(resultPath, JSON.stringify(finalResults, null, 2));

  console.log("\n============================================================");
  console.log("PHASE 14 MATRIX BENCHMARK COMPLETED SUCCESSFULLY");
  console.log(`Results saved to: ${resultPath}`);
  console.log("============================================================");

  // Print comparison table
  console.log("\nPHASE 14 MATRIX COMPARISON TABLE:");
  console.log("┌──────────┬─────────┬──────────┬─────────────────┬───────────┬───────────┬───────────┬────────────┬─────────────┐");
  console.log("│ Config   │ Workers │ Pool/Wkr │ Total DB Budget │ 100 Users │ 250 Users │ 500 Users │ 1000 Users │ 1000 P50 ms │");
  console.log("├──────────┼─────────┼──────────┼─────────────────┼───────────┼───────────┼───────────┼────────────┼─────────────┤");

  for (const res of finalResults) {
    const cfg = res.config;
    const s = res.summary || [];
    const u100 = s.find(x => x.concurrencyLevel === 100)?.successRate || 0;
    const u250 = s.find(x => x.concurrencyLevel === 250)?.successRate || 0;
    const u500 = s.find(x => x.concurrencyLevel === 500)?.successRate || 0;
    const u1000 = s.find(x => x.concurrencyLevel === 1000)?.successRate || 0;
    const p50_1000 = s.find(x => x.concurrencyLevel === 1000)?.latency?.medianMs || '-';

    console.log(
      `│ ${cfg.id.padEnd(8)} │ ${String(cfg.workers).padEnd(7)} │ ${String(cfg.maxPoolSize).padEnd(8)} │ ${String(cfg.theoreticalMax).padEnd(15)} │ ${(u100 + '%').padEnd(9)} │ ${(u250 + '%').padEnd(9)} │ ${(u500 + '%').padEnd(9)} │ ${(u1000 + '%').padEnd(10)} │ ${String(p50_1000).padEnd(11)} │`
    );
  }
  console.log("└──────────┴─────────┴──────────┴─────────────────┴───────────┴───────────┴───────────┴────────────┴─────────────┘");
}

runMatrix().catch(console.error);
