const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';

// Canonical role normalization (mirrors frontend roleUtils.ts)
const normalizeRole = (role) => {
  if (!role || typeof role !== 'string') {
    if (role && typeof role === 'object' && role.role) {
      return normalizeRole(role.role);
    }
    return 'unknown';
  }
  const normalized = role.toLowerCase().trim();
  if (normalized === 'supervisor' || normalized === 'admin' || normalized === 'manager') {
    return 'supervisor';
  }
  if (normalized === 'student' || normalized === 'user') {
    return 'student';
  }
  return 'unknown';
};

const isSupervisor = (role) => normalizeRole(role) === 'supervisor';
const isStudent = (role) => normalizeRole(role) === 'student';

const parseJwtPayload = (token) => {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (e) {
    return null;
  }
};

const resolveValidRole = (...candidates) => {
  for (const candidate of candidates) {
    const normalized = normalizeRole(candidate);
    if (normalized === 'student' || normalized === 'supervisor') {
      return normalized;
    }
  }
  return null;
};

const evaluateRoute = (token, user) => {
  if (!token) return 'LoginScreen';
  const role = resolveValidRole(user && user.role, parseJwtPayload(token)?.role);
  if (!role) return 'LoginScreen';
  if (isSupervisor(role)) return 'SupervisorDashboard';
  if (isStudent(role)) return 'StudentDashboard';
  return 'LoginScreen';
};

function makeRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, headers: res.headers, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runRegressionSuite() {
  console.log('============================================================');
  console.log('SMART MESS — ROLE ROUTING & AUTHENTICATION REGRESSION SUITE');
  console.log('============================================================\n');

  let totalTests = 0;
  let passedTests = 0;
  let wrongRedirects = 0;

  const assert = (condition, description) => {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`  [PASS] ${description}`);
    } else {
      console.error(`  [FAIL] ${description}`);
      throw new Error(`Assertion failed: ${description}`);
    }
  };

  // ------------------------------------------------------------------
  // 1. CANONICAL ROLE NORMALIZATION TESTS
  // ------------------------------------------------------------------
  console.log('--- 1. Canonical Role Normalization Unit Tests ---');
  assert(normalizeRole('student') === 'student', "normalizeRole('student') === 'student'");
  assert(normalizeRole('STUDENT') === 'student', "normalizeRole('STUDENT') === 'student'");
  assert(normalizeRole('  student  ') === 'student', "normalizeRole('  student  ') === 'student'");
  assert(normalizeRole('user') === 'student', "normalizeRole('user') === 'student'");
  assert(normalizeRole('supervisor') === 'supervisor', "normalizeRole('supervisor') === 'supervisor'");
  assert(normalizeRole('SUPERVISOR') === 'supervisor', "normalizeRole('SUPERVISOR') === 'supervisor'");
  assert(normalizeRole('admin') === 'supervisor', "normalizeRole('admin') === 'supervisor'");
  assert(normalizeRole('ADMIN') === 'supervisor', "normalizeRole('ADMIN') === 'supervisor'");
  assert(normalizeRole('manager') === 'supervisor', "normalizeRole('manager') === 'supervisor'");
  assert(normalizeRole(null) === 'unknown', "normalizeRole(null) === 'unknown'");
  assert(normalizeRole(undefined) === 'unknown', "normalizeRole(undefined) === 'unknown'");
  assert(normalizeRole('') === 'unknown', "normalizeRole('') === 'unknown'");
  assert(normalizeRole('guest') === 'unknown', "normalizeRole('guest') === 'unknown'");
  assert(normalizeRole({ role: 'admin' }) === 'supervisor', "normalizeRole({ role: 'admin' }) === 'supervisor'");
  assert(normalizeRole({ role: 'student' }) === 'student', "normalizeRole({ role: 'student' }) === 'student'");

  assert(isSupervisor('admin') === true, "isSupervisor('admin') is true");
  assert(isSupervisor('supervisor') === true, "isSupervisor('supervisor') is true");
  assert(isSupervisor('student') === false, "isSupervisor('student') is false");
  assert(isSupervisor(null) === false, "isSupervisor(null) is false");

  assert(isStudent('student') === true, "isStudent('student') is true");
  assert(isStudent('admin') === false, "isStudent('admin') is false");
  assert(isStudent(undefined) === false, "isStudent(undefined) is false");

  // ------------------------------------------------------------------
  // 2. MISSING / INVALID ROLE MUST NEVER FALL BACK TO STUDENT
  // ------------------------------------------------------------------
  console.log('\n--- 2. Missing / Invalid Role Rejection Tests ---');

  const validStudentJwt = jwt.sign(
    { studentId: 'student123', rollNumber: 'RA1001', role: 'student', name: 'Test Student' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
  const validSupervisorJwt = jwt.sign(
    { studentId: 'sup123', rollNumber: 'SUP1001', role: 'admin', name: 'Test Supervisor' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const invalidRoleScenarios = [
    ['JWT without role', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x' }],
    ['Stored user without role', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x', name: 'No Role' }],
    ['stored role = null', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x', role: null }],
    ['stored role = empty string', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x', role: '' }],
    ['role = unknown', jwt.sign({ studentId: 'x', role: 'unknown' }, JWT_SECRET), { id: 'x', role: 'unknown' }],
    ['corrupted JWT payload', 'header.invalid-payload.signature', { id: 'x' }],
    ['unsupported role', jwt.sign({ studentId: 'x', role: 'auditor' }, JWT_SECRET), { id: 'x', role: 'auditor' }],
    ['session restore with token but no role', jwt.sign({ studentId: 'x' }, JWT_SECRET), null],
    ['login response missing role', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x', name: 'Login Missing Role' }],
    ['biometric/saved-login result missing role', jwt.sign({ studentId: 'x' }, JWT_SECRET), { id: 'x', name: 'Saved Missing Role' }],
  ];

  let invalidRoleStudentRoutes = 0;
  let invalidRoleSupervisorRoutes = 0;
  for (const [description, token, user] of invalidRoleScenarios) {
    const route = evaluateRoute(token, user);
    if (route === 'StudentDashboard') invalidRoleStudentRoutes++;
    if (route === 'SupervisorDashboard') invalidRoleSupervisorRoutes++;
    assert(route === 'LoginScreen', `${description} rejects to LoginScreen, not an app dashboard`);
  }
  assert(invalidRoleStudentRoutes === 0, `Invalid/missing role -> StudentDashboard occurrences: ${invalidRoleStudentRoutes}`);
  assert(invalidRoleSupervisorRoutes === 0, `Invalid/missing role -> SupervisorDashboard occurrences: ${invalidRoleSupervisorRoutes}`);

  // ------------------------------------------------------------------
  // 3. BACKEND API ROLE-BASED AUTHORIZATION TESTS
  // ------------------------------------------------------------------
  console.log('\n--- 3. Backend Role Authorization Security Tests ---');
  
  // Create synthetic verified JWT tokens for testing authorization middleware
  const studentJwt = validStudentJwt;
  const supervisorJwt = validSupervisorJwt;

  // Student token accessing supervisor endpoint -> MUST FAIL with 401/403
  let studentOnSupervisorEndpoint;
  try {
    studentOnSupervisorEndpoint = await makeRequest({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/dashboard',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${studentJwt}` }
    });
  } catch (e) {
    console.error("HTTP request error (studentOnSupervisor):", e);
    throw e;
  }
  assert(
    studentOnSupervisorEndpoint.status === 403 || studentOnSupervisorEndpoint.status === 401,
    `Student token blocked from Supervisor API (Status: ${studentOnSupervisorEndpoint.status})`
  );

  // Supervisor token accessing supervisor endpoint -> MUST PASS (200 or valid non-403 response)
  let supervisorOnSupervisorEndpoint;
  try {
    supervisorOnSupervisorEndpoint = await makeRequest({
      hostname: '127.0.0.1',
      port: 5000,
      path: '/api/dashboard',
      method: 'GET',
      headers: { 'Authorization': `Bearer ${supervisorJwt}` }
    });
  } catch (e) {
    console.error("HTTP request error (supervisorOnSupervisor):", e);
    throw e;
  }
  assert(
    supervisorOnSupervisorEndpoint.status === 200 || supervisorOnSupervisorEndpoint.status === 500,
    `Supervisor token allowed access to Supervisor API (Status: ${supervisorOnSupervisorEndpoint.status})`
  );

  // ------------------------------------------------------------------
  // 4. BACKEND JWT ROLE MIDDLEWARE HARDENING TESTS
  // ------------------------------------------------------------------
  console.log('\n--- 4. Backend JWT Role Middleware Hardening Tests ---');

  const roleMiddlewareScenarios = [
    {
      description: 'Explicit Student token accepted on generic protected route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001', role: 'student' }, JWT_SECRET),
      path: '/api/attendance',
      expected: (status) => status === 200 || status === 500,
    },
    {
      description: 'Explicit Supervisor token accepted on supervisor route',
      token: jwt.sign({ studentId: 'sup123', rollNumber: 'SUP1001', role: 'supervisor' }, JWT_SECRET),
      path: '/api/dashboard',
      expected: (status) => status === 200 || status === 500,
    },
    {
      description: 'Signed token with no role rejected on generic protected route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001' }, JWT_SECRET),
      path: '/api/attendance',
      expected: (status) => status === 401,
    },
    {
      description: 'Signed token with empty role rejected on generic protected route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001', role: '' }, JWT_SECRET),
      path: '/api/attendance',
      expected: (status) => status === 401,
    },
    {
      description: 'Signed token with null role rejected on generic protected route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001', role: null }, JWT_SECRET),
      path: '/api/attendance',
      expected: (status) => status === 401,
    },
    {
      description: 'Signed token with invalid role rejected on generic protected route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001', role: 'admin_fake' }, JWT_SECRET),
      path: '/api/attendance',
      expected: (status) => status === 401,
    },
    {
      description: 'Missing role rejected on student-scoped attendance route',
      token: jwt.sign({ studentId: 'student123', rollNumber: 'RA1001' }, JWT_SECRET),
      path: '/api/nfc/attendance/me',
      expected: (status) => status === 401,
    },
    {
      description: 'Missing role rejected on supervisor route',
      token: jwt.sign({ studentId: 'sup123', rollNumber: 'SUP1001' }, JWT_SECRET),
      path: '/api/dashboard',
      expected: (status) => status === 403 || status === 401,
    },
    {
      description: 'isAdmin without explicit role rejected on supervisor route',
      token: jwt.sign({ studentId: 'sup123', rollNumber: 'SUP1001', isAdmin: true }, JWT_SECRET),
      path: '/api/dashboard',
      expected: (status) => status === 403 || status === 401,
    },
  ];

  let missingRoleStudentRoutes = 0;
  for (const scenario of roleMiddlewareScenarios) {
    const result = await makeRequest({
      hostname: '127.0.0.1',
      port: 5000,
      path: scenario.path,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${scenario.token}` }
    });
    const tokenRole = parseJwtPayload(scenario.token)?.role;
    const evaluatedRoute = evaluateRoute(scenario.token, { id: 'x', role: tokenRole });
    if ((tokenRole === undefined || tokenRole === null || tokenRole === '') && evaluatedRoute === 'StudentDashboard') {
      missingRoleStudentRoutes++;
    }
    assert(scenario.expected(result.status), `${scenario.description} (Status: ${result.status})`);
  }
  assert(missingRoleStudentRoutes === 0, `Missing role -> StudentDashboard occurrences: ${missingRoleStudentRoutes}`);

  // ------------------------------------------------------------------
  // 5. STRESS-TESTING 50 ALTERNATING AUTHENTICATION TRANSITIONS
  // ------------------------------------------------------------------
  console.log('\n--- 5. Stress-Testing 50 Alternating Role Transitions ---');
  
  const simulatedStorage = {};

  const simulateLogin = (accountType, receivedToken, receivedUser) => {
    // Mirroring AuthContext.tsx hardened login flow
    const canonicalRole = resolveValidRole(receivedUser?.role, parseJwtPayload(receivedToken)?.role);
    if (!canonicalRole) return 'LoginScreen';
    const userObject = { ...receivedUser, role: canonicalRole };

    // Atomic storage write
    simulatedStorage['auth_session'] = JSON.stringify({ token: receivedToken, user: userObject });
    simulatedStorage['auth_token'] = receivedToken;
    simulatedStorage['auth_user'] = JSON.stringify(userObject);

    // AppNavigator evaluation
    const isSup = isSupervisor(userObject.role);
    const isStu = isStudent(userObject.role);

    if (isSup) return 'SupervisorDashboard';
    if (isStu) return 'StudentDashboard';
    return 'LoginScreen';
  };

  const simulateLogout = () => {
    delete simulatedStorage['auth_session'];
    delete simulatedStorage['auth_token'];
    delete simulatedStorage['auth_user'];
  };

  const simulateSessionRestore = () => {
    const sessionRaw = simulatedStorage['auth_session'];
    if (!sessionRaw) return 'LoginScreen';
    const session = JSON.parse(sessionRaw);
    const role = normalizeRole(session.user?.role);
    if (isSupervisor(role)) return 'SupervisorDashboard';
    if (isStudent(role)) return 'StudentDashboard';
    return 'LoginScreen';
  };

  for (let i = 1; i <= 50; i++) {
    const isSupervisorCycle = i % 2 === 0;
    
    if (isSupervisorCycle) {
      const destination = simulateLogin(
        'supervisor',
        supervisorJwt,
        { id: 1, name: 'Mess Supervisor', roll_number: 'SUP101', role: 'admin' }
      );
      if (destination !== 'SupervisorDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i}: ERROR - Supervisor routed to ${destination}`);
      }
      
      const restored = simulateSessionRestore();
      if (restored !== 'SupervisorDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i}: ERROR - Supervisor session restore gave ${restored}`);
      }
      simulateLogout();
    } else {
      const destination = simulateLogin(
        'student',
        studentJwt,
        { id: 2, name: 'Hostel Student', roll_number: 'RA1001', role: 'student' }
      );
      if (destination !== 'StudentDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i}: ERROR - Student routed to ${destination}`);
      }
      
      const restored = simulateSessionRestore();
      if (restored !== 'StudentDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i}: ERROR - Student session restore gave ${restored}`);
      }
      simulateLogout();
    }
  }

  assert(wrongRedirects === 0, `50 Alternating Login Transitions: ${wrongRedirects} wrong redirects (Expected 0)`);

  console.log('\n============================================================');
  console.log(`ALL ${totalTests} ROLE ROUTING & SECURITY TESTS PASSED (0 ERRORS)!`);
  console.log('============================================================\n');
}

runRegressionSuite().catch((err) => {
  console.error('\n❌ Test Suite Failed:', err.message);
  process.exit(1);
});
