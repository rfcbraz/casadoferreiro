// src/routes/availability.js
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { MINIMUM_STAY_NIGHTS, CHECK_IN_DATE_ERROR, getPortugalToday, isCheckInDateAllowed } = require('../lib/reservationRules');
const { normalizeParty, calculateQuote } = require('../lib/pricing');
const { loadPricing } = require('../lib/priceRules');
const { blockedConflictWhere } = require('../lib/blockedDates');
const { publicRoom } = require('../lib/publicRoom');
const router = express.Router();

// GET /api/availability?checkIn=YYYY-MM-DD&checkOut=YYYY-MM-DD
// Devolve quartos disponíveis para um período
router.get('/', async (req, res, next) => {
  try {
    const { checkIn, checkOut } = req.query;
    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'checkIn e checkOut são obrigatórios.' });
    }

    const ciDate = new Date(checkIn);
    const coDate = new Date(checkOut);

    if (isNaN(ciDate) || isNaN(coDate) || ciDate >= coDate) {
      return res.status(400).json({ error: 'Datas inválidas.' });
    }
    if (!isCheckInDateAllowed(checkIn)) {
      return res.status(400).json({ error: CHECK_IN_DATE_ERROR });
    }

    const nights = Math.round((coDate - ciDate) / (1000 * 60 * 60 * 24));
    if (nights < MINIMUM_STAY_NIGHTS) {
      return res.status(400).json({
        error: `A estadia mínima é de ${MINIMUM_STAY_NIGHTS} noites consecutivas.`,
        minimumStayNights: MINIMUM_STAY_NIGHTS,
      });
    }

    // Quartos com reservas que se sobrepõem ao período pedido
    const bookedRoomIds = await prisma.reservation.findMany({
      where: {
        OR: [
          { status: { in: ['CONFIRMED', 'PAID'] } },
          { status: { in: ['AWAITING_PAYMENT', 'PENDING'] }, paymentExpiresAt: { gt: new Date() } },
        ],
        AND: [
          { checkIn: { lt: coDate } },
          { checkOut: { gt: ciDate } },
        ],
      },
      select: { roomId: true },
    });

    const bookedIds = bookedRoomIds.map(r => r.roomId);

    // Quartos com datas bloqueadas no período
    const blockedRoomIds = await prisma.blockedDate.findMany({
      where: blockedConflictWhere(ciDate, coDate),
      select: { roomId: true },
    });

    const blockedIds = blockedRoomIds.map(r => r.roomId);
    const unavailableIds = [...new Set([...bookedIds, ...blockedIds])];

    const rooms = await prisma.room.findMany({
      where: {
        isActive: true,
        id: { notIn: unavailableIds },
      },
      orderBy: { pricePerNight: 'asc' },
    });

    // Total com as idades indicadas; sem idades, usa a ocupação base de cada unidade
    const hasAgeGroups = ['adults', 'teens', 'children', 'infants'].some(key => req.query[key] !== undefined);
    const availableRooms = await Promise.all(rooms.map(async room => {
      const party = hasAgeGroups
        ? normalizeParty(req.query)
        : normalizeParty({ adults: room.baseOccupancy ?? room.capacity });
      const { rules, promotions } = await loadPricing(prisma, room.id, checkIn, checkOut);
      const quote = calculateQuote(room, rules, checkIn, checkOut, party, promotions);
      return { ...publicRoom(room), totalPrice: quote.total, quote };
    }));

    res.json({
      checkIn,
      checkOut,
      nights,
      minimumStayNights: MINIMUM_STAY_NIGHTS,
      availableRooms,
    });
  } catch (err) { next(err); }
});

// GET /api/availability/room/:roomId?year=2026&month=5 — datas ocupadas/bloqueadas de um mês
// GET /api/availability/room/:roomId?from=YYYY-MM-DD&to=YYYY-MM-DD — de um período (até 2 anos),
//   usado pelo calendário do site para saber todas as noites ocupadas de uma vez
const MAX_RANGE_DAYS = 731;
router.get('/room/:roomId', async (req, res, next) => {
  try {
    const { roomId } = req.params;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    let startOfMonth, endOfMonth, year, month;
    if (req.query.from || req.query.to) {
      const { from, to } = req.query;
      if (!datePattern.test(from || '') || !datePattern.test(to || '') || from > to) {
        return res.status(400).json({ error: 'Período inválido.' });
      }
      startOfMonth = new Date(`${from}T00:00:00Z`);
      endOfMonth = new Date(`${to}T23:59:59Z`);
      if ((endOfMonth - startOfMonth) / 86400000 > MAX_RANGE_DAYS) {
        return res.status(400).json({ error: 'O período não pode ter mais de 2 anos.' });
      }
    } else {
      year = parseInt(req.query.year || new Date().getFullYear());
      month = parseInt(req.query.month || new Date().getMonth() + 1);
      startOfMonth = new Date(Date.UTC(year, month - 1, 1));
      endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    }

    const reservations = await prisma.reservation.findMany({
      where: {
        roomId,
        OR: [
          { status: { in: ['CONFIRMED', 'PAID'] } },
          { status: { in: ['AWAITING_PAYMENT', 'PENDING'] }, paymentExpiresAt: { gt: new Date() } },
        ],
        AND: [
          { checkIn: { lt: endOfMonth } },
          { checkOut: { gt: startOfMonth } },
        ],
      },
      select: { checkIn: true, checkOut: true },
    });

    const blocked = await prisma.blockedDate.findMany({
      where: { roomId, date: { gte: startOfMonth, lte: endOfMonth } },
      select: { date: true, reason: true, source: true },
    });

    // Expandir reservas em noites individuais (dentro do período pedido)
    const occupiedDates = new Set();
    reservations.forEach(r => {
      const cur = new Date(r.checkIn);
      while (cur < r.checkOut) {
        if (cur >= startOfMonth && cur <= endOfMonth) occupiedDates.add(cur.toISOString().split('T')[0]);
        cur.setUTCDate(cur.getUTCDate() + 1);
      }
    });

    res.json({
      roomId,
      year,
      month,
      occupiedDates: [...occupiedDates].sort(),
      blockedDates: blocked.map(b => ({
        date: b.date.toISOString().split('T')[0],
        reason: b.reason,
        source: b.source, // MANUAL fecha o dia inteiro; BOOKING_COM/AIRBNB só a noite
      })),
    });
  } catch (err) { next(err); }
});

// POST /api/availability/block — bloquear datas (admin)
router.post('/block', requireAuth, async (req, res, next) => {
  try {
    const { roomId, dates, reason } = req.body;
    if (!roomId || !dates || !Array.isArray(dates) || dates.length === 0) {
      return res.status(400).json({ error: 'roomId e dates[] são obrigatórios.' });
    }
    if (dates.length > 731 || dates.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(String(d)))) {
      return res.status(400).json({ error: 'Datas inválidas.' });
    }
    // Só se bloqueiam datas de hoje em diante (hora de Portugal)
    const today = getPortugalToday();
    if (dates.some(d => d < today)) {
      return res.status(400).json({ error: 'Não é possível bloquear datas passadas.' });
    }

    const created = await Promise.all(
      dates.map(d =>
        prisma.blockedDate.upsert({
          where: { roomId_date: { roomId, date: new Date(d) } },
          update: { reason },
          create: { roomId, date: new Date(d), reason },
        })
      )
    );

    res.status(201).json({ message: `${created.length} data(s) bloqueada(s).`, dates: created });
  } catch (err) { next(err); }
});

// DELETE /api/availability/block — desbloquear datas (admin)
router.delete('/block', requireAuth, async (req, res, next) => {
  try {
    const { roomId, dates } = req.body;
    await prisma.blockedDate.deleteMany({
      where: {
        roomId,
        date: { in: dates.map(d => new Date(d)) },
      },
    });
    res.json({ message: 'Datas desbloqueadas.' });
  } catch (err) { next(err); }
});

module.exports = router;
