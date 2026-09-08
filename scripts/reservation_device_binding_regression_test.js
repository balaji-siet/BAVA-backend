const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const routes = read('src/routes/api.js');
const controller = read('src/controllers/reservationDeviceController.js');
const reservationController = read('src/controllers/reservationController.js');
const studentModel = read('src/models/Student.js');

assert(routes.includes("router.post('/reservation-device/enroll', verifyToken, reservationDeviceController.enrollDevice)"), 'Enroll route must require auth.');
assert(routes.includes("router.post('/students/:studentId/reservation-device/reset', verifyAdmin, reservationDeviceController.resetStudentDevice)"), 'Reset route must require supervisor/admin middleware.');
assert(controller.includes("const DEVICE_TOKEN_HEADER = 'x-smartmess-device-token'"), 'Backend must validate the canonical device-token header.');
assert(controller.includes("const MEAL_PASSWORD_HEADER = 'x-smartmess-meal-password'"), 'Backend must support fresh meal-password verification header.');
assert(controller.includes("crypto.createHash('sha256')"), 'Backend must hash raw device tokens before storage.');
assert(controller.includes("crypto.randomBytes(32).toString('base64url')"), 'Device token enrollment must use high-entropy server-generated tokens.');
assert(controller.includes("crypto.timingSafeEqual"), 'Device token comparison must use timing-safe comparison.');
assert(controller.includes('bcrypt.compare(receivedPassword, student.password)'), 'Backend must verify fresh meal password against bcrypt hash.');
assert(controller.includes("Reservation authentication failed."), 'Password failures must use generic authentication failure text.');
assert(controller.includes(".select('+reservationDeviceTokenHash") , 'select:false token hash must be explicitly selected only where needed.');
assert(studentModel.includes('reservationDeviceTokenHash') && studentModel.includes('select: false'), 'Student model must keep token hashes excluded by default.');
assert((reservationController.match(/validateStudentDeviceBinding\(req, res\)/g) || []).length === 2, 'Only reserve and cancel writes should require device binding.');
assert((reservationController.match(/validateStudentMealPasswordIfProvided\(req, res\)/g) || []).length === 2, 'Reserve and cancel writes must verify fresh password when no-fingerprint mode supplies one.');
assert(!controller.includes('deviceTrusted') && !controller.includes('biometricVerified'), 'Backend must not trust client-side boolean flags.');

console.log('PASS hybrid meal auth backend static regression (14 assertions)');
