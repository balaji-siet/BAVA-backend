const MealSettings = require('../models/MealSettings');
const Reservation = require('../models/Reservation');
const SMSLog = require('../models/SMSLog');
const { sendCutoffSMS } = require('../services/smsService');

const DEFAULT_TIMINGS = {
  breakfast: { open_time: '06:00', close_time: '09:30', enabled: true, sms_sent: false },
  lunch: { open_time: '10:30', close_time: '13:00', enabled: true, sms_sent: false },
  dinner: { open_time: '17:00', close_time: '20:00', enabled: true, sms_sent: false }
};

function getTodayDateString() {
  return new Date().toISOString().split('T')[0];
}

function getTomorrowDateString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// GET /api/meal-settings/today
const getTodaySettings = async (req, res) => {
  try {
    const todayStr = getTodayDateString();
    let settings = await MealSettings.findOne({ date: todayStr });

    if (!settings) {
      settings = new MealSettings({
        date: todayStr,
        breakfast: DEFAULT_TIMINGS.breakfast,
        lunch: DEFAULT_TIMINGS.lunch,
        dinner: DEFAULT_TIMINGS.dinner,
        updatedBy: 'System Default'
      });
      await settings.save();
    }

    // Get live reservation counts for today
    const counts = await getReservationCountsForDate(todayStr);

    res.status(200).json({
      settings,
      reservationCounts: counts,
      currentTime: new Date().toLocaleTimeString('en-US', { hour12: false })
    });
  } catch (err) {
    console.error('Error fetching today settings:', err);
    res.status(500).json({ error: 'Failed to fetch meal settings' });
  }
};

// GET /api/meal-settings/:date
const getSettingsByDate = async (req, res) => {
  try {
    const dateStr = req.params.date || getTodayDateString();
    let settings = await MealSettings.findOne({ date: dateStr });

    if (!settings) {
      settings = new MealSettings({
        date: dateStr,
        breakfast: DEFAULT_TIMINGS.breakfast,
        lunch: DEFAULT_TIMINGS.lunch,
        dinner: DEFAULT_TIMINGS.dinner,
        updatedBy: 'System Default'
      });
      await settings.save();
    }

    const counts = await getReservationCountsForDate(dateStr);

    res.status(200).json({
      settings,
      reservationCounts: counts
    });
  } catch (err) {
    console.error('Error fetching date settings:', err);
    res.status(500).json({ error: 'Failed to fetch date meal settings' });
  }
};

// POST /api/meal-settings (Supervisor Update)
const saveSettings = async (req, res) => {
  try {
    const { date, breakfast, lunch, dinner } = req.body;
    const targetDate = date || getTodayDateString();

    let settingsDoc = await MealSettings.findOne({ date: targetDate });

    if (!settingsDoc) {
      settingsDoc = new MealSettings({ date: targetDate });
    }

    if (breakfast) {
      if (breakfast.open_time) settingsDoc.breakfast.open_time = breakfast.open_time;
      if (breakfast.close_time) settingsDoc.breakfast.close_time = breakfast.close_time;
      if (breakfast.open_date !== undefined) settingsDoc.breakfast.open_date = breakfast.open_date;
      if (breakfast.close_date !== undefined) settingsDoc.breakfast.close_date = breakfast.close_date;
      if (breakfast.enabled !== undefined) settingsDoc.breakfast.enabled = Boolean(breakfast.enabled);
    }

    if (lunch) {
      if (lunch.open_time) settingsDoc.lunch.open_time = lunch.open_time;
      if (lunch.close_time) settingsDoc.lunch.close_time = lunch.close_time;
      if (lunch.open_date !== undefined) settingsDoc.lunch.open_date = lunch.open_date;
      if (lunch.close_date !== undefined) settingsDoc.lunch.close_date = lunch.close_date;
      if (lunch.enabled !== undefined) settingsDoc.lunch.enabled = Boolean(lunch.enabled);
    }

    if (dinner) {
      if (dinner.open_time) settingsDoc.dinner.open_time = dinner.open_time;
      if (dinner.close_time) settingsDoc.dinner.close_time = dinner.close_time;
      if (dinner.open_date !== undefined) settingsDoc.dinner.open_date = dinner.open_date;
      if (dinner.close_date !== undefined) settingsDoc.dinner.close_date = dinner.close_date;
      if (dinner.enabled !== undefined) settingsDoc.dinner.enabled = Boolean(dinner.enabled);
    }

    settingsDoc.updatedBy = req.userRoll || 'Supervisor';
    await settingsDoc.save();

    console.log(`[MEAL SETTINGS] Updated for date: ${targetDate}`);

    res.status(200).json({
      message: 'Meal reservation schedule saved successfully',
      settings: settingsDoc
    });
  } catch (err) {
    console.error('Error saving meal settings:', err);
    res.status(500).json({ error: 'Failed to save meal settings' });
  }
};

// POST /api/meal-settings/copy-tomorrow
const copyTodayToTomorrow = async (req, res) => {
  try {
    const todayStr = getTodayDateString();
    const tomorrowStr = getTomorrowDateString();

    let todaySettings = await MealSettings.findOne({ date: todayStr });
    if (!todaySettings) {
      todaySettings = DEFAULT_TIMINGS;
    }

    let tomorrowDoc = await MealSettings.findOne({ date: tomorrowStr });
    if (!tomorrowDoc) {
      tomorrowDoc = new MealSettings({ date: tomorrowStr });
    }

    tomorrowDoc.breakfast = {
      open_time: todaySettings.breakfast.open_time,
      close_time: todaySettings.breakfast.close_time,
      open_date: tomorrowStr,
      close_date: tomorrowStr,
      enabled: todaySettings.breakfast.enabled,
      sms_sent: false
    };

    tomorrowDoc.lunch = {
      open_time: todaySettings.lunch.open_time,
      close_time: todaySettings.lunch.close_time,
      open_date: tomorrowStr,
      close_date: tomorrowStr,
      enabled: todaySettings.lunch.enabled,
      sms_sent: false
    };

    tomorrowDoc.dinner = {
      open_time: todaySettings.dinner.open_time,
      close_time: todaySettings.dinner.close_time,
      open_date: tomorrowStr,
      close_date: tomorrowStr,
      enabled: todaySettings.dinner.enabled,
      sms_sent: false
    };

    tomorrowDoc.updatedBy = 'Copied from Today';
    await tomorrowDoc.save();

    res.status(200).json({
      message: "Copied today's schedule to tomorrow successfully",
      settings: tomorrowDoc
    });
  } catch (err) {
    console.error('Error copying schedule to tomorrow:', err);
    res.status(500).json({ error: 'Failed to copy schedule to tomorrow' });
  }
};

// POST /api/meal-settings/reset-default
const resetToDefault = async (req, res) => {
  try {
    const targetDate = req.body.date || getTodayDateString();

    let settingsDoc = await MealSettings.findOne({ date: targetDate });
    if (!settingsDoc) {
      settingsDoc = new MealSettings({ date: targetDate });
    }

    settingsDoc.breakfast = { ...DEFAULT_TIMINGS.breakfast };
    settingsDoc.lunch = { ...DEFAULT_TIMINGS.lunch };
    settingsDoc.dinner = { ...DEFAULT_TIMINGS.dinner };
    settingsDoc.updatedBy = 'Reset to Default';

    await settingsDoc.save();

    res.status(200).json({
      message: 'Reset reservation schedule to default timings',
      settings: settingsDoc
    });
  } catch (err) {
    console.error('Error resetting settings to default:', err);
    res.status(500).json({ error: 'Failed to reset settings to default' });
  }
};

// Helper: Count live reservations from MongoDB
async function getReservationCountsForDate(dateStr) {
  try {
    const reservations = await Reservation.find({ reservation_date: dateStr });
    let breakfast = 0;
    let lunch = 0;
    let dinner = 0;

    reservations.forEach(r => {
      if (r.breakfast) breakfast++;
      if (r.lunch) lunch++;
      if (r.dinner) dinner++;
    });

    return { breakfast, lunch, dinner, total: breakfast + lunch + dinner };
  } catch (e) {
    return { breakfast: 0, lunch: 0, dinner: 0, total: 0 };
  }
}

// Background Task: Check cut-offs and send SMS automatically
async function checkCutoffsAndSendSMS() {
  try {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`;

    let settings = await MealSettings.findOne({ date: todayStr });
    if (!settings) return;

    const meals = ['breakfast', 'lunch', 'dinner'];
    const counts = await getReservationCountsForDate(todayStr);

    for (const meal of meals) {
      const window = settings[meal];
      if (!window || !window.enabled || window.sms_sent) continue;

      // Check if current time has passed or reached the close_time
      if (currentTimeStr >= window.close_time) {
        console.log(`[AUTOMATIC CUT-OFF] ${meal.toUpperCase()} reservation closed at ${window.close_time}. Sending SMS...`);

        const mealCount = counts[meal] || 0;
        await sendCutoffSMS({
          meal,
          date: todayStr,
          cutoff_time: window.close_time,
          count: mealCount
        });

        // Mark sms_sent to prevent duplicate SMS
        settings[meal].sms_sent = true;
        await settings.save();
      }
    }
  } catch (err) {
    console.error('[CUT-OFF BACKGROUND ERROR]:', err);
  }
}

// GET /api/sms/logs
const getSMSLogs = async (req, res) => {
  try {
    const logs = await SMSLog.find().sort({ createdAt: -1 }).limit(50);
    res.status(200).json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch SMS logs' });
  }
};

module.exports = {
  getTodaySettings,
  getSettingsByDate,
  saveSettings,
  copyTodayToTomorrow,
  resetToDefault,
  checkCutoffsAndSendSMS,
  getSMSLogs
};
