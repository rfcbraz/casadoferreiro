// Verificação anti-robô Cloudflare Turnstile (formulários de reserva e de contacto)
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
let warnedMissingSecret = false;

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Sem chave configurada os formulários continuam a funcionar, mas sem esta proteção
    if (!warnedMissingSecret) {
      console.warn('⚠️  TURNSTILE_SECRET_KEY não definida: verificação anti-robô desativada.');
      warnedMissingSecret = true;
    }
    return { success: true, skipped: true };
  }
  if (typeof token !== 'string' || !token || token.length > 2048) return { success: false };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.append('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    if (!data.success) console.warn('Turnstile recusou o pedido:', data['error-codes']);
    return { success: data.success === true };
  } catch (err) {
    // Se a verificação não responder, recusa (mais seguro do que deixar passar)
    console.error('Erro ao verificar Turnstile:', err.message);
    return { success: false, unavailable: true };
  }
}

const TURNSTILE_ERROR = 'Não foi possível confirmar que não é um robô. Atualize a verificação e tente novamente.';

module.exports = { verifyTurnstile, TURNSTILE_ERROR };
