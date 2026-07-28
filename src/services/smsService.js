const Supervisor = require('../models/Supervisor');
const SMSLog = require('../models/SMSLog');

/**
 * Multi-Provider SMS Dispatcher
 * Supports: MSG91, Fast2SMS, Twilio, AWS SNS, and local Logger
 */

async function getSupervisorPhoneNumbers() {
  try {
    const supervisors = await Supervisor.find({ mobile_number: { $exists: true, $ne: '' } });
    if (supervisors.length > 0) {
      return supervisors.map(s => s.mobile_number).filter(Boolean);
    }
  } catch (e) {
    console.error('[SMS] Error fetching supervisor phone numbers:', e);
  }
  return [process.env.SUPERVISOR_MOBILE || '9876543210'];
}

function formatDateDisplay(dateStr) {
  try {
    const dateObj = new Date(dateStr + 'T00:00:00');
    return dateObj.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (e) {
    return dateStr;
  }
}

async function sendCutoffSMS({ meal, date, cutoff_time, count }) {
  const phoneNumbers = await getSupervisorPhoneNumbers();
  const dateFormatted = formatDateDisplay(date);
  const mealTitle = meal.charAt(0).toUpperCase() + meal.slice(1);

  const messageBody = `SMART MESS\nReservation Closed\n\nMeal:\n${mealTitle}\n\nDate:\n${dateFormatted}\n\nReservation Closed:\n${cutoff_time}\n\nTotal Students Reserved:\n${count}\n\nPlease prepare food for approximately ${count} students.\n\nSMART MESS System`;

  console.log(`\n====================================================`);
  console.log(`[SMS DISPATCH] Triggered for ${mealTitle} on ${date}`);
  console.log(`[SMS BODY]:\n${messageBody}`);
  console.log(`====================================================\n`);

  const results = [];

  for (const phone of phoneNumbers) {
    let provider = 'simulator';
    let status = 'simulated';
    let messageId = `SIM_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    let errorDetails = '';

    try {
      // 1. Twilio
      if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
        provider = 'twilio';
        const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        const res = await twilio.messages.create({
          body: messageBody,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: phone.startsWith('+') ? phone : `+91${phone}`
        });
        messageId = res.sid;
        status = 'sent';
      }
      // 2. Fast2SMS
      else if (process.env.FAST2SMS_API_KEY) {
        provider = 'fast2sms';
        const rawRes = await fetch('https://www.fast2sms.com/dev/bulkV2', {
          method: 'POST',
          headers: {
            'authorization': process.env.FAST2SMS_API_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            route: 'v3',
            sender_id: 'TXTIND',
            message: messageBody,
            language: 'english',
            flash: 0,
            numbers: phone.replace(/[^0-9]/g, '')
          })
        });
        const resData = await rawRes.json();
        messageId = resData?.request_id || `F2S_${Date.now()}`;
        status = resData?.return ? 'sent' : 'failed';
      }
      // 3. MSG91
      else if (process.env.MSG91_AUTH_KEY) {
        provider = 'msg91';
        const rawRes = await fetch('https://api.msg91.com/api/v2/sendsms', {
          method: 'POST',
          headers: {
            'authkey': process.env.MSG91_AUTH_KEY,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            sender: process.env.MSG91_SENDER_ID || 'SMESS',
            route: '4',
            country: '91',
            sms: [{ message: messageBody, to: [phone.replace(/[^0-9]/g, '')] }]
          })
        });
        const resData = await rawRes.json();
        messageId = resData?.request_id || `MSG91_${Date.now()}`;
        status = resData?.type === 'success' ? 'sent' : 'failed';
      }
      // 4. Default Simulator Mode
      else {
        provider = 'simulator';
        status = 'simulated';
      }
    } catch (err) {
      console.error(`[SMS FAILED] Provider ${provider} failed for ${phone}:`, err.message);
      status = 'failed';
      errorDetails = err.message;
    }

    // Save SMS Log to MongoDB
    try {
      const log = new SMSLog({
        meal: meal.toLowerCase(),
        reservation_count: count,
        date: date,
        cutoff_time: cutoff_time,
        sent_to: phone,
        status: status,
        provider: provider,
        message_id: messageId,
        message_body: messageBody,
        error_details: errorDetails
      });
      await log.save();
      results.push(log);
    } catch (dbErr) {
      console.error('[SMS LOG DB ERROR]:', dbErr);
    }
  }

  return results;
}

module.exports = {
  sendCutoffSMS,
  getSupervisorPhoneNumbers
};
