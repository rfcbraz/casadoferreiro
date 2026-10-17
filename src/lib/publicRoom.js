// Dados de uma unidade que podem ser mostrados no site: sem os links iCal privados do Booking/Airbnb
function publicRoom(room) {
  const { bookingIcalUrl, airbnbIcalUrl, ...visible } = room;
  return visible;
}

module.exports = { publicRoom };
