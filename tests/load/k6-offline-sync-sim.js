import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

export const syncSuccessRate = new Rate('sync_success_rate');
export const syncDuration = new Trend('sync_duration');
export const duplicateReplaysHandled = new Counter('duplicate_replays_handled');

export const options = {
  scenarios: {
    // Scenario 4: Reconnect sync burst with 1000 simulated offline devices
    offline_sync_burst: {
      executor: 'per-vu-iterations',
      vus: 1000,
      iterations: 2, // 2 operations per device (e.g. reserve + update)
      maxDuration: '3m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    sync_success_rate: ['rate>0.99'],
    sync_duration: ['p(95)<1500'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:5000/api';
const TARGET_DATE = __ENV.TARGET_DATE || new Date(Date.now() + 86400000).toISOString().split('T')[0];

export default function () {
  const vuId = __VU;
  const iterId = __ITER;
  const rollNumber = `22CS${String(vuId).padStart(4, '0')}`;
  
  // Client-side jitter (0 to 15 seconds) to simulate offlineSyncService reconnect schedule
  const jitterSec = Math.random() * 15;
  sleep(jitterSec);

  const operationId = `offline_op_vu${vuId}_item${iterId}`;

  const payload = JSON.stringify({
    date: TARGET_DATE,
    roll_number: rollNumber,
    breakfast: true,
    lunch: iterId === 1,
    dinner: false,
    meal_type: iterId === 0 ? 'breakfast' : 'lunch'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Operation-Id': operationId,
      'X-SmartMess-Device-Token': `device_token_sim_${rollNumber}`,
    },
  };

  const startTime = Date.now();
  const res = http.post(`${BASE_URL}/reservations`, payload, params);
  syncDuration.add(Date.now() - startTime);

  const ok = check(res, {
    'sync response 200/201': (r) => r.status === 200 || r.status === 201,
  });

  if (ok) {
    syncSuccessRate.add(1);
  } else {
    syncSuccessRate.add(0);
  }

  // Duplicate replay test: send exact same operation ID to verify server-side idempotency
  const dupRes = http.post(`${BASE_URL}/reservations`, payload, params);
  const dupOk = check(dupRes, {
    'duplicate replay returns 200 cached': (r) => r.status === 200,
  });

  if (dupOk) {
    duplicateReplaysHandled.add(1);
  }
}
