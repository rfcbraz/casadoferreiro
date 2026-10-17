const test = require('node:test');
const assert = require('node:assert/strict');
const { monthRange, monthRevenue, monthOccupancy } = require('./stats');

const october = monthRange('2026-10-17');
const day = date => new Date(`${date}T00:00:00Z`);

test('monthRange devolve o mês e o anterior com nome', () => {
  assert.equal(october.label, 'Outubro 2026');
  assert.equal(monthRange('2026-01-05', -1).label, 'Dezembro 2025');
  assert.equal(monthRange('2026-01-05', -1).name, 'dezembro');
});

test('receita conta só as noites do mês, pelo valor de cada noite', () => {
  const reservations = [
    { status: 'PAID', checkIn: day('2026-10-30'), checkOut: day('2026-11-02'), totalPrice: 330,
      priceBreakdown: { nights: [{ date: '2026-10-30', total: 100 }, { date: '2026-10-31', total: 120 }, { date: '2026-11-01', total: 110 }] } },
    // Reserva antiga sem detalhe: 4 noites, 2 em outubro → metade do total
    { status: 'CONFIRMED', checkIn: day('2026-09-29'), checkOut: day('2026-10-03'), totalPrice: 400 },
    { status: 'PENDING', checkIn: day('2026-10-10'), checkOut: day('2026-10-12'), totalPrice: 999 },
  ];
  assert.equal(monthRevenue(reservations, october), 420);
  assert.equal(monthRevenue(reservations, monthRange('2026-10-17', 1)), 110);
});

test('ocupação junta reservas e Booking/Airbnb, sem bloqueios manuais nem repetições', () => {
  const reservations = [{ status: 'PAID', roomId: 't2', checkIn: day('2026-10-01'), checkOut: day('2026-10-04') }];
  const blocked = [
    { roomId: 't2', source: 'BOOKING_COM', date: day('2026-10-03') }, // mesma noite da reserva
    { roomId: 't3', source: 'AIRBNB', date: day('2026-10-10') },
    { roomId: 't3', source: 'MANUAL', date: day('2026-10-11') },
  ];
  const result = monthOccupancy(reservations, blocked, ['t2', 't3'], october);
  assert.deepEqual(result, { occupiedNights: 4, availableNights: 62, rate: 6 });
});
