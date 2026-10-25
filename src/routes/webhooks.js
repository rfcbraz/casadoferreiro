// src/routes/webhooks.js
const express = require('express');
const prisma = require('../lib/prisma');
const { sendReservationStatusUpdate, sendAdminNotification, sendDoubleBookingAlert } = require('../services/email');
const { syncRoomCalendars, findImportedConflicts } = require('../services/ical');
const { getStripeClient, refundPaymentIntent } = require('../services/stripe');
const router = express.Router();

// O body tem de chegar em raw para validar a assinatura do Stripe
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(500).json({ error: 'Webhook do Stripe não configurado.' });
    }
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(400).json({ error: 'Assinatura do webhook inválida.' });
  }

  if (event.type === 'payment_intent.succeeded') {
    const paymentIntent = event.data.object;
    const reservationId = paymentIntent.metadata.reservationId;

    if (reservationId) {
      try {
        const updated = await prisma.reservation.updateMany({
          where: { id: reservationId, status: { notIn: ['PAID', 'CANCELLED', 'DECLINED'] } },
          data: {
            status: 'PAID',
            stripePaymentId: paymentIntent.id,
            paidAt: new Date(),
          },
        });
        if (updated.count) {
          const reservation = await prisma.reservation.findUnique({
            where: { id: reservationId },
            include: { room: true, guest: true },
          });
          Promise.all([
            sendReservationStatusUpdate(reservation, 'PAID'),
            sendAdminNotification(reservation),
          ]).catch(err => console.error('Erro ao enviar emails após pagamento:', err));
          // Em segundo plano: o Booking/Airbnb receberam uma reserva nestas datas entretanto?
          checkDoubleBooking(reservation);
        } else {
          const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
          if (reservation && ['CANCELLED', 'DECLINED'].includes(reservation.status)) {
            const refund = await refundPaymentIntent(paymentIntent.id, reservation.id);
            await prisma.reservation.update({
              where: { id: reservation.id },
              data: {
                stripePaymentId: paymentIntent.id,
                stripeRefundId: refund.id,
                paidAt: new Date(),
              },
            });
            if (!reservation.stripeRefundId) {
              const refundedReservation = await prisma.reservation.findUnique({
                where: { id: reservationId },
                include: { room: true, guest: true },
              });
              sendReservationStatusUpdate(refundedReservation, 'CANCELLED')
                .catch(err => console.error('Erro ao notificar reembolso:', err));
            }
          }
        }
      } catch (err) {
        console.error('Erro ao atualizar reserva após pagamento:', err);
        return res.status(500).json({ error: 'Não foi possível atualizar a reserva.' });
      }
    }
  } else if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const reservationId = session.metadata.reservationId;
    if (reservationId) {
      try {
        await prisma.reservation.updateMany({
          where: {
            id: reservationId,
            status: { in: ['PENDING', 'AWAITING_PAYMENT'] },
          },
          data: { status: 'CANCELLED', paymentExpiresAt: null },
        });
      } catch (err) {
        console.error('Erro ao libertar reserva após expiração do Checkout:', err);
        return res.status(500).json({ error: 'Não foi possível atualizar a reserva.' });
      }
    }
  }

  res.json({ received: true });
});

// Lê já os calendários do Booking/Airbnb da casa e avisa o proprietário se houver noites em conflito
async function checkDoubleBooking(reservation) {
  try {
    await syncRoomCalendars(reservation.roomId);
    const conflicts = await findImportedConflicts(reservation);
    if (conflicts.length) {
      console.warn(`Possível reserva duplicada #${reservation.id.slice(0, 8)}: ${conflicts.length} noite(s) ocupadas no Booking/Airbnb`);
      await sendDoubleBookingAlert(reservation, conflicts);
    }
  } catch (err) {
    console.error('Erro ao verificar reserva duplicada após pagamento:', err);
  }
}

module.exports = router;
