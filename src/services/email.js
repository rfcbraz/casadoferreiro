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

function boxRow(label, value) {
  return `<div class="box-row"><span class="box-label">${label}</span><span class="box-value">${value}</span></div>`;
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
    body { font-family: Georgia, serif; background: #f5f0e8; margin: 0; padding: 0; }
    .wrap { max-width: 580px; margin: 40px auto; background: #fdfaf5; border: 1px solid #e8dcc8; }
    .header { background: #2a2118; padding: 32px 40px; }
    .header h1 { font-family: Georgia, serif; color: #e8b87a; margin: 0; font-size: 24px; font-weight: normal; letter-spacing: 2px; }
    .header p { color: rgba(255,255,255,.5); margin: 4px 0 0; font-size: 12px; letter-spacing: 1px; text-transform: uppercase; }
    .body { padding: 40px; }
    .body p { color: #5a4a38; line-height: 1.8; font-size: 15px; }
    .box { background: #f5f0e8; border: 1px solid #e8dcc8; border-radius: 4px; padding: 20px 24px; margin: 24px 0; }
    .box-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #e8dcc8; font-size: 14px; }
    .box-row:last-child { border-bottom: none; font-weight: bold; font-size: 16px; }
    .box-label { color: #8b7355; }
    .box-value { color: #2a2118; }
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
      <div class="box">
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${boxRow(t.nights, reservation.nights)}
        ${boxRow(t.guests, partyLabel(reservation, locale))}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice))}
      </div>
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
      <div class="box">
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice))}
      </div>
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
      <div class="box">
        ${boxRow(t.reference, `#${ref}`)}
        ${boxRow(t.unit, escapeHtml(reservation.room.name))}
        ${stayRows(reservation, locale)}
        ${priceRows(reservation, locale)}
        ${boxRow(t.total, euros(reservation.totalPrice))}
      </div>
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
      <div class="box">
        <div class="box-row"><span class="box-label">Referência</span><span class="box-value">#${reservation.id.slice(0,8).toUpperCase()}</span></div>
        <div class="box-row"><span class="box-label">Hóspede</span><span class="box-value">${escapeHtml(guest.name)}</span></div>
        <div class="box-row"><span class="box-label">Email</span><span class="box-value">${escapeHtml(guest.email)}</span></div>
        <div class="box-row"><span class="box-label">Telefone</span><span class="box-value">${escapeHtml(guest.phone || '—')}</span></div>
        <div class="box-row"><span class="box-label">Idioma</span><span class="box-value">${LANGUAGE_NAMES[normalizeLocale(reservation.locale)]}</span></div>
        <div class="box-row"><span class="box-label">Quarto</span><span class="box-value">${room.name}</span></div>
        ${stayRows(reservation)}
        <div class="box-row"><span class="box-label">Hóspedes</span><span class="box-value">${partyLabel(reservation)}</span></div>
        ${priceRows(reservation)}
        <div class="box-row"><span class="box-label">Total</span><span class="box-value">€${reservation.totalPrice.toFixed(2)}</span></div>
        ${notes ? `<div class="box-row"><span class="box-label">Observações</span><span class="box-value">${escapeHtml(notes).replace(/\n/g, '<br>')}</span></div>` : ''}
      </div>
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

async function sendContactMessage({ name, email, phone, message }) {
  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Nova mensagem de contacto</p>
    </div>
    <div class="body">
      <p>Foi enviada uma mensagem através do formulário de contacto do site. Pode responder diretamente a este email.</p>
      <div class="box">
        <div class="box-row"><span class="box-label">Nome</span><span class="box-value">${escapeHtml(name)}</span></div>
        <div class="box-row"><span class="box-label">Email</span><span class="box-value">${escapeHtml(email)}</span></div>
        <div class="box-row"><span class="box-label">Telefone</span><span class="box-value">${escapeHtml(phone || '—')}</span></div>
      </div>
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
  sendContactMessage,
  sendReservationConfirmation,
  sendReservationPaymentLink,
  sendReservationStatusUpdate,
  sendAdminNotification,
};
