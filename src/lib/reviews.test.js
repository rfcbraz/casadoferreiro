const test = require('node:test');
const assert = require('node:assert/strict');
const { displayName, validateReview, isReviewRequestDue, summarize } = require('./reviews');

test('nome publicado: primeiro nome e inicial do último apelido', () => {
  assert.equal(displayName('Maria Silva Santos'), 'Maria S.');
  assert.equal(displayName('  joão   pereira '), 'joão P.');
  assert.equal(displayName('Ana'), 'Ana');
  assert.equal(displayName(''), 'Hóspede');
});

test('formulário: estrelas de 1 a 5, extras opcionais, comentário limitado', () => {
  assert.deepEqual(validateReview({ rating: 5, comment: ' Ótimo ', consent: true }).data,
    { rating: 5, cleanliness: null, comfort: null, location: null, comment: 'Ótimo', consent: true });
  assert.ok(validateReview({}).error);
  assert.ok(validateReview({ rating: 6 }).error);
  assert.ok(validateReview({ rating: 4.5 }).error);
  assert.ok(validateReview({ rating: 4, comfort: 0 }).error);
  assert.ok(validateReview({ rating: 4, comment: 'x'.repeat(2001) }).error);
  assert.equal(validateReview({ rating: 4, consent: 'sim' }).data.consent, false);
});

test('pedido de avaliação: dia seguinte à saída, a partir das 10h, até 14 dias depois', () => {
  const out = new Date('2026-11-05T00:00:00Z');
  assert.equal(isReviewRequestDue(out, '2026-11-05', 15), false); // dia da saída
  assert.equal(isReviewRequestDue(out, '2026-11-06', 9), false);  // dia seguinte, antes das 10h
  assert.equal(isReviewRequestDue(out, '2026-11-06', 10), true);
  assert.equal(isReviewRequestDue(out, '2026-11-08', 3), true);   // servidor esteve parado: envia quando voltar
  assert.equal(isReviewRequestDue(out, '2026-11-19', 12), true);
  assert.equal(isReviewRequestDue(out, '2026-11-20', 12), false); // estadia antiga
});

test('média por casa e geral', () => {
  const summary = summarize([{ roomId: 't2', rating: 5 }, { roomId: 't2', rating: 4 }, { roomId: 't3', rating: 3 }]);
  assert.deepEqual(summary, { count: 3, average: 4, rooms: { t2: { count: 2, average: 4.5 }, t3: { count: 1, average: 3 } } });
  assert.equal(summarize([]).average, null);
});
