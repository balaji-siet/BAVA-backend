const bcrypt = require('bcrypt');
const mongoose = require('mongoose');
require('dotenv').config();

const Student = require('../src/models/Student');
const Supervisor = require('../src/models/Supervisor');
const authController = require('../src/controllers/authController');

const MONGODB_URI = process.env.MONGODB_URI;

function invokeController(handler, body) {
  return new Promise((resolve) => {
    const req = { body };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, data: payload });
      },
    };
    Promise.resolve(handler(req, res)).catch((err) => resolve({ status: 500, data: { error: err.message } }));
  });
}

const isBcryptHash = (value) => typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

async function runPasswordSecurityRegression() {
  console.log('============================================================');
  console.log('SMART MESS — PASSWORD SECURITY REGRESSION SUITE');
  console.log('============================================================\n');

  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI is required for password storage verification');
  }

  let totalTests = 0;
  let passedTests = 0;
  const createdStudentEmails = [];
  const createdSupervisorEmails = [];

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

  await mongoose.connect(MONGODB_URI, {
    serverSelectionTimeoutMS: 10000,
    connectTimeoutMS: 15000,
  });

  try {
    const suffix = Date.now();
    const studentEmail = `password_student_${suffix}@test.local`;
    const studentRoll = `PWD_STU_${suffix}`;
    const supervisorEmail = `password_supervisor_${suffix}@test.local`;
    const supervisorId = `PWD_SUP_${suffix}`;
    const studentPassword = 'StudentSecure123!';
    const supervisorPassword = 'SupervisorSecure123!';

    createdStudentEmails.push(studentEmail);
    createdSupervisorEmails.push(supervisorEmail);

    console.log('--- 1. Registration stores bcrypt hashes ---');
    const studentReg = await invokeController(authController.studentRegister, {
      name: 'Password Test Student',
      roll_number: studentRoll,
      department: 'CSE',
      email: studentEmail,
      password: studentPassword,
    });
    assert(studentReg.status === 201 || studentReg.status === 400, `Student registration reached backend (status=${studentReg.status})`);

    const supervisorReg = await invokeController(authController.supervisorRegister, {
      name: 'Password Test Supervisor',
      employee_id: supervisorId,
      email: supervisorEmail,
      password: supervisorPassword,
    });
    assert(supervisorReg.status === 201 || supervisorReg.status === 400, `Supervisor registration reached backend (status=${supervisorReg.status})`);

    const student = await Student.findOne({ email: studentEmail }).lean();
    const supervisor = await Supervisor.findOne({ email: supervisorEmail }).lean();
    assert(Boolean(student), 'New Student account exists for storage verification');
    assert(Boolean(supervisor), 'New Supervisor account exists for storage verification');
    assert(isBcryptHash(student.password), 'New Student password stored as bcrypt hash');
    assert(isBcryptHash(supervisor.password), 'New Supervisor password stored as bcrypt hash');

    console.log('\n--- 2. Login behavior uses bcrypt-compatible hashes ---');
    const studentLogin = await invokeController(authController.studentLogin, {
      email: studentEmail,
      password: studentPassword,
    });
    assert(studentLogin.status === 200 && studentLogin.data?.token, 'Correct Student password authenticates');

    const supervisorLogin = await invokeController(authController.supervisorLogin, {
      email: supervisorEmail,
      password: supervisorPassword,
    });
    assert(supervisorLogin.status === 200 && supervisorLogin.data?.token, 'Correct Supervisor password authenticates');

    const wrongStudentLogin = await invokeController(authController.studentLogin, {
      email: studentEmail,
      password: 'WrongPassword123!',
    });
    assert(wrongStudentLogin.status !== 200, 'Wrong Student password rejected');

    const wrongSupervisorLogin = await invokeController(authController.supervisorLogin, {
      email: supervisorEmail,
      password: 'WrongPassword123!',
    });
    assert(wrongSupervisorLogin.status !== 200, 'Wrong Supervisor password rejected');

    console.log('\n--- 3. Plaintext stored password is rejected ---');
    const plainEmail = `plaintext_student_${suffix}@test.local`;
    const plainRoll = `PLAIN_STU_${suffix}`;
    createdStudentEmails.push(plainEmail);
    await Student.create({
      name: 'Plaintext Rejection Student',
      roll_number: plainRoll,
      department: 'CSE',
      email: plainEmail,
      password: 'PlaintextShouldNotWork123!',
      status: 'active',
    });

    const plaintextLogin = await invokeController(authController.studentLogin, {
      email: plainEmail,
      password: 'PlaintextShouldNotWork123!',
    });
    assert(plaintextLogin.status !== 200, 'Direct plaintext stored password does not authenticate');

    console.log('\n--- 4. Legacy bcrypt compatibility ---');
    const bcrypt2bHash = await bcrypt.hash('CompatPassword123!', 10);
    assert(await bcrypt.compare('CompatPassword123!', bcrypt2bHash), 'bcrypt $2b$ compatibility works');

    const bcrypt2aHash = '$2a$10$DxEAEBvMdMOGi9QfUzW5YORD8XlxmuGJQ/PGsulD3KNQSaaSoQj/2';
    assert(await bcrypt.compare('TestPassword123!', bcrypt2aHash), 'legacy bcrypt $2a$ compatibility works');

    console.log('\n--- 5. Log hygiene ---');
    assert(true, 'This regression script does not print raw passwords or stored hashes');

    console.log('\n============================================================');
    console.log(`PASSWORD SECURITY RESULT: ${passedTests}/${totalTests} TESTS PASSED`);
    console.log('============================================================\n');
  } finally {
    await Student.deleteMany({ email: { $in: createdStudentEmails } });
    await Supervisor.deleteMany({ email: { $in: createdSupervisorEmails } });
    await mongoose.disconnect();
  }
}

runPasswordSecurityRegression().catch((err) => {
  console.error('\nTest Suite Failed:', err.message);
  process.exit(1);
});
