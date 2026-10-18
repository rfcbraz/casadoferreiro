const test = require('node:test');
const assert = require('node:assert/strict');
const { eachNight, cribsAvailable } = require('./cribs');

const range = (checkIn, checkOut, cribs) => ({ checkIn: new Date(`${checkIn}T00:00:00Z`), checkOut: new Date(`${checkOut}T00:00:00Z`), cribs });

test('berços livres contam a noite mais ocupada da estadia', () => {
  const nights = eachNight('2026-11-10', '2026-11-15');
  // T3 com 2 berços de 12 a 14 (noites 12 e 13); a estadia 10–15 apanha essas noites
  assert.equal(cribsAvailable(2, nights, [range('2026-11-12', '2026-11-14', 2)]).available, 0);
  // Saída no dia 14: a noite de 14 fica livre
  assert.equal(cribsAvailable(2, eachNight('2026-11-14', '2026-11-16'), [range('2026-11-12', '2026-11-14', 2)]).available, 2);
});

test('reservas e registos manuais somam-se; nunca abaixo de zero', () => {
  const nights = eachNight('2026-11-10', '2026-11-12');
  assert.equal(cribsAvailable(2, nights, [range('2026-11-09', '2026-11-11', 1)]).available, 1);
  assert.equal(cribsAvailable(2, nights, [range('2026-11-09', '2026-11-11', 1), range('2026-11-11', '2026-11-13', 1)]).available, 1);
  assert.equal(cribsAvailable(2, nights, [range('2026-11-10', '2026-11-11', 1), range('2026-11-10', '2026-11-12', 1)]).available, 0);
  assert.equal(cribsAvailable(1, nights, [range('2026-11-10', '2026-11-12', 2)]).available, 0);
  assert.equal(cribsAvailable(3, nights, []).available, 3);
});
