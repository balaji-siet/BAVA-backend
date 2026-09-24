const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const Student = require('../src/models/Student');
const Supervisor = require('../src/models/Supervisor');
const authController = require('../src/controllers/authController');

let mongod;

const mockRes = () => {
  const res = {};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data) => {
    res.jsonData = data;
    return res;
  };
  return res;
};

async function runPasswordRegression() {
  console.log('============================================================');
  console.log('SMART MESS — PASSWORD & ACCOUNT MANAGEMENT REGRESSION TEST');
  console.log('============================================================\n');

  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);

  let passed = 0;
  let total = 0;

  function assert(desc, condition) {
    total++;
    if (condition) {
      console.log(`  [PASS] ${desc}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${desc}`);
    }
  }

  try {
    // 1. Register student
    const regReq = {
      body: {
        name: 'Test Student',
        roll_number: 'TEST2026',
        department: 'CSE',
        email: 'test2026@shakthimess.com',
        password: 'Password123!',
        hostel_block: 'A',
        room_number: '202'
      }
    };
    const regRes = mockRes();
    await authController.studentRegister(regReq, regRes);
    assert('Student registration succeeds', regRes.statusCode === 201);

    // 2. Duplicate Roll Number Rejection
    const dupRollRes = mockRes();
    await authController.studentRegister(regReq, dupRollRes);
    assert('Duplicate Roll Number rejected (HTTP 400)', dupRollRes.statusCode === 400);

    // 3. Duplicate Email Rejection
    const dupEmailReq = {
      body: {
        name: 'Another Student',
        roll_number: 'TEST2027',
        department: 'ECE',
        email: 'test2026@shakthimess.com',
        password: 'Password123!'
      }
    };
    const dupEmailRes = mockRes();
    await authController.studentRegister(dupEmailReq, dupEmailRes);
    assert('Duplicate Email rejected (HTTP 400)', dupEmailRes.statusCode === 400);

    // 4. Initial Login with valid password
    const loginReq = {
      body: {
        email: 'test2026@shakthimess.com',
        password: 'Password123!'
      }
    };
    const loginRes = mockRes();
    await authController.studentLogin(loginReq, loginRes);
    assert('Login with valid initial password succeeds', loginRes.statusCode === 200 && loginRes.jsonData.token);
    const studentId = loginRes.jsonData.user.id;

    // 5. Change Password - Wrong Current Password
    const wrongChangeReq = {
      userId: studentId,
      body: {
        current_password: 'WrongPassword!',
        new_password: 'NewPassword2026!'
      }
    };
    const wrongChangeRes = mockRes();
    await authController.changePassword(wrongChangeReq, wrongChangeRes);
    assert('Change password with wrong current password rejected (HTTP 400)', wrongChangeRes.statusCode === 400);

    // 6. Change Password - Short New Password (<6 chars)
    const shortChangeReq = {
      userId: studentId,
      body: {
        current_password: 'Password123!',
        new_password: '123'
      }
    };
    const shortChangeRes = mockRes();
    await authController.changePassword(shortChangeReq, shortChangeRes);
    assert('Short new password (< 6 chars) rejected (HTTP 400)', shortChangeRes.statusCode === 400);

    // 7. Change Password - Mismatched Confirm Password
    const mismatchReq = {
      userId: studentId,
      body: {
        current_password: 'Password123!',
        new_password: 'NewPassword2026!',
        confirm_password: 'DifferentPassword2026!'
      }
    };
    const mismatchRes = mockRes();
    await authController.changePassword(mismatchReq, mismatchRes);
    assert('Mismatched confirm password rejected (HTTP 400)', mismatchRes.statusCode === 400);

    // 8. Change Password - Valid
    const validChangeReq = {
      userId: studentId,
      body: {
        current_password: 'Password123!',
        new_password: 'NewPassword2026!',
        confirm_password: 'NewPassword2026!'
      }
    };
    const validChangeRes = mockRes();
    await authController.changePassword(validChangeReq, validChangeRes);
    assert('Change password with valid credentials succeeds (HTTP 200)', validChangeRes.statusCode === 200 && validChangeRes.jsonData.success);

    // 9. Verify Old Password Login Fails
    const oldLoginReq = {
      body: {
        email: 'test2026@shakthimess.com',
        password: 'Password123!'
      }
    };
    const oldLoginRes = mockRes();
    await authController.studentLogin(oldLoginReq, oldLoginRes);
    assert('Old password after password change is rejected (HTTP 400)', oldLoginRes.statusCode === 400);

    // 10. Verify New Password Login Succeeds
    const newLoginReq = {
      body: {
        email: 'test2026@shakthimess.com',
        password: 'NewPassword2026!'
      }
    };
    const newLoginRes = mockRes();
    await authController.studentLogin(newLoginReq, newLoginRes);
    assert('New password login succeeds (HTTP 200)', newLoginRes.statusCode === 200 && newLoginRes.jsonData.token);

    // 11. Security Audit: Database contains bcrypt hash, not plaintext
    const dbStudent = await Student.findById(studentId);
    assert('Database does NOT store plaintext password', dbStudent.password !== 'NewPassword2026!' && dbStudent.password.startsWith('$2'));

    // 12. Forgot Password - Unknown identifier
    const unknownForgotReq = { body: { identifier: 'NON_EXISTENT_ROLL' } };
    const unknownForgotRes = mockRes();
    await authController.forgotPassword(unknownForgotReq, unknownForgotRes);
    assert('Forgot password with unknown identifier returns 404', unknownForgotRes.statusCode === 404);

    // 13. Forgot Password - Valid identifier generates reset token
    const validForgotReq = { headers: {}, body: { identifier: 'TEST2026' } };
    const validForgotRes = mockRes();
    await authController.forgotPassword(validForgotReq, validForgotRes);
    assert('Forgot password generates short-lived reset token', validForgotRes.statusCode === 200 && validForgotRes.jsonData.reset_token);
    const resetToken = validForgotRes.jsonData.reset_token;

    // 14. Reset Password - Valid token
    const resetReq = {
      body: {
        reset_token: resetToken,
        new_password: 'ResetPassword999!',
        confirm_password: 'ResetPassword999!'
      }
    };
    const resetRes = mockRes();
    await authController.resetPassword(resetReq, resetRes);
    assert('Reset password with valid token succeeds (HTTP 200)', resetRes.statusCode === 200 && resetRes.jsonData.success);

    // 15. Verify login with reset password
    const postResetLoginReq = {
      body: {
        roll_number: 'TEST2026',
        password: 'ResetPassword999!'
      }
    };
    const postResetLoginRes = mockRes();
    await authController.studentLogin(postResetLoginReq, postResetLoginRes);
    assert('Login with reset password succeeds', postResetLoginRes.statusCode === 200);

    // 16. Reset Password - Forged / Invalid token rejected
    const forgedReq = {
      body: {
        reset_token: 'forged.invalid.token',
        new_password: 'AttackPassword123!'
      }
    };
    const forgedRes = mockRes();
    await authController.resetPassword(forgedReq, forgedRes);
    assert('Reset password with forged token rejected (HTTP 400/500)', forgedRes.statusCode >= 400);

  } finally {
    await mongoose.disconnect();
    await mongod.stop();
  }

  console.log('\n============================================================');
  console.log(`RESULTS: ${passed}/${total} TESTS PASSED (${Math.round((passed/total)*100)}%)`);
  console.log('============================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runPasswordRegression().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
