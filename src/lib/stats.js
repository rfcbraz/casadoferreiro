// Estatísticas mensais do painel: receita pelas noites de estadia e ocupação das unidades
const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const STAY_STATUSES = ['CONFIRMED', 'PAID', 'COMPLETED'];
const EXTERNAL_SOURCES = ['BOOKING_COM', 'AIRBNB'];
const DAY_MS = 24 * 60 * 60 * 1000;

const round2 = value => Math.round(value * 100) / 100;
const dayString = value => new Date(value).toISOString().slice(0, 10);

// Mês de uma data 'AAAA-MM-DD', deslocado `offset` meses: início (incluído) e fim (excluído) em UTC
function monthRange(dateString, offset = 0) {
  const [year, month] = dateString.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return { start, end, label: `${MONTH_NAMES[start.getUTCMonth()]} ${start.getUTCFullYear()}`, name: MONTH_NAMES[start.getUTCMonth()].toLowerCase() };
}

// Noites [checkIn, checkOut) de uma reserva como 'AAAA-MM-DD'
function stayNights(reservation) {
  const nights = [];
  for (let time = new Date(dayString(reservation.checkIn)).getTime(); time < new Date(dayString(reservation.checkOut)).getTime(); time += DAY_MS) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }
  return nights;
}

const inRange = (date, range) => date >= dayString(range.start) && date < dayString(range.end);

// Receita das noites da reserva dentro do mês: usa o valor de cada noite guardado no pedido;
// reservas antigas sem esse detalhe dividem o total pelas noites
function reservationRevenue(reservation, range) {
  const breakdown = reservation.priceBreakdown?.nights;
  if (Array.isArray(breakdown) && breakdown.length) {
    return breakdown.filter(night => inRange(night.date, range)).reduce((sum, night) => sum + (night.total || 0), 0);
  }
  const nights = stayNights(reservation);
  if (!nights.length) return 0;
  return (reservation.totalPrice || 0) * nights.filter(date => inRange(date, range)).length / nights.length;
}

function monthRevenue(reservations, range) {
  return round2(reservations
    .filter(reservation => STAY_STATUSES.includes(reservation.status))
    .reduce((sum, reservation) => sum + reservationRevenue(reservation, range), 0));
}

// Ocupação = noites ocupadas (reservas + Booking/Airbnb) ÷ noites das unidades ativas no mês.
// Bloqueios manuais não contam: são dias fechados, não ocupados.
function monthOccupancy(reservations, blockedDates, roomIds, range) {
  const rooms = new Set(roomIds);
  const occupied = new Set();
  reservations
    .filter(reservation => STAY_STATUSES.includes(reservation.status) && rooms.has(reservation.roomId))
    .forEach(reservation => stayNights(reservation)
      .filter(date => inRange(date, range))
      .forEach(date => occupied.add(`${reservation.roomId}|${date}`)));
  blockedDates
    .filter(block => EXTERNAL_SOURCES.includes(block.source) && rooms.has(block.roomId))
    .map(block => ({ roomId: block.roomId, date: dayString(block.date) }))
    .filter(block => inRange(block.date, range))
    .forEach(block => occupied.add(`${block.roomId}|${block.date}`));
  const available = rooms.size * Math.round((range.end - range.start) / DAY_MS);
  return { occupiedNights: occupied.size, availableNights: available, rate: available ? Math.round((occupied.size / available) * 100) : 0 };
}

module.exports = { STAY_STATUSES, EXTERNAL_SOURCES, monthRange, stayNights, monthRevenue, monthOccupancy };
