const jwt = require('jsonwebtoken');
const http = require('http');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_jwt_mess_token_123!';

// Canonical role normalization
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

// Simulated Hardware SecureStore
class MockSecureStore {
  constructor() {
    this.store = {};
  }
  async setItem(key, value) {
    this.store[key] = value;
  }
  async getItem(key) {
    return this.store[key] || null;
  }
  async deleteItem(key) {
    delete this.store[key];
  }
}

// Simulated App Session Storage (AsyncStorage)
class MockAsyncStorage {
  constructor() {
    this.store = {};
  }
  async multiSet(pairs) {
    for (const [k, v] of pairs) {
      this.store[k] = v;
    }
  }
  async multiRemove(keys) {
    for (const k of keys) {
      delete this.store[k];
    }
  }
  async getItem(key) {
    return this.store[key] || null;
  }
}

async function runRememberLoginSuite() {
  console.log('================================================================');
  console.log('SMART MESS — SECURE REMEMBER LOGIN & ROLE REGRESSION TEST SUITE');
  console.log('================================================================\n');

  let totalTests = 0;
  let passedTests = 0;

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

  const secureStore = new MockSecureStore();
  const asyncStorage = new MockAsyncStorage();

  const STUDENT_KEY = 'smartmess_saved_student';
  const SUPERVISOR_KEY = 'smartmess_saved_supervisor';

  // Secure Credential Helpers
  const saveStudentCred = async (id, pwd) => {
    await secureStore.setItem(STUDENT_KEY, JSON.stringify({
      identifier: id,
      securePassword: pwd,
      role: 'student',
      savedAt: new Date().toISOString()
    }));
  };

  const getStudentCred = async () => {
    const raw = await secureStore.getItem(STUDENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (normalizeRole(parsed.role) !== 'student') return null;
    return parsed;
  };

  const saveSupervisorCred = async (id, pwd) => {
    await secureStore.setItem(SUPERVISOR_KEY, JSON.stringify({
      identifier: id,
      securePassword: pwd,
      role: 'supervisor',
      savedAt: new Date().toISOString()
    }));
  };

  const getSupervisorCred = async () => {
    const raw = await secureStore.getItem(SUPERVISOR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (normalizeRole(parsed.role) !== 'supervisor') return null;
    return parsed;
  };

  // Mock Authentication System
  const authenticateUser = async (identifier, password, intendedType) => {
    if (identifier === 'RA1001' && password === 'Student@123') {
      const token = jwt.sign(
        { studentId: 'stu1', rollNumber: 'RA1001', role: 'student', name: 'Balaji' },
        JWT_SECRET
      );
      return { token, user: { id: 1, name: 'Balaji', roll_number: 'RA1001', role: 'student' } };
    }
    if (identifier === 'supervisor@test.com' && password === 'Supervisor@123') {
      const token = jwt.sign(
        { studentId: 'sup1', rollNumber: 'SUP101', role: 'admin', name: 'Mess Supervisor' },
        JWT_SECRET
      );
      return { token, user: { id: 2, name: 'Mess Supervisor', roll_number: 'SUP101', role: 'admin' } };
    }
    throw new Error('Invalid credentials');
  };

  const performLogin = async (id, pwd, remember, intendedType) => {
    const res = await authenticateUser(id, pwd, intendedType);
    const canonicalRole = resolveValidRole(res.user?.role, parseJwtPayload(res.token)?.role);
    if (!canonicalRole) {
      throw new Error('Invalid role returned by authentication');
    }
    const userObj = { ...res.user, role: canonicalRole };

    // Set Active Session
    await asyncStorage.multiSet([
      ['auth_session', JSON.stringify({ token: res.token, user: userObj })],
      ['auth_token', res.token],
      ['auth_user', JSON.stringify(userObj)]
    ]);

    // Save in SecureStore if requested
    if (remember) {
      if (intendedType === 'Student') {
        await saveStudentCred(id, pwd);
      } else {
        await saveSupervisorCred(id, pwd);
      }
    }

    // Evaluate Navigation
    if (isSupervisor(canonicalRole)) return 'SupervisorDashboard';
    if (isStudent(canonicalRole)) return 'StudentDashboard';
    return 'LoginScreen';
  };

  const performLogout = async () => {
    await asyncStorage.multiRemove(['auth_session', 'auth_token', 'auth_user']);
  };

  // --- TESTS ---
  console.log('--- 1. Manual Student & Supervisor Remembered Login ---');
  // A. Student Login + Remember -> Logout -> One-tap Login -> Student Dashboard
  const screenA = await performLogin('RA1001', 'Student@123', true, 'Student');
  assert(screenA === 'StudentDashboard', 'A. Manual Student Login navigates to StudentDashboard');
  
  await performLogout();
  assert(await asyncStorage.getItem('auth_session') === null, 'E. Student logout clears active session');
  assert((await getStudentCred()) !== null, 'E. Student logout preserves remembered student account in SecureStore');

  const savedStu = await getStudentCred();
  const screenASaved = await performLogin(savedStu.identifier, savedStu.securePassword, false, 'Student');
  assert(screenASaved === 'StudentDashboard', 'A. One-Tap Student Login navigates to StudentDashboard');
  await performLogout();

  // B. Supervisor Login + Remember -> Logout -> One-tap Login -> Supervisor Dashboard
  const screenB = await performLogin('supervisor@test.com', 'Supervisor@123', true, 'Supervisor');
  assert(screenB === 'SupervisorDashboard', 'B. Manual Supervisor Login navigates to SupervisorDashboard');
  
  await performLogout();
  assert(await asyncStorage.getItem('auth_session') === null, 'F. Supervisor logout clears active session');
  assert((await getSupervisorCred()) !== null, 'F. Supervisor logout preserves remembered supervisor account in SecureStore');

  const savedSup = await getSupervisorCred();
  const screenBSaved = await performLogin(savedSup.identifier, savedSup.securePassword, false, 'Supervisor');
  assert(screenBSaved === 'SupervisorDashboard', 'B. One-Tap Supervisor Login navigates to SupervisorDashboard');
  await performLogout();

  console.log('\n--- 2. Role Separation & Cross-Account Isolation ---');
  // Both accounts co-exist in SecureStore simultaneously
  assert((await getStudentCred())?.identifier === 'RA1001', '10. Student credentials intact');
  assert((await getSupervisorCred())?.identifier === 'supervisor@test.com', '10. Supervisor credentials intact');

  // G. Forget Student removes student but keeps supervisor
  await secureStore.deleteItem(STUDENT_KEY);
  assert((await getStudentCred()) === null, 'G. Forget Student removes student credentials');
  assert((await getSupervisorCred()) !== null, 'G. Forget Student preserves supervisor credentials');

  // Re-save student and test Forget Supervisor
  await saveStudentCred('RA1001', 'Student@123');
  await secureStore.deleteItem(SUPERVISOR_KEY);
  assert((await getSupervisorCred()) === null, 'H. Forget Supervisor removes supervisor credentials');
  assert((await getStudentCred()) !== null, 'H. Forget Supervisor preserves student credentials');
  await saveSupervisorCred('supervisor@test.com', 'Supervisor@123');

  console.log('\n--- 3. Invalid/Corrupt Role & Failed Password Safety ---');
  // I. Corrupt saved role
  await secureStore.setItem('smartmess_saved_student', JSON.stringify({
    identifier: 'RA1001',
    securePassword: 'Student@123',
    role: 'hacker_role'
  }));
  const corruptStu = await getStudentCred();
  assert(corruptStu === null, 'I. Corrupt saved role rejected safely (returns null)');
  await saveStudentCred('RA1001', 'Student@123');

  // J. Wrong saved password rejection
  let failedLoginHandled = false;
  try {
    await performLogin('RA1001', 'WrongPassword!', false, 'Student');
  } catch (e) {
    failedLoginHandled = true;
  }
  assert(failedLoginHandled === true, 'J. Wrong saved password rejected safely without crash');

  console.log('\n--- 4. Missing Role Safety for Saved/Biometric Login Results ---');
  const invalidSavedRoleCases = [
    ['saved-login result missing role', { token: jwt.sign({ studentId: 'x' }, JWT_SECRET), user: { id: 'x' } }],
    ['saved-login result null role', { token: jwt.sign({ studentId: 'x' }, JWT_SECRET), user: { id: 'x', role: null } }],
    ['saved-login result empty role', { token: jwt.sign({ studentId: 'x' }, JWT_SECRET), user: { id: 'x', role: '' } }],
    ['saved-login result unsupported role', { token: jwt.sign({ studentId: 'x', role: 'auditor' }, JWT_SECRET), user: { id: 'x', role: 'auditor' } }],
    ['saved-login corrupted JWT and missing role', { token: 'header.invalid.signature', user: { id: 'x' } }],
  ];

  let invalidSavedStudentRoutes = 0;
  for (const [description, result] of invalidSavedRoleCases) {
    const role = resolveValidRole(result.user?.role, parseJwtPayload(result.token)?.role);
    const route = role && isStudent(role) ? 'StudentDashboard' : role && isSupervisor(role) ? 'SupervisorDashboard' : 'LoginScreen';
    if (route === 'StudentDashboard') invalidSavedStudentRoutes++;
    assert(route === 'LoginScreen', `${description} rejects to LoginScreen`);
  }
  assert(invalidSavedStudentRoutes === 0, `Invalid saved/biometric result -> StudentDashboard occurrences: ${invalidSavedStudentRoutes}`);

  console.log('\n--- 5. 20 Alternating Saved-Account Login Cycles ---');
  let wrongRedirects = 0;
  for (let i = 1; i <= 20; i++) {
    const isSupervisor = i % 2 === 0;
    if (isSupervisor) {
      const cred = await getSupervisorCred();
      const dest = await performLogin(cred.identifier, cred.securePassword, false, 'Supervisor');
      if (dest !== 'SupervisorDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i} ERROR: Supervisor routed to ${dest}`);
      }
      await performLogout();
    } else {
      const cred = await getStudentCred();
      const dest = await performLogin(cred.identifier, cred.securePassword, false, 'Student');
      if (dest !== 'StudentDashboard') {
        wrongRedirects++;
        console.error(`Cycle ${i} ERROR: Student routed to ${dest}`);
      }
      await performLogout();
    }
  }

  assert(wrongRedirects === 0, `K. 20 Alternating Saved-Account Cycles: ${wrongRedirects} wrong redirects (Expected 0)`);

  console.log('\n================================================================');
  console.log(`ALL ${totalTests} SECURE REMEMBER LOGIN TESTS PASSED (0 ERRORS)!`);
  console.log('================================================================\n');
}

runRememberLoginSuite().catch(err => {
  console.error('\n❌ Test Suite Failed:', err);
  process.exit(1);
});
