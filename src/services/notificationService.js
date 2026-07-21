const cron = require('node-cron');
const db = require('../config/db');
require('dotenv').config();

// Get simulated current date string helper
function getSimulatedDateStr(offsetDays = 0) {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  if (offsetDays !== 0) {
    now.setDate(now.getDate() + offsetDays);
  }
  return now.toISOString().split('T')[0];
}

function getSmsConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  const to = process.env.SUPERVISOR_PHONE;

  if (!accountSid || !authToken || !from || !to) {
    return null;
  }

  return { accountSid, authToken, from, to };
}

async function sendSupervisorSms(message, customPhoneNumber) {
  let to = customPhoneNumber || process.env.SUPERVISOR_PHONE || '8015667502';
  if (to && !to.startsWith('+')) {
    to = '+91' + to;
  }

  const smsConfig = getSmsConfig();

  if (!smsConfig) {
    console.log(`
------------------------------------------------------------------------
MOCK SMS NOTIFICATION LOG (SMS NOT CONFIGURED IN .env)
To: ${to}
Message:
${message}
------------------------------------------------------------------------
    `);
    return;
  }

  const auth = Buffer.from(`${smsConfig.accountSid}:${smsConfig.authToken}`).toString('base64');
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${smsConfig.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        From: smsConfig.from,
        To: to,
        Body: message
      }).toString()
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio SMS failed: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  console.log(`Notification Service: SMS notification sent to ${to}. Message SID: ${result.sid}`);
}

// Send the notification report
async function sendMealReport(mealType, targetDate, customTime, customPhoneNumber) {
  try {
    // 1. Fetch counts from database
    const [rows] = await db.query(
      "SELECT COUNT(*) AS count FROM meal_reservations WHERE reservation_date = ? AND meal_type = ? AND reservation_status = 'confirmed'",
      [targetDate, mealType]
    );

    const count = (rows && rows[0]) ? rows[0].count : 0;
    const displayTime = customTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const smsMessage = `Sri Shakthi Smart Mess final ${mealType.toUpperCase()} report for ${targetDate}: ${count} student(s) confirmed. Cutoff closed at ${displayTime}.`;

    console.log(`Notification Service: Generating SMS report for ${mealType} on ${targetDate}...`);
    await sendSupervisorSms(smsMessage, customPhoneNumber);
    return count;
  } catch (error) {
    console.error(`Notification Service error sending report for ${mealType}:`, error);
  }
}

// Initialize cron schedules
function initializeSchedules() {
  console.log('Notification Service: Initializing scheduled reservation cutoffs...');

  // 1. Lunch Cutoff - 10:00 AM daily
  cron.schedule('0 10 * * *', async () => {
    const today = getSimulatedDateStr();
    console.log('Cron: Triggering Lunch reservation cutoff report...');
    await sendMealReport('lunch', today);
  });

  // 2. Dinner Cutoff - 4:00 PM (16:00) daily
  cron.schedule('0 16 * * *', async () => {
    const today = getSimulatedDateStr();
    console.log('Cron: Triggering Dinner reservation cutoff report...');
    await sendMealReport('dinner', today);
  });

  // 3. Breakfast Cutoff - 10:00 PM (22:00) daily (for tomorrow's breakfast)
  cron.schedule('0 22 * * *', async () => {
    const tomorrow = getSimulatedDateStr(1);
    console.log('Cron: Triggering Breakfast reservation cutoff report...');
    await sendMealReport('breakfast', tomorrow);
  });

  console.log('Notification Service: Schedules registered.');
}

module.exports = {
  sendMealReport,
  initializeSchedules,
  getSimulatedDateStr
};