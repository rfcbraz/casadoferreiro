// Assinatura do link de regresso do Stripe: só quem recebeu o link verdadeiro pode cancelar o pagamento
const crypto = require('crypto');

function secret() {
  const value = process.env.CHECKOUT_LINK_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não está configurado no servidor.');
  return value;
}

function signCheckoutCancel(reservationId) {
  return crypto.createHmac('sha256', secret()).update(`cancel-checkout:${reservationId}`).digest('base64url');
}

function isValidCheckoutCancelSignature(reservationId, signature) {
  if (typeof signature !== 'string' || !signature) return false;
  const expected = Buffer.from(signCheckoutCancel(reservationId));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = { signCheckoutCancel, isValidCheckoutCancelSignature };
