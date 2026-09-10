const MealSettings = require('../models/MealSettings');

const MEALS = ['breakfast', 'lunch', 'dinner'];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function getBusinessNow() {
  if (process.env.DEBUG_NOW_IST) {
    const debugValue = process.env.DEBUG_NOW_IST.trim();
    const [datePart, timePart = '00:00'] = debugValue.split(/[ T]/);
    const debug = parseIndiaDateTime(datePart, timePart.slice(0, 5));
    if (debug) return debug;
  }

  const now = new Date();
  const offsetHrs = parseInt(process.env.DEBUG_TIME_OFFSET_HRS || '0', 10);
  if (offsetHrs !== 0) {
    now.setHours(now.getHours() + offsetHrs);
  }
  return now;
}

function parseIndiaDateTime(dateStr, timeStr = '00:00') {
  if (!DATE_RE.test(dateStr) || !TIME_RE.test(timeStr)) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0) - IST_OFFSET_MS);
}

function addDays(dateStr, days) {
  const base = parseIndiaDateTime(dateStr, '12:00');
  if (!base) return dateStr;
  base.setUTCDate(base.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(base);
}

function resolveWindowBounds(mealDate, mealConfig) {
  const openTime = mealConfig && mealConfig.open_time;
  const closeTime = mealConfig && mealConfig.close_time;
  if (!TIME_RE.test(openTime || '') || !TIME_RE.test(closeTime || '')) {
    return { ok: false, code: 'INVALID_SCHEDULE', message: 'Reservation schedule is invalid.' };
  }

  let openDate = mealConfig.open_date || mealDate;
  let closeDate = mealConfig.close_date || mealDate;

  if (!mealConfig.open_date && !mealConfig.close_date && closeTime < openTime) {
    openDate = addDays(mealDate, -1);
    closeDate = mealDate;
  }

  const opensAt = parseIndiaDateTime(openDate, openTime);
  const closesAt = parseIndiaDateTime(closeDate, closeTime);
  if (!opensAt || !closesAt || opensAt.getTime() > closesAt.getTime()) {
    return { ok: false, code: 'INVALID_SCHEDULE', message: 'Reservation schedule is invalid.' };
  }

  return { ok: true, openDate, closeDate, opensAt, closesAt };
}

async function getReservationWindowStatus(meal, mealDate, now = getBusinessNow()) {
  if (!MEALS.includes(meal)) {
    return { allowed: false, code: 'INVALID_MEAL', message: 'Invalid meal type.' };
  }
  if (!DATE_RE.test(mealDate || '')) {
    return { allowed: false, code: 'INVALID_DATE', message: 'Invalid meal date.' };
  }

  const settings = await MealSettings.findOne({ date: mealDate }).lean();
  if (!settings) {
    return { allowed: false, code: 'SCHEDULE_NOT_AVAILABLE', message: 'Reservation schedule unavailable.' };
  }

  const mealConfig = settings[meal];
  if (!mealConfig || !mealConfig.enabled) {
    return { allowed: false, code: 'RESERVATION_DISABLED', message: 'Reservation is disabled for this meal.' };
  }

  const bounds = resolveWindowBounds(mealDate, mealConfig);
  if (!bounds.ok) {
    return { allowed: false, code: bounds.code, message: bounds.message };
  }

  const nowMs = now.getTime();
  if (nowMs < bounds.opensAt.getTime()) {
    return { allowed: false, code: 'RESERVATION_NOT_OPEN', message: `Reservation opens at ${mealConfig.open_time}.`, settings, ...bounds };
  }
  if (nowMs > bounds.closesAt.getTime()) {
    return { allowed: false, code: 'RESERVATION_CLOSED', message: `Reservation closed at ${mealConfig.close_time}.`, settings, ...bounds };
  }

  return { allowed: true, code: 'OPEN', message: 'Reservation window is open.', settings, ...bounds };
}

function getMealWindowSnapshot(settings, date, now = getBusinessNow()) {
  const result = {};
  for (const meal of MEALS) {
    const config = settings && settings[meal];
    if (!config || !config.enabled) {
      result[meal] = { open: false, status: 'DISABLED', code: 'RESERVATION_DISABLED' };
      continue;
    }
    const bounds = resolveWindowBounds(date, config);
    if (!bounds.ok) {
      result[meal] = { open: false, status: 'UNAVAILABLE', code: bounds.code };
      continue;
    }
    const nowMs = now.getTime();
    const isOpen = nowMs >= bounds.opensAt.getTime() && nowMs <= bounds.closesAt.getTime();
    result[meal] = {
      open: isOpen,
      status: nowMs < bounds.opensAt.getTime() ? 'NOT_OPEN_YET' : nowMs > bounds.closesAt.getTime() ? 'CLOSED' : 'OPEN',
      code: nowMs < bounds.opensAt.getTime() ? 'RESERVATION_NOT_OPEN' : nowMs > bounds.closesAt.getTime() ? 'RESERVATION_CLOSED' : 'OPEN',
      openDate: bounds.openDate,
      closeDate: bounds.closeDate,
      openTime: config.open_time,
      closeTime: config.close_time,
    };
  }
  return result;
}

module.exports = {
  MEALS,
  getBusinessNow,
  parseIndiaDateTime,
  resolveWindowBounds,
  getReservationWindowStatus,
  getMealWindowSnapshot,
};
