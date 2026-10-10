const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const http = require("http");
const { spawn } = require("child_process");
const MealSettings = require("../src/models/MealSettings");
const Reservation = require("../src/models/Reservation");
const { getIndiaDateString, getIndiaTomorrowDateString } = require("../src/utils/dateUtils");

const PORT = 5001;
const BASE_URL = "http://127.0.0.1:" + PORT;
const MONGODB_URI = "mongodb://127.0.0.1:27018/smartmess_test";

function makeRequest(method, pathStr, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve) => {
    const url = new URL(pathStr, BASE_URL);
    const options = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: { "Content-Type": "application/json", ...extraHeaders },
      timeout: 10000,
    };
    if (token) options.headers.Authorization = "Bearer " + token;
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed = null;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({ status: res.statusCode, data: parsed });
      });
    });
    req.on("error", err => resolve({ status: 0, error: err.message, data: null }));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function waitForHealth(port, maxAttempts = 60) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(() => {
      attempts++;
      const req = http.get("http://127.0.0.1:" + port + "/health", (res) => {
        if (res.statusCode === 200) {
          clearInterval(interval);
          resolve(true);
        }
      });
      req.on("error", () => {});
      req.end();
      if (attempts >= maxAttempts) {
        clearInterval(interval);
        reject(new Error("Timeout waiting for server"));
      }
    }, 500);
  });
}

async function seedOpenSchedule(date) {
  await MealSettings.findOneAndUpdate(
    { date },
    {
      $set: {
        breakfast: { open_time: "00:00", close_time: "23:59", open_date: "2026-01-01", close_date: "2026-12-31", enabled: true, sms_sent: false },
        lunch: { open_time: "00:00", close_time: "23:59", open_date: "2026-01-01", close_date: "2026-12-31", enabled: true, sms_sent: false },
        dinner: { open_time: "00:00", close_time: "23:59", open_date: "2026-01-01", close_date: "2026-12-31", enabled: true, sms_sent: false },
        updatedBy: "CountsTest"
      }
    },
    { upsert: true }
  );
}

async function registerStudent(name, roll, email, password) {
  const reg = await makeRequest("POST", "/api/student/register", {
    name,
    roll_number: roll,
    department: "CSE",
    email,
    password
  });
  if (reg.status !== 201) throw new Error("Register failed: " + JSON.stringify(reg));
  const login = await makeRequest("POST", "/api/student/login", { email, password });
  if (login.status !== 200 || !login.data.token) throw new Error("Login failed: " + JSON.stringify(login));
  return { token: login.data.token, studentId: login.data.user.id, roll };
}

async function registerSupervisor(name, email, password) {
  const reg = await makeRequest("POST", "/api/supervisor/register", {
    name,
    employee_id: "EMP_SUP_" + Date.now(),
    department: "MESS_ADMIN",
    mobile_number: "9876543210",
    email,
    password
  });
  if (reg.status !== 201) throw new Error("Supervisor register failed: " + JSON.stringify(reg));
  const login = await makeRequest("POST", "/api/supervisor/login", { email, password });
  if (login.status !== 200 || !login.data.token) throw new Error("Supervisor login failed: " + JSON.stringify(login));
  return { token: login.data.token };
}

(async () => {
  let mongod = null;
  let serverProcess = null;
  let passed = 0;
  let failed = 0;

  const check = (cond, label, detail = "") => {
    if (cond) {
      console.log("  [PASS] " + label + (detail ? " (" + detail + ")" : ""));
      passed++;
    } else {
      console.error("  [FAIL] " + label + (detail ? " (" + detail + ")" : ""));
      failed++;
    }
  };

  try {
    console.log("Starting isolated MongoMemoryServer on port 27018...");
    mongod = await MongoMemoryServer.create({
      instance: { port: 27018, dbName: "smartmess_test", ip: "127.0.0.1" }
    });
    await mongoose.connect(MONGODB_URI);

    console.log("Starting backend server on port " + PORT + "...");
    serverProcess = spawn(process.execPath, [require("path").join(__dirname, "..", "src", "server.js")], {
      cwd: require("path").join(__dirname, ".."),
      env: { ...process.env, MONGODB_URI, NODE_ENV: "development", PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    await waitForHealth(PORT);
    console.log("Backend server online! Running tests...");

    const todayDate = getIndiaDateString();
    const tomorrowDate = getIndiaTomorrowDateString();
    const customDate = "2026-11-20";

    await seedOpenSchedule(todayDate);
    await seedOpenSchedule(tomorrowDate);
    await seedOpenSchedule(customDate);

    // Register supervisor for dashboard count queries
    const supervisor = await registerSupervisor("Supervisor John", "sup_test@mess.local", "SuperSecret123!");

    // Initial counts before reservations
    const initialCounts = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(initialCounts.status === 200, "Initial counts endpoint accessible", "status=" + initialCounts.status);
    check(initialCounts.data.breakfast === 0, "Initial Breakfast count is 0", "count=" + initialCounts.data.breakfast);
    check(initialCounts.data.lunch === 0, "Initial Lunch count is 0", "count=" + initialCounts.data.lunch);
    check(initialCounts.data.dinner === 0, "Initial Dinner count is 0", "count=" + initialCounts.data.dinner);

    // PART 1-6: Student A reserves meals with NO DEVICE TOKEN
    console.log("\n--- Testing Student A Normal Account Reservation (NO DEVICE TOKEN) ---");
    const studentA = await registerStudent("Student Alice", "STUDENT_A_001", "alice@test.local", "StudentPass123!");

    // 1. Reserve Breakfast without device
    const resA1 = await makeRequest("POST", "/api/reservations", {
      date: todayDate,
      breakfast: true,
      lunch: false,
      dinner: false
    }, studentA.token);
    check(resA1.status === 200, "Student A reserves Breakfast without device identifier", "status=" + resA1.status);
    check(JSON.stringify(resA1.data).includes("Registered reservation device") === false, "No registered device error on Breakfast");

    // Check counts after Breakfast
    const countsAfterB = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(countsAfterB.data.breakfast === 1 && countsAfterB.data.breakfast_count === 1, "Supervisor Breakfast count incremented to 1", "b=" + countsAfterB.data.breakfast);
    check(countsAfterB.data.lunch === 0 && countsAfterB.data.dinner === 0, "Lunch and Dinner unchanged");

    // 2. Reserve Lunch without device
    const resA2 = await makeRequest("POST", "/api/reservations", {
      date: todayDate,
      breakfast: true,
      lunch: true,
      dinner: false
    }, studentA.token);
    check(resA2.status === 200, "Student A reserves Lunch without device identifier", "status=" + resA2.status);
    check(JSON.stringify(resA2.data).includes("Registered reservation device") === false, "No registered device error on Lunch");

    const countsAfterL = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(countsAfterL.data.breakfast === 1 && countsAfterL.data.lunch === 1, "Supervisor Lunch count incremented to 1", "l=" + countsAfterL.data.lunch);
    check(countsAfterL.data.dinner === 0, "Dinner unchanged");

    // 3. Reserve Dinner without device
    const resA3 = await makeRequest("POST", "/api/reservations", {
      date: todayDate,
      breakfast: true,
      lunch: true,
      dinner: true
    }, studentA.token);
    check(resA3.status === 200, "Student A reserves Dinner without device identifier", "status=" + resA3.status);
    check(JSON.stringify(resA3.data).includes("Registered reservation device") === false, "No registered device error on Dinner");

    const countsAfterD = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(countsAfterD.data.breakfast === 1 && countsAfterD.data.lunch === 1 && countsAfterD.data.dinner === 1, "All 3 meal counts at 1 for today", "total=" + countsAfterD.data.total);

    // 4. Duplicate reservation protection (Idempotency)
    console.log("\n--- Testing Duplicate Reservation Protection ---");
    const resADup = await makeRequest("POST", "/api/reservations", {
      date: todayDate,
      breakfast: true,
      lunch: true,
      dinner: true
    }, studentA.token);
    check(resADup.status === 200, "Duplicate submission returns 200 success", "status=" + resADup.status);
    const countsDup = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(countsDup.data.breakfast === 1 && countsDup.data.lunch === 1 && countsDup.data.dinner === 1, "Counts do NOT duplicate (Breakfast=1, Lunch=1, Dinner=1)");
    const totalDocs = await Reservation.countDocuments({ reservation_date: todayDate, roll_number: studentA.roll });
    check(totalDocs === 1, "Exactly one MongoDB reservation document exists for Student A on date", "docs=" + totalDocs);

    // 5. Cancellation decrements count
    console.log("\n--- Testing Cancellation & Count Decrement ---");
    const cancelL = await makeRequest("POST", "/api/cancel-reservation", {
      date: todayDate,
      meal_type: "lunch"
    }, studentA.token);
    check(cancelL.status === 200, "Student A cancels Lunch", "status=" + cancelL.status);
    const countsAfterCancel = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    check(countsAfterCancel.data.lunch === 0 && countsAfterCancel.data.lunch_count === 0, "Supervisor Lunch count decremented back to 0", "l=" + countsAfterCancel.data.lunch);
    check(countsAfterCancel.data.breakfast === 1 && countsAfterCancel.data.dinner === 1, "Breakfast and Dinner remain unaffected (B=1, D=1)");

    // PART 21: Multiple Students Demand Aggregation
    console.log("\n--- Testing Multiple Students Demand Aggregation ---");
    const studentB = await registerStudent("Student Bob", "STUDENT_B_002", "bob@test.local", "StudentPass123!");
    const studentC = await registerStudent("Student Charlie", "STUDENT_C_003", "charlie@test.local", "StudentPass123!");

    // Student B reserves Lunch
    await makeRequest("POST", "/api/reservations", { date: todayDate, breakfast: false, lunch: true, dinner: false }, studentB.token);
    // Student C reserves Lunch and Dinner
    await makeRequest("POST", "/api/reservations", { date: todayDate, breakfast: false, lunch: true, dinner: true }, studentC.token);

    const countsMulti = await makeRequest("GET", "/api/reservations/counts?date=" + todayDate, null, supervisor.token);
    // Expected:
    // Breakfast: Student A (1) -> 1
    // Lunch: Student B (1) + Student C (1) -> 2
    // Dinner: Student A (1) + Student C (1) -> 2
    check(countsMulti.data.breakfast === 1, "Multi-student aggregate Breakfast = 1", "b=" + countsMulti.data.breakfast);
    check(countsMulti.data.lunch === 2, "Multi-student aggregate Lunch = 2 (Bob + Charlie)", "l=" + countsMulti.data.lunch);
    check(countsMulti.data.dinner === 2, "Multi-student aggregate Dinner = 2 (Alice + Charlie)", "d=" + countsMulti.data.dinner);
    check(countsMulti.data.total === 5, "Total meal demand = 5", "total=" + countsMulti.data.total);

    // PART 7: Tomorrow and Custom Date
    console.log("\n--- Testing Tomorrow & Custom Dates ---");
    const resTomorrow = await makeRequest("POST", "/api/reservations", { date: tomorrowDate, breakfast: true, lunch: true, dinner: true }, studentA.token);
    check(resTomorrow.status === 200, "Tomorrow reservation succeeds without device", "date=" + tomorrowDate);
    const countsTomorrow = await makeRequest("GET", "/api/reservations/counts?date=" + tomorrowDate, null, supervisor.token);
    check(countsTomorrow.data.breakfast === 1 && countsTomorrow.data.lunch === 1 && countsTomorrow.data.dinner === 1, "Tomorrow counts reflect reservation");

    const resCustom = await makeRequest("POST", "/api/reservations", { date: customDate, breakfast: false, lunch: true, dinner: false }, studentB.token);
    check(resCustom.status === 200, "Custom future date reservation succeeds without device", "date=" + customDate);
    const countsCustom = await makeRequest("GET", "/api/reservations/counts?date=" + customDate, null, supervisor.token);
    check(countsCustom.data.lunch === 1 && countsCustom.data.breakfast === 0, "Custom date counts reflect reservation");

    // PART 25: Security & Role Boundaries
    console.log("\n--- Testing Security & Role Isolation ---");
    // Missing JWT
    const noAuth = await makeRequest("POST", "/api/reservations", { date: todayDate, breakfast: true });
    check(noAuth.status === 401, "Missing JWT rejected with 401", "status=" + noAuth.status);

    // Invalid JWT
    const badAuth = await makeRequest("POST", "/api/reservations", { date: todayDate, breakfast: true }, "invalid_token_xyz");
    check(badAuth.status === 401, "Invalid JWT rejected with 401", "status=" + badAuth.status);

    // Student cannot access Supervisor-only endpoint
    const studentAccessAdmin = await makeRequest("POST", "/api/students/" + studentA.studentId + "/reservation-device/reset", {}, studentA.token);
    check(studentAccessAdmin.status === 403, "Student cannot access Supervisor-only reset endpoint", "status=" + studentAccessAdmin.status);

    // Cutoff enforcement preserved
    await MealSettings.findOneAndUpdate(
      { date: "2026-12-25" },
      {
        $set: {
          breakfast: { open_time: "08:00", close_time: "09:00", open_date: "2026-12-25", close_date: "2026-12-25", enabled: true, sms_sent: false }
        }
      },
      { upsert: true }
    );
    const cutoffBlocked = await makeRequest("POST", "/api/reservations", { date: "2026-12-25", breakfast: true }, studentA.token);
    check(cutoffBlocked.status === 403, "Closed cutoff window correctly rejected with 403", "status=" + cutoffBlocked.status);

    console.log("\n============================================================");
    console.log("RESERVATION & SUPERVISOR COUNT TESTS: " + passed + " PASSED | " + failed + " FAILED");
    console.log("============================================================");
  } catch (err) {
    console.error("Test failed with exception:", err);
    failed++;
  } finally {
    if (serverProcess) serverProcess.kill("SIGINT");
    if (mongoose.connection.readyState) await mongoose.disconnect();
    if (mongod) await mongod.stop();
    process.exit(failed > 0 ? 1 : 0);
  }
})();
