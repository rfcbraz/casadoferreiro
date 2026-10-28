// Casa do Ferreiro — página de avaliação (depois de common.js). Idioma = idioma da reserva.
const REVIEW_TEXT = {
  pt: {
    loading: 'A carregar…', errorTitle: 'Não foi possível abrir a avaliação', backToSite: 'Voltar ao site',
    thanksTitle: 'Obrigado pela sua avaliação!', thanksText: 'A sua opinião ajuda-nos a melhorar e a receber cada vez melhor os nossos hóspedes. Esperamos voltar a vê-lo/a em breve.',
    hello: 'Olá', overall: 'Como avalia a sua estadia?', cleanliness: 'Limpeza', comfort: 'Conforto', location: 'Localização',
    commentLabel: 'O que mais gostou? O que podemos melhorar?', consent: 'Autorizo a publicação desta avaliação no site, com o nome',
    submit: 'Enviar avaliação', sending: 'A enviar…', stars: n => `${n} ${n === 1 ? 'estrela' : 'estrelas'}`,
    stay: (room, from, to) => `${room} · ${from} a ${to}`, chooseStars: 'Escolha de 1 a 5 estrelas para a estadia.',
    alreadyTitle: 'Esta estadia já foi avaliada', alreadyText: 'Já recebemos a sua avaliação. Obrigado!',
    invalidLink: 'Este link de avaliação não é válido. Use o link que recebeu por email.', network: 'Não foi possível ligar ao servidor. Tente novamente dentro de momentos.',
    title: 'Avaliar a estadia · Casa do Ferreiro',
  },
  en: {
    loading: 'Loading…', errorTitle: 'We could not open the review', backToSite: 'Back to the website',
    thanksTitle: 'Thank you for your review!', thanksText: 'Your feedback helps us improve and welcome our guests even better. We hope to see you again soon.',
    hello: 'Hello', overall: 'How would you rate your stay?', cleanliness: 'Cleanliness', comfort: 'Comfort', location: 'Location',
    commentLabel: 'What did you enjoy most? What could we improve?', consent: 'I agree to this review being published on the website under the name',
    submit: 'Send review', sending: 'Sending…', stars: n => `${n} ${n === 1 ? 'star' : 'stars'}`,
    stay: (room, from, to) => `${room} · ${from} to ${to}`, chooseStars: 'Please choose 1 to 5 stars for your stay.',
    alreadyTitle: 'This stay has already been reviewed', alreadyText: 'We have already received your review. Thank you!',
    invalidLink: 'This review link is not valid. Please use the link you received by email.', network: 'We could not reach the server. Please try again in a moment.',
    title: 'Review your stay · Casa do Ferreiro',
  },
  es: {
    loading: 'Cargando…', errorTitle: 'No se ha podido abrir la valoración', backToSite: 'Volver a la web',
    thanksTitle: '¡Gracias por su valoración!', thanksText: 'Su opinión nos ayuda a mejorar y a recibir cada vez mejor a nuestros huéspedes. Esperamos volver a verle pronto.',
    hello: 'Hola', overall: '¿Cómo valora su estancia?', cleanliness: 'Limpieza', comfort: 'Comodidad', location: 'Ubicación',
    commentLabel: '¿Qué es lo que más le gustó? ¿Qué podemos mejorar?', consent: 'Autorizo la publicación de esta valoración en la web, con el nombre',
    submit: 'Enviar valoración', sending: 'Enviando…', stars: n => `${n} ${n === 1 ? 'estrella' : 'estrellas'}`,
    stay: (room, from, to) => `${room} · del ${from} al ${to}`, chooseStars: 'Elija de 1 a 5 estrellas para su estancia.',
    alreadyTitle: 'Esta estancia ya ha sido valorada', alreadyText: 'Ya hemos recibido su valoración. ¡Gracias!',
    invalidLink: 'Este enlace de valoración no es válido. Utilice el enlace que recibió por correo.', network: 'No se ha podido conectar con el servidor. Inténtelo de nuevo en unos momentos.',
    title: 'Valorar la estancia · Casa do Ferreiro',
  },
};
const DATE_LOCALE = { pt: 'pt-PT', en: 'en-GB', es: 'es-ES' };

const params = new URLSearchParams(location.search);
const reservationId = params.get('r') || '';
const signature = params.get('sig') || '';
// Idioma provisório (do browser) até chegar o da reserva
let lang = ['pt', 'en', 'es'].includes((navigator.language || '').slice(0, 2)) ? navigator.language.slice(0, 2) : 'pt';
const text = () => REVIEW_TEXT[lang];
const ratings = { rating: 0, cleanliness: 0, comfort: 0, location: 0 };

function applyLanguage() {
  document.documentElement.lang = lang;
  document.title = text().title;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = text()[el.dataset.i18n]; });
  document.querySelectorAll('.star-input button').forEach(button => button.setAttribute('aria-label', text().stars(Number(button.dataset.value))));
}

function show(id) {
  ['review-loading', 'review-error', 'review-done', 'review-form'].forEach(other => { document.getElementById(other).hidden = other !== id; });
}

function showError(message) {
  document.getElementById('review-error-text').textContent = message;
  show('review-error');
}

// Estrelas clicáveis (também por teclado: setas e Enter)
function buildStars() {
  document.querySelectorAll('.star-input').forEach(container => {
    const name = container.dataset.name;
    container.setAttribute('role', 'radiogroup');
    for (let value = 1; value <= 5; value++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = '★';
      button.dataset.value = value;
      button.setAttribute('role', 'radio');
      button.addEventListener('click', () => { ratings[name] = ratings[name] === value && name !== 'rating' ? 0 : value; paint(container); });
      button.addEventListener('mouseenter', () => paint(container, value));
      button.addEventListener('keydown', event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { ratings[name] = Math.min(5, (ratings[name] || 0) + 1); paint(container); container.children[ratings[name] - 1].focus(); event.preventDefault(); }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { ratings[name] = Math.max(1, (ratings[name] || 1) - 1); paint(container); container.children[ratings[name] - 1].focus(); event.preventDefault(); }
      });
      container.appendChild(button);
    }
    container.addEventListener('mouseleave', () => paint(container));
  });
}

function paint(container, hover) {
  const value = hover || ratings[container.dataset.name];
  [...container.children].forEach((button, index) => {
    button.classList.toggle('on', index < value);
    button.setAttribute('aria-checked', String(index + 1 === ratings[container.dataset.name]));
  });
}

const formatDay = value => new Date(`${value}T00:00:00Z`).toLocaleDateString(DATE_LOCALE[lang], { day: 'numeric', month: 'long', timeZone: 'UTC' });

async function loadForm() {
  applyLanguage();
  if (!reservationId || !signature) { showError(text().invalidLink); return; }
  try {
    const res = await fetchWithRetry(`${API}/reviews/form?r=${encodeURIComponent(reservationId)}&sig=${encodeURIComponent(signature)}`);
    const data = await res.json();
    if (!res.ok) { showError(res.status === 403 || res.status === 404 ? text().invalidLink : data.error); return; }
    lang = REVIEW_TEXT[data.locale] ? data.locale : 'pt';
    applyLanguage();
    if (data.alreadyReviewed) {
      document.querySelector('#review-done h1').textContent = text().alreadyTitle;
      document.querySelector('#review-done p').textContent = text().alreadyText;
      show('review-done');
      return;
    }
    document.getElementById('review-first-name').textContent = data.firstName;
    document.getElementById('review-display-name').textContent = data.displayName;
    document.getElementById('review-stay').textContent = text().stay(data.roomName, formatDay(data.checkIn), formatDay(data.checkOut));
    show('review-form');
  } catch (err) {
    showError(text().network);
  }
}

document.getElementById('review-form').addEventListener('submit', async event => {
  event.preventDefault();
  const errorEl = document.getElementById('review-form-error');
  errorEl.textContent = '';
  if (!ratings.rating) { errorEl.textContent = text().chooseStars; return; }
  const button = event.submitter || document.querySelector('.review-submit');
  button.disabled = true;
  button.textContent = text().sending;
  try {
    const res = await fetch(`${API}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        r: reservationId,
        sig: signature,
        rating: ratings.rating,
        cleanliness: ratings.cleanliness || null,
        comfort: ratings.comfort || null,
        location: ratings.location || null,
        comment: document.getElementById('review-comment').value,
        consent: document.getElementById('review-consent').checked,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) { show('review-done'); return; }
    if (res.status === 409) {
      document.querySelector('#review-done h1').textContent = text().alreadyTitle;
      document.querySelector('#review-done p').textContent = text().alreadyText;
      show('review-done');
      return;
    }
    errorEl.textContent = data.error || text().network;
  } catch (err) {
    errorEl.textContent = text().network;
  } finally {
    button.disabled = false;
    button.textContent = text().submit;
  }
});

buildStars();
loadForm();
