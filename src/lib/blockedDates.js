// Conflitos com datas bloqueadas numa estadia (da entrada à saída):
// - qualquer bloqueio numa noite da estadia (entrada inclusive, saída exclusive);
// - bloqueio MANUAL no próprio dia de saída: o proprietário fechou o dia inteiro, ninguém pode
//   estar na casa nesse dia. Bloqueios importados (Booking/Airbnb) representam noites de outras
//   reservas, por isso aí sair no dia em que outra reserva entra continua permitido.
function blockedConflictWhere(checkIn, checkOut, roomId) {
  return {
    ...(roomId ? { roomId } : {}),
    OR: [
      { date: { gte: checkIn, lt: checkOut } },
      { source: 'MANUAL', date: checkOut },
    ],
  };
}

module.exports = { blockedConflictWhere };
