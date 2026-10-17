const { randomUUID } = require('crypto');
const prisma = require('../lib/prisma');

function unfoldICal(ics) {
  return ics.replace(/\r?\n[ \t]/g, '');
}

function parseIcsDate(value) {
  if (!value) return null;
  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const date = new Date(Date.UTC(year, month, day));
    date.setUTCHours(0, 0, 0, 0);
    return date;
  }

  if (/^\d{8}T\d{6}Z$/.test(value)) {
    return new Date(value);
  }

  if (/^\d{8}T\d{6}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6)) - 1;
    const day = Number(value.slice(6, 8));
    const hour = Number(value.slice(9, 11));
    const minute = Number(value.slice(11, 13));
    const second = Number(value.slice(13, 15));
    return new Date(year, month, day, hour, minute, second);
  }

  const parsed = new Date(value);
  return isNaN(parsed) ? null : parsed;
}

function parseICalEvents(content) {
  const lines = unfoldICal(content).split(/\r?\n/);
  const events = [];
  let current = null;

  for (const line of lines) {
    if (!line) continue;
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT' && current) {
      events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;

    const match = line.match(/^([^:;]+)(?:;[^:]*)?:(.*)$/);
    if (!match) continue;

    const [, key, value] = match;
    switch (key) {
      case 'DTSTART':
        current.startDate = parseIcsDate(value);
        break;
      case 'DTEND':
        current.endDate = parseIcsDate(value);
        break;
      case 'UID':
        current.uid = value;
        break;
      case 'STATUS':
        current.status = value;
        break;
      case 'SUMMARY':
        current.summary = value;
        break;
      case 'DESCRIPTION':
        current.description = value;
        break;
      default:
        break;
    }
  }

  return events.filter(event => event.startDate && event.endDate);
}

// Dias sempre em UTC (as datas das reservas são guardadas à meia-noite UTC),
// para o resultado não depender do fuso horário do servidor
function normalizeDay(date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function formatIcsDate(date, allDay = true) {
  const iso = date.toISOString();
  const year = iso.slice(0, 4);
  const month = iso.slice(5, 7);
  const day = iso.slice(8, 10);
  if (allDay) {
    return `${year}${month}${day}`;
  }
  const time = iso.slice(11, 19).replace(/[:]/g, '');
  return `${year}${month}${day}T${time}Z`;
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function buildIcsCalendar({ prodId = 'Casa do Ferreiro', events = [] }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${prodId}//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${formatIcsDate(new Date(), false)}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.startDate, true)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDate(event.endDate, true)}`);
    } else {
      lines.push(`DTSTART:${formatIcsDate(event.startDate, false)}`);
      lines.push(`DTEND:${formatIcsDate(event.endDate, false)}`);
    }
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    }
    if (event.status) {
      lines.push(`STATUS:${event.status}`);
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function dateKey(date) {
  return normalizeDay(date).toISOString().slice(0, 10);
}

function groupDates(dates) {
  const sorted = [...dates]
    .map(normalizeDay)
    .sort((a, b) => a - b);

  const groups = [];
  let current = null;

  for (const date of sorted) {
    if (!current) {
      current = { start: date, end: addDays(date, 1) };
      continue;
    }

    if (date.getTime() === current.end.getTime()) {
      current.end = addDays(current.end, 1);
    } else {
      groups.push(current);
      current = { start: date, end: addDays(date, 1) };
    }
  }

  if (current) groups.push(current);
  return groups;
}

async function syncRoomIcalFeed(roomId, source, url, label) {
  if (!url) return { roomId, source, skipped: true };

  let content;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      throw new Error(`Falha a carregar ${label} iCal: ${response.status} ${response.statusText}`);
    }
    content = await response.text();
    // Uma página de erro ou de login (ex.: link expirado) não é um calendário: manter as datas que já existem
    // em vez de as apagar todas
    if (!/BEGIN:VCALENDAR/.test(content)) {
      throw new Error(`O link ${label} não devolveu um calendário iCal.`);
    }
  } catch (error) {
    console.error('Erro ao importar iCal:', error.message);
    return { roomId, source, error: error.message };
  }

  const events = parseICalEvents(content);
  const blockedDates = new Set();

  events.forEach(event => {
    if (event.status && event.status.toUpperCase() === 'CANCELLED') return;
    if (!event.startDate || !event.endDate) return;

    const start = normalizeDay(event.startDate);
    const end = normalizeDay(event.endDate);
    for (let current = new Date(start); current < end; current = addDays(current, 1)) {
      blockedDates.add(dateKey(current));
    }
  });

  const dates = [...blockedDates].map(dateString => new Date(`${dateString}T00:00:00Z`));

  // Apagar e recriar numa só transação: as datas importadas nunca ficam livres durante a sincronização
  return prisma.$transaction(async transaction => {
    await transaction.blockedDate.deleteMany({
      where: { roomId, source },
    });

    if (dates.length === 0) {
      return { roomId, source, synced: true, blockedDates: 0 };
    }

    const manualBlocks = await transaction.blockedDate.findMany({
      where: {
        roomId,
        source: 'MANUAL',
        date: { in: dates },
      },
      select: { date: true },
    });

    const blockedManually = new Set(manualBlocks.map(b => dateKey(b.date)));
    const createData = dates
      .filter(date => !blockedManually.has(dateKey(date)))
      .map(date => ({
        id: randomUUID(),
        roomId,
        date,
        reason: `${label} importado`,
        source,
        externalUid: `${source}:${dateKey(date)}`,
      }));

    if (createData.length > 0) {
      // skipDuplicates: a mesma noite pode vir do Booking e do Airbnb
      await transaction.blockedDate.createMany({ data: createData, skipDuplicates: true });
    }

    return { roomId, source, synced: true, blockedDates: createData.length };
  });
}

async function syncExternalCalendars() {
  const rooms = await prisma.room.findMany({
    where: {
      OR: [
        { bookingIcalUrl: { not: null } },
        { airbnbIcalUrl: { not: null } },
      ],
    },
  });

  const results = [];
  for (const room of rooms) {
    if (room.bookingIcalUrl) {
      results.push(await syncRoomIcalFeed(room.id, 'BOOKING_COM', room.bookingIcalUrl, 'Booking.com'));
    }
    if (room.airbnbIcalUrl) {
      results.push(await syncRoomIcalFeed(room.id, 'AIRBNB', room.airbnbIcalUrl, 'Airbnb'));
    }
  }

  return results;
}

function buildRoomCalendar(room, reservations, blockedDates) {
  const events = [];

  reservations.forEach(reservation => {
    events.push({
      uid: `reservation-${reservation.id}`,
      summary: `${reservation.status === 'AWAITING_PAYMENT' ? 'Reserva a aguardar pagamento' : 'Reserva confirmada'} — ${room.name}`,
      // Sem nome nem email do hóspede: este calendário é público para o Booking/Airbnb o poderem ler
      description: `Check-in: ${reservation.checkIn.toISOString().slice(0, 10)}\\nCheck-out: ${reservation.checkOut.toISOString().slice(0, 10)}`,
      startDate: normalizeDay(reservation.checkIn),
      endDate: normalizeDay(reservation.checkOut),
      allDay: true,
      status: 'CONFIRMED',
    });
  });

  const blockedRanges = groupDates(blockedDates.map(b => b.date));
  blockedRanges.forEach(range => {
    events.push({
      uid: `blocked-${range.start.toISOString().slice(0, 10)}`,
      summary: `Indisponível — ${room.name}`,
      description: `Bloqueio de calendário: ${range.start.toISOString().slice(0, 10)} até ${new Date(range.end.getTime() - 1).toISOString().slice(0, 10)}`,
      startDate: range.start,
      endDate: range.end,
      allDay: true,
      status: 'CONFIRMED',
    });
  });

  return buildIcsCalendar({ prodId: `Casa do Ferreiro - ${room.name}`, events });
}

module.exports = {
  parseICalEvents,
  syncExternalCalendars,
  buildRoomCalendar,
};
