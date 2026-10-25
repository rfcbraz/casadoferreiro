// src/services/email.js
const nodemailer = require('nodemailer');
const { DATE_LOCALES, LANGUAGE_NAMES, normalizeLocale, emailText } = require('./emailText');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_PORT === '465', // 465 usa SSL direto; 587 usa STARTTLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  // Falhar depressa em vez de esperar 2 minutos quando o SMTP não está acessível
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});

// O Railway bloqueia SMTP fora do plano Pro; com RESEND_API_KEY os emails seguem pela API HTTPS do Resend
async function sendMail({ from, to, replyTo, subject, html }) {
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
    return res.json();
  }
  return transporter.sendMail({ from, to, replyTo, subject, html });
}

// Data por extenso no idioma do email (as datas das reservas são guardadas à meia-noite UTC)
function formatDate(date, locale = 'pt') {
  return new Date(date).toLocaleDateString(DATE_LOCALES[normalizeLocale(locale)], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
}

// Data e hora em Portugal (validade do link de pagamento)
function formatDateTime(date, locale = 'pt') {
  return new Date(date).toLocaleString(DATE_LOCALES[normalizeLocale(locale)], {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon'
  }) + ` (${emailText(locale).portugalTime})`;
}

// Todos os avisos (novas reservas e contactos) e respostas dos hóspedes vão para este email
const RESERVATIONS_EMAIL = process.env.NOTIFICATION_EMAIL || 'reservas@casadoferreirovn.pt';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// O formulário guarda a hora prevista na primeira linha das observações: "Hora prevista de chegada: HH:MM"
function splitSpecialRequests(specialRequests) {
  const lines = (specialRequests || '').split('\n');
  const match = lines[0]?.match(/^Hora prevista de chegada:\s*(\d{2}:\d{2})$/);
  return {
    arrivalTime: match ? match[1] : null,
    notes: (match ? lines.slice(1) : lines).join('\n').trim(),
  };
}

// Caixa de dados em tabela com estilos em cada célula: os programas de email ignoram display:flex
const FONT = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;";
const BOX_OPEN = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0e8;border:1px solid #e8dcc8;border-radius:4px;margin:24px 0;border-collapse:separate"><tr><td style="padding:10px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">`;
const BOX_CLOSE = '</table></td></tr></table>';

function boxRow(label, value, isTotal = false) {
  const cell = `${FONT}padding:10px 0;vertical-align:top;${isTotal ? 'font-size:16px;font-weight:bold;' : 'font-size:14px;border-bottom:1px solid #e8dcc8;'}`;
  return `<tr><td style="${cell}color:#8b7355;padding-right:16px">${label}</td><td style="${cell}color:#2a2118;text-align:right">${value}</td></tr>`;
}

function stayRows(reservation, locale = 'pt') {
  const t = emailText(locale);
  const { arrivalTime } = splitSpecialRequests(reservation.specialRequests);
  return [
    boxRow(t.checkIn, `${formatDate(reservation.checkIn, locale)}, ${t.checkInTime}`),
    arrivalTime ? boxRow(t.arrivalTime, arrivalTime) : '',
    boxRow(t.checkOut, `${formatDate(reservation.checkOut, locale)}, ${t.checkOutTime}`),
  ].filter(Boolean).join('\n        ');
}

// Nome e telefone do pedido (reservas antigas só têm os do hóspede)
function guestContact(reservation) {
  return {
    ...reservation.guest,
    name: reservation.contactName || reservation.guest.name,
    phone: reservation.contactPhone || reservation.guest.phone,
  };
}

// Hóspedes por idade; reservas antigas só têm o total
function partyLabel(reservation, locale = 'pt') {
  const { party } = emailText(locale);
  const groups = ['adults', 'teens', 'children', 'infants']
    .filter(key => reservation[key] > 0)
    .map(key => `${reservation[key]} ${party[key][reservation[key] === 1 ? 0 : 1]}`);
  return groups.length ? groups.join(', ') : String(reservation.guests);
}

function euros(value) {
  return `€${Math.abs(value).toFixed(2)}`;
}

// Detalhe do preço guardado na reserva (reservas antigas não o têm)
function priceRows(reservation, locale = 'pt') {
  const t = emailText(locale);
  const quote = reservation.priceBreakdown;
  if (!quote) return '';
  const rows = [boxRow(t.accommodation, euros(quote.accommodation))];
  if (quote.guestAdjustment > 0) rows.push(boxRow(t.extraGuests, `+${euros(quote.guestAdjustment)}`));
  if (quote.guestAdjustment < 0) rows.push(boxRow(t.fewerGuests, `−${euros(quote.guestAdjustment)}`));
  if (quote.crib > 0) rows.push(boxRow(t.cot, euros(quote.crib)));
  if (quote.promotion) {
    rows.push(boxRow(`${t.promotion} «${escapeHtml(quote.promotion.name)}» (−${quote.promotion.discountPct}%)`, `−${euros(quote.promotion.discount)}`));
  }
  return rows.join('\n        ');
}

// Nota destacada para o hóspede quando a reserva tem promoção
function promotionNote(reservation, locale = 'pt') {
  const promotion = reservation.priceBreakdown?.promotion;
  if (!promotion) return '';
  return `<p>${emailText(locale).promotionNote(escapeHtml(promotion.name), promotion.discountPct, promotion.minNights, euros(promotion.discount))}</p>`;
}

function scheduleNote(locale = 'pt') {
  return `<p>${emailText(locale).schedule}</p>`;
}

function reference(reservation) {
  return reservation.id.slice(0, 8).toUpperCase();
}

function guestFooter(locale) {
  return `
    <div class="footer">
      <p>Casa do Ferreiro · Venda Nova, Montalegre, Portugal</p>
      <p>© ${new Date().getFullYear()} Casa do Ferreiro. ${emailText(locale).rights}</p>
    </div>`;
}

function baseTemplate(content, locale = 'pt') {
  return `
  <!DOCTYPE html>
  <html lang="${normalizeLocale(locale)}">
  <head><meta charset="UTF-8"><style>
    body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-variant-numeric: lining-nums; background: #f5f0e8; margin: 0; padding: 0; }
    /* Texto sem serifa: a Georgia desenha o 1 parecido com um I; o título continua em Georgia (não tem números) */
    .wrap { max-width: 580px; margin: 40px auto; background: #fdfaf5; border: 1px solid #e8dcc8; }
    .header { background: #2a2118; padding: 32px 40px; }
    .header h1 { font-family: Georgia, serif; color: #e8b87a; margin: 0; font-size: 24px; font-weight: normal; letter-spacing: 2px; }
    .header p { color: rgba(255,255,255,.5); margin: 4px 0 0; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
    .body { padding: 40px; }
    .body p { color: #5a4a38; line-height: 1.8; font-size: 15px; }
    .btn { display: inline-block; background: #c9893a; color: #fff; text-decoration: none; padding: 14px 32px; border-radius: 2px; font-size: 13px; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0; }
    .footer { background: #f5f0e8; padding: 20px 40px; border-top: 1px solid #e8dcc8; text-align: center; }
    .footer p { color: #8b7355; font-size: 12px; margin: 4px 0; }
  </style></head>
  <body><div class="wrap">${content}</div></body>
  </html>`;
}

async function sendReservationConfirmation(reservation) {
  const locale = normalizeLocale(reservation.locale);
  const t = emailText(locale);
  const guest = guestContact(reservation);
  const ref = reference(reservation);

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>${t.requestTitle}</p>
    </div>
    <div class="body">
      <p>${t.dear(escapeHtml(guest.name))}</p>
      <p>${t.requestIntro}</p>
      ${BOX_OPEN}
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${boxRow(t.nights, reservation.nights)}
        ${boxRow(t.guests, partyLabel(reservation, locale))}
        ${reservation.cribs > 0 ? boxRow(t.cribs, reservation.cribs) : ''}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice), true)}
      ${BOX_CLOSE}
      ${promotionNote(reservation, locale)}
      ${scheduleNote(locale)}
      <p>${t.requestNotConfirmed}</p>
      <p>${t.contactUs}</p>
      <p>📞 +351 938 750 239 &nbsp;|&nbsp; ✉ ${RESERVATIONS_EMAIL}</p>
    </div>
    ${guestFooter(locale)}
  `, locale);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: t.requestSubject(ref),
    html,
  });
}

async function sendReservationPaymentLink(reservation, checkoutUrl) {
  const locale = normalizeLocale(reservation.locale);
  const t = emailText(locale);
  const guest = guestContact(reservation);
  const ref = reference(reservation);
  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>${t.approvedTitle}</p>
    </div>
    <div class="body">
      <p>${t.dear(escapeHtml(guest.name))}</p>
      <p>${t.approvedIntro}</p>
      ${BOX_OPEN}
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice), true)}
      ${BOX_CLOSE}
      <p><a href="${checkoutUrl}" class="btn">${t.payButton}</a></p>
      ${reservation.paymentExpiresAt ? `<p>${t.linkValidUntil(formatDateTime(reservation.paymentExpiresAt, locale))}</p>` : ''}
      ${promotionNote(reservation, locale)}
      ${scheduleNote(locale)}
    </div>
    ${guestFooter(locale)}
  `, locale);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: t.approvedSubject(ref),
    html,
  });
}

async function sendReservationStatusUpdate(reservation, newStatus) {
  const locale = normalizeLocale(reservation.locale);
  const t = emailText(locale);
  const guest = guestContact(reservation);
  const ref = reference(reservation);
  const statusKey = newStatus === 'CANCELLED' && reservation.stripeRefundId ? 'CANCELLED_REFUND' : newStatus;
  const [label, message] = t.status[statusKey] || [newStatus, ''];
  const isDeclined = newStatus === 'DECLINED';
  const siteUrl = `${String(process.env.FRONTEND_URL || 'https://casadoferreirovn.pt').replace(/\/$/, '')}/${locale === 'pt' ? '' : `?lang=${locale}`}#availability`;

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>${isDeclined ? t.declined.title : t.updateTitle(label)}</p>
    </div>
    <div class="body">
      <p>${t.dear(escapeHtml(guest.name))}</p>
      <p>${isDeclined ? t.declined.message : message}</p>
      ${BOX_OPEN}
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice), true)}
      ${BOX_CLOSE}
      ${['CONFIRMED', 'PAID'].includes(newStatus) ? promotionNote(reservation, locale) + scheduleNote(locale) : ''}
      ${isDeclined ? `<p>${t.declined.invite}</p><p><a href="${siteUrl}" class="btn">${t.declined.button}</a></p>` : ''}
    </div>
    ${guestFooter(locale)}
  `, locale);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: isDeclined ? t.declined.subject(ref) : t.updateSubject(label, ref),
    html,
  });
}

// Aviso ao proprietário: pedido novo (a aprovar) ou pagamento recebido (reserva confirmada)
async function sendAdminNotification(reservation) {
  const { room } = reservation;
  const guest = guestContact(reservation);
  const { notes } = splitSpecialRequests(reservation.specialRequests);
  const isPaid = reservation.status === 'PAID';
  const ref = reservation.id.slice(0, 8).toUpperCase();
  const adminUrl = `${String(process.env.FRONTEND_URL || 'https://casadoferreirovn.pt').replace(/\/$/, '')}/admin.html`;

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>${isPaid ? 'Pagamento recebido' : 'Novo pedido de reserva'}</p>
    </div>
    <div class="body">
      <p>${isPaid
        ? 'O hóspede pagou e a reserva está confirmada. As datas já estão ocupadas no calendário.'
        : 'Foi recebido um novo pedido de reserva que aguarda aprovação.'}</p>
      ${BOX_OPEN}
        ${boxRow('Referência', `#${reservation.id.slice(0,8).toUpperCase()}`)}
        ${boxRow('Hóspede', `${escapeHtml(guest.name)}`)}
        ${boxRow('Email', `${escapeHtml(guest.email)}`)}
        ${boxRow('Telefone', `${escapeHtml(guest.phone || '—')}`)}
        ${boxRow('Idioma', `${LANGUAGE_NAMES[normalizeLocale(reservation.locale)]}`)}
        ${boxRow('Quarto', `${room.name}`)}
        ${stayRows(reservation)}
        ${boxRow('Hóspedes', `${partyLabel(reservation)}`)}
        ${reservation.infants > 0 ? `${boxRow('Berços', `${reservation.cribs > 0 ? reservation.cribs : '0 (traz berço próprio)'}`)}` : ''}
        ${priceRows(reservation)}
        ${notes ? `${boxRow('Observações', `${escapeHtml(notes).replace(/\n/g, '<br>')}`)}` : ''}
        ${boxRow('Total', `€${reservation.totalPrice.toFixed(2)}`, true)}
      ${BOX_CLOSE}
      ${isPaid ? closeDatesReminder(reservation) : ''}
      <a href="${adminUrl}" class="btn">Ver no Painel</a>
    </div>
    <div class="footer"><p>Casa do Ferreiro · Painel de Gestão</p></div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: RESERVATIONS_EMAIL,
    subject: isPaid
      ? `Reserva paga #${ref}: ${String(guest.name).replace(/[\r\n]/g, ' ')} — ${room.name}`
      : `Novo pedido de reserva: ${String(guest.name).replace(/[\r\n]/g, ' ')} — ${room.name}`,
    html,
  });
}

// Data curta em português (ex.: "ter., 3 nov.")
function shortDate(date) {
  return new Date(date).toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

const NOTICE_STYLE = "font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;border-radius:4px;padding:16px 20px;margin:24px 0;font-size:14px;line-height:1.6";

// Caixa no email "Reserva paga": o Booking/Airbnb só leem o calendário do site de poucas em poucas horas
function closeDatesReminder(reservation) {
  return `<div style="${NOTICE_STYLE};background:#fff7e6;border:1px solid #f0c987;color:#5a4a38">
    <strong style="color:#2a2118">📅 Feche estas datas no Booking e no Airbnb</strong><br>
    Entrada ${shortDate(reservation.checkIn)} → saída ${shortDate(reservation.checkOut)} · ${escapeHtml(reservation.room.name)}<br>
    O Booking e o Airbnb leem o calendário do site de poucas em poucas horas. Fechar já as datas nas apps evita uma reserva duplicada nesse intervalo.
  </div>`;
}

// Aviso urgente: depois do pagamento, o Booking/Airbnb mostram noites ocupadas nesta estadia
async function sendDoubleBookingAlert(reservation, conflicts) {
  const guest = guestContact(reservation);
  const ref = reservation.id.slice(0, 8).toUpperCase();
  const adminUrl = `${String(process.env.FRONTEND_URL || 'https://casadoferreirovn.pt').replace(/\/$/, '')}/admin.html`;
  const platforms = [...new Set(conflicts.map(conflict => conflict.source))].join(' e ');
  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>⚠ Possível reserva duplicada</p>
    </div>
    <div class="body">
      <p>A reserva <strong>#${ref}</strong> foi paga no site, mas o calendário do ${platforms} indica noites ocupadas na mesma casa e nas mesmas datas. Verifique de imediato.</p>
      ${BOX_OPEN}
        ${boxRow('Referência', `#${ref}`)}
        ${boxRow('Hóspede (site)', `${escapeHtml(guest.name)} · ${escapeHtml(guest.email)} · ${escapeHtml(guest.phone || '—')}`)}
        ${boxRow('Casa', escapeHtml(reservation.room.name))}
        ${boxRow('Estadia', `${shortDate(reservation.checkIn)} → ${shortDate(reservation.checkOut)}`)}
        ${boxRow('Noites em conflito', conflicts.map(conflict => `${shortDate(`${conflict.date}T00:00:00Z`)} (${conflict.source})`).join('<br>'))}
      ${BOX_CLOSE}
      <p>Se for mesmo uma reserva duplicada, contacte um dos hóspedes para encontrar uma solução. Para devolver o pagamento do site, cancele a reserva no painel: o reembolso é feito automaticamente.</p>
      <a href="${adminUrl}" class="btn">Abrir o painel</a>
    </div>
    <div class="footer"><p>Casa do Ferreiro · Painel de Gestão</p></div>
  `);
  await sendMail({
    from: process.env.EMAIL_FROM,
    to: RESERVATIONS_EMAIL,
    subject: `⚠ Possível reserva duplicada #${ref} — ${reservation.room.name}`,
    html,
  });
}

async function sendContactMessage({ name, email, phone, message }) {
  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Nova mensagem de contacto</p>
    </div>
    <div class="body">
      <p>Foi enviada uma mensagem através do formulário de contacto do site. Pode responder diretamente a este email.</p>
      ${BOX_OPEN}
        ${boxRow('Nome', `${escapeHtml(name)}`)}
        ${boxRow('Email', `${escapeHtml(email)}`)}
        ${boxRow('Telefone', `${escapeHtml(phone || '—')}`)}
      ${BOX_CLOSE}
      <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
    </div>
    <div class="footer"><p>Casa do Ferreiro · Formulário de contacto</p></div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: RESERVATIONS_EMAIL,
    replyTo: `"${name.replace(/["\r\n]/g, '')}" <${email}>`,
    subject: `Mensagem de contacto: ${name.replace(/[\r\n]/g, ' ')}`,
    html,
  });
}

module.exports = {
  sendDoubleBookingAlert,
  sendContactMessage,
  sendReservationConfirmation,
  sendReservationPaymentLink,
  sendReservationStatusUpdate,
  sendAdminNotification,
};
