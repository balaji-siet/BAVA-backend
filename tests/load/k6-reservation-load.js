import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
export const errorRate = new Rate('errors');
export const reservationSuccessRate = new Rate('reservation_success');
export const reservationDuration = new Trend('reservation_duration');

// Test configuration: 4 load scenarios against LOCAL TEST ENVIRONMENT
export const options = {
  scenarios: {
    // Scenario 1: Gradual Ramp to 1000 VUs over 5 minutes
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 200 },
        { duration: '2m', target: 500 },
        { duration: '2m', target: 1000 },
        { duration: '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'reservationScenario',
    },
    // Scenario 2: Sudden Spike: 0 -> 1000 in 10 seconds
    spike_test: {
      executor: 'ramping-vus',
      startTime: '6m30s',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 1000 },
        { duration: '1m', target: 1000 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '30s',
      exec: 'reservationScenario',
    },
    // Scenario 3: Sustained Load: 1000 VUs for 3 minutes
    sustained_load: {
      executor: 'constant-vus',
      startTime: '8m30s',
      vus: 500,
      duration: '2m',
      exec: 'reservationScenario',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'], // Less than 2% failure rate
    http_req_duration: ['p(95)<1000', 'p(99)<2500'], // 95% under 1s, 99% under 2.5s
    errors: ['rate<0.02'],
    reservation_success: ['rate>0.98'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:5000/api';
const TARGET_DATE = __ENV.TARGET_DATE || new Date(Date.now() + 86400000).toISOString().split('T')[0];

export function reservationScenario() {
  const vuId = __VU;
  const iterId = __ITER;
  const rollNumber = `22CS${String(vuId).padStart(4, '0')}`;
  const operationId = `op_vu${vuId}_iter${iterId}_${Date.now()}`;

  const payload = JSON.stringify({
    date: TARGET_DATE,
    roll_number: rollNumber,
    breakfast: true,
    lunch: true,
    dinner: false,
    meal_type: 'breakfast'
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
  const duration = Date.now() - startTime;
  reservationDuration.add(duration);

  const passed = check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
    'response has message': (r) => r.json('message') !== undefined,
  });

  if (passed) {
    reservationSuccessRate.add(1);
    errorRate.add(0);
  } else {
    reservationSuccessRate.add(0);
    errorRate.add(1);
  }

  // Idempotency replay check: Send same operationId again immediately
  if (iterId % 5 === 0) {
    const replayRes = http.post(`${BASE_URL}/reservations`, payload, params);
    check(replayRes, {
      'idempotency replay returns 200': (r) => r.status === 200,
    });
  }

  // Jittered student think time (1 to 3 seconds)
  sleep(Math.random() * 2 + 1);
}
