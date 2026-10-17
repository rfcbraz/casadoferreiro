// src/routes/reservations.js
const express = require('express');
const prisma = require('../lib/prisma');
const { MINIMUM_STAY_NIGHTS, stayDatesError } = require('../lib/reservationRules');
const { validateEmail, normalizePhoneNumber } = require('../lib/contactValidation');
const { requireAuth } = require('../middleware/auth');
const { normalizeParty, validateParty, countedGuests, calculateQuote } = require('../lib/pricing');
const { loadPricing } = require('../lib/priceRules');
const { blockedConflictWhere } = require('../lib/blockedDates');
const { verifyTurnstile, TURNSTILE_ERROR } = require('../lib/turnstile');
const { signCheckoutCancel, isValidCheckoutCancelSignature } = require('../lib/checkoutSignature');

const MAX_PENDING_REQUESTS_PER_EMAIL = 3; // pedidos pendentes por email em 24 horas
const { sendReservationConfirmation, sendReservationPaymentLink, sendReservationStatusUpdate, sendAdminNotification } = require('../services/email');
const { getStripeClient, refundPaymentIntent } = require('../services/stripe');
const router = express.Router();

// POST /api/reservations — criar reserva (público)
router.post('/', async (req, res, next) => {
  try {
    const { name, email, phone, roomId, checkIn, checkOut, guests, specialRequests, website, turnstileToken } = req.body;
    // Campo escondido anti-robô: pessoas não o preenchem
    if (website) return res.status(400).json({ error: 'Pedido inválido.' });
    // Idades: adultos (18+), 7–17, 3–6 e bebés (0–2). Pedidos antigos só com "guests" contam como adultos.
    const hasAgeGroups = ['adults', 'teens', 'children', 'infants'].some(key => req.body[key] !== undefined);
    const party = normalizeParty(hasAgeGroups ? req.body : { adults: guests });

    // Validação básica
    if (!name || !email || !roomId || !checkIn || !checkOut || (!guests && !hasAgeGroups)) {
      return res.status(400).json({ error: 'Campos obrigatórios em falta.' });
    }
    const emailResult = validateEmail(email);
    if (!emailResult.success) {
      return res.status(400).json({ error: 'Indique um endereço de email válido.' });
    }
    if (phone === undefined || phone === null || phone === '') {
      return res.status(400).json({ error: 'O número de telefone é obrigatório.' });
    }
    if (typeof phone !== 'string') {
      return res.status(400).json({ error: 'Número de telefone inválido.' });
    }
    const normalizedPhone = normalizePhoneNumber(phone);
    if (!phone.trim()) {
      return res.status(400).json({ error: 'O número de telefone é obrigatório.' });
    }
    if (!normalizedPhone) {
      return res.status(400).json({ error: 'O telefone deve ter entre 7 e 15 algarismos.' });
    }
    const validEmail = emailResult.data;
    const guestName = typeof name === 'string' ? name.trim() : '';
    if (!guestName || guestName.length > 100) {
      return res.status(400).json({ error: 'Indique o seu nome (máximo 100 caracteres).' });
    }
    if (specialRequests !== undefined && specialRequests !== null
      && (typeof specialRequests !== 'string' || specialRequests.length > 2000)) {
      return res.status(400).json({ error: 'As observações não podem ter mais de 2000 caracteres.' });
    }

    const datesError = stayDatesError(checkIn, checkOut);
    if (datesError) return res.status(400).json({ error: datesError, minimumStayNights: MINIMUM_STAY_NIGHTS });

    const turnstile = await verifyTurnstile(turnstileToken, req.ip);
    if (!turnstile.success) return res.status(403).json({ error: TURNSTILE_ERROR });

    // Evita usar o formulário para enviar muitos emails ao mesmo endereço
    const recentPending = await prisma.reservation.count({
      where: {
        guest: { email: validEmail },
        status: 'PENDING',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (recentPending >= MAX_PENDING_REQUESTS_PER_EMAIL) {
      return res.status(429).json({ error: 'Já existem vários pedidos pendentes para este email. Aguarde a resposta do proprietário.' });
    }

    const ciDate = new Date(`${checkIn}T00:00:00Z`);
    const coDate = new Date(`${checkOut}T00:00:00Z`);
    const nights = Math.round((coDate - ciDate) / (1000 * 60 * 60 * 24));

    // Verificar quarto
    const room = await prisma.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) {
      return res.status(404).json({ error: 'Quarto não encontrado.' });
    }
    const partyError = validateParty(room, party);
    if (partyError) return res.status(400).json({ error: partyError });
    const guestCount = countedGuests(party);

    const { rules, promotions } = await loadPricing(prisma, room.id, ciDate, coDate);
    const quote = calculateQuote(room, rules, ciDate, coDate, party, promotions);
    const totalPrice = quote.total;
    const reservation = await prisma.$transaction(async transaction => {
      const conflict = await transaction.reservation.findFirst({
        where: {
          roomId,
          OR: [
            { status: { in: ['CONFIRMED', 'PAID'] } },
            { status: { in: ['AWAITING_PAYMENT', 'PENDING'] }, paymentExpiresAt: { gt: new Date() } },
          ],
          AND: [
            { checkIn: { lt: coDate } },
            { checkOut: { gt: ciDate } },
          ],
        },
      });
      if (conflict) {
        const error = new Error('O quarto não está disponível para as datas selecionadas.');
        error.status = 409;
        throw error;
      }

      const blockedConflict = await transaction.blockedDate.findFirst({
        where: blockedConflictWhere(ciDate, coDate, roomId),
      });
      if (blockedConflict) {
        const error = new Error('O quarto está bloqueado para parte das datas selecionadas.');
        error.status = 409;
        throw error;
      }

      // Um pedido novo não altera os dados guardados de um hóspede existente:
      // o nome e o telefone deste pedido ficam na própria reserva
      const guest = await transaction.guest.upsert({
        where: { email: validEmail },
        update: {},
        create: { name: guestName, email: validEmail, phone: normalizedPhone },
      });

      return transaction.reservation.create({
        data: {
          checkIn: ciDate,
          checkOut: coDate,
          nights,
          guests: guestCount,
          adults: party.adults,
          teens: party.teens,
          children: party.children,
          infants: party.infants,
          priceBreakdown: quote,
          totalPrice,
          breakfast: false,
          specialRequests: specialRequests || null,
          contactName: guestName,
          contactPhone: normalizedPhone,
          roomId,
          guestId: guest.id,
        },
        include: { room: true, guest: true },
      });
    }, { isolationLevel: 'Serializable' });

    Promise.all([
      sendReservationConfirmation(reservation),
      sendAdminNotification(reservation),
    ]).catch(error => console.error('Erro ao enviar emails de reserva:', error));

    res.status(201).json({
      message: 'Pedido recebido. O pagamento será solicitado se o proprietário aprovar a reserva.',
      reservation: {
        id: reservation.id,
        ref: reservation.id.slice(0, 8).toUpperCase(),
        room: reservation.room.name,
        checkIn: reservation.checkIn,
        checkOut: reservation.checkOut,
        nights: reservation.nights,
        totalPrice: reservation.totalPrice,
        status: reservation.status,
      },
    });
  } catch (err) {
    if (err.code === 'P2034') {
      return res.status(409).json({ error: 'A disponibilidade mudou. Atualize as datas e tente novamente.' });
    }
    next(err);
  }
});

// POST /api/reservations/:id/cancel-checkout — libertar uma sessão Stripe cancelada
router.post('/:id/cancel-checkout', async (req, res, next) => {
  try {
    // Exige a assinatura que o servidor pôs no link de regresso do Stripe
    if (!isValidCheckoutCancelSignature(req.params.id, req.body?.sig)) {
      return res.status(403).json({ error: 'Link de cancelamento inválido.' });
    }
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation || !['PENDING', 'AWAITING_PAYMENT'].includes(reservation.status)) {
      return res.status(404).json({ error: 'Pagamento pendente não encontrado.' });
    }

    if (reservation.stripeCheckoutSessionId) {
      const stripe = getStripeClient();
      await stripe.checkout.sessions.expire(reservation.stripeCheckoutSessionId);
    }
    await prisma.reservation.updateMany({
      where: { id: reservation.id, status: { in: ['PENDING', 'AWAITING_PAYMENT'] } },
      data: { status: 'CANCELLED', paymentExpiresAt: null },
    });
    res.json({ message: 'Sessão de pagamento cancelada.' });
  } catch (err) { next(err); }
});

// GET /api/reservations/:id — consultar reserva pelo ID (admin)
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true, guest: { select: { name: true, email: true } } },
    });
    if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
    res.json(reservation);
  } catch (err) { next(err); }
});

// GET /api/reservations — listar todas (admin)
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { status, roomId, from, to } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const where = {};
    if (status) where.status = status;
    if (roomId) where.roomId = roomId;
    if (from || to) {
      where.checkIn = {};
      if (from) where.checkIn.gte = new Date(from);
      if (to) where.checkIn.lte = new Date(to);
    }

    const [reservations, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        include: { room: true, guest: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reservation.count({ where }),
    ]);

    res.json({ reservations, total, page, pages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

async function approveReservationForPayment(reservation) {
  if (!process.env.FRONTEND_URL) {
    const error = new Error('FRONTEND_URL não está configurado no servidor.');
    error.status = 503;
    throw error;
  }

  const stripe = getStripeClient();
  const paymentExpiresAt = new Date(Date.now() + 35 * 60 * 1000);
  const frontendUrl = process.env.FRONTEND_URL.replace(/\/$/, '');

  if (reservation.stripeCheckoutSessionId) {
    const previousSession = await stripe.checkout.sessions.retrieve(reservation.stripeCheckoutSessionId);
    if (previousSession.status === 'complete') {
      const error = new Error('O pagamento desta reserva está a ser confirmado. Atualize a lista de reservas.');
      error.status = 409;
      throw error;
    }
    if (previousSession.status === 'open') {
      await stripe.checkout.sessions.expire(previousSession.id);
    }
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    customer_email: reservation.guest.email,
    client_reference_id: reservation.id,
    expires_at: Math.floor(paymentExpiresAt.getTime() / 1000),
    line_items: [{
      price_data: {
        currency: 'eur',
        product_data: {
          name: `Reserva ${reservation.room.name} - ${reservation.nights} noites`,
          description: `${reservation.checkIn.toISOString().slice(0, 10)} a ${reservation.checkOut.toISOString().slice(0, 10)}`,
        },
        unit_amount: Math.round(reservation.totalPrice * 100),
      },
      quantity: 1,
    }],
    metadata: { reservationId: reservation.id },
    payment_intent_data: { metadata: { reservationId: reservation.id } },
    success_url: `${frontendUrl}/?payment=success&reservation=${reservation.id}`,
    cancel_url: `${frontendUrl}/?payment=cancelled&reservation=${reservation.id}&sig=${signCheckoutCancel(reservation.id)}`,
  });

  try {
    const approval = await prisma.$transaction(async transaction => {
      const current = await transaction.reservation.findUnique({ where: { id: reservation.id } });
      if (!current || current.status !== 'PENDING') {
        const error = new Error('Este pedido já não está pendente. Atualize a lista de reservas.');
        error.status = 409;
        throw error;
      }

      const conflict = await transaction.reservation.findFirst({
        where: {
          id: { not: reservation.id },
          roomId: reservation.roomId,
          OR: [
            { status: { in: ['CONFIRMED', 'PAID'] } },
            { status: { in: ['AWAITING_PAYMENT', 'PENDING'] }, paymentExpiresAt: { gt: new Date() } },
          ],
          checkIn: { lt: reservation.checkOut },
          checkOut: { gt: reservation.checkIn },
        },
      });
      if (conflict) {
        const error = new Error('A unidade deixou de estar disponível para estas datas.');
        error.status = 409;
        throw error;
      }

      const blockedConflict = await transaction.blockedDate.findFirst({
        where: blockedConflictWhere(reservation.checkIn, reservation.checkOut, reservation.roomId),
      });
      if (blockedConflict) {
        const error = new Error('A unidade foi bloqueada para parte destas datas.');
        error.status = 409;
        throw error;
      }

      const pendingConflicts = await transaction.reservation.findMany({
        where: {
          id: { not: reservation.id },
          roomId: reservation.roomId,
          status: 'PENDING',
          checkIn: { lt: reservation.checkOut },
          checkOut: { gt: reservation.checkIn },
        },
        include: { room: true, guest: true },
      });
      if (pendingConflicts.length) {
        await transaction.reservation.updateMany({
          where: { id: { in: pendingConflicts.map(item => item.id) } },
          data: { status: 'DECLINED' },
        });
      }

      const approvedReservation = await transaction.reservation.update({
        where: { id: reservation.id },
        data: {
          status: 'AWAITING_PAYMENT',
          stripeCheckoutSessionId: checkoutSession.id,
          paymentExpiresAt,
        },
        include: { room: true, guest: true },
      });

      return { reservation: approvedReservation, declinedReservations: pendingConflicts };
    }, { isolationLevel: 'Serializable' });

    return { ...approval, checkoutUrl: checkoutSession.url };
  } catch (error) {
    await stripe.checkout.sessions.expire(checkoutSession.id)
      .catch(expireError => console.error('Erro ao expirar Checkout sem aprovação:', expireError.message));
    throw error;
  }
}

// PATCH /api/reservations/:id/status — atualizar estado (admin)
router.patch('/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status, notes } = req.body;
    const validStatuses = ['PENDING', 'CONFIRMED', 'DECLINED', 'CANCELLED', 'COMPLETED', 'PAID'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Estado inválido. Use: ${validStatuses.join(', ')}` });
    }

    const currentReservation = await prisma.reservation.findUnique({
      where: { id: req.params.id },
      include: { room: true, guest: true },
    });
    if (!currentReservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (status === 'PAID') {
      return res.status(400).json({ error: 'O estado de pagamento é atualizado automaticamente pelo Stripe.' });
    }
    if (status === 'CONFIRMED') {
      if (currentReservation.status !== 'PENDING') {
        return res.status(409).json({ error: 'Só é possível aprovar pedidos pendentes.' });
      }
      const nights = Math.round((currentReservation.checkOut - currentReservation.checkIn) / (1000 * 60 * 60 * 24));
      if (nights < MINIMUM_STAY_NIGHTS) {
        return res.status(409).json({ error: `A estadia mínima é de ${MINIMUM_STAY_NIGHTS} noites consecutivas.` });
      }

      try {
        const approval = await approveReservationForPayment(currentReservation);
        const emailPromises = [sendReservationPaymentLink(approval.reservation, approval.checkoutUrl)];
        approval.declinedReservations.forEach(conflict => {
          emailPromises.push(sendReservationStatusUpdate(conflict, 'DECLINED'));
        });
        Promise.all(emailPromises).catch(error => console.error('Erro ao enviar emails após aprovação:', error));
        return res.json({
          message: 'Pedido aprovado. O link de pagamento foi enviado ao hóspede.',
          reservation: approval.reservation,
        });
      } catch (error) {
        if (error.code === 'P2034') {
          return res.status(409).json({ error: 'A disponibilidade mudou. Atualize as reservas e tente novamente.' });
        }
        if (error.status) return res.status(error.status).json({ error: error.message });
        return next(error);
      }
    }
    if (status === 'DECLINED' && currentReservation.status === 'PAID') {
      return res.status(409).json({ error: 'Uma reserva paga não pode ser recusada.' });
    }

    if (['CANCELLED', 'DECLINED'].includes(status) && ['PENDING', 'AWAITING_PAYMENT'].includes(currentReservation.status) && currentReservation.stripeCheckoutSessionId) {
      try {
        const stripe = getStripeClient();
        await stripe.checkout.sessions.expire(currentReservation.stripeCheckoutSessionId);
      } catch (error) {
        console.error('Erro ao expirar Checkout antes de atualizar a reserva:', error.message);
      }
    }

    let stripeRefundId;
    if (status === 'CANCELLED' && currentReservation.status === 'PAID') {
      const refund = await refundPaymentIntent(currentReservation.stripePaymentId, currentReservation.id);
      stripeRefundId = refund.id;
    }
 
    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: { status, notes: notes || undefined, stripeRefundId },
      include: { room: true, guest: true },
    });
 
    const emailPromises = [];
    if (['CONFIRMED', 'CANCELLED', 'PAID', 'DECLINED'].includes(status)) {
      emailPromises.push(sendReservationStatusUpdate(reservation, status));
    }
 
    Promise.all(emailPromises)
      .catch(err => console.error('Erro a enviar email:', err));

    res.json(reservation);
  } catch (err) { next(err); }
});

// DELETE /api/reservations/:id/record — apagar reserva decidida (admin)
router.delete('/:id/record', requireAuth, async (req, res, next) => {
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!reservation) return res.status(404).json({ error: 'Reserva não encontrada.' });

    const deletableStatuses = ['AWAITING_PAYMENT', 'CONFIRMED', 'DECLINED'];
    if (!deletableStatuses.includes(reservation.status)) {
      return res.status(409).json({
        error: 'Só é possível apagar uma reserva depois de ser aceite ou recusada, e antes de ser paga.',
      });
    }

    if (reservation.status === 'AWAITING_PAYMENT' && reservation.stripeCheckoutSessionId) {
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(reservation.stripeCheckoutSessionId);
      if (session.status === 'complete') {
        return res.status(409).json({ error: 'O pagamento está a ser confirmado. Atualize a lista de reservas.' });
      }
      if (session.status === 'open') {
        await stripe.checkout.sessions.expire(reservation.stripeCheckoutSessionId);
      } else if (session.status !== 'expired') {
        return res.status(409).json({ error: 'Não foi possível confirmar o estado do pagamento. Atualize a lista e tente novamente.' });
      }
    }

    const result = await prisma.reservation.deleteMany({
      where: { id: reservation.id, status: { in: deletableStatuses } },
    });
    if (result.count === 0) {
      return res.status(409).json({ error: 'O estado da reserva foi alterado. Atualize a lista e tente novamente.' });
    }

    res.json({ message: 'Reserva apagada com sucesso.' });
  } catch (err) { next(err); }
});

// DELETE /api/reservations/:id — cancelar reserva (admin)
router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const currentReservation = await prisma.reservation.findUnique({ where: { id: req.params.id } });
    if (!currentReservation) return res.status(404).json({ error: 'Reserva não encontrada.' });
    if (['PENDING', 'AWAITING_PAYMENT'].includes(currentReservation.status) && currentReservation.stripeCheckoutSessionId) {
      const stripe = getStripeClient();
      await stripe.checkout.sessions.expire(currentReservation.stripeCheckoutSessionId);
    }

    let stripeRefundId;
    if (currentReservation.status === 'PAID') {
      const refund = await refundPaymentIntent(currentReservation.stripePaymentId, currentReservation.id);
      stripeRefundId = refund.id;
    }

    const reservation = await prisma.reservation.update({
      where: { id: req.params.id },
      data: { status: 'CANCELLED', stripeRefundId },
      include: { room: true, guest: true },
    });
    sendReservationStatusUpdate(reservation, 'CANCELLED')
      .catch(err => console.error('Erro a enviar email:', err));
    res.json({ message: 'Reserva cancelada.' });
  } catch (err) { next(err); }
});

module.exports = router;
