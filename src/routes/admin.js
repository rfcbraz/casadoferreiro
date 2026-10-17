// src/routes/admin.js
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const router = express.Router();

// POST /api/admin/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
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

// GET /api/admin/stats — dashboard stats
router.get('/stats', requireAuth, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalReservations,
      pendingReservations,
      monthRevenue,
      lastMonthRevenue,
      occupancyToday,
      totalRooms,
      upcomingCheckIns,
    ] = await Promise.all([
      prisma.reservation.count({ where: { status: { not: ['CANCELLED', 'DECLINED'] } } }),
      prisma.reservation.count({ where: { status: { in: ['PENDING', 'AWAITING_PAYMENT'] } } }),
      prisma.reservation.aggregate({
        where: { status: { in: ['CONFIRMED', 'PAID'] }, createdAt: { gte: startOfMonth } },
        _sum: { totalPrice: true },
      }),
      prisma.reservation.aggregate({
        where: { status: { in: ['CONFIRMED', 'PAID'] }, createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        _sum: { totalPrice: true },
      }),
      prisma.reservation.count({
        where: {
          status: { in: ['CONFIRMED', 'PAID'] },
          checkIn: { lte: now },
          checkOut: { gte: now },
        },
      }),
      prisma.room.count({ where: { isActive: true } }),
      prisma.reservation.findMany({
        where: {
          status: { in: ['CONFIRMED', 'PAID'] },
          checkIn: { gte: now },
        },
        take: 5,
        orderBy: { checkIn: 'asc' },
        include: { room: true, guest: true },
      }),
    ]);

    const monthRev = monthRevenue._sum.totalPrice || 0;
    const lastMonthRev = lastMonthRevenue._sum.totalPrice || 0;
    const revenueGrowth = lastMonthRev > 0
      ? (((monthRev - lastMonthRev) / lastMonthRev) * 100).toFixed(1)
      : null;

    res.json({
      totalReservations,
      pendingReservations,
      monthRevenue: monthRev,
      revenueGrowth,
      occupancyRate: totalRooms > 0 ? Math.round((occupancyToday / totalRooms) * 100) : 0,
      occupancyToday,
      totalRooms,
      upcomingCheckIns,
    });
  } catch (err) { next(err); }
});

// PATCH /api/admin/password — alterar password
router.patch('/password', requireAuth, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword e newPassword são obrigatórios.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'A nova password deve ter pelo menos 8 caracteres.' });
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
