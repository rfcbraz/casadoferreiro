// src/routes/reviews.js — avaliações das estadias
const express = require('express');
const prisma = require('../lib/prisma');
const { requireAuth } = require('../middleware/auth');
const { isValidReviewSignature } = require('../lib/signedLinks');
const { REVIEW_STATUSES, STAY_DONE_STATUSES, displayName, validateReview, summarize } = require('../lib/reviews');
const { sendNewReviewNotification } = require('../services/email');
const router = express.Router();

const INVALID_LINK = 'Este link de avaliação não é válido. Use o link que recebeu por email.';

// Reserva do link assinado, se a estadia já terminou
async function reservationFromLink(reservationId, signature) {
  if (!isValidReviewSignature(reservationId, signature)) return { status: 403, error: INVALID_LINK };
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId }, include: { room: true, guest: true } });
  if (!reservation || !STAY_DONE_STATUSES.includes(reservation.status)) return { status: 404, error: INVALID_LINK };
  if (reservation.checkOut > new Date()) return { status: 409, error: 'Poderá avaliar a estadia depois da data de saída.' };
  return { reservation };
}

const stayMonth = reservation => reservation.checkIn.toISOString().slice(0, 7); // "2026-11"

// GET /api/reviews — avaliações publicadas (site)
router.get('/', async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({ where: { status: 'PUBLISHED', consent: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const rooms = await prisma.room.findMany({ select: { id: true, name: true, type: true } });
    const roomById = new Map(rooms.map(room => [room.id, room]));
    const reservations = await prisma.reservation.findMany({
      where: { id: { in: reviews.map(review => review.reservationId) } },
      select: { id: true, checkIn: true },
    });
    const monthById = new Map(reservations.map(reservation => [reservation.id, stayMonth(reservation)]));
    res.json({
      summary: summarize(reviews),
      reviews: reviews.map(review => ({
        id: review.id,
        roomName: roomById.get(review.roomId)?.name || '',
        roomType: roomById.get(review.roomId)?.type || '',
        roomId: review.roomId,
        rating: review.rating,
        cleanliness: review.cleanliness,
        comfort: review.comfort,
        location: review.location,
        comment: review.comment,
        displayName: review.displayName,
        locale: review.locale,
        stayMonth: monthById.get(review.reservationId) || null,
        ownerReply: review.ownerReply,
      })),
    });
  } catch (err) { next(err); }
});

// GET /api/reviews/form?r=&sig= — dados da estadia para o formulário
router.get('/form', async (req, res, next) => {
  try {
    const { reservation, status, error } = await reservationFromLink(String(req.query.r || ''), req.query.sig);
    if (error) return res.status(status).json({ error });
    const existing = await prisma.review.findUnique({ where: { reservationId: reservation.id } });
    res.json({
      roomName: reservation.room.name,
      checkIn: reservation.checkIn.toISOString().slice(0, 10),
      checkOut: reservation.checkOut.toISOString().slice(0, 10),
      firstName: displayName(reservation.contactName || reservation.guest.name).split(' ')[0],
      displayName: displayName(reservation.contactName || reservation.guest.name),
      locale: reservation.locale,
      alreadyReviewed: Boolean(existing),
    });
  } catch (err) { next(err); }
});

// POST /api/reviews — enviar avaliação (uma por reserva)
router.post('/', async (req, res, next) => {
  try {
    const { r, sig } = req.body || {};
    const { reservation, status, error } = await reservationFromLink(String(r || ''), sig);
    if (error) return res.status(status).json({ error });
    const checked = validateReview(req.body);
    if (checked.error) return res.status(400).json({ error: checked.error });

    let review;
    try {
      review = await prisma.review.create({
        data: {
          reservationId: reservation.id,
          roomId: reservation.roomId,
          ...checked.data,
          displayName: displayName(reservation.contactName || reservation.guest.name),
          locale: reservation.locale,
        },
      });
    } catch (err) {
      if (err.code === 'P2002') return res.status(409).json({ error: 'Esta estadia já foi avaliada. Obrigado!' });
      throw err;
    }
    sendNewReviewNotification(review, reservation).catch(err => console.error('Erro ao avisar nova avaliação:', err.message));
    res.status(201).json({ message: 'Obrigado pela sua avaliação!' });
  } catch (err) { next(err); }
});

// ── Painel ─────────────────────────────────────────────────

// GET /api/reviews/admin — todas as avaliações, mais recentes primeiro
router.get('/admin', requireAuth, async (req, res, next) => {
  try {
    const reviews = await prisma.review.findMany({ orderBy: { createdAt: 'desc' }, take: 500 });
    const reservations = await prisma.reservation.findMany({
      where: { id: { in: reviews.map(review => review.reservationId) } },
      include: { room: { select: { name: true } }, guest: { select: { email: true } } },
    });
    const byId = new Map(reservations.map(reservation => [reservation.id, reservation]));
    res.json(reviews.map(review => {
      const reservation = byId.get(review.reservationId);
      return {
        ...review,
        ref: review.reservationId.slice(0, 8).toUpperCase(),
        roomName: reservation?.room.name || '',
        guestEmail: reservation?.guest.email || '',
        checkIn: reservation?.checkIn,
        checkOut: reservation?.checkOut,
      };
    }));
  } catch (err) { next(err); }
});

// PATCH /api/reviews/admin/:id — publicar/ocultar e responder
router.patch('/admin/:id', requireAuth, async (req, res, next) => {
  try {
    const review = await prisma.review.findUnique({ where: { id: req.params.id } });
    if (!review) return res.status(404).json({ error: 'Avaliação não encontrada.' });
    const data = {};
    if (req.body?.status !== undefined) {
      if (!REVIEW_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Estado inválido.' });
      if (req.body.status === 'PUBLISHED' && !review.consent) {
        return res.status(409).json({ error: 'O hóspede não autorizou a publicação desta avaliação.' });
      }
      data.status = req.body.status;
    }
    if (req.body?.ownerReply !== undefined) {
      const reply = String(req.body.ownerReply || '').trim();
      if (reply.length > 1000) return res.status(400).json({ error: 'A resposta pode ter até 1000 caracteres.' });
      data.ownerReply = reply || null;
      data.ownerReplyAt = reply ? new Date() : null;
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nada para alterar.' });
    res.json(await prisma.review.update({ where: { id: review.id }, data }));
  } catch (err) { next(err); }
});

// DELETE /api/reviews/admin/:id — apagar (ex.: conteúdo impróprio)
router.delete('/admin/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.review.delete({ where: { id: req.params.id } });
    res.json({ message: 'Avaliação apagada.' });
  } catch (err) {
    if (err.code === 'P2025') return res.status(404).json({ error: 'Avaliação não encontrada.' });
    next(err);
  }
});

module.exports = router;
