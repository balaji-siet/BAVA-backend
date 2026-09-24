const cron = require('node-cron');
const Reservation = require('../models/Reservation');
const MealSettings = require('../models/MealSettings');
const PushToken = require('../models/PushToken');
const NotificationDispatchLog = require('../models/NotificationDispatchLog');
const { getIndiaDateString, getIndiaTomorrowDateString } = require('../utils/dateUtils');
require('dotenv').config();

function getSimulatedDateStr(offsetDays = 0) {
  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  if (offsetDays !== 0) {
    now.setDate(now.getDate() + offsetDays);
  }
  return getIndiaDateString(now);
}

// Authoritative demand counter matching Supervisor Dashboard & mealSettingsController
async function getAuthoritativeDemandCount(mealType, targetDate) {
  const normalizedMeal = (mealType || '').toLowerCase().trim();
  if (!['breakfast', 'lunch', 'dinner'].includes(normalizedMeal)) {
    throw new Error(`Invalid meal type: ${mealType}`);
  }

  const count = await Reservation.countDocuments({
    reservation_date: targetDate,
    [normalizedMeal]: true
  });
  return count;
}

// Dispatches push notifications to Expo Push API
async function sendExpoPushNotifications(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { success: true, count: 0, tickets: [] };
  }

  try {
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[PushService] Expo Push API responded with HTTP ${response.status}: ${errText}`);
      return { success: false, error: errText, count: 0 };
    }

    const data = await response.json();
    const tickets = data.data || [];

    // Cleanup invalid tokens if reported by Expo
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        const invalidToken = messages[i]?.to;
        if (invalidToken) {
          console.log(`[PushService] Disabling unregistered token: ${invalidToken}`);
          await PushToken.updateOne({ pushToken: invalidToken }, { enabled: false }).catch(() => {});
        }
      }
    }

    return { success: true, count: tickets.length, tickets };
  } catch (err) {
    console.error('[PushService] Network error sending Expo push notifications:', err.message || err);
    return { success: false, error: err.message || 'Unknown network error', count: 0 };
  }
}

// Dispatches demand notification to supervisors with idempotency guard
async function dispatchDemandNotification(mealType, targetDate, triggerKind = '30MIN') {
  const normalizedMeal = (mealType || '').toLowerCase().trim();
  const mealDisplay = normalizedMeal.charAt(0).toUpperCase() + normalizedMeal.slice(1);
  const eventKey = `DEMAND_${triggerKind}:${targetDate}:${normalizedMeal}`;

  // 1. Idempotency Check: Prevent duplicate sends
  if (triggerKind !== 'TEST') {
    const existing = await NotificationDispatchLog.findOne({ eventKey });
    if (existing && existing.status === 'SUCCESS') {
      console.log(`[PushService] Skipping duplicate dispatch for eventKey: ${eventKey}`);
      return { skipped: true, reason: 'DUPLICATE_EVENT', eventKey };
    }
  }

  // 2. Authoritative Count
  const count = await getAuthoritativeDemandCount(normalizedMeal, targetDate);

  // 3. Construct Notification Content
  let title = `📊 ${mealDisplay} Demand Update`;
  let body = `Current ${mealDisplay} reservations: ${count} students.`;

  if (triggerKind === '30MIN') {
    title = `📊 ${mealDisplay} Demand Update`;
    body = `Current ${mealDisplay} reservations: ${count} students • 30 minutes remaining.`;
  } else if (triggerKind === 'FINAL') {
    title = `✅ ${mealDisplay} Final Demand`;
    body = `Final ${mealDisplay} demand: ${count} students.`;
  } else if (triggerKind === 'TEST') {
    title = `📊 ${mealDisplay} Live Demand (Test)`;
    body = `Current ${mealDisplay} reservations: ${count} students (Authoritative verification).`;
  }

  // 4. Retrieve Active Supervisor Push Tokens
  const activeTokens = await PushToken.find({
    role: { $in: ['supervisor', 'admin'] },
    enabled: true
  }).lean();

  const messages = activeTokens.map(tokenDoc => ({
    to: tokenDoc.pushToken,
    sound: 'default',
    title,
    body,
    channelId: 'supervisor-demand',
    priority: 'high',
    data: {
      type: 'SUPERVISOR_DEMAND',
      meal: normalizedMeal,
      date: targetDate,
      count,
      triggerKind,
      eventKey
    }
  }));

  // 5. Send Push
  let pushResult = { success: true, count: 0 };
  if (messages.length > 0) {
    pushResult = await sendExpoPushNotifications(messages);
  } else {
    console.log(`[PushService] No active supervisor push tokens registered for ${eventKey}`);
  }

  // 6. Record in NotificationDispatchLog
  const logDoc = await NotificationDispatchLog.findOneAndUpdate(
    { eventKey },
    {
      eventKey,
      mealType: normalizedMeal,
      targetDate,
      triggerKind,
      demandCount: count,
      title,
      body,
      recipientCount: messages.length,
      status: pushResult.success ? 'SUCCESS' : 'FAILED',
      responsePayload: pushResult
    },
    { upsert: true, new: true }
  ).catch(err => {
    console.warn('[PushService] Failed to save dispatch log:', err);
  });

  return {
    success: pushResult.success,
    eventKey,
    meal: normalizedMeal,
    targetDate,
    triggerKind,
    count,
    recipientCount: messages.length,
    title,
    body
  };
}

// Scheduled check for dynamic cutoffs
async function checkScheduledCutoffs() {
  const today = getIndiaDateString();
  const tomorrow = getIndiaTomorrowDateString();

  const settingsList = await MealSettings.find({
    date: { $in: [today, tomorrow] }
  }).lean();

  const now = new Date();

  for (const doc of settingsList) {
    const targetDate = doc.date;
    const meals = ['breakfast', 'lunch', 'dinner'];

    for (const m of meals) {
      const windowCfg = doc[m];
      if (!windowCfg || !windowCfg.enabled || !windowCfg.close_time) continue;

      // Parse cutoff time on targetDate
      const [closeHours, closeMinutes] = windowCfg.close_time.split(':').map(Number);
      const [y, mon, d] = targetDate.split('-').map(Number);

      // Create cutoff Date in local/India timezone
      const cutoffDate = new Date(y, mon - 1, d, closeHours, closeMinutes, 0, 0);
      const diffMs = cutoffDate.getTime() - now.getTime();
      const diffMinutes = Math.floor(diffMs / 60000);

      // 30 Minutes Before Cutoff: window is [28, 32] minutes remaining
      if (diffMinutes >= 28 && diffMinutes <= 32) {
        await dispatchDemandNotification(m, targetDate, '30MIN').catch(e => {
          console.error(`[PushService] Error in 30MIN dispatch for ${m}:`, e);
        });
      }

      // At Cutoff: window is [0, 4] minutes after cutoff
      if (diffMinutes <= 0 && diffMinutes >= -4) {
        await dispatchDemandNotification(m, targetDate, 'FINAL').catch(e => {
          console.error(`[PushService] Error in FINAL dispatch for ${m}:`, e);
        });
      }
    }
  }
}

// Backward-compatible SMS report generator
async function sendMealReport(mealType, targetDate, customTime, customPhoneNumber) {
  try {
    const count = await getAuthoritativeDemandCount(mealType, targetDate);
    const displayTime = customTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const smsMessage = `Sri Shakthi Smart Mess final ${mealType.toUpperCase()} report for ${targetDate}: ${count} student(s) confirmed. Cutoff closed at ${displayTime}.`;

    console.log(`Notification Service: Generating SMS & Push report for ${mealType} on ${targetDate}...`);
    
    // Also dispatch native push
    await dispatchDemandNotification(mealType, targetDate, 'FINAL').catch(() => {});
    
    return count;
  } catch (error) {
    console.error(`Notification Service error sending report for ${mealType}:`, error);
  }
}

function initializeSchedules() {
  console.log('[NotificationService] Initializing dynamic cutoff scheduler (every minute)...');

  // Check cutoffs every 60 seconds
  cron.schedule('* * * * *', async () => {
    try {
      await checkScheduledCutoffs();
    } catch (err) {
      console.error('[NotificationService] Error running checkScheduledCutoffs:', err);
    }
  });

  console.log('[NotificationService] Dynamic cutoff scheduler active.');
}

module.exports = {
  getAuthoritativeDemandCount,
  sendExpoPushNotifications,
  dispatchDemandNotification,
  checkScheduledCutoffs,
  sendMealReport,
  initializeSchedules,
  getSimulatedDateStr
};