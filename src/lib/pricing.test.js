const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateQuote, normalizeParty, validateParty, nightlyRate } = require('./pricing');

const t2 = {
  pricePerNight: 100,
  weekendPrice: 120,
  capacity: 6,
  baseOccupancy: 4,
  fewerGuestDiscountPct: 10,
  extraGuestFee: 20,
  cribFeePerNight: 5,
};
const party = values => normalizeParty(values);

test('base price on weekdays and weekend price on Friday and Saturday nights', () => {
  // 2026-11-04 é quarta-feira; noites de qua, qui, sex, sáb
  const quote = calculateQuote(t2, [], '2026-11-04', '2026-11-08', party({ adults: 4 }));
  assert.deepEqual(quote.nights.map(night => night.price), [100, 100, 120, 120]);
  assert.equal(quote.total, 440);
});

test('holiday beats season and season weekend price beats base', () => {
  const rules = [
    { kind: 'SEASON', name: 'Época alta', startDate: '2026-07-01', endDate: '2026-08-31', price: 150, weekendPrice: 180 },
    { kind: 'HOLIDAY', name: 'Assunção', startDate: '2026-08-15', endDate: '2026-08-15', price: 250, weekendPrice: null },
  ];
  assert.equal(nightlyRate(t2, rules, '2026-08-12').price, 150); // quarta
  assert.equal(nightlyRate(t2, rules, '2026-08-14').price, 180); // sexta
  assert.equal(nightlyRate(t2, rules, '2026-08-15').price, 250); // feriado ao sábado
  assert.equal(nightlyRate(t2, rules, '2026-09-02').source, 'BASE');
});

test('shortest overlapping season wins', () => {
  const rules = [
    { kind: 'SEASON', name: 'Verão', startDate: '2026-06-01', endDate: '2026-09-30', price: 130 },
    { kind: 'SEASON', name: 'Agosto', startDate: '2026-08-01', endDate: '2026-08-31', price: 160 },
  ];
  assert.equal(nightlyRate(t2, rules, '2026-08-05').ruleName, 'Agosto');
  assert.equal(nightlyRate(t2, rules, '2026-07-01').ruleName, 'Verão');
});

test('discount per missing guest and fee per extra guest', () => {
  const twoAdults = calculateQuote(t2, [], '2026-11-04', '2026-11-05', party({ adults: 2 }));
  assert.equal(twoAdults.total, 80); // 2 pessoas a menos → -20%
  const sixAdults = calculateQuote(t2, [], '2026-11-04', '2026-11-05', party({ adults: 6 }));
  assert.equal(sixAdults.total, 140); // 2 pessoas a mais → +40€
});

test('children 3-6 count as half a person and infants only pay the crib', () => {
  // 4 adultos + 1 criança = 4,5 pessoas → +10€; 1 bebé → +5€
  const quote = calculateQuote(t2, [], '2026-11-04', '2026-11-05', party({ adults: 4, children: 1, infants: 1 }));
  assert.equal(quote.guestAdjustment, 10);
  assert.equal(quote.crib, 5);
  assert.equal(quote.total, 115);
  // 3 adultos + 1 criança = 3,5 pessoas → -5%
  const fewer = calculateQuote(t2, [], '2026-11-04', '2026-11-05', party({ adults: 3, children: 1 }));
  assert.equal(fewer.total, 95);
});

test('party validation requires an adult and ignores infants for capacity', () => {
  assert.match(validateParty(t2, party({ teens: 2 })), /adulto/);
  assert.equal(validateParty(t2, party({ adults: 6, infants: 2 })), null);
  assert.match(validateParty(t2, party({ adults: 6, children: 1 })), /até 6/);
  assert.match(validateParty(t2, party({ adults: 1.5 })), /inválido/);
});

test('promotion applies only with enough nights, on covered nights, best one wins', () => {
  const promotions = [
    { id: 'p1', name: 'Estadia longa', startDate: '2026-11-01', endDate: '2026-11-30', discountPct: 10, minNights: 5, isActive: true },
    { id: 'p2', name: 'Semana', startDate: '2026-11-01', endDate: '2026-11-30', discountPct: 20, minNights: 7, isActive: true },
  ];
  const short = calculateQuote(t2, [], '2026-11-02', '2026-11-05', party({ adults: 4 }), promotions);
  assert.equal(short.promotion, null);
  assert.equal(short.nextPromotion.minNights, 5); // sugere a mais próxima
  assert.equal(short.total, 300);

  // 5 noites (seg a sex): 4 × 100 + 120 na sexta = 520 → −10%
  const five = calculateQuote(t2, [], '2026-11-02', '2026-11-07', party({ adults: 4 }), promotions);
  assert.equal(five.promotion.name, 'Estadia longa');
  assert.equal(five.promotion.discount, -52);
  assert.equal(five.total, 468);
  assert.equal(five.nextPromotion.minNights, 7);

  // Desconto não incide no berço
  const crib = calculateQuote(t2, [], '2026-11-02', '2026-11-07', party({ adults: 4, infants: 1 }), promotions);
  assert.equal(crib.total, 468 + 25);
});

test('promotion only discounts nights inside its dates', () => {
  const promotions = [{ id: 'p', name: 'Fim de outubro', startDate: '2026-10-01', endDate: '2026-11-03', discountPct: 50, minNights: 2, isActive: true }];
  // noites 2 e 3 nov dentro, 4 nov fora
  const quote = calculateQuote(t2, [], '2026-11-02', '2026-11-05', party({ adults: 4 }), promotions);
  assert.equal(quote.promotion.discount, -100);
  assert.equal(quote.total, 200);
});

test('the crib fee is charged per crib requested, not per baby', () => {
  const oneCrib = calculateQuote(t2, [], '2026-11-02', '2026-11-04', party({ adults: 2, infants: 2, cribs: 1 }));
  assert.equal(oneCrib.crib, 10);
  assert.equal(oneCrib.cribs, 1);
  const noCrib = calculateQuote(t2, [], '2026-11-02', '2026-11-04', party({ adults: 2, infants: 1, cribs: 0 }));
  assert.equal(noCrib.crib, 0);
  // Pedidos sem o campo "cribs" (antigos): um berço por bebé
  assert.equal(calculateQuote(t2, [], '2026-11-02', '2026-11-04', party({ adults: 2, infants: 1 })).crib, 10);
  assert.match(validateParty(t2, party({ adults: 2, infants: 1, cribs: 2 })), /berços/);
  assert.match(validateParty(t2, party({ adults: 2, infants: 1, cribs: -1 })), /berços/);
});
