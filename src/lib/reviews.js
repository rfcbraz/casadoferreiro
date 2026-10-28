// Avaliações das estadias: regras partilhadas pelo servidor e pelos testes
const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'HIDDEN'];
const STAY_DONE_STATUSES = ['PAID', 'COMPLETED', 'CONFIRMED'];
const MAX_COMMENT = 2000;
const SEND_FROM_HOUR = 10;      // o email sai a partir das 10:00 (Portugal) do dia seguinte à saída
const SEND_WINDOW_DAYS = 14;    // estadias que terminaram há mais tempo já não recebem o pedido

// Nome publicado: primeiro nome + inicial do último apelido ("Maria Silva Santos" → "Maria S.")
function displayName(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Hóspede';
  const first = parts[0].slice(0, 40);
  return parts.length > 1 ? `${first} ${parts[parts.length - 1][0].toUpperCase()}.` : first;
}

function starValue(value, required) {
  if (value === undefined || value === null || value === '') return required ? NaN : null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : NaN;
}

// Valida o formulário; devolve { error } ou { data }
function validateReview(body = {}) {
  const rating = starValue(body.rating, true);
  if (Number.isNaN(rating)) return { error: 'Escolha de 1 a 5 estrelas.' };
  const extras = {};
  for (const key of ['cleanliness', 'comfort', 'location']) {
    const value = starValue(body[key], false);
    if (Number.isNaN(value)) return { error: 'Avaliação inválida.' };
    extras[key] = value;
  }
  if (body.comment !== undefined && typeof body.comment !== 'string') return { error: 'Comentário inválido.' };
  const comment = String(body.comment || '').trim();
  if (comment.length > MAX_COMMENT) return { error: `O comentário pode ter até ${MAX_COMMENT} caracteres.` };
  return { data: { rating, ...extras, comment, consent: body.consent === true } };
}

// Dia seguinte à saída, a partir das 10:00 (Portugal), e saída há no máximo 14 dias
function isReviewRequestDue(checkOut, today, hour) {
  const out = new Date(checkOut).toISOString().slice(0, 10);
  if (out >= today) return false;
  const oldest = new Date(`${today}T00:00:00Z`);
  oldest.setUTCDate(oldest.getUTCDate() - SEND_WINDOW_DAYS);
  if (out < oldest.toISOString().slice(0, 10)) return false;
  const nextDay = new Date(`${out}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return out < today && (today > nextDay.toISOString().slice(0, 10) || hour >= SEND_FROM_HOUR);
}

// Média e número de avaliações publicadas (geral e por casa)
function summarize(reviews) {
  const average = list => (list.length ? Math.round((list.reduce((sum, review) => sum + review.rating, 0) / list.length) * 10) / 10 : null);
  const byRoom = {};
  reviews.forEach(review => { (byRoom[review.roomId] ||= []).push(review); });
  return {
    count: reviews.length,
    average: average(reviews),
    rooms: Object.fromEntries(Object.entries(byRoom).map(([roomId, list]) => [roomId, { count: list.length, average: average(list) }])),
  };
}

module.exports = { REVIEW_STATUSES, STAY_DONE_STATUSES, MAX_COMMENT, SEND_WINDOW_DAYS, displayName, validateReview, isReviewRequestDue, summarize };
