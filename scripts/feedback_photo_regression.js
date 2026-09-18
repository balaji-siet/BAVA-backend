const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const Feedback = require('../src/models/Feedback');
const Student = require('../src/models/Student');
const feedbackController = require('../src/controllers/feedbackController');
const { detectImageType, isDangerousContent } = require('../src/utils/photoStorage');

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

// Create a minimal 1x1 valid JPEG in base64
const validJpegBase64 = Buffer.from([
  0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
  0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
  0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
  0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
  0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
  0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
  0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xD9
]).toString('base64');

// Minimal 1x1 valid PNG in base64
const validPngBase64 = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
  0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
]).toString('base64');

async function runFeedbackRegression() {
  console.log('============================================================');
  console.log('SMART MESS — FEEDBACK & PHOTO UPLOAD REGRESSION TEST');
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
    // Setup student
    const student = await Student.create({
      name: 'Feedback Tester',
      roll_number: 'FB2026',
      department: 'IT',
      email: 'fb2026@shakthimess.com',
      password: 'hashedpassword',
      hostel_block: 'B',
      room_number: '101'
    });

    // 1. Missing rating rejected
    const missingReq = { userId: student._id, body: { comments: 'Good food' } };
    const missingRes = mockRes();
    await feedbackController.submitFeedback(missingReq, missingRes);
    assert('Missing rating rejected (HTTP 400)', missingRes.statusCode === 400);

    // 2. Rating < 1 rejected
    const zeroReq = { userId: student._id, body: { rating: 0, comments: 'Bad' } };
    const zeroRes = mockRes();
    await feedbackController.submitFeedback(zeroReq, zeroRes);
    assert('Rating = 0 rejected (HTTP 400)', zeroRes.statusCode === 400);

    // 3. Rating > 5 rejected
    const overReq = { userId: student._id, body: { rating: 6, comments: 'Super' } };
    const overRes = mockRes();
    await feedbackController.submitFeedback(overReq, overRes);
    assert('Rating = 6 rejected (HTTP 400)', overRes.statusCode === 400);

    // 4. Rating string/NaN rejected
    const nanReq = { userId: student._id, body: { rating: 'abc', comments: 'Super' } };
    const nanRes = mockRes();
    await feedbackController.submitFeedback(nanReq, nanRes);
    assert('Non-numeric rating rejected (HTTP 400)', nanRes.statusCode === 400);

    // 5. Valid feedback without photo succeeds
    const noPhotoReq = {
      userId: student._id,
      body: {
        rating: 4,
        meal_type: 'lunch',
        comments: 'Tasty meal without photo'
      }
    };
    const noPhotoRes = mockRes();
    await feedbackController.submitFeedback(noPhotoReq, noPhotoRes);
    assert('Feedback without photo succeeds (HTTP 201)', noPhotoRes.statusCode === 201 && noPhotoRes.jsonData.feedback.photo_url === '');

    // 6. Valid feedback with JPEG photo succeeds
    const jpegReq = {
      userId: student._id,
      body: {
        rating: 5,
        meal_type: 'dinner',
        comments: 'Fresh hot dinner with photo',
        photo: validJpegBase64
      }
    };
    const jpegRes = mockRes();
    await feedbackController.submitFeedback(jpegReq, jpegRes);
    assert('Feedback with valid JPEG photo succeeds (HTTP 201)', jpegRes.statusCode === 201 && jpegRes.jsonData.feedback.photo_url.includes('.jpg'));

    // 7. Valid feedback with PNG photo succeeds
    const pngReq = {
      userId: student._id,
      body: {
        rating: 3,
        meal_type: 'breakfast',
        comments: 'Decent breakfast with PNG photo',
        photo: `data:image/png;base64,${validPngBase64}`
      }
    };
    const pngRes = mockRes();
    await feedbackController.submitFeedback(pngReq, pngRes);
    assert('Feedback with valid PNG photo succeeds (HTTP 201)', pngRes.statusCode === 201 && pngRes.jsonData.feedback.photo_url.includes('.png'));

    // 8. Fake/malicious file rejected (HTML/Script)
    const fakeHtmlBase64 = Buffer.from('<html><script>alert("hack")</script></html>').toString('base64');
    const maliciousReq = {
      userId: student._id,
      body: {
        rating: 4,
        comments: 'Malicious file attempt',
        photo: fakeHtmlBase64
      }
    };
    const maliciousRes = mockRes();
    await feedbackController.submitFeedback(maliciousReq, maliciousRes);
    assert('Unsafe HTML/script attachment rejected (HTTP 400/415)', maliciousRes.statusCode === 400 || maliciousRes.statusCode === 415);

    // 9. Fake executable (MZ header) rejected
    const fakeExeBase64 = Buffer.from('MZ90000300000004000000ffff0000').toString('base64');
    const exeReq = {
      userId: student._id,
      body: {
        rating: 4,
        comments: 'Executable attempt',
        photo: fakeExeBase64
      }
    };
    const exeRes = mockRes();
    await feedbackController.submitFeedback(exeReq, exeRes);
    assert('Executable attachment rejected (HTTP 400/415)', exeRes.statusCode === 400 || exeRes.statusCode === 415);

    // 10. Oversized photo (>5MB) rejected
    const bigBuffer = Buffer.alloc(5.2 * 1024 * 1024);
    bigBuffer[0] = 0xFF; bigBuffer[1] = 0xD8; bigBuffer[2] = 0xFF; // JPEG magic header
    const bigBase64 = bigBuffer.toString('base64');
    const bigReq = {
      userId: student._id,
      body: {
        rating: 4,
        comments: 'Oversized photo',
        photo: bigBase64
      }
    };
    const bigRes = mockRes();
    await feedbackController.submitFeedback(bigReq, bigRes);
    assert('Oversized photo (>5 MB) rejected (HTTP 400/413)', (bigRes.statusCode === 400 || bigRes.statusCode === 413) && bigRes.jsonData.error.includes('5 MB'));

    // 11. getAllFeedback returns stored feedback with photo_url
    const listRes = mockRes();
    await feedbackController.getAllFeedback({}, listRes);
    assert('getAllFeedback returns array of feedback', Array.isArray(listRes.jsonData) && listRes.jsonData.length === 3);
    const hasPhotoItem = listRes.jsonData.find(item => Boolean(item.photo_url));
    assert('Stored feedback includes photo_url attribute', Boolean(hasPhotoItem));

    // 12. getFeedbackSummary computes real average rating and total feedback
    const sumRes = mockRes();
    await feedbackController.getFeedbackSummary({}, sumRes);
    // Ratings entered: 4, 5, 3 -> avg = (4+5+3)/3 = 4.0, total = 3
    assert('Feedback summary calculates exact average rating (4.0)', sumRes.jsonData.averageRating === 4.0);
    assert('Feedback summary returns exact total count (3)', sumRes.jsonData.totalFeedback === 3);

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

runFeedbackRegression().catch(err => {
  console.error('Feedback regression test failed:', err);
  process.exit(1);
});
