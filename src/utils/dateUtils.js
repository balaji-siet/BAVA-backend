function getIndiaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getIndiaTomorrowDateString(date = new Date()) {
  const next = new Date(date.getTime() + 24 * 60 * 60 * 1000);
  return getIndiaDateString(next);
}

module.exports = {
  getIndiaDateString,
  getIndiaTomorrowDateString,
};
