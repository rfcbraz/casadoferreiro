// Berços: um conjunto partilhado pelas duas casas (por omissão 2), contado noite a noite.
// Ocupam berços: reservas aprovadas (a aguardar pagamento dentro do prazo), confirmadas e pagas,
// e os registos manuais do painel (ex.: reservas do Booking/Airbnb com bebé).
// Pedidos pendentes não ocupam berços: a aprovação volta a confirmar que há berço livre.
const DEFAULT_CRIBS_TOTAL = 2;
const CRIBS_TOTAL_KEY = 'cribsTotal';
const DAY_MS = 86400000;

const dayString = value => new Date(value).toISOString().slice(0, 10);

function eachNight(checkIn, checkOut) {
  const nights = [];
  for (let time = new Date(`${dayString(checkIn)}T00:00:00Z`).getTime(); time < new Date(`${dayString(checkOut)}T00:00:00Z`).getTime(); time += DAY_MS) {
    nights.push(new Date(time).toISOString().slice(0, 10));
  }
  return nights;
}

// Berços em uso em cada noite pedida, a partir de intervalos { checkIn, checkOut, cribs }
function cribsUsedByNight(nights, ranges) {
  const used = new Map(nights.map(night => [night, 0]));
  ranges.forEach(range => {
    if (!(range.cribs > 0)) return;
    eachNight(range.checkIn, range.checkOut).forEach(night => {
      if (used.has(night)) used.set(night, used.get(night) + range.cribs);
    });
  });
  return used;
}

// Berços livres em todas as noites da estadia (o mínimo entre as noites)
function cribsAvailable(total, nights, ranges) {
  const used = cribsUsedByNight(nights, ranges);
  const free = [...used.values()].map(count => Math.max(0, total - count));
  return { total, available: free.length ? Math.min(...free) : total, used };
}

async function getCribsTotal(db) {
  const setting = await db.setting.findUnique({ where: { key: CRIBS_TOTAL_KEY } });
  const value = Number(setting?.value);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_CRIBS_TOTAL;
}

// Intervalos que ocupam berços e se sobrepõem a [checkIn, checkOut)
async function loadCribRanges(db, checkIn, checkOut, { excludeReservationId } = {}) {
  const start = new Date(`${dayString(checkIn)}T00:00:00Z`);
  const end = new Date(`${dayString(checkOut)}T00:00:00Z`);
  const [reservations, holds] = await Promise.all([
    db.reservation.findMany({
      where: {
        cribs: { gt: 0 },
        ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
        OR: [
          { status: { in: ['CONFIRMED', 'PAID'] } },
          { status: 'AWAITING_PAYMENT', paymentExpiresAt: { gt: new Date() } },
        ],
        checkIn: { lt: end },
        checkOut: { gt: start },
      },
      select: { checkIn: true, checkOut: true, cribs: true },
    }),
    db.cribHold.findMany({
      where: { startDate: { lt: end }, endDate: { gt: start } },
      select: { startDate: true, endDate: true, cribs: true },
    }),
  ]);
  return [
    ...reservations,
    ...holds.map(hold => ({ checkIn: hold.startDate, checkOut: hold.endDate, cribs: hold.cribs })),
  ];
}

async function checkCribs(db, checkIn, checkOut, options) {
  const [total, ranges] = await Promise.all([getCribsTotal(db), loadCribRanges(db, checkIn, checkOut, options)]);
  return cribsAvailable(total, eachNight(checkIn, checkOut), ranges);
}

const cribsError = available => (available > 0
  ? `Para estas datas só ${available === 1 ? 'resta 1 berço disponível' : `restam ${available} berços disponíveis`}.`
  : 'Para estas datas já não há berços disponíveis.');

module.exports = { DEFAULT_CRIBS_TOTAL, CRIBS_TOTAL_KEY, eachNight, cribsUsedByNight, cribsAvailable, getCribsTotal, loadCribRanges, checkCribs, cribsError };
