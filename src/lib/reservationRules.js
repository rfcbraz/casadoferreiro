const MINIMUM_STAY_NIGHTS = 2;
// Limites de um pedido: evitam cálculos de preço enormes e reservas para daqui a muitos anos
const MAXIMUM_STAY_NIGHTS = 90;
const MAXIMUM_ADVANCE_DAYS = 730;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

// Valida as datas de uma estadia (AAAA-MM-DD); devolve a mensagem de erro ou null
function stayDatesError(checkIn, checkOut, now = new Date()) {
  if (!DATE_PATTERN.test(checkIn || '') || !DATE_PATTERN.test(checkOut || '')) return 'Datas inválidas.';
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start >= end) return 'Datas inválidas.';
  const nights = Math.round((end - start) / 86400000);
  if (nights < MINIMUM_STAY_NIGHTS) return `A estadia mínima é de ${MINIMUM_STAY_NIGHTS} noites consecutivas.`;
  if (nights > MAXIMUM_STAY_NIGHTS) return `A estadia máxima é de ${MAXIMUM_STAY_NIGHTS} noites. Para estadias mais longas, contacte-nos.`;
  if (!isCheckInDateAllowed(checkIn, now)) return CHECK_IN_DATE_ERROR;
  const latest = new Date(`${getPortugalToday(now)}T00:00:00Z`);
  latest.setUTCDate(latest.getUTCDate() + MAXIMUM_ADVANCE_DAYS);
  if (start > latest) return 'Ainda não é possível reservar para essa data.';
  return null;
}

module.exports = { MAXIMUM_STAY_NIGHTS, stayDatesError, MINIMUM_STAY_NIGHTS, SAME_DAY_CUTOFF_HOUR, CHECK_IN_DATE_ERROR, getPortugalToday, getMinimumCheckInDate, isCheckInDateAllowed };
