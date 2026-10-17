const express = require('express');
const prisma = require('../lib/prisma');
const { buildRoomCalendar } = require('../services/ical');
const router = express.Router();

// Plataforma que vai ler o calendário → origem dos bloqueios que não lhe devolvemos
const OWN_SOURCE = { booking: 'BOOKING_COM', airbnb: 'AIRBNB' };

// GET /ical/:roomId.ics — export calendar iCal para o Booking.com/Airbnb
// ?para=booking ou ?para=airbnb: sem as noites importadas dessa mesma plataforma,
// para que uma reserva cancelada lá não fique bloqueada pelo nosso calendário
router.get('/:roomId.ics', async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.roomId } });
    if (!room) return res.status(404).json({ error: 'Unidade não encontrada.' });

    const reservations = await prisma.reservation.findMany({
      where: {
        roomId: room.id,
        OR: [
          { status: { in: ['CONFIRMED', 'PAID'] } },
          { status: { in: ['AWAITING_PAYMENT', 'PENDING'] }, paymentExpiresAt: { gt: new Date() } },
        ],
      },
      include: { guest: true },
      orderBy: { checkIn: 'asc' },
    });

    const ownSource = OWN_SOURCE[String(req.query.para || '').toLowerCase()];
    const blockedDates = await prisma.blockedDate.findMany({
      where: { roomId: room.id, ...(ownSource && { source: { not: ownSource } }) },
      orderBy: { date: 'asc' },
    });

    const ics = buildRoomCalendar(room, reservations, blockedDates);
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(ics);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
