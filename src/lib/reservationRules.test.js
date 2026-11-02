const test = require('node:test');
const assert = require('node:assert/strict');
const { getMinimumCheckInDate, isCheckInDateAllowed } = require('./reservationRules');

// Em outubro Portugal está em UTC+1 (hora de verão)
test('same-day check-in is allowed until 12:00 in Portugal', () => {
  assert.equal(getMinimumCheckInDate(new Date('2026-10-15T08:00:00Z')), '2026-10-15'); // 09:00
  assert.equal(getMinimumCheckInDate(new Date('2026-10-15T10:59:59Z')), '2026-10-15'); // 11:59:59
});

test('from 12:00 in Portugal the minimum check-in moves to tomorrow', () => {
  assert.equal(getMinimumCheckInDate(new Date('2026-10-15T11:00:00Z')), '2026-10-16'); // 12:00
  assert.equal(getMinimumCheckInDate(new Date('2026-10-15T22:59:59Z')), '2026-10-16'); // 23:59:59
});

test('cutoff follows Portugal time in winter (UTC+0)', () => {
  assert.equal(getMinimumCheckInDate(new Date('2026-12-15T11:59:00Z')), '2026-12-15');
  assert.equal(getMinimumCheckInDate(new Date('2026-12-15T12:00:00Z')), '2026-12-16');
});

test('check-in today is allowed before 12:00, past dates never', () => {
  const now = new Date('2026-10-15T09:00:00Z');
  assert.equal(isCheckInDateAllowed('2026-10-15', now), true);
  assert.equal(isCheckInDateAllowed('2026-10-16', now), true);
  assert.equal(isCheckInDateAllowed('2026-10-14', now), false);
  assert.equal(isCheckInDateAllowed('2026-10-15', new Date('2026-10-15T11:30:00Z')), false);
});

test('stayDatesError aceita estadias normais e recusa formatos, extremos e datas distantes', () => {
  const { stayDatesError } = require('./reservationRules');
  const now = new Date('2026-10-17T10:00:00Z');
  assert.equal(stayDatesError('2026-10-20', '2026-10-23', now), null);
  assert.equal(stayDatesError('2026-10-20T15:00', '2026-10-23', now), 'Datas inválidas.');
  assert.equal(stayDatesError('2026-10-23', '2026-10-20', now), 'Datas inválidas.');
  assert.match(stayDatesError('2026-10-20', '2026-10-21', now), /mínima/);
  assert.match(stayDatesError('2026-10-20', '2999-01-01', now), /máxima/);
  assert.match(stayDatesError('2026-10-10', '2026-10-13', now), /já não está disponível/);
  assert.match(stayDatesError('2029-01-01', '2029-01-05', now), /Ainda não é possível/);
});
