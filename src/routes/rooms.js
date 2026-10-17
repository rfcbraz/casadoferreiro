// src/routes/rooms.js
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { normalizeParty, validateParty, calculateQuote } = require('../lib/pricing');
const { loadPricing } = require('../lib/priceRules');
const { publicRoom } = require('../lib/publicRoom');
const { MAXIMUM_STAY_NIGHTS } = require('../lib/reservationRules');
const { syncExternalCalendars } = require('../services/ical');
const router = express.Router();

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/rooms — lista todos os quartos ativos
router.get('/', async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      where: { isActive: true },
      orderBy: { pricePerNight: 'asc' },
    });
    res.json(rooms.map(publicRoom));
  } catch (err) { next(err); }
});

// GET /api/rooms/admin — lista todos os quartos para gestão (admin)
router.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const rooms = await prisma.room.findMany({
      orderBy: { pricePerNight: 'asc' },
    });
    res.json(rooms);
  } catch (err) { next(err); }
});

// GET /api/rooms/promotions/active — promoções ativas que ainda não terminaram (público, para o pop-up do site)
router.get('/promotions/active', async (req, res, next) => {
  try {
    const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const promotions = await prisma.promotion.findMany({
      where: { isActive: true, endDate: { gte: today } },
      include: { room: { select: { name: true, isActive: true } } },
      orderBy: [{ discountPct: 'desc' }],
    });
    res.json(promotions
      .filter(promotion => !promotion.room || promotion.room.isActive)
      .map(promotion => ({
        name: promotion.name,
        discountPct: promotion.discountPct,
        minNights: promotion.minNights,
        startDate: promotion.startDate.toISOString().slice(0, 10),
        endDate: promotion.endDate.toISOString().slice(0, 10),
        roomName: promotion.room?.name || null,
      })));
  } catch (err) { next(err); }
});

// GET /api/rooms/:id/quote?checkIn&checkOut&adults&teens&children&infants — orçamento (público)
router.get('/:id/quote', async (req, res, next) => {
  try {
    const { checkIn, checkOut } = req.query;
    if (!DATE_PATTERN.test(checkIn || '') || !DATE_PATTERN.test(checkOut || '') || checkIn >= checkOut) {
      return res.status(400).json({ error: 'Datas inválidas.' });
    }
    const nights = Math.round((new Date(`${checkOut}T00:00:00Z`) - new Date(`${checkIn}T00:00:00Z`)) / 86400000);
    if (!(nights <= MAXIMUM_STAY_NIGHTS)) {
      return res.status(400).json({ error: `A estadia máxima é de ${MAXIMUM_STAY_NIGHTS} noites.` });
    }
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room || !room.isActive) return res.status(404).json({ error: 'Quarto não encontrado.' });

    const party = normalizeParty(req.query);
    const partyError = validateParty(room, party);
    if (partyError) return res.status(400).json({ error: partyError });

    const { rules, promotions } = await loadPricing(prisma, room.id, checkIn, checkOut);
    res.json(calculateQuote(room, rules, checkIn, checkOut, party, promotions));
  } catch (err) { next(err); }
});

// GET /api/rooms/:id/price-rules — épocas e feriados da unidade (admin)
router.get('/:id/price-rules', requireAuth, async (req, res, next) => {
  try {
    const rules = await prisma.priceRule.findMany({
      where: { roomId: req.params.id },
      orderBy: [{ startDate: 'asc' }],
    });
    res.json(rules);
  } catch (err) { next(err); }
});

// POST /api/rooms/:id/price-rules — criar época ou feriado (admin)
router.post('/:id/price-rules', requireAuth, async (req, res, next) => {
  try {
    const { name, kind, startDate, endDate, price, weekendPrice } = req.body || {};
    if (!['SEASON', 'HOLIDAY'].includes(kind)) return res.status(400).json({ error: 'Tipo inválido.' });
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Indique um nome.' });
    if (!DATE_PATTERN.test(startDate || '') || !DATE_PATTERN.test(endDate || '') || startDate > endDate) {
      return res.status(400).json({ error: 'Datas inválidas: a data final tem de ser igual ou posterior à inicial.' });
    }
    const nightlyPrice = parseFloat(price);
    if (!(nightlyPrice > 0)) return res.status(400).json({ error: 'Indique um preço por noite válido.' });
    let weekendNightlyPrice = null;
    if (kind === 'SEASON' && weekendPrice !== undefined && weekendPrice !== null && weekendPrice !== '') {
      weekendNightlyPrice = parseFloat(weekendPrice);
      if (!(weekendNightlyPrice > 0)) return res.status(400).json({ error: 'Preço de fim de semana inválido.' });
    }
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Quarto não encontrado.' });

    const rule = await prisma.priceRule.create({
      data: {
        roomId: room.id,
        name: String(name).trim().slice(0, 100),
        kind,
        startDate: new Date(`${startDate}T00:00:00Z`),
        endDate: new Date(`${endDate}T00:00:00Z`),
        price: nightlyPrice,
        weekendPrice: weekendNightlyPrice,
      },
    });
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

// DELETE /api/rooms/price-rules/:ruleId — apagar época ou feriado (admin)
router.delete('/price-rules/:ruleId', requireAuth, async (req, res, next) => {
  try {
    await prisma.priceRule.delete({ where: { id: req.params.ruleId } });
    res.json({ message: 'Regra de preço apagada.' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Regra não encontrada.' });
    next(err);
  }
});

// GET /api/rooms/:id/promotions — promoções da unidade e de todas as unidades (admin)
router.get('/:id/promotions', requireAuth, async (req, res, next) => {
  try {
    const promotions = await prisma.promotion.findMany({
      where: { OR: [{ roomId: req.params.id }, { roomId: null }] },
      orderBy: [{ startDate: 'asc' }],
    });
    res.json(promotions);
  } catch (err) { next(err); }
});

// POST /api/rooms/:id/promotions — criar promoção; allRooms=true aplica a todas as unidades (admin)
router.post('/:id/promotions', requireAuth, async (req, res, next) => {
  try {
    const { name, startDate, endDate, discountPct, minNights, allRooms } = req.body || {};
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Indique um nome para a promoção.' });
    if (!DATE_PATTERN.test(startDate || '') || !DATE_PATTERN.test(endDate || '') || startDate > endDate) {
      return res.status(400).json({ error: 'Datas inválidas: a data final tem de ser igual ou posterior à inicial.' });
    }
    const pct = parseFloat(discountPct);
    if (!(pct > 0 && pct <= 100)) return res.status(400).json({ error: 'O desconto tem de estar entre 0 e 100%.' });
    const nights = parseInt(minNights, 10);
    if (!(nights >= 1)) return res.status(400).json({ error: 'O mínimo de noites tem de ser pelo menos 1.' });
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Quarto não encontrado.' });

    const promotion = await prisma.promotion.create({
      data: {
        roomId: allRooms ? null : room.id,
        name: String(name).trim().slice(0, 100),
        startDate: new Date(`${startDate}T00:00:00Z`),
        endDate: new Date(`${endDate}T00:00:00Z`),
        discountPct: pct,
        minNights: nights,
        isActive: true,
      },
    });
    res.status(201).json(promotion);
  } catch (err) { next(err); }
});

// PATCH /api/rooms/promotions/:promotionId — ativar/desativar promoção (admin)
router.patch('/promotions/:promotionId', requireAuth, async (req, res, next) => {
  try {
    if (typeof req.body?.isActive !== 'boolean') return res.status(400).json({ error: 'isActive tem de ser verdadeiro ou falso.' });
    const promotion = await prisma.promotion.update({
      where: { id: req.params.promotionId },
      data: { isActive: req.body.isActive },
    });
    res.json(promotion);
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Promoção não encontrada.' });
    next(err);
  }
});

// DELETE /api/rooms/promotions/:promotionId — apagar promoção (admin)
router.delete('/promotions/:promotionId', requireAuth, async (req, res, next) => {
  try {
    await prisma.promotion.delete({ where: { id: req.params.promotionId } });
    res.json({ message: 'Promoção apagada.' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Promoção não encontrada.' });
    next(err);
  }
});

// GET /api/rooms/:id
router.get('/:id', async (req, res, next) => {
  try {
    const room = await prisma.room.findUnique({ where: { id: req.params.id } });
    if (!room) return res.status(404).json({ error: 'Quarto não encontrado.' });
    res.json(publicRoom(room));
  } catch (err) { next(err); }
});

// POST /api/rooms — criar quarto (admin)
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const { name, type, description, pricePerNight, capacity, amenities, images } = req.body;
    if (!name || !type || !pricePerNight || !capacity) {
      return res.status(400).json({ error: 'Campos obrigatórios: name, type, pricePerNight, capacity.' });
    }
    const room = await prisma.room.create({
      data: { name, type, description: description || '', pricePerNight, capacity, amenities: amenities || [], images: images || [] }
    });
    res.status(201).json(room);
  } catch (err) { next(err); }
});

// PATCH /api/rooms/:id — atualizar quarto (admin)
router.patch('/:id', requireAuth, async (req, res, next) => {
  try {
    // Only allow a whitelist of updatable fields to avoid accidental/invalid writes
    const allowed = ['name','type','description','pricePerNight','weekendPrice','capacity','baseOccupancy','fewerGuestDiscountPct','extraGuestFee','cribFeePerNight','amenities','images','isActive','sizeSqm','bedrooms','beds','bookingIcalUrl','airbnbIcalUrl'];
    const data = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        data[key] = req.body[key];
      }
    }

    // Coerce numeric fields when present
    if (data.pricePerNight !== undefined) {
      if (data.pricePerNight === '') data.pricePerNight = null;
      else {
        data.pricePerNight = parseFloat(data.pricePerNight);
        if (Number.isNaN(data.pricePerNight)) {
          return res.status(400).json({ error: 'pricePerNight precisa ser um número válido.' });
        }
      }
    }
    if (data.capacity !== undefined) {
      if (data.capacity === '') data.capacity = null;
      else {
        data.capacity = parseInt(data.capacity, 10);
        if (Number.isNaN(data.capacity)) {
          return res.status(400).json({ error: 'capacity precisa ser um número válido.' });
        }
      }
    }
    if (data.sizeSqm !== undefined) {
      data.sizeSqm = parseFloat(data.sizeSqm);
      if (Number.isNaN(data.sizeSqm)) {
        return res.status(400).json({ error: 'sizeSqm precisa ser um número válido.' });
      }
    }
    if (data.bedrooms !== undefined) {
      data.bedrooms = parseInt(data.bedrooms, 10);
      if (Number.isNaN(data.bedrooms)) {
        return res.status(400).json({ error: 'bedrooms precisa ser um número válido.' });
      }
    }
    if (data.beds !== undefined) {
      data.beds = parseInt(data.beds, 10);
      if (Number.isNaN(data.beds)) {
        return res.status(400).json({ error: 'beds precisa ser um número válido.' });
      }
    }

    // Preços: campos opcionais (vazio = sem valor) e não negativos
    const pricingFields = {
      weekendPrice: { parse: parseFloat, nullable: true, label: 'Preço de fim de semana' },
      baseOccupancy: { parse: value => parseInt(value, 10), nullable: true, label: 'Ocupação base' },
      fewerGuestDiscountPct: { parse: parseFloat, max: 100, label: 'Desconto por pessoa a menos' },
      extraGuestFee: { parse: parseFloat, label: 'Valor por pessoa a mais' },
      cribFeePerNight: { parse: parseFloat, label: 'Valor do berço' },
    };
    for (const [key, rule] of Object.entries(pricingFields)) {
      if (data[key] === undefined) continue;
      if (data[key] === '' || data[key] === null) {
        data[key] = rule.nullable ? null : 0;
        continue;
      }
      const value = rule.parse(data[key]);
      if (Number.isNaN(value) || value < 0 || (rule.max !== undefined && value > rule.max)) {
        return res.status(400).json({ error: `${rule.label}: valor inválido.` });
      }
      data[key] = value;
    }

    // Links iCal: vazio = sem sincronização; caso contrário só endereços https
    for (const key of ['bookingIcalUrl', 'airbnbIcalUrl']) {
      if (data[key] === undefined) continue;
      const value = String(data[key] || '').trim();
      if (!value) { data[key] = null; continue; }
      let url;
      try { url = new URL(value); } catch { url = null; }
      if (!url || url.protocol !== 'https:' || value.length > 2000) {
        return res.status(400).json({ error: 'O link iCal tem de ser um endereço https:// válido.' });
      }
      data[key] = value;
    }

    // Normalize arrays (allow comma-separated strings from form submissions)
    if (data.amenities !== undefined && !Array.isArray(data.amenities)) {
      data.amenities = String(data.amenities).split(',').map(s => s.trim()).filter(Boolean);
    }
    if (data.images !== undefined && !Array.isArray(data.images)) {
      data.images = String(data.images).split(',').map(s => s.trim()).filter(Boolean);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'Nenhum campo válido enviado para atualizar.' });
    }

    // If updating the name, ensure it does not collide with another room
    if (data.name) {
      const existing = await prisma.room.findUnique({ where: { name: data.name } });
      if (existing && existing.id !== req.params.id) {
        return res.status(409).json({ error: 'Já existe um quarto com esse nome.' });
      }
    }

    const room = await prisma.room.update({
      where: { id: req.params.id },
      data,
    });
    // Link iCal novo ou alterado: importar já, sem esperar pela sincronização de hora a hora
    if (data.bookingIcalUrl || data.airbnbIcalUrl) {
      syncExternalCalendars().catch(err => console.error('Erro na sincronização iCal após editar unidade:', err));
    }
    res.json(room);
  } catch (err) {
    console.error('Error updating room:', err);
    // Prisma known errors (unique constraint etc.) have codes — map common ones to useful HTTP responses
    if (err && err.code === 'P2002') {
      return res.status(409).json({ error: 'Violação de constraint única no banco de dados.', details: err.meta });
    }
    return next(err);
  }
});

// DELETE /api/rooms/:id — desativar quarto (admin)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.room.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });
    res.json({ message: 'Quarto desativado com sucesso.' });
  } catch (err) { next(err); }
});

module.exports = router;
