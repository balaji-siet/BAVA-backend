# SMART MESS — 1000 Concurrent Students Load Testing Suite

This directory contains load testing scripts using [k6](https://k6.io/) to verify the concurrency, throughput, and consistency of SMART MESS under burst conditions of 1000 active students.

> **CRITICAL RULE**: Never run load tests against the Render production backend. Run load tests exclusively against local backend instances connected to a local test MongoDB (`mongodb://localhost:27017/smartmess_test`).

## Prerequisites

1. **Install k6**:
   - Windows (Chocolatey): `choco install k6`
   - Windows (winget): `winget install k6`
   - Mac (Homebrew): `brew install k6`
   - Or download binary from [k6.io](https://k6.io/docs/get-started/installation/)

2. **Start Local Backend**:
   ```bash
   cd backend
   export MONGODB_URI="mongodb://localhost:27017/smartmess_test"
   export MONGO_MAX_POOL_SIZE=50
   export PORT=5000
   node server.js
   ```

## Test Scripts

### 1. High-Concurrency Reservation Scenarios
`k6-reservation-load.js` tests 3 distinct concurrency profiles:
- **Ramp-Up**: 0 to 1000 VUs over 5 minutes.
- **Spike**: 0 to 1000 VUs in 10 seconds (worst-case meal window opening burst).
- **Sustained Load**: Constant 500 VUs for 2 minutes.

**Run**:
```bash
k6 run tests/load/k6-reservation-load.js
```

### 2. Offline Sync Mass-Reconnect Burst Simulation
`k6-offline-sync-sim.js` simulates 1000 mobile devices reconnecting simultaneously after an offline period:
- Applies 0–15s client-side randomized jitter.
- Sends 2 operations per device with unique `X-Operation-Id` idempotency headers.
- Replays duplicate requests to confirm zero duplicate database inserts.

**Run**:
```bash
k6 run tests/load/k6-offline-sync-sim.js
```

## Expected Thresholds & Pass Criteria

| Metric | Target | Description |
|---|---|---|
| `http_req_failed` | `< 1%` | Near-zero failed requests under load |
| `http_req_duration (p95)` | `< 1000ms` | 95% of reservations finish in under 1s |
| `sync_success_rate` | `> 99%` | Mass reconnects succeed completely |
| Duplicate Inconsistencies | `0` | Idempotency key guarantees 1 DB doc per student/date |
