// src/routes/admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { getPortugalToday } = require('../lib/reservationRules');
const { STAY_STATUSES, EXTERNAL_SOURCES, monthRange, stayNights, monthRevenue, monthOccupancy } = require('../lib/stats');
const router = express.Router();

// POST /api/admin/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email e password são obrigatórios.' });
    }

    // A antiga password por omissão está desativada (ver setup-db.js para a substituir)
    if (password === 'admin1234') {
      return res.status(401).json({ error: 'Esta password foi desativada por segurança. Defina ADMIN_PASSWORD no servidor.' });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'JWT_SECRET não está configurado no servidor.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '12h' } // sessão do painel limitada a 12 horas
    );

    res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
  } catch (err) {
    console.error('Error in admin login:', err);
    if (err && err.name === 'JsonWebTokenError') {
      return res.status(500).json({ error: 'Erro ao gerar token JWT. Verifique a configuração do servidor.' });
    }
    next(err);
  }
});

// GET /api/admin/me — verificar token
router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: req.admin });
});

// GET /api/admin/stats — números do painel
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const today = getPortugalToday(now);
    const thisMonth = monthRange(today);
    const lastMonth = monthRange(today, -1);

    const [
      totalReservations,
      pendingReservations,
      rooms,
      monthReservations,
      externalBlocks,
      upcomingCheckIns,
    ] = await Promise.all([
      prisma.reservation.count({ where: { status: { notIn: ['CANCELLED', 'DECLINED'] } } }),
      prisma.reservation.count({ where: { status: { in: ['PENDING', 'AWAITING_PAYMENT'] } } }),
      prisma.room.findMany({ where: { isActive: true }, select: { id: true } }),
      // Estadias com noites no mês anterior ou no atual
      prisma.reservation.findMany({
        where: { status: { in: STAY_STATUSES }, checkIn: { lt: thisMonth.end }, checkOut: { gt: lastMonth.start } },
        select: { roomId: true, status: true, checkIn: true, checkOut: true, totalPrice: true, priceBreakdown: true },
      }),
      prisma.blockedDate.findMany({
        where: { source: { in: EXTERNAL_SOURCES }, date: { gte: thisMonth.start, lt: thisMonth.end } },
        select: { roomId: true, source: true, date: true },
      }),
      prisma.reservation.findMany({
        where: { status: { in: STAY_STATUSES }, checkIn: { gte: new Date(`${today}T00:00:00Z`) } },
        take: 5,
        orderBy: { checkIn: 'asc' },
        include: { room: true, guest: true },
      }),
    ]);

    const roomIds = rooms.map(room => room.id);
    const monthRev = monthRevenue(monthReservations, thisMonth);
    const lastMonthRev = monthRevenue(monthReservations, lastMonth);
    const occupancy = monthOccupancy(monthReservations, externalBlocks, roomIds, thisMonth);
    const occupiedToday = new Set(monthReservations
      .filter(reservation => stayNights(reservation).includes(today))
      .map(reservation => reservation.roomId));
    externalBlocks
      .filter(block => block.date.toISOString().slice(0, 10) === today)
      .forEach(block => occupiedToday.add(block.roomId));

    res.json({
      totalReservations,
      pendingReservations,
      monthLabel: thisMonth.label,
      lastMonthName: lastMonth.name,
      monthRevenue: monthRev,
      lastMonthRevenue: lastMonthRev,
      revenueGrowth: lastMonthRev > 0 ? Number((((monthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1)) : null,
      occupancyRate: occupancy.rate,
      occupiedNights: occupancy.occupiedNights,
      availableNights: occupancy.availableNights,
      occupancyToday: [...occupiedToday].filter(id => roomIds.includes(id)).length,
      totalRooms: roomIds.length,
      upcomingCheckIns,
    });
  } catch (err) { next(err); }
});

// PATCH /api/admin/password — alterar password
router.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword e newPassword são obrigatórios.' });
    }
    if (newPassword.length < 12) {
      return res.status(400).json({ error: 'A nova password deve ter pelo menos 12 caracteres.' });
    }

    const admin = await prisma.admin.findUnique({ where: { id: req.admin.id } });
    const valid = await bcrypt.compare(currentPassword, admin.password);
    if (!valid) return res.status(401).json({ error: 'Password atual incorreta.' });

    const hashed = await bcrypt.hash(newPassword, 12);
    // Termina todas as sessões abertas noutros dispositivos
    await prisma.admin.update({ where: { id: req.admin.id }, data: { password: hashed, passwordChangedAt: new Date() } });

    res.json({ message: 'Password alterada com sucesso. Inicie sessão novamente.' });
  } catch (err) { next(err); }
});

module.exports = router;
