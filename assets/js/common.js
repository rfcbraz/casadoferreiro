// Casa do Ferreiro — código comum ao site e ao painel (carregar primeiro)
// ── Configuração da API ───────────────────────────────────
const API = 'https://casadaserra-production.up.railway.app/api';

// Pedidos de leitura com novas tentativas: o servidor pode demorar uns segundos a arrancar
// (depois de uma atualização ou de estar parado) e responder com erro ou não responder
const RETRY_DELAYS_MS = [1000, 2500, 5000];
async function fetchWithRetry(url, options = {}, delays = RETRY_DELAYS_MS) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (![502, 503, 504].includes(res.status) || attempt >= delays.length) return res;
    } catch (err) {
      if (attempt >= delays.length) throw err;
    }
    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
  }
}

// ── Datas em hora de Portugal ─────────────────────────────
function getPortugalDateString() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function shiftDateString(dateString, days) {
  const [year, month, day] = dateString.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().split('T')[0];
}

// ── Toast ─────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 4000);
}
