const Stripe = require('stripe');

function getStripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error('STRIPE_SECRET_KEY não está configurada.');
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function refundPaymentIntent(paymentIntentId, reservationId) {
  if (!paymentIntentId) {
    throw new Error('A reserva não tem um pagamento Stripe associado.');
  }
  const stripe = getStripeClient();
  try {
    return await stripe.refunds.create({
      payment_intent: paymentIntentId,
      reason: 'requested_by_customer',
      metadata: { reservationId },
    }, {
      idempotencyKey: `reservation-refund-${reservationId}`,
    });
  } catch (err) {
    // Reembolso já feito noutro sítio (ex.: diretamente no painel do Stripe): usar esse reembolso
    if (err.code === 'charge_already_refunded') {
      const { data } = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 1 });
      if (data[0]) return data[0];
    }
    throw err;
  }
}

module.exports = { getStripeClient, refundPaymentIntent };