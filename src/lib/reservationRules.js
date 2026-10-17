const MINIMUM_STAY_NIGHTS = 2;
// Reservas com entrada no próprio dia são aceites até esta hora (Portugal)
const SAME_DAY_CUTOFF_HOUR = 22;
const CHECK_IN_DATE_ERROR = 'Essa data de entrada já não está disponível. Reservas para o próprio dia são aceites até às 22:00.';

function getPortugalParts(now) {
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  return Object.fromEntries(dateParts.map(({ type, value }) => [type, value]));
}

// Data de hoje em Portugal (YYYY-MM-DD)
function getPortugalToday(now = new Date()) {
  const parts = getPortugalParts(now);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// Hoje até às 22:00 (hora de Portugal); depois disso, amanhã
function getMinimumCheckInDate(now = new Date()) {
  const parts = getPortugalParts(now);
  const daysAhead = Number(parts.hour) < SAME_DAY_CUTOFF_HOUR ? 0 : 1;
  const minimum = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + daysAhead));
  return minimum.toISOString().slice(0, 10);
}

function isCheckInDateAllowed(checkIn, now = new Date()) {
  const checkInDate = new Date(checkIn);
  return !Number.isNaN(checkInDate.getTime())
    && checkInDate.toISOString().slice(0, 10) >= getMinimumCheckInDate(now);
}

module.exports = { MINIMUM_STAY_NIGHTS, SAME_DAY_CUTOFF_HOUR, CHECK_IN_DATE_ERROR, getPortugalToday, getMinimumCheckInDate, isCheckInDateAllowed };
