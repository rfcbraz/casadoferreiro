const test = require('node:test');
const assert = require('node:assert/strict');
const { monthRange, monthRevenue, monthOccupancy, externalCheckIns } = require('./stats');

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

test('chegadas do Booking/Airbnb: cada bloco de noites seguidas é uma estadia', () => {
  const block = (roomId, source, date) => ({ roomId, source, date: day(date) });
  const blocks = [
    block('t2', 'BOOKING_COM', '2026-11-13'), block('t2', 'BOOKING_COM', '2026-11-14'),
    block('t3', 'BOOKING_COM', '2026-10-31'), block('t3', 'BOOKING_COM', '2026-11-01'), // já a decorrer
    block('t3', 'AIRBNB', '2026-11-05'),
    block('t3', 'MANUAL', '2026-11-08'), // dia fechado, não é chegada
    block('t2', 'BOOKING_COM', '2026-11-20'), // depois do período
  ];
  assert.deepEqual(externalCheckIns(blocks, '2026-11-01', '2026-11-16'), [
    { roomId: 't3', source: 'AIRBNB', checkIn: '2026-11-05', checkOut: '2026-11-06' },
    { roomId: 't2', source: 'BOOKING_COM', checkIn: '2026-11-13', checkOut: '2026-11-15' },
  ]);
});
