// src/services/email.js
const nodemailer = require('nodemailer');

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

function formatDate(date) {
  return new Date(date).toLocaleDateString('pt-PT', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

// Todos os avisos (novas reservas e contactos) e respostas dos hóspedes vão para este email
const RESERVATIONS_EMAIL = process.env.NOTIFICATION_EMAIL || 'reservas@casadoferreirovn.pt';

const CHECK_IN_TIME = 'a partir das 16:00';
const CHECK_OUT_TIME = 'até às 11:00';

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

function stayRows(reservation) {
  const { arrivalTime } = splitSpecialRequests(reservation.specialRequests);
  return `
        <div class="box-row"><span class="box-label">Check-in</span><span class="box-value">${formatDate(reservation.checkIn)}, ${CHECK_IN_TIME}</span></div>
        ${arrivalTime ? `<div class="box-row"><span class="box-label">Hora prevista de chegada</span><span class="box-value">${arrivalTime}</span></div>` : ''}
        <div class="box-row"><span class="box-label">Check-out</span><span class="box-value">${formatDate(reservation.checkOut)}, ${CHECK_OUT_TIME}</span></div>`;
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
function partyLabel(reservation) {
  const groups = [
    [reservation.adults, 'adulto', 'adultos'],
    [reservation.teens, 'jovem (7–17)', 'jovens (7–17)'],
    [reservation.children, 'criança (3–6)', 'crianças (3–6)'],
    [reservation.infants, 'bebé (0–2)', 'bebés (0–2)'],
  ].filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${count === 1 ? one : many}`);
  return groups.length ? groups.join(', ') : String(reservation.guests);
}

function euros(value) {
  return `€${Math.abs(value).toFixed(2)}`;
}

// Detalhe do preço guardado na reserva (reservas antigas não o têm)
function priceRows(reservation) {
  const quote = reservation.priceBreakdown;
  if (!quote) return '';
  const row = (label, value) => `<div class="box-row"><span class="box-label">${label}</span><span class="box-value">${value}</span></div>`;
  const rows = [row('Alojamento', euros(quote.accommodation))];
  if (quote.guestAdjustment > 0) rows.push(row('Pessoas a mais', `+${euros(quote.guestAdjustment)}`));
  if (quote.guestAdjustment < 0) rows.push(row('Desconto por pessoas a menos', `−${euros(quote.guestAdjustment)}`));
  if (quote.crib > 0) rows.push(row('Berço', euros(quote.crib)));
  if (quote.promotion) {
    rows.push(row(`Promoção «${escapeHtml(quote.promotion.name)}» (−${quote.promotion.discountPct}%)`, `−${euros(quote.promotion.discount)}`));
  }
  return rows.join('\n        ');
}

// Nota destacada para o hóspede quando a reserva tem promoção
function promotionNote(reservation) {
  const promotion = reservation.priceBreakdown?.promotion;
  if (!promotion) return '';
  return `<p>🎉 <strong>Promoção «${escapeHtml(promotion.name)}»:</strong> ${promotion.discountPct}% de desconto em estadias de ${promotion.minNights} ou mais noites. Nesta reserva poupou ${euros(promotion.discount)}.</p>`;
}

const SCHEDULE_NOTE = `<p>Check-in ${CHECK_IN_TIME}, à hora que lhe for mais conveniente. Check-out ${CHECK_OUT_TIME}.</p>`;

function baseTemplate(content) {
  return `
  <!DOCTYPE html>
  <html lang="pt">
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
  const { room } = reservation;
  const guest = guestContact(reservation);
  const nights = reservation.nights;

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Pedido de Reserva Recebido</p>
    </div>
    <div class="body">
      <p>Caro/a <strong>${escapeHtml(guest.name)}</strong>,</p>
      <p>O seu pedido foi recebido e será analisado pelo proprietário. Se for aprovado, receberá um link para pagar e confirmar a reserva.</p>
      <div class="box">
        <div class="box-row"><span class="box-label">Referência</span><span class="box-value">#${reservation.id.slice(0,8).toUpperCase()}</span></div>
        <div class="box-row"><span class="box-label">Quarto</span><span class="box-value">${room.name}</span></div>
        ${stayRows(reservation)}
        <div class="box-row"><span class="box-label">Noites</span><span class="box-value">${nights}</span></div>
        <div class="box-row"><span class="box-label">Hóspedes</span><span class="box-value">${partyLabel(reservation)}</span></div>
        ${priceRows(reservation)}
        <div class="box-row"><span class="box-label">Total</span><span class="box-value">€${reservation.totalPrice.toFixed(2)}</span></div>
      </div>
      ${promotionNote(reservation)}
      ${SCHEDULE_NOTE}
      <p>O envio deste pedido ainda não confirma a reserva.</p>
      <p>Para qualquer dúvida, contacte-nos:</p>
      <p>📞 +351 938 750 239 &nbsp;|&nbsp; ✉ ${RESERVATIONS_EMAIL}</p>
    </div>
    <div class="footer">
      <p>Casa do Ferreiro · Venda Nova, Montalegre, Portugal</p>
      <p>© 2026 Casa do Ferreiro. Todos os direitos reservados.</p>
    </div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: `Pedido de reserva recebido — Casa do Ferreiro #${reservation.id.slice(0,8).toUpperCase()}`,
    html,
  });
}

async function sendReservationPaymentLink(reservation, checkoutUrl) {
  const { room } = reservation;
  const guest = guestContact(reservation);
  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Reserva aprovada</p>
    </div>
    <div class="body">
      <p>Caro/a <strong>${escapeHtml(guest.name)}</strong>,</p>
      <p>O proprietário aprovou o seu pedido. Conclua o pagamento para confirmar definitivamente a reserva.</p>
      <div class="box">
        <div class="box-row"><span class="box-label">Referência</span><span class="box-value">#${reservation.id.slice(0,8).toUpperCase()}</span></div>
        <div class="box-row"><span class="box-label">Unidade</span><span class="box-value">${room.name}</span></div>
        ${stayRows(reservation)}
        ${priceRows(reservation)}
        <div class="box-row"><span class="box-label">Total</span><span class="box-value">€${reservation.totalPrice.toFixed(2)}</span></div>
      </div>
      <p><a href="${checkoutUrl}" class="btn">Pagar e confirmar reserva</a></p>
      <p>Este link é válido durante 35 minutos.</p>
      ${promotionNote(reservation)}
      ${SCHEDULE_NOTE}
    </div>
    <div class="footer"><p>Casa do Ferreiro · Venda Nova, Montalegre, Portugal</p></div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: `Pedido aprovado: conclua o pagamento — Casa do Ferreiro #${reservation.id.slice(0,8).toUpperCase()}`,
    html,
  });
}

async function sendReservationStatusUpdate(reservation, newStatus) {
  const { room } = reservation;
  const guest = guestContact(reservation);
  const cancellationMessage = reservation.stripeRefundId
    ? 'A sua reserva foi cancelada e foi solicitado o reembolso integral do pagamento. O prazo para o valor ficar disponível depende do banco emissor.'
    : 'A sua reserva foi cancelada. Lamentamos qualquer inconveniente.';
  const statusMessages = {
    CONFIRMED: { label: 'Confirmada ✓', msg: 'A sua reserva foi confirmada! Estamos ansiosos por recebê-lo/a.' },
    DECLINED:  { label: 'Recusada',      msg: 'Lamentamos informar que não foi possível confirmar a sua reserva para as datas solicitadas.' },
    CANCELLED: { label: 'Cancelada',     msg: cancellationMessage },
    PAID:      { label: 'Paga ✓',        msg: 'O pagamento foi processado com sucesso. Tudo pronto!' },
  };
  const info = statusMessages[newStatus] || { label: newStatus, msg: '' };

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Atualização de Reserva — ${info.label}</p>
    </div>
    <div class="body">
      <p>Caro/a <strong>${escapeHtml(guest.name)}</strong>,</p>
      <p>${info.msg}</p>
      <div class="box">
        <div class="box-row"><span class="box-label">Referência</span><span class="box-value">#${reservation.id.slice(0,8).toUpperCase()}</span></div>
        <div class="box-row"><span class="box-label">Quarto</span><span class="box-value">${room.name}</span></div>
        ${stayRows(reservation)}
        ${priceRows(reservation)}
        <div class="box-row"><span class="box-label">Total</span><span class="box-value">€${reservation.totalPrice.toFixed(2)}</span></div>
      </div>
      ${['CONFIRMED', 'PAID'].includes(newStatus) ? promotionNote(reservation) + SCHEDULE_NOTE : ''}
    </div>
    <div class="footer">
      <p>Casa do Ferreiro · Venda Nova, Montalegre, Portugal</p>
    </div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: guest.email,
    replyTo: RESERVATIONS_EMAIL,
    subject: `Reserva ${info.label} — Casa do Ferreiro`,
    html,
  });
}

async function sendAdminNotification(reservation) {
  const { room } = reservation;
  const guest = guestContact(reservation);
  const { notes } = splitSpecialRequests(reservation.specialRequests);

  const html = baseTemplate(`
    <div class="header">
      <h1>Casa do Ferreiro</h1>
      <p>Nova Reserva Recebida</p>
    </div>
    <div class="body">
      <p>Foi recebido um novo pedido de reserva que aguarda aprovação.</p>
      <div class="box">
        <div class="box-row"><span class="box-label">Referência</span><span class="box-value">#${reservation.id.slice(0,8).toUpperCase()}</span></div>
        <div class="box-row"><span class="box-label">Hóspede</span><span class="box-value">${escapeHtml(guest.name)}</span></div>
        <div class="box-row"><span class="box-label">Email</span><span class="box-value">${escapeHtml(guest.email)}</span></div>
        <div class="box-row"><span class="box-label">Telefone</span><span class="box-value">${escapeHtml(guest.phone || '—')}</span></div>
        <div class="box-row"><span class="box-label">Quarto</span><span class="box-value">${room.name}</span></div>
        ${stayRows(reservation)}
        <div class="box-row"><span class="box-label">Hóspedes</span><span class="box-value">${partyLabel(reservation)}</span></div>
        ${priceRows(reservation)}
        <div class="box-row"><span class="box-label">Total</span><span class="box-value">€${reservation.totalPrice.toFixed(2)}</span></div>
        ${notes ? `<div class="box-row"><span class="box-label">Observações</span><span class="box-value">${escapeHtml(notes).replace(/\n/g, '<br>')}</span></div>` : ''}
      </div>
      <a href="${process.env.FRONTEND_URL}/admin" class="btn">Ver no Painel</a>
    </div>
    <div class="footer"><p>Casa do Ferreiro · Painel de Gestão</p></div>
  `);

  await sendMail({
    from: process.env.EMAIL_FROM,
    to: RESERVATIONS_EMAIL,
    subject: `Novo pedido de reserva: ${String(guest.name).replace(/[\r\n]/g, ' ')} — ${room.name}`,
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
