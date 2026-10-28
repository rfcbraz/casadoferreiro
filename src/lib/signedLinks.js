// Links assinados enviados por email: só quem recebeu o link verdadeiro o pode usar.
// Cada propósito tem a sua assinatura (um link de cancelamento não serve para avaliar, e vice-versa).
const crypto = require('crypto');

function secret() {
  const value = process.env.CHECKOUT_LINK_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error('JWT_SECRET não está configurado no servidor.');
  return value;
}

function signLink(purpose, reservationId) {
  return crypto.createHmac('sha256', secret()).update(`${purpose}:${reservationId}`).digest('base64url');
}

function isValidLinkSignature(purpose, reservationId, signature) {
  if (typeof signature !== 'string' || !signature || typeof reservationId !== 'string') return false;
  const expected = Buffer.from(signLink(purpose, reservationId));
  const received = Buffer.from(signature);
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// Regresso do Stripe sem pagar
const signCheckoutCancel = id => signLink('cancel-checkout', id);
const isValidCheckoutCancelSignature = (id, signature) => isValidLinkSignature('cancel-checkout', id, signature);

// Avaliação da estadia
const signReviewLink = id => signLink('review', id);
const isValidReviewSignature = (id, signature) => isValidLinkSignature('review', id, signature);

module.exports = { signCheckoutCancel, isValidCheckoutCancelSignature, signReviewLink, isValidReviewSignature };
