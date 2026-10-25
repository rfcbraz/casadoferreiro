// Gera uma página com todos os emails (modelos reais do servidor, dados fictícios), sem enviar nada.
// Uso: npm run emails  →  abre email-previews/index.html no browser
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'email-previews');

// Os emails passam pela API do Resend; aqui o envio é intercetado e guardado em vez de enviado
process.env.RESEND_API_KEY = 'pre-visualizacao';
process.env.EMAIL_FROM = 'Casa do Ferreiro <reservas@casadoferreirovn.pt>';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'https://casadoferreirovn.pt';
const captured = [];
global.fetch = async (url, options) => {
  captured.push(JSON.parse(options.body));
  return { ok: true, json: async () => ({ id: 'pre-visualizacao' }) };
};

const email = require('../src/services/email');

const day = offset => {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offset);
  return date;
};

const sample = {
  id: 'a1b2c3d4-0000-4000-8000-000000000000',
  status: 'PENDING',
  checkIn: day(21),
  checkOut: day(27),
  nights: 6,
  guests: 5,
  adults: 2,
  teens: 1,
  children: 1,
  infants: 1,
  cribs: 1,
  totalPrice: 1031.4,
  contactName: 'Maria Silva',
  contactPhone: '+351912345678',
  specialRequests: 'Hora prevista de chegada: 18:30\nViajamos com um bebé, agradecíamos o berço montado.',
  priceBreakdown: {
    accommodation: 1080,
    guestAdjustment: 60,
    crib: 30,
    promotion: { name: 'Estadia longa', discountPct: 10, minNights: 5, discount: -114 },
    total: 1031.4,
  },
  paymentExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000 - 5 * 60 * 1000),
  room: { name: 'Casa do Ferreiro T2' },
  guest: { name: 'Maria Silva', email: 'maria.silva@example.com', phone: '+351912345678' },
};

const LANGUAGES = { pt: 'Português', en: 'English', es: 'Español' };
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/exemplo';

async function generate() {
  const previews = [];
  const add = async (group, title, language, send) => {
    const before = captured.length;
    await send();
    const message = captured[before];
    previews.push({ group, title, language, subject: message.subject, to: message.to.join(', '), html: message.html });
  };

  for (const [locale, languageName] of Object.entries(LANGUAGES)) {
    const reservation = { ...sample, locale };
    const group = `Hóspede · ${languageName}`;
    await add(group, '1. Pedido recebido', locale, () => email.sendReservationConfirmation(reservation));
    await add(group, '2. Pedido aprovado (link de pagamento)', locale, () => email.sendReservationPaymentLink({ ...reservation, status: 'AWAITING_PAYMENT' }, CHECKOUT_URL));
    await add(group, '3. Pagamento recebido', locale, () => email.sendReservationStatusUpdate({ ...reservation, status: 'PAID' }, 'PAID'));
    await add(group, '4. Pedido recusado', locale, () => email.sendReservationStatusUpdate({ ...reservation, status: 'DECLINED' }, 'DECLINED'));
    await add(group, '5. Reserva cancelada', locale, () => email.sendReservationStatusUpdate({ ...reservation, status: 'CANCELLED' }, 'CANCELLED'));
    await add(group, '6. Cancelada com reembolso', locale, () => email.sendReservationStatusUpdate({ ...reservation, status: 'CANCELLED', stripeRefundId: 're_exemplo' }, 'CANCELLED'));
  }

  const owner = 'Proprietário (sempre em português)';
  await add(owner, 'Novo pedido de reserva', 'pt', () => email.sendAdminNotification({ ...sample, locale: 'en' }));
  await add(owner, 'Reserva paga', 'pt', () => email.sendAdminNotification({ ...sample, locale: 'en', status: 'PAID' }));
  await add(owner, 'Possível reserva duplicada', 'pt', () => email.sendDoubleBookingAlert({ ...sample, status: 'PAID' }, [
    { date: sample.checkIn.toISOString().slice(0, 10), source: 'Booking.com' },
  ]));
  await add(owner, 'Mensagem do formulário de contacto', 'pt', () => email.sendContactMessage({
    name: 'João Pereira',
    email: 'joao.pereira@example.com',
    phone: '+351 913 456 789',
    message: 'Olá! Gostaria de saber se aceitam animais de estimação e se há possibilidade de check-in mais cedo no dia 14.\n\nObrigado.',
  }));
  return previews;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function buildIndex(previews) {
  const groups = [...new Set(previews.map(preview => preview.group))];
  const nav = groups.map(group => `
      <h2>${escapeHtml(group)}</h2>
      ${previews.map((preview, index) => preview.group === group
        ? `<button type="button" data-index="${index}">${escapeHtml(preview.title)}</button>` : '').join('')}`).join('');
  const data = JSON.stringify(previews.map(({ html, ...rest }, index) => ({ ...rest, file: `${index}.html` })));
  return `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Emails · Casa do Ferreiro</title>
<style>
  :root{--dark:#2a2118;--cream:#f5f0e8;--warm:#e8dcc8;--accent:#c9893a;--muted:#7a6d5a}
  *{box-sizing:border-box;margin:0}
  body{font-family:system-ui,sans-serif;background:var(--cream);color:var(--dark);display:grid;grid-template-columns:280px 1fr;min-height:100vh}
  nav{background:var(--dark);color:#fff;padding:1.5rem 1rem;overflow-y:auto;max-height:100vh;position:sticky;top:0}
  nav h1{font-size:1.05rem;font-weight:600;margin-bottom:.25rem}
  nav p{font-size:.75rem;color:#c4b49a;margin-bottom:1.25rem;line-height:1.5}
  nav h2{font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:#e8b87a;margin:1.25rem 0 .4rem}
  nav button{display:block;width:100%;text-align:left;background:none;border:0;border-left:2px solid transparent;color:rgba(255,255,255,.7);padding:.45rem .6rem;font:inherit;font-size:.82rem;cursor:pointer}
  nav button:hover,nav button.active{color:#fff;background:rgba(255,255,255,.06);border-left-color:var(--accent)}
  main{padding:1.5rem;display:flex;flex-direction:column;gap:1rem;min-width:0}
  .meta{background:#fff;border:1px solid var(--warm);border-radius:6px;padding:1rem 1.25rem;font-size:.85rem;line-height:1.7}
  .meta strong{display:inline-block;width:5.5rem;color:var(--muted);font-weight:500}
  .toolbar{display:flex;gap:.5rem}
  .toolbar button{border:1px solid var(--warm);background:#fff;padding:.4rem .9rem;border-radius:4px;cursor:pointer;font:inherit;font-size:.8rem}
  .toolbar button.active{background:var(--dark);color:#fff;border-color:var(--dark)}
  .frame{flex:1;display:flex;justify-content:center}
  iframe{width:100%;max-width:760px;height:calc(100vh - 13rem);min-height:500px;border:1px solid var(--warm);border-radius:6px;background:#fff;transition:max-width .2s}
  iframe.mobile{max-width:390px}
  @media (max-width:760px){body{grid-template-columns:1fr}nav{position:static;max-height:none}}
</style>
</head>
<body>
<nav>
  <h1>Emails · Casa do Ferreiro</h1>
  <p>Pré-visualização com os modelos reais e dados fictícios. Nada foi enviado. Gerado em ${new Date().toLocaleString('pt-PT', { timeZone: 'Europe/Lisbon' })}.</p>
  ${nav}
</nav>
<main>
  <div class="meta" id="meta"></div>
  <div class="toolbar">
    <button type="button" class="active" data-width="desktop">Computador</button>
    <button type="button" data-width="mobile">Telemóvel</button>
  </div>
  <div class="frame"><iframe id="preview" title="Pré-visualização do email"></iframe></div>
</main>
<script>
  const previews = ${data};
  const iframe = document.getElementById('preview');
  const meta = document.getElementById('meta');
  const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function show(index) {
    const preview = previews[index];
    iframe.src = preview.file;
    meta.innerHTML = '<div><strong>Assunto</strong>' + esc(preview.subject) + '</div><div><strong>Para</strong>' + esc(preview.to) + '</div>';
    document.querySelectorAll('nav button').forEach(button => button.classList.toggle('active', Number(button.dataset.index) === index));
  }
  document.querySelectorAll('nav button').forEach(button => button.addEventListener('click', () => show(Number(button.dataset.index))));
  document.querySelectorAll('.toolbar button').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('.toolbar button').forEach(other => other.classList.toggle('active', other === button));
    iframe.classList.toggle('mobile', button.dataset.width === 'mobile');
  }));
  show(0);
</script>
</body>
</html>`;
}

generate().then(previews => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  previews.forEach((preview, index) => fs.writeFileSync(path.join(OUT_DIR, `${index}.html`), preview.html));
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildIndex(previews));
  console.log(`✓ ${previews.length} emails gerados. Abra ${path.join(OUT_DIR, 'index.html')}`);
}).catch(err => {
  console.error('Erro ao gerar os emails:', err);
  process.exit(1);
});
