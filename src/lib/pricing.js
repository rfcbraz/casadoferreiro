// src/lib/pricing.js — cálculo do preço de uma estadia
//
// Preço de cada noite (por ordem de prioridade):
//   1. Feriado que inclua a noite → preço do feriado
//   2. Época que inclua a noite → preço de fim de semana da época (noites de sexta e sábado) ou preço normal
//   3. Preço base da unidade → preço de fim de semana da unidade ou preço por noite
// Ajuste por pessoas, sobre a ocupação base da unidade (T2: 4, T3: 6):
//   adultos e 7–17 anos contam 1, crianças 3–6 contam 0,5, bebés 0–2 não contam
//   - por cada pessoa a menos: desconto de X% no preço da noite
//   - por cada pessoa a mais: + X€ por noite
//   - bebés: aluguer de berço por noite
// Promoções (ativas, da unidade ou de todas): se a estadia tiver pelo menos o mínimo de noites,
//   desconto em % nas noites dentro do período da promoção (o berço não tem desconto).
//   Se várias se aplicarem, vale a de maior desconto; não se acumulam.

const WEEKEND_NIGHTS = new Set([5, 6]); // noites de sexta e sábado
const CHILD_WEIGHT = 0.5;
const AGE_GROUPS = ['adults', 'teens', 'children', 'infants'];

function round2(value) {
  return Math.round(value * 100) / 100;
}

function dateKey(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(value).toISOString().slice(0, 10);
}

function eachNight(checkIn, checkOut) {
  const nights = [];
  const end = dateKey(checkOut);
  const cursor = new Date(`${dateKey(checkIn)}T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) < end) {
    nights.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return nights;
}

function isWeekendNight(date) {
  return WEEKEND_NIGHTS.has(new Date(`${date}T00:00:00Z`).getUTCDay());
}

// Entre regras sobrepostas do mesmo tipo, vale a mais curta (a mais específica)
function findRule(rules, kind, date) {
  return rules
    .filter(rule => rule.kind === kind && dateKey(rule.startDate) <= date && date <= dateKey(rule.endDate))
    .sort((a, b) => ruleLength(a) - ruleLength(b))[0] || null;
}

function ruleLength(rule) {
  return new Date(dateKey(rule.endDate)) - new Date(dateKey(rule.startDate));
}

function nightlyRate(room, rules, date) {
  const weekend = isWeekendNight(date);
  const holiday = findRule(rules, 'HOLIDAY', date);
  if (holiday) return { price: holiday.price, source: 'HOLIDAY', ruleName: holiday.name, weekend };

  const season = findRule(rules, 'SEASON', date);
  if (season) {
    const useWeekend = weekend && season.weekendPrice != null;
    return { price: useWeekend ? season.weekendPrice : season.price, source: 'SEASON', ruleName: season.name, weekend };
  }

  const useWeekend = weekend && room.weekendPrice != null;
  return { price: useWeekend ? room.weekendPrice : room.pricePerNight, source: 'BASE', ruleName: null, weekend };
}

function normalizeParty(party = {}) {
  const normalized = Object.fromEntries(AGE_GROUPS.map(group => {
    const value = Number(party[group] ?? 0);
    return [group, Number.isInteger(value) && value >= 0 ? value : NaN];
  }));
  // Berços pedidos (0 até ao número de bebés); pedidos antigos sem este campo pediam um por bebé
  const cribs = Number(party.cribs ?? normalized.infants);
  normalized.cribs = Number.isInteger(cribs) && cribs >= 0 ? cribs : NaN;
  return normalized;
}

function countedGuests(party) {
  return party.adults + party.teens + party.children;
}

function getBaseOccupancy(room) {
  return room.baseOccupancy ?? room.capacity;
}

function validateParty(room, party) {
  if (AGE_GROUPS.some(group => Number.isNaN(party[group]))) return 'Número de hóspedes inválido.';
  if (party.adults < 1) return 'A reserva tem de incluir pelo menos um adulto.';
  if (Number.isNaN(party.cribs) || party.cribs > party.infants) return 'O número de berços não pode ser superior ao número de bebés.';
  if (countedGuests(party) > room.capacity) return `Esta unidade permite até ${room.capacity} hóspedes (bebés até 2 anos não contam).`;
  return null;
}

function promotionCovers(promotion, date) {
  return dateKey(promotion.startDate) <= date && date <= dateKey(promotion.endDate);
}

function describePromotion(promotion) {
  return { id: promotion.id, name: promotion.name, discountPct: promotion.discountPct, minNights: promotion.minNights };
}

function applyPromotion(nights, promotions) {
  const stayLength = nights.length;
  const candidates = promotions.filter(promotion => promotion.isActive !== false
    && nights.some(night => promotionCovers(promotion, night.date)));
  const best = candidates
    .filter(promotion => stayLength >= promotion.minNights)
    .sort((a, b) => b.discountPct - a.discountPct)[0] || null;

  // Promoção que o hóspede ainda não atinge (para o site sugerir mais noites)
  const nextPromotion = candidates
    .filter(promotion => stayLength < promotion.minNights && promotion.discountPct > (best?.discountPct || 0))
    .sort((a, b) => a.minNights - b.minNights || b.discountPct - a.discountPct)[0] || null;

  let discount = 0;
  if (best) {
    nights.forEach(night => {
      if (!promotionCovers(best, night.date)) return;
      const nightDiscount = round2((night.price + night.guestAdjustment) * best.discountPct / 100);
      night.promotionDiscount = -nightDiscount;
      night.total = round2(night.total - nightDiscount);
      discount += nightDiscount;
    });
  }
  return {
    promotion: best ? { ...describePromotion(best), discount: -round2(discount) } : null,
    nextPromotion: nextPromotion ? describePromotion(nextPromotion) : null,
  };
}

function calculateQuote(room, rules, checkIn, checkOut, party, promotions = []) {
  const baseOccupancy = getBaseOccupancy(room);
  const equivalentGuests = party.adults + party.teens + party.children * CHILD_WEIGHT;
  const difference = equivalentGuests - baseOccupancy;
  const discountPct = room.fewerGuestDiscountPct || 0;
  const extraFee = room.extraGuestFee || 0;
  const cribFee = room.cribFeePerNight || 0;

  const nights = eachNight(checkIn, checkOut).map(date => {
    const rate = nightlyRate(room, rules, date);
    let guestAdjustment = 0;
    if (difference > 0) guestAdjustment = difference * extraFee;
    if (difference < 0) guestAdjustment = -rate.price * Math.min(1, (-difference * discountPct) / 100);
    const crib = (party.cribs ?? party.infants) * cribFee;
    return {
      date,
      ...rate,
      guestAdjustment: round2(guestAdjustment),
      crib: round2(crib),
      total: round2(rate.price + guestAdjustment + crib),
    };
  });

  const { promotion, nextPromotion } = applyPromotion(nights, promotions);
  const sum = key => round2(nights.reduce((total, night) => total + (night[key] || 0), 0));
  return {
    nights,
    promotion,
    nextPromotion,
    nightsCount: nights.length,
    baseOccupancy,
    equivalentGuests,
    accommodation: sum('price'),
    guestAdjustment: sum('guestAdjustment'),
    crib: sum('crib'),
    cribs: party.cribs ?? party.infants,
    total: sum('total'),
  };
}

module.exports = {
  AGE_GROUPS,
  WEEKEND_NIGHTS,
  eachNight,
  isWeekendNight,
  nightlyRate,
  normalizeParty,
  countedGuests,
  validateParty,
  calculateQuote,
};
