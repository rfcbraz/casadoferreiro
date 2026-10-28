// Email de agradecimento e pedido de avaliação, no dia seguinte à saída (corre de hora a hora)
const prisma = require('../lib/prisma');
const { getPortugalToday } = require('../lib/reservationRules');
const { STAY_DONE_STATUSES, SEND_WINDOW_DAYS, isReviewRequestDue } = require('../lib/reviews');
const { signReviewLink } = require('../lib/signedLinks');
const { sendReviewRequest } = require('./email');

function portugalHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

function reviewUrl(reservationId) {
  const base = String(process.env.FRONTEND_URL || 'https://casadoferreirovn.pt').replace(/\/$/, '');
  return `${base}/avaliacao.html?r=${encodeURIComponent(reservationId)}&sig=${signReviewLink(reservationId)}`;
}

async function sendDueReviewRequests(now = new Date()) {
  const today = getPortugalToday(now);
  const hour = portugalHour(now);
  const oldest = new Date(`${today}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - SEND_WINDOW_DAYS);

  const candidates = await prisma.reservation.findMany({
    where: {
      status: { in: STAY_DONE_STATUSES },
      reviewRequestSentAt: null,
      checkOut: { gte: oldest, lt: new Date(`${today}T00:00:00Z`) },
    },
    include: { room: true, guest: true },
  });

  let sent = 0;
  for (const reservation of candidates) {
    if (!isReviewRequestDue(reservation.checkOut, today, hour)) continue;
    // Marcar antes de enviar: dois processos nunca enviam o mesmo email
    const claimed = await prisma.reservation.updateMany({
      where: { id: reservation.id, reviewRequestSentAt: null },
      data: { reviewRequestSentAt: now },
    });
    if (!claimed.count) continue;
    try {
      await sendReviewRequest(reservation, reviewUrl(reservation.id));
      sent++;
    } catch (err) {
      console.error(`Erro ao enviar pedido de avaliação #${reservation.id.slice(0, 8)}:`, err.message);
      await prisma.reservation.update({ where: { id: reservation.id }, data: { reviewRequestSentAt: null } });
    }
  }
  if (sent) console.log(`Pedidos de avaliação enviados: ${sent}`);
  return sent;
}

module.exports = { sendDueReviewRequests, reviewUrl };
