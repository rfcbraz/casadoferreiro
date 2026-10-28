// Casa do Ferreiro — site público (depois de common.js e translations.js)
const MINIMUM_STAY_NIGHTS = 2;
let currentLanguage = (() => {
  const queryLanguage = new URLSearchParams(window.location.search).get('lang');
  if (['pt', 'en', 'es'].includes(queryLanguage)) return queryLanguage;
  const savedLanguage = localStorage.getItem('casadaserra-language');
  return ['pt', 'en', 'es'].includes(savedLanguage) ? savedLanguage : 'pt';
})();
const originalTextNodes = new WeakMap();
const originalAttributes = new WeakMap();

function translateText(value) {
  const leadingWhitespace = value.match(/^\s*/)[0];
  const trailingWhitespace = value.match(/\s*$/)[0];
  const source = value.slice(leadingWhitespace.length, value.length - trailingWhitespace.length);
  const translated = translations[currentLanguage]?.[source];
  return translated === undefined ? value : `${leadingWhitespace}${translated}${trailingWhitespace}`;
}

function translateTemplate(value, parameters = {}) {
  return Object.entries(parameters).reduce(
    (message, [key, parameter]) => message.replaceAll(`{{${key}}}`, parameter),
    translateText(value)
  );
}

function translateSubtree(root) {
  if (root.nodeType === Node.ELEMENT_NODE
    && (root.closest('.admin-panel') || root.closest('#admin-login-modal'))) return;
  if (root.nodeType === Node.TEXT_NODE) {
    if (root.parentElement?.closest('.admin-panel, #admin-login-modal')) return;
    const original = originalTextNodes.get(root) ?? root.nodeValue;
    originalTextNodes.set(root, original);
    root.nodeValue = translateText(original);
    return;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach(node => {
    if (node.parentElement?.closest('.admin-panel, #admin-login-modal')) return;
    const original = originalTextNodes.get(node) ?? node.nodeValue;
    originalTextNodes.set(node, original);
    node.nodeValue = translateText(original);
  });

  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll('*')] : [];
  elements.forEach(element => {
    if (element.closest('.admin-panel, #admin-login-modal')) return;
    const attributes = originalAttributes.get(element) || new Map();
    ['aria-label', 'aria-labelledby', 'alt', 'placeholder', 'title'].forEach(attribute => {
      if (!element.hasAttribute(attribute)) return;
      const original = attributes.has(attribute) ? attributes.get(attribute) : element.getAttribute(attribute);
      attributes.set(attribute, original);
      element.setAttribute(attribute, translateText(original));
    });
    originalAttributes.set(element, attributes);
  });
}

function initializeLanguage() {
  document.documentElement.lang = currentLanguage;
  const toggle = document.getElementById('language-toggle');
  const control = toggle.closest('.language-control');
  const currentFlag = document.getElementById('language-current-flag');
  const currentCode = document.getElementById('language-current-code');
  const menu = document.getElementById('language-menu');
  const languageFlags = {
    pt: '<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg"><rect width="12" height="20" fill="#046a38"/><rect x="12" width="18" height="20" fill="#da291c"/><circle cx="12" cy="10" r="4.2" fill="#ffcd00"/><circle cx="12" cy="10" r="2.8" fill="#fff"/><path d="M9.8 8.5h4.4v3H9.8z" fill="#da291c"/></svg>',
    en: '<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg"><rect width="30" height="20" fill="#012169"/><path d="m0 0 30 20m0-20L0 20" stroke="#fff" stroke-width="5"/><path d="m0 0 30 20m0-20L0 20" stroke="#c8102e" stroke-width="2"/><path d="M15 0v20M0 10h30" stroke="#fff" stroke-width="8"/><path d="M15 0v20M0 10h30" stroke="#c8102e" stroke-width="4"/></svg>',
    es: '<svg viewBox="0 0 30 20" xmlns="http://www.w3.org/2000/svg"><rect width="30" height="20" fill="#aa151b"/><rect y="5" width="30" height="10" fill="#f1bf00"/><path d="M9 7h2.5v6H9z" fill="#ad1519"/><path d="M8.5 8h3.5v3H8.5z" fill="#f1bf00"/><path d="M9.5 8.5h1.5v2h-1.5z" fill="#ad1519"/></svg>',
  };
  const languages = [
    { code: 'pt', name: 'Português' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
  ];
  const closeMenu = returnFocus => {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (returnFocus) toggle.focus();
  };
  const openMenu = focusSelected => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (focusSelected) {
      menu.querySelector('[aria-checked="true"]').focus();
    }
  };
  const selectLanguage = language => {
    closeMenu(false);
    if (language === currentLanguage) return;
    localStorage.setItem('casadaserra-language', language);
    const url = new URL(window.location.href);
    if (language === 'pt') url.searchParams.delete('lang');
    else url.searchParams.set('lang', language);
    window.location.assign(url.href);
  };
  currentFlag.innerHTML = languageFlags[currentLanguage];
  currentCode.textContent = currentLanguage.toUpperCase();
  menu.innerHTML = languages.filter(({ code }) => code !== currentLanguage).map(({ code, name }) => `
    <button class="language-option" type="button" role="menuitem" aria-label="${name}" data-language="${code}">
      ${languageFlags[code]}<span>${code.toUpperCase()}</span>
    </button>
  `).join('');
  translateSubtree(document.body);
  control.addEventListener('mouseenter', () => openMenu(false));
  control.addEventListener('mouseleave', () => {
    if (!control.contains(document.activeElement)) closeMenu(false);
  });
  toggle.addEventListener('click', () => {
    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      openMenu(false);
    } else if (menu.hidden) {
      openMenu(false);
    } else {
      closeMenu(false);
    }
  });
  toggle.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(true);
    }
  });
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-language]');
    if (option) selectLanguage(option.dataset.language);
  });
  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('[role="menuitem"]')];
    const index = options.indexOf(document.activeElement);
    let nextIndex;
    if (event.key === 'ArrowDown') nextIndex = (index + 1) % options.length;
    else if (event.key === 'ArrowUp') nextIndex = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu(true);
      return;
    } else return;
    event.preventDefault();
    options[nextIndex].focus();
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.language-control')) closeMenu(false);
  });
}

initializeLanguage();

const publicTranslationObserver = new MutationObserver(records => {
  records.forEach(record => {
    if (record.type === 'characterData') {
      const node = record.target;
      if (node.parentElement?.closest('.admin-panel, #admin-login-modal')) return;
      const original = originalTextNodes.get(node);
      if (original !== undefined && translateText(original) === node.nodeValue) return;
      originalTextNodes.set(node, node.nodeValue);
      node.nodeValue = translateText(node.nodeValue);
      return;
    }
    record.addedNodes.forEach(node => {
      if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE) translateSubtree(node);
    });
  });
});
publicTranslationObserver.observe(document.body, { childList: true, characterData: true, subtree: true });

let heroTitleCharacters = [];
let heroTitleAnimations = [];
let brandTitleCharacters = [];
let brandTitleAnimations = [];
const sectionTitleCharacters = new WeakMap();

function animateBrandTitle() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const title = document.querySelector('.nav-logo');
  if (!title || typeof Element.prototype.animate !== 'function') return 0;
  if (!brandTitleCharacters.length) {
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      Array.from(node.textContent).forEach(character => {
        const span = document.createElement('span');
        span.textContent = character;
        fragment.appendChild(span);
        brandTitleCharacters.push(span);
      });
      node.replaceWith(fragment);
    });
  }
  brandTitleAnimations.forEach(animation => animation.cancel());
  brandTitleAnimations = brandTitleCharacters.map((character, index) =>
    character.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 100, delay: index * 55, fill: 'both', easing: 'ease-out' }
    )
  );
  return Math.max(0, (brandTitleCharacters.length - 1) * 55 + 100);
}

function animateHeroTitle(startDelay = 0) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const title = document.querySelector('.hero h1');
  if (!title || typeof Element.prototype.animate !== 'function') return;
  if (!heroTitleCharacters.length) {
    const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      const isEmphasis = Boolean(node.parentElement.closest('em'));
      Array.from(node.textContent).forEach(character => {
        const span = document.createElement('span');
        if (isEmphasis) span.className = 'hero-title-emphasis-char';
        span.textContent = character;
        fragment.appendChild(span);
        heroTitleCharacters.push(span);
      });
      node.replaceWith(fragment);
    });
  }
  heroTitleAnimations.forEach(animation => animation.cancel());
  heroTitleAnimations = heroTitleCharacters.map((character, index) => {
    const isEmphasis = character.classList.contains('hero-title-emphasis-char');
    return character.animate(
      isEmphasis
        ? [{ opacity: 0, transform: 'scale(.75)' }, { opacity: 1, transform: 'scale(1.15)', offset: .72 }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: isEmphasis ? 360 : 100, delay: startDelay + index * 55, fill: 'both', easing: 'ease-out' }
    );
  });
}

function animateSectionText(element, startDelay = 0) {
  let characters = sectionTitleCharacters.get(element);
  if (!characters) {
    characters = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach(node => {
      const fragment = document.createDocumentFragment();
      const isEmphasis = Boolean(node.parentElement.closest('em'));
      Array.from(node.textContent.replace(/\s+/g, ' ')).forEach(character => {
        const span = document.createElement('span');
        if (isEmphasis) span.className = 'hero-title-emphasis-char';
        span.textContent = isEmphasis && character === ' ' ? '\u00a0' : character;
        fragment.appendChild(span);
        characters.push({ element: span, isEmphasis });
      });
      node.replaceWith(fragment);
    });
    sectionTitleCharacters.set(element, characters);
  }

  characters.forEach(({ element: character, isEmphasis }, index) => {
    character.animate(
      isEmphasis
        ? [{ opacity: 0, transform: 'scale(.75)' }, { opacity: 1, transform: 'scale(1.15)', offset: .72 }, { opacity: 1, transform: 'scale(1)' }]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: isEmphasis ? 360 : 100, delay: startDelay + index * 40, fill: 'both', easing: 'ease-out' }
    );
  });
  return characters.length ? startDelay + (characters.length - 1) * 40 + 360 : startDelay;
}

function observeSectionTitles() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const titles = document.querySelectorAll('.animated-section-title');
  if (!('IntersectionObserver' in window)) {
    titles.forEach(title => {
      const eyebrow = title.previousElementSibling;
      const nextDelay = eyebrow?.classList.contains('animated-section-eyebrow')
        ? animateSectionText(eyebrow)
        : 0;
      animateSectionText(title, nextDelay);
    });
    return;
  }

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const title = entry.target;
      const eyebrow = title.previousElementSibling;
      const nextDelay = eyebrow?.classList.contains('animated-section-eyebrow')
        ? animateSectionText(eyebrow)
        : 0;
      animateSectionText(title, nextDelay);
      observer.unobserve(title);
    });
  }, { threshold: .2 });

  titles.forEach(title => observer.observe(title));
}

let hasLeftTop = false;
function updateScrollControls() {
  const isScrolled = window.scrollY > 60;
  document.getElementById('main-nav').classList.toggle('scrolled', isScrolled);
  const backToTop = document.getElementById('back-to-top');
  backToTop.classList.toggle('visible', window.scrollY > 300);
  const defaultBottom = parseFloat(getComputedStyle(backToTop).getPropertyValue('--back-to-top-bottom'));
  let bottomOffset = null;
  if (window.scrollY > 300) {
    const adminLink = document.querySelector('.admin-link');
    const adminRect = adminLink?.getBoundingClientRect();
    const buttonRect = backToTop.getBoundingClientRect();
    const buttonTop = window.innerHeight - defaultBottom - backToTop.offsetHeight;
    const overlapsHorizontally = adminRect
      && buttonRect.left < adminRect.right
      && buttonRect.right > adminRect.left;
    const overlapsVertically = adminRect
      && buttonTop < adminRect.bottom
      && buttonTop + backToTop.offsetHeight > adminRect.top;
    if (overlapsHorizontally && overlapsVertically) {
      bottomOffset = window.innerHeight - adminRect.top + 12;
    }
  }
  const nextBottom = bottomOffset === null ? '' : `${bottomOffset}px`;
  if (backToTop.style.bottom !== nextBottom) backToTop.style.bottom = nextBottom;
  if (isScrolled) {
    hasLeftTop = true;
  } else if (hasLeftTop) {
    animateHeroTitle(animateBrandTitle());
    hasLeftTop = false;
  }
}
window.addEventListener('scroll', updateScrollControls, { passive: true });
window.addEventListener('resize', updateScrollControls);
updateScrollControls();
// As animações do texto só começam depois de fechado o pop-up de promoção (se houver)
let introStarted = false;
function startIntroAnimations() {
  if (introStarted) return;
  introStarted = true;
  document.documentElement.classList.remove('intro-pending');
  animateHeroTitle(animateBrandTitle());
  observeSectionTitles();
}
Promise.resolve().then(showActivePromotions);
function toggleMobileMenu() {
  const navLinks = document.getElementById('main-nav-links');
  const toggle = document.querySelector('.nav-toggle');
  if (!navLinks || !toggle) return;
  const isOpen = navLinks.classList.toggle('open');
  toggle.classList.toggle('is-open', isOpen);
  toggle.setAttribute('aria-expanded', String(isOpen));
}

document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => {
    const navLinks = document.getElementById('main-nav-links');
    const toggle = document.querySelector('.nav-toggle');
    if (navLinks) navLinks.classList.remove('open');
    if (toggle) {
      toggle.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    }
  });
});
// Minutos desde a meia-noite em Portugal (ex.: 21:10 → 1270)
function getPortugalMinutesNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
}
// Reservas para o próprio dia até às 22:00 (hora de Portugal); depois disso, a partir de amanhã
const SAME_DAY_CUTOFF_MINUTES = 22 * 60;
function getMinimumCheckInDate() {
  const today = getPortugalDateString();
  return getPortugalMinutesNow() < SAME_DAY_CUTOFF_MINUTES ? today : shiftDateString(today, 1);
}
const todayDateString = getPortugalDateString();
const tomorrowDateString = getMinimumCheckInDate();

// Anos completos desde a abertura (dezembro de 2024), atualizado automaticamente
// Ano do rodapé sempre atual
document.getElementById('copyright-year').textContent = new Date().getFullYear();

const OPENING_DATE = '2024-12-01';
(() => {
  const [y, m, d] = todayDateString.split('-').map(Number);
  const [oy, om, od] = OPENING_DATE.split('-').map(Number);
  const years = y - oy - ((m < om || (m === om && d < od)) ? 1 : 0);
  document.getElementById('years-open').textContent = `${Math.max(years, 1)}+`;
})();
document.getElementById('bar-checkin').min=tomorrowDateString;
document.getElementById('f-checkin').min=tomorrowDateString;
updateBarMinimumCheckoutDate();

let calYear=Number(todayDateString.slice(0,4)),calMonth=Number(todayDateString.slice(5,7))-1,selStart=null,selEnd=null;
// Noites ocupadas por casa (próximos 18 meses), para o calendário funcionar em qualquer mês
const CALENDAR_RANGE_DAYS = 548;
const roomOccupancy = new Map();
let calendarRoomId = null; // casa mostrada no calendário; null = todas as casas
let selectedAvailabilityRoomId = null;
let availableRoomIds = null;
let availabilityRequestId = 0;
let availabilityQuotes = new Map(); // roomId → orçamento das datas escolhidas (ocupação base)

function renderCal(){
  const monthName = new Intl.DateTimeFormat(currentLanguage, { month: 'long' }).format(new Date(calYear, calMonth, 1));
  document.getElementById('cal-title').textContent=monthName.charAt(0).toLocaleUpperCase(currentLanguage)+monthName.slice(1)+' '+calYear;
  const grid=document.getElementById('cal-grid');grid.innerHTML='';
  const first=new Date(calYear,calMonth,1).getDay();
  const days=new Date(calYear,calMonth+1,0).getDate();
  document.querySelectorAll('.cal-day-name').forEach((element, index) => {
    const day = new Date(Date.UTC(2023, 0, 1 + index));
    element.textContent = new Intl.DateTimeFormat(currentLanguage, { weekday: 'short', timeZone: 'UTC' }).format(day);
  });
  const minimumCheckInDate = getMinimumCheckInDate();
  for(let i=0;i<first;i++){const d=document.createElement('div');d.className='cal-day empty';grid.appendChild(d);}
  for(let d=1;d<=days;d++){
    const dateStr=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el=document.createElement('div');el.className='cal-day';el.textContent=d;
    // A escolher a saída: só dias depois da entrada com a estadia mínima e sem noites ocupadas pelo meio.
    // Caso contrário: só dias em que é possível entrar (alguma casa livre durante a estadia mínima).
    const choosingCheckout = selStart && !selEnd;
    let isSelectable;
    if (dateStr === selStart) isSelectable = true;
    else if (choosingCheckout && dateStr > selStart) isSelectable = isValidCheckOut(selStart, dateStr);
    else isSelectable = dateStr >= minimumCheckInDate && isValidCheckIn(dateStr);
    // Saída e entrada no mesmo dia são permitidas: um dia em que começa outra reserva continua
    // disponível como dia de saída (só as noites contam como ocupadas)
    const isUnavail = !isSelectable;
    if(isUnavail) el.classList.add('unavail');
    // Esbatidos (não a vermelho): dias passados e saídas que não cumprem a estadia mínima
    const isTooShort = choosingCheckout && dateStr > selStart && nightsBetween(selStart, dateStr) < MINIMUM_STAY_NIGHTS
      && isRangeFree(selStart, dateStr);
    if(isUnavail && (dateStr < minimumCheckInDate || isTooShort)) el.classList.add('past');
    if(dateStr===getPortugalDateString())el.classList.add('today');
    el.dataset.dragDate=dateStr;
    if(!isUnavail){el.dataset.date=dateStr;el.onclick=()=>selectDay(dateStr);}
    grid.appendChild(el);
  }
  highlightCalSelection();
  updateCalendarHint();
}

function isValidCheckIn(date) {
  return isRangeFree(date, shiftDateString(date, MINIMUM_STAY_NIGHTS));
}
function isValidCheckOut(start, end) {
  return nightsBetween(start, end) >= MINIMUM_STAY_NIGHTS && isRangeFree(start, end, true);
}
function updateCalendarHint() {
  const hint = document.getElementById('cal-hint');
  if (!hint) return;
  hint.textContent = translateText(!selStart
    ? 'Escolha a data de entrada. Só aparecem disponíveis os dias em que é possível reservar.'
    : !selEnd
      ? 'Escolha a data de saída. Para mudar a entrada, clique novamente nela.'
      : 'Para escolher outras datas, clique numa nova data de entrada.');
}

// selStart/selEnd guardam datas completas (YYYY-MM-DD) para permitir estadias entre meses
function highlightCalSelection(start = selStart, end = selEnd) {
  document.querySelectorAll('#cal-grid .cal-day').forEach(el => {
    const date = el.dataset.date || el.dataset.dragDate; // inclui dias não clicáveis dentro da estadia escolhida
    el.classList.toggle('selected', Boolean(date) && (date === start || date === end));
    el.classList.toggle('in-range', Boolean(date && start && end) && date > start && date < end);
  });
}
function calendarRoomIds() {
  if (calendarRoomId) return [calendarRoomId];
  return (allRooms || []).filter(room => ['T2', 'T3'].includes((room.type || '').toUpperCase())).map(room => room.id);
}
// Uma noite está indisponível se todas as casas consideradas estiverem ocupadas
function isNightOccupied(date) {
  const ids = calendarRoomIds().filter(id => roomOccupancy.has(id));
  return ids.length > 0 && ids.every(id => roomOccupancy.get(id).nights.has(date));
}
// Há pelo menos uma casa livre em todas as noites, da entrada (inclusive) à saída (exclusive).
// Com isCheckOut, o dia de saída também não pode estar fechado no painel (bloqueio manual = dia inteiro).
function isRangeFree(start, end, isCheckOut = false) {
  const ids = calendarRoomIds().filter(id => roomOccupancy.has(id));
  if (!ids.length) return true;
  return ids.some(id => {
    const { nights, closedDays } = roomOccupancy.get(id);
    if (isCheckOut && closedDays.has(end)) return false;
    for (let date = start; date < end; date = shiftDateString(date, 1)) {
      if (nights.has(date)) return false;
    }
    return true;
  });
}
function nightsBetween(start, end) {
  return Math.round((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
}

// Seleção por arrastar (rato/caneta): carregar no dia de entrada e largar no dia de saída.
// Em ecrãs táteis mantém-se o toque em dois dias, para não bloquear o scroll da página.
let calDrag = null;
function calDayFromEvent(e) {
  return e.target.closest?.('#cal-grid .cal-day')?.dataset.date || null;
}
function previewCalDrag() {
  const [a, b] = [calDrag.start, calDrag.end].sort();
  highlightCalSelection(a, b);
}
const calGridEl = document.getElementById('cal-grid');
calGridEl.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const day = calDayFromEvent(e);
  if (!day || !isValidCheckIn(day)) return;
  calDrag = { start: day, end: day };
});
calGridEl.addEventListener('pointerover', e => {
  if (!calDrag) return;
  const day = e.target.closest?.('#cal-grid .cal-day')?.dataset.date || e.target.closest?.('#cal-grid .cal-day')?.dataset.dragDate;
  // Só estende até dias que podem ser saída a partir do dia em que o arrasto começou
  if (!day || day === calDrag.end || day <= calDrag.start || !isValidCheckOut(calDrag.start, day)) return;
  calDrag.end = day;
  previewCalDrag();
});
document.addEventListener('pointerup', () => {
  if (!calDrag) return;
  const { start, end } = calDrag;
  calDrag = null;
  if (start === end) return; // clique simples: tratado pelo onclick do dia
  selStart = null; selEnd = null;
  selectDay(start);
  selectDay(end);
});

// Carrega datas ocupadas para o quarto selecionado no mês atual
async function fetchRoomOccupancy(roomId) {
  const from = getPortugalDateString();
  const to = shiftDateString(from, CALENDAR_RANGE_DAYS);
  const res = await fetchWithRetry(`${API}/availability/room/${roomId}?from=${from}&to=${to}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  // nights: noites ocupadas ou bloqueadas; closedDays: dias fechados no painel (nem entrada nem saída)
  const blocked = data.blockedDates || [];
  roomOccupancy.set(roomId, {
    nights: new Set([...(data.occupiedDates || []), ...blocked.map(b => b.date)]),
    closedDays: new Set(blocked.filter(b => !b.source || b.source === 'MANUAL').map(b => b.date)),
  });
}

// Mostra no calendário a casa indicada (ou todas, com null). refresh=false reutiliza o que já foi carregado.
let calAvailabilityRequestId = 0;
async function loadPublicCalAvailability(roomId, refresh = true) {
  const requestId = ++calAvailabilityRequestId;
  calendarRoomId = roomId || null;
  const ids = calendarRoomIds().filter(id => refresh || !roomOccupancy.has(id));
  try {
    await Promise.all(ids.map(fetchRoomOccupancy));
  } catch(err) {
    console.error('Erro calendário público:', err);
  }
  if (requestId !== calAvailabilityRequestId) return;
  renderCal();
}
function clearCalendarSelection() {
  selStart = null; selEnd = null;
  ['bar-checkin', 'bar-checkout', 'f-checkin', 'f-checkout'].forEach(id => { document.getElementById(id).value = ''; });
  availabilityRequestId++;
  availableRoomIds = null; availabilityQuotes = new Map();
  renderCal();
  updateSummary();
  renderAvailRooms(allRooms);
  updateAvailabilitySummary();
}
function selectDay(dateStr){
  if (selStart && !selEnd && dateStr === selStart) { clearCalendarSelection(); return; }
  if (dateStr < getMinimumCheckInDate()) {
    showToast('Essa data de entrada já não está disponível. Reservas para o próprio dia são aceites até às 22:00.');
    return;
  }
  if(selStart && !selEnd && dateStr > selStart && nightsBetween(selStart, dateStr) < MINIMUM_STAY_NIGHTS){
    showToast(`A estadia mínima é de ${MINIMUM_STAY_NIGHTS} noites consecutivas.`);
    return;
  }
  if(selStart && !selEnd && dateStr > selStart && !isRangeFree(selStart, dateStr, true)){
    showToast('Há noites ocupadas nesse período. Escolha outras datas.');
    return;
  }
  if(!selStart||selEnd){selStart=dateStr;selEnd=null;}
  else if(dateStr>selStart){selEnd=dateStr;}
  else{selStart=dateStr;selEnd=null;}
  renderCal(); // atualiza os dias que podem ser dia de saída

  // Sincronizar datas com o formulário de reserva e barra de pesquisa (formato YYYY-MM-DD)
  if(selStart) {
    const ciStr = selStart;
    document.getElementById('bar-checkin').value = ciStr;
    document.getElementById('f-checkin').value = ciStr;
    if (!selEnd) {
      document.getElementById('bar-checkout').value = '';
      document.getElementById('f-checkout').value = '';
    }
    updateBarMinimumCheckoutDate();
    updateMinimumCheckoutDate();
    if (!selEnd) {
      availabilityRequestId++;
      availableRoomIds = null; availabilityQuotes = new Map();
      updateSummary();
      renderAvailRooms(allRooms);
      updateAvailabilitySummary();
    }
  }
  if(selEnd) {
    const ciStr = selStart;
    const coStr = selEnd;
    document.getElementById('bar-checkout').value = coStr;
    document.getElementById('f-checkout').value = coStr;
    updateSummary();
    availableRoomIds = null; availabilityQuotes = new Map();
    const requestId = ++availabilityRequestId;
    updateAvailabilitySummary();

    // Atualizar disponibilidade com as datas selecionadas
    const list = document.getElementById('avail-rooms-list');
    if (list) list.innerHTML = '<p style="color:var(--stone);font-size:.9rem;padding:1rem 0">A verificar disponibilidade...</p>';
    fetch(`${API}/availability?checkIn=${ciStr}&checkOut=${coStr}`)
      .then(async r => {
        const data = await r.json().catch(() => ({}));
        // Um erro do servidor (ex.: data inválida) não significa que as casas estejam ocupadas
        if (!r.ok) throw new Error(data.error || 'Erro ao verificar disponibilidade.');
        return data;
      })
      .then(data => {
        if (requestId !== availabilityRequestId) return;
        availableRoomIds = new Set((data.availableRooms || []).map(room => room.id));
        availabilityQuotes = new Map((data.availableRooms || []).map(room => [room.id, room.quote]));
        if (selectedAvailabilityRoomId && !availableRoomIds.has(selectedAvailabilityRoomId)) {
          selectedAvailabilityRoomId = null;
        }
        renderAvailRooms(data.availableRooms, ciStr, coStr);
        updateAvailabilitySummary();
        document.getElementById('f-checkin').value = ciStr;
        document.getElementById('f-checkout').value = coStr;
      })
      .catch(err => {
        if (requestId !== availabilityRequestId) return;
        console.error('Erro disponibilidade:', err);
        if (list) {
          const message = document.createElement('p');
          message.style.cssText = 'color:var(--stone);font-size:.9rem;padding:1rem 0';
          message.textContent = translateText(err.message || 'Erro ao verificar disponibilidade.');
          list.replaceChildren(message);
        }
        availableRoomIds = new Set();
        selectedAvailabilityRoomId = null;
        updateAvailabilitySummary();
      });
  }
}
function changeMonth(dir){
  calMonth+=dir;
  if(calMonth>11){calMonth=0;calYear++;}
  if(calMonth<0){calMonth=11;calYear--;}
  // A seleção mantém-se ao mudar de mês, para permitir entrada num mês e saída noutro
  const roomId = selectedAvailabilityRoomId || document.getElementById('f-room')?.value;
  loadPublicCalAvailability(roomId, false);
}

// ── Unidades ──────────────────────────────────────────────
let allRooms = []; // quartos carregados da API
renderCal(); // calendário visível já, antes de chegarem os dias ocupados
let roomCardEventsBound = false;

const ROOM_OVERRIDES = {
  T2: {
    displayName: 'Casa do Ferreiro T2',
    description: 'Casa de férias T2 com 115 m², composta por 2 quartos de casal com casa de banho privativa, sala espaçosa com sofá confortável, cozinha totalmente equipada e varanda/terraço com vista panorâmica para a albufeira e as montanhas. Acomoda até 6 hóspedes, com cama extra insuflável.',
    amenities: ['2 quartos de casal', 'Cama extra insuflável', 'Sala de estar com sofá confortável', '3 casas de banho', 'Cozinha totalmente equipada', 'Varanda e terraço', 'Wi‑Fi gratuito', 'Estacionamento privado', 'Jardim e espaço exterior'],
    sizeSqm: 115,
    bedrooms: 2,
    beds: 3,
    maxGuests: 6,
    coverImage: 'assets/images/t2-capa.jpg',
    coverAlt: 'Quarto de casal do T2 com ar condicionado e televisão',
    emoji: '🏡',
    badge: 'T2',
    slides: [
      { label: 'Quartos com casa de banho privativa' },
      { label: 'Vista para a albufeira e as montanhas' },
      { label: 'Cozinha ampla e totalmente equipada' }
    ]
  },
  T3: {
    displayName: 'Casa do Ferreiro T3',
    description: 'Apartamento / casa de férias T3 com 125 m², localizado em frente à praia/albufeira, com 3 quartos de casal, sala de estar espaçosa com sofá-cama, cozinha totalmente equipada, varanda e terraço com vistas deslumbrantes sobre o lago, montanhas e jardim. Acomoda até 8 hóspedes.',
    amenities: ['3 quartos de casal', '3 casas de banho completas', 'Sala de estar com sofá-cama', 'Cozinha totalmente equipada', 'Varanda e terraço', 'Área de praia privada', 'Wi‑Fi gratuito', 'Estacionamento privado gratuito', 'Ar condicionado', 'Quartos para não fumadores'],
    sizeSqm: 125,
    bedrooms: 3,
    beds: 4,
    maxGuests: 8,
    coverImage: 'assets/images/t3-capa.jpg',
    coverAlt: 'Quarto de casal do T3 com televisão e ar condicionado',
    emoji: '🏞️',
    badge: 'T3',
    slides: [
      { label: 'Área de praia privada' },
      { label: 'Vista para o lago e montanhas' },
      { label: 'Conforto para famílias e grupos' }
    ]
  }
};

function getRoomPresentation(room) {
  const type = (room?.type || '').toUpperCase();
  const override = ROOM_OVERRIDES[type] || null;
  return {
    name: translateText(override?.displayName || room?.name || 'Unidade'),
    description: translateText(override?.description || room?.description || 'Descrição em atualização.'),
    amenities: (override?.amenities || room?.amenities || []).map(translateText),
    sizeSqm: override?.sizeSqm || room?.sizeSqm || null,
    bedrooms: override?.bedrooms || room?.bedrooms || null,
    beds: override?.beds || room?.beds || null,
    coverImage: override?.coverImage || null,
    coverAlt: translateText(override?.coverAlt || ''),
    emoji: override?.emoji || '🏡',
    badge: override?.badge || room?.type || 'Unidade',
    slides: (override?.slides || [
      { label: 'Espaço acolhedor' },
      { label: 'Conforto e serenidade' },
      { label: 'Ideal para férias' }
    ]).map(slide => ({ ...slide, label: translateText(slide.label) }))
  };
}

function getRoomMaxGuests(room) {
  const type = (room?.type || '').toUpperCase();
  return ROOM_OVERRIDES[type]?.maxGuests || room?.capacity || 8;
}

function renderRoomCards() {
  const grid = document.getElementById('rooms-grid');
  if (!grid) return;

  const visibleRooms = (allRooms || []).filter(room => ['T2', 'T3'].includes((room.type || '').toUpperCase()));
  if (!visibleRooms.length) {
    grid.innerHTML = '<div class="info-card" style="grid-column:1/-1">A carregar as unidades...</div>';
    return;
  }

  grid.innerHTML = visibleRooms.map(room => {
    const presentation = getRoomPresentation(room);
    const amenities = presentation.amenities.slice(0, 6).map(item => `<span class="amenity">${item}</span>`).join('');
    const bedroomCount = presentation.bedrooms;
    const bedCount = presentation.beds;
    return `
      <div class="room-card" data-room-id="${room.id}">
        <div class="room-visual t${(room.type || '').toUpperCase().replace('T','')}">
          <button class="room-visual-image" type="button" aria-label="${translateText('Ver fotografias de ')}${presentation.name}">
            <img class="room-visual-photo" src="${presentation.coverImage}" alt="${presentation.coverAlt}" loading="lazy" decoding="async">
          </button>
          <div class="room-visual-badge">${presentation.badge}</div>
        </div>
        <div class="room-body">
          <div class="room-name">${presentation.name}</div>
          <div class="room-desc">${presentation.description}</div>
          <div class="room-stats">
            <div class="room-stat"><span>${presentation.sizeSqm ? `${presentation.sizeSqm} m²` : '—'}</span></div>
            <div class="room-stat"><span>${bedroomCount ? `${bedroomCount} ${translateText(bedroomCount === 1 ? 'quarto' : 'quartos')}` : '—'}</span></div>
            <div class="room-stat"><span>${bedCount ? `${bedCount} ${translateText(bedCount === 1 ? 'cama' : 'camas')}` : '—'}</span></div>
          </div>
          <div class="room-amenities">${amenities}</div>
          <div class="room-footer">
            <div class="room-price">€${new Intl.NumberFormat(currentLanguage).format(room.pricePerNight)}<span>${translateText('/ noite')}</span></div>
            <button class="btn-book" onclick="event.stopPropagation(); openBookingForRoom('${room.id}')">${translateText('Reservar')}</button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function bindRoomCardEvents() {
  const grid = document.getElementById('rooms-grid');
  if (!grid || roomCardEventsBound) return;
  roomCardEventsBound = true;
  grid.addEventListener('click', (event) => {
    const imageButton = event.target.closest('.room-visual-image');
    const card = imageButton?.closest('.room-card');
    if (card) openRoomDetails(card.dataset.roomId);
  });
}

// ── Carregar quartos da API ───────────────────────────────
async function loadRooms() {
  try {
    const res = await fetchWithRetry(`${API}/rooms`);
    const rooms = await res.json();
    if (!res.ok || !Array.isArray(rooms)) throw new Error(rooms?.error || `HTTP ${res.status}`);
    allRooms = rooms;
    populateRoomSelect();
    renderRoomCards();
    bindRoomCardEvents();
    renderAvailRooms(allRooms);
    updateAvailabilitySummary();
    // Calendário começa com todas as casas: risca as noites em que nenhuma está livre
    loadPublicCalAvailability(calendarRoomId);
  } catch(err) {
    console.error('Erro ao carregar quartos:', err);
    showToast(translateText('Não foi possível carregar as casas. Atualize a página dentro de momentos.'));
  }
}

function populateRoomSelect() {
  const sel = document.getElementById('f-room');
  const barSel = document.getElementById('bar-room');
  sel.innerHTML = '';
  barSel.innerHTML = `<option value="" disabled selected>${translateText('Selecione uma unidade')}</option>`;
  const visibleRooms = (allRooms || []).filter(room => ['T2', 'T3'].includes((room.type || '').toUpperCase()));
  visibleRooms.forEach(r => {
    const name = translateText(r.name);
    sel.innerHTML += `<option value="${r.id}" data-price="${r.pricePerNight}" data-name="${name}" data-capacity="${getRoomMaxGuests(r)}">${name} — €${new Intl.NumberFormat(currentLanguage).format(r.pricePerNight)}/${translateText('noite')}</option>`;
    barSel.innerHTML += `<option value="${r.id}" data-capacity="${getRoomMaxGuests(r)}">${name}</option>`;
  });
  syncGuestOptions('bar-room', 'bar-guests');
  syncAgeGroupOptions();
  updateBookingPolicyHint();
  updateArrivalTimeOptions();
  updateSummary();
}

function syncGuestOptions(roomSelectId, guestsSelectId, hintId) {
  const roomId = document.getElementById(roomSelectId).value;
  const room = allRooms.find(item => item.id === roomId);
  const maxGuests = room ? getRoomMaxGuests(room) : Math.max(8, ...allRooms.map(getRoomMaxGuests));
  const guestSelect = document.getElementById(guestsSelectId);
  const selectedGuests = Math.min(parseInt(guestSelect.value, 10) || 2, maxGuests);

  guestSelect.innerHTML = Array.from({ length: maxGuests }, (_, index) => {
    const count = index + 1;
    return `<option value="${count}">${translateText(`${count} ${count === 1 ? 'hóspede' : 'hóspedes'}`)}</option>`;
  }).join('');
  guestSelect.value = String(selectedGuests);

  if (hintId) {
    document.getElementById(hintId).textContent = translateText(room
      ? `Capacidade máxima desta unidade: ${maxGuests} hóspedes.`
      : `Selecione uma unidade; capacidade máxima: ${maxGuests} hóspedes.`);
  }
}

// Hóspedes por idade: adultos, 7–17 e 3–6 contam para a lotação; bebés (0–2) não
const AGE_GROUP_FIELDS = { adults: 'f-adults', teens: 'f-teens', children: 'f-children', infants: 'f-infants' };
const MAX_INFANTS = 3;

function getBookingParty() {
  const party = Object.fromEntries(Object.entries(AGE_GROUP_FIELDS)
    .map(([group, id]) => [group, parseInt(document.getElementById(id).value, 10) || 0]));
  party.cribs = party.infants > 0 ? Math.min(party.infants, parseInt(document.getElementById('f-cribs').value, 10) || 0) : 0;
  return party;
}

// ── Berços (partilhados pelas duas casas, contados noite a noite pelo servidor) ──
let cribAvailability = { key: '', available: null, loading: false };
let cribChoiceTouched = false; // o hóspede escolheu o número; senão, propõe um berço por bebé

function cribDatesKey() {
  const checkIn = document.getElementById('f-checkin').value;
  const checkOut = document.getElementById('f-checkout').value;
  return checkIn && checkOut && checkIn < checkOut ? `${checkIn}|${checkOut}` : '';
}

// Pede ao servidor os berços livres nas datas escolhidas (só quando as datas mudam)
async function refreshCribAvailability() {
  const key = cribDatesKey();
  const infants = parseInt(document.getElementById('f-infants').value, 10) || 0;
  if (!key || infants === 0 || key === cribAvailability.key) { renderCribOptions(); return; }
  cribAvailability = { key, available: null, loading: true };
  renderCribOptions();
  const [checkIn, checkOut] = key.split('|');
  try {
    const res = await fetch(`${API}/availability/cribs?checkIn=${checkIn}&checkOut=${checkOut}`);
    const data = await res.json();
    if (cribAvailability.key !== key) return;
    cribAvailability = { key, available: res.ok ? data.available : null, loading: false };
  } catch (err) {
    if (cribAvailability.key !== key) return;
    cribAvailability = { key, available: null, loading: false };
  }
  const before = document.getElementById('f-cribs').value;
  renderCribOptions();
  if (document.getElementById('f-cribs').value !== before) updateSummary();
}

function renderCribOptions() {
  const field = document.getElementById('crib-field');
  const select = document.getElementById('f-cribs');
  const hint = document.getElementById('crib-hint');
  const infants = parseInt(document.getElementById('f-infants').value, 10) || 0;
  field.hidden = infants === 0;
  if (infants === 0) { select.innerHTML = '<option value="0">0</option>'; cribChoiceTouched = false; return; }

  const known = cribAvailability.key === cribDatesKey() && cribAvailability.available !== null;
  const max = known ? Math.min(infants, cribAvailability.available) : infants;
  const current = parseInt(select.value, 10);
  const value = cribChoiceTouched && Number.isInteger(current) ? Math.min(current, max) : max;
  select.innerHTML = Array.from({ length: max + 1 }, (_, count) => `<option value="${count}">${count}</option>`).join('');
  select.value = String(value);

  hint.classList.remove('warning');
  if (!cribDatesKey()) {
    hint.textContent = translateText('Escolha as datas para ver os berços disponíveis.');
  } else if (!known) {
    hint.textContent = cribAvailability.loading ? translateText('A verificar berços disponíveis...') : translateText('Berço com custo por noite.');
  } else if (cribAvailability.available === 0) {
    hint.classList.add('warning');
    hint.textContent = translateText('Para estas datas já não há berços disponíveis. Pode reservar na mesma se trouxer um berço de viagem.');
  } else if (cribAvailability.available < infants) {
    hint.classList.add('warning');
    hint.textContent = cribAvailability.available === 1
      ? translateText('Para estas datas só resta 1 berço disponível.')
      : translateTemplate('Para estas datas só restam {{count}} berços disponíveis.', { count: cribAvailability.available });
  } else {
    hint.textContent = translateText('Berço com custo por noite.');
  }
}

function countPartyGuests(party) {
  return party.adults + party.teens + party.children;
}

function syncAgeGroupOptions() {
  const room = allRooms.find(item => item.id === document.getElementById('f-room').value);
  const maxGuests = room ? getRoomMaxGuests(room) : Math.max(8, ...allRooms.map(getRoomMaxGuests));
  const party = getBookingParty();
  const limits = { adults: [1, maxGuests], teens: [0, maxGuests - 1], children: [0, maxGuests - 1], infants: [0, MAX_INFANTS] };
  Object.entries(AGE_GROUP_FIELDS).forEach(([group, id]) => {
    const [min, max] = limits[group];
    const select = document.getElementById(id);
    const value = Math.min(Math.max(party[group], min), max);
    select.innerHTML = Array.from({ length: max - min + 1 }, (_, index) => `<option value="${min + index}">${min + index}</option>`).join('');
    select.value = String(value);
  });
  updateGuestLimitHint();
}

function updateGuestLimitHint() {
  const room = allRooms.find(item => item.id === document.getElementById('f-room').value);
  const maxGuests = room ? getRoomMaxGuests(room) : Math.max(8, ...allRooms.map(getRoomMaxGuests));
  const hint = document.getElementById('guest-limit-hint');
  const overLimit = countPartyGuests(getBookingParty()) > maxGuests;
  hint.classList.toggle('error', overLimit);
  hint.textContent = overLimit
    ? translateTemplate('Esta unidade permite até {{max}} hóspedes (bebés até 2 anos não contam).', { max: maxGuests })
    : translateText(room
      ? `Capacidade máxima desta unidade: ${maxGuests} hóspedes.`
      : `Selecione uma unidade; capacidade máxima: ${maxGuests} hóspedes.`);
}

function updateBookingPolicyHint() {
  const room = allRooms.find(item => item.id === document.getElementById('f-room').value);
  const text = room
    ? `Check-in: a partir das 16:00 (avise a hora de chegada). Check-out: até às 11:00. Estadia mínima: ${MINIMUM_STAY_NIGHTS} noites consecutivas. Berço para bebés dos 0 aos 2 anos, mediante pedido, com custo por noite. ${room.type?.toUpperCase() === 'T2' ? 'Cama extra insuflável e sofá confortável na sala.' : 'Sofá-cama na sala.'}`
    : `Check-in: a partir das 16:00 (avise a hora de chegada). Check-out: até às 11:00. Estadia mínima: ${MINIMUM_STAY_NIGHTS} noites consecutivas. Berço para bebés dos 0 aos 2 anos, mediante pedido, com custo por noite; T2 com cama extra insuflável e sofá na sala; T3 com sofá-cama na sala.`;
  document.getElementById('booking-policy-hint').textContent = translateText(text);
}

function updateArrivalTimeOptions() {
  const room = allRooms.find(item => item.id === document.getElementById('f-room').value);
  const select = document.getElementById('f-arrival-time');
  if (!room) {
    select.innerHTML = `<option value="">${translateText('Selecione primeiro a unidade')}</option>`;
    select.disabled = true;
    return;
  }

  const previousValue = select.value;
  const options = [];
  // Entrada hoje: não mostrar horas que já passaram (arredonda para a meia hora seguinte)
  const isToday = document.getElementById('f-checkin').value === getPortugalDateString();
  const firstMinute = isToday ? Math.max(16 * 60, Math.ceil((getPortugalMinutesNow() + 1) / 30) * 30) : 16 * 60;
  for (let minute = firstMinute; minute <= 24 * 60; minute += 30) {
    const time = `${String(Math.floor(minute / 60) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    options.push(`<option value="${time}">${time}</option>`);
  }
  select.innerHTML = `<option value="">${translateText('Selecione a hora prevista')}</option>` + options.join('');
  select.disabled = false;
  select.value = options.some(option => option.includes(`value="${previousValue}"`)) ? previousValue : '';
}

function formatAvailabilityDate(dateString) {
  return new Intl.DateTimeFormat(currentLanguage, { day: 'numeric', month: 'short', year: 'numeric' })
    .format(new Date(`${dateString}T00:00:00`));
}

function updateAvailabilitySummary() {
  const panel = document.getElementById('availability-summary');
  if (!panel) return;
  const checkIn = document.getElementById('f-checkin').value;
  const checkOut = document.getElementById('f-checkout').value;
  const nights = checkIn && checkOut
    ? Math.round((new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86400000)
    : 0;
  const room = allRooms.find(item => item.id === selectedAvailabilityRoomId);
  const dateDetails = checkIn ? `
    <div class="availability-summary-details">
      <div class="availability-summary-item">${translateText('Entrada')}<strong>${formatAvailabilityDate(checkIn)}</strong></div>
      <div class="availability-summary-item">${translateText('Saída')}<strong>${checkOut ? formatAvailabilityDate(checkOut) : '—'}</strong></div>
      ${nights > 0 ? `<div class="availability-summary-item">${translateText('Noites')}<strong>${nights}</strong></div>` : ''}
    </div>` : '';
  let nextStep = '';
  if (!checkIn) {
    nextStep = translateText('Selecione as datas no calendário e depois escolha um alojamento.');
  } else if (!checkOut) {
    nextStep = translateText('Agora escolha a data de saída no calendário.');
  } else if (checkOut && !room) {
    nextStep = translateText('Escolha uma unidade disponível para ver o resumo.');
  }

  // Mesmo total da lista (calculado pelo servidor com épocas, fins de semana, feriados e promoções)
  const quote = room ? availabilityQuotes.get(room.id) : null;
  const money = value => `€${new Intl.NumberFormat(currentLanguage, { maximumFractionDigits: 2 }).format(value)}`;
  const roomDetails = room ? `
    <div class="availability-summary-item">${translateText('Alojamento')}<strong>${translateText(room.name)}</strong></div>
    ${nights > 0 && quote ? `<div class="availability-summary-total"><span>${translateText('Total estimado')}</span><strong>${money(quote.total)}</strong></div>
    ${quote.promotion ? `<p class="availability-promo">${translateTemplate('✓ Desconto de {{pct}}% aplicado (promoção «{{name}}»).', { pct: quote.promotion.discountPct, name: quote.promotion.name })}</p>` : ''}
    <p class="availability-note">${translateTemplate('Valor para {{people}} pessoas. O total final depende do número e da idade dos hóspedes.', { people: quote.baseOccupancy })}</p>` : ''}` : '';
  const canContinue = Boolean(room && checkIn && checkOut && nights >= MINIMUM_STAY_NIGHTS && availableRoomIds?.has(room.id));

  panel.innerHTML = `
    <h3>${translateText('Resumo da estadia')}</h3>
    ${dateDetails}
    ${roomDetails}
    ${nextStep ? `<p>${nextStep}</p>` : ''}
    ${canContinue ? `<button class="btn-book" type="button" onclick="continueAvailabilityBooking()">${translateText('Continuar para reserva')}</button>` : ''}`;
}

function selectAvailabilityRoom(roomId) {
  if (availableRoomIds && !availableRoomIds.has(roomId)) return;
  const roomChanged = selectedAvailabilityRoomId !== roomId;
  selectedAvailabilityRoomId = roomId;
  if (roomChanged) loadPublicCalAvailability(roomId);
  document.querySelectorAll('.avail-room[data-room-id]').forEach(card => {
    const selected = card.dataset.roomId === roomId;
    card.classList.toggle('is-selected', selected);
    const button = card.querySelector('[data-select-room]');
    if (button) {
      button.textContent = translateText(selected ? 'Selecionado' : 'Selecionar');
      button.setAttribute('aria-pressed', String(selected));
    }
  });
  updateAvailabilitySummary();
}

function continueAvailabilityBooking() {
  if (!selectedAvailabilityRoomId) return;
  if (!document.getElementById('f-checkin').value || !document.getElementById('f-checkout').value) {
    showToast('Selecione as datas de entrada e saída antes de reservar.');
    return;
  }
  document.getElementById('f-room').value = selectedAvailabilityRoomId;
  openBooking();
}

function renderAvailRooms(availableRooms, checkIn, checkOut) {
  const list = document.getElementById('avail-rooms-list');
  if (!list) return;
  list.innerHTML = '';

  const visibleRooms = (allRooms || []).filter(room => ['T2', 'T3'].includes((room.type || '').toUpperCase()));

  if (!checkIn || !checkOut) {
    visibleRooms.forEach(r => {
      const selected = r.id === selectedAvailabilityRoomId;
      list.innerHTML += `
        <div class="avail-room${selected ? ' is-selected' : ''}" data-room-id="${r.id}">
          <div><div class="avail-room-name">${translateText(r.name)}</div><div class="avail-room-type">${r.type}</div></div>
          <div class="avail-status"><div class="status-dot avail"></div>${translateText('Disponível')}</div>
          <div class="avail-price">€${new Intl.NumberFormat(currentLanguage).format(r.pricePerNight)}<small>${translateText('/ noite')}</small></div>
          <button class="btn-book" data-select-room type="button" aria-pressed="${selected}" style="font-size:.7rem;padding:.4rem .9rem" onclick="selectAvailabilityRoom('${r.id}')">${translateText(selected ? 'Selecionado' : 'Selecionar')}</button>
        </div>`;
    });
    return;
  }

  const availIds = new Set((availableRooms || []).map(r => r.id));
  const quotes = new Map((availableRooms || []).map(r => [r.id, r.quote]));

  visibleRooms.forEach(r => {
    const isAvail = availIds.has(r.id);
    const selected = r.id === selectedAvailabilityRoomId;
    list.innerHTML += `
      <div class="avail-room${selected ? ' is-selected' : ''}" data-room-id="${r.id}" style="${!isAvail ? 'opacity:.6' : ''}">
        <div><div class="avail-room-name">${translateText(r.name)}</div><div class="avail-room-type">${r.type}</div></div>
        <div class="avail-status">
          <div class="status-dot ${isAvail ? 'avail' : 'unavail'}"></div>
          ${translateText(isAvail ? 'Disponível' : 'Indisponível')}
        </div>
        ${isAvail && quotes.get(r.id)
          ? `<div class="avail-price">€${new Intl.NumberFormat(currentLanguage, { maximumFractionDigits: 2 }).format(quotes.get(r.id).total)}<small>${quotes.get(r.id).nightsCount} ${translateText('Noites').toLocaleLowerCase(currentLanguage)}</small></div>`
          : `<div class="avail-price">€${new Intl.NumberFormat(currentLanguage).format(r.pricePerNight)}<small>${translateText('/ noite')}</small></div>`}
        ${isAvail
          ? `<button class="btn-book" data-select-room type="button" aria-pressed="${selected}" style="font-size:.7rem;padding:.4rem .9rem" onclick="selectAvailabilityRoom('${r.id}')">${translateText(selected ? 'Selecionado' : 'Selecionar')}</button>`
          : `<span style="font-size:.72rem;color:var(--stone)">${translateText('Ocupado')}</span>`
        }
      </div>`;
  });
}

// ── Verificar disponibilidade pela barra ──────────────────
async function openBookingFromBar() {
  const roomId = document.getElementById('bar-room').value;
  const checkIn = document.getElementById('bar-checkin').value;
  const checkOut = document.getElementById('bar-checkout').value;
  if (!roomId) {
    showToast('Selecione uma unidade para verificar a disponibilidade.');
    return;
  }
  const dateError = getBookingDateError(checkIn, checkOut);
  if (dateError) {
    showToast(dateError);
    return;
  }
  document.getElementById('f-room').value = roomId;
  document.getElementById('f-adults').value = document.getElementById('bar-guests').value;
  ['f-teens', 'f-children', 'f-infants'].forEach(id => { document.getElementById(id).value = '0'; });
  document.getElementById('f-checkin').value = checkIn;
  document.getElementById('f-checkout').value = checkOut;
  syncAgeGroupOptions();

  try {
    const res = await fetch(`${API}/availability?checkIn=${checkIn}&checkOut=${checkOut}`);
    const data = await res.json();
    if (!res.ok) {
      showToast(translateText(data.error || 'Erro ao verificar disponibilidade.'));
      return;
    }
    renderAvailRooms(data.availableRooms, checkIn, checkOut);
  } catch(err) { console.error(err); }

  openBooking();
}

// ── Modal de detalhes do quarto ─────────────────────────
const roomCarouselImages = {
  T2: [
    { src: 'assets/images/t2-slide-1.jpg', alt: 'Casa de banho do T2 com chuveiro envidraçado' },
    { src: 'assets/images/t2-slide-2.jpg', alt: 'Quarto do T2 com cama de casal e berço' },
    { src: 'assets/images/t2-slide-3.jpg', alt: 'Sala de estar do T2 com sofá e televisão' }
  ],
  T3: [
    { src: 'assets/images/t3-slide-1.jpg', alt: 'Quarto de casal do T3 com televisão e ar condicionado' },
    { src: 'assets/images/t3-slide-2.jpg', alt: 'Quarto de casal do T3 com vista para a albufeira' },
    { src: 'assets/images/t3-slide-3.jpg', alt: 'Cozinha equipada do T3' }
  ],
  default: [
    { label: 'Espaço acolhedor' },
    { label: 'Conforto e serenidade' },
    { label: 'Ideal para férias' }
  ]
};
let currentCarouselIndex = 0;
let currentCarouselRoomType = '';
let roomCarouselTimer = null;

function startRoomCarouselAutoplay() {
  clearInterval(roomCarouselTimer);
  roomCarouselTimer = setInterval(() => moveRoomCarousel(1), 3000);
}

function renderRoomCarousel(room) {
  const track = document.getElementById('room-detail-carousel-track');
  const dots = document.getElementById('room-detail-carousel-dots');
  currentCarouselRoomType = (room?.type || '').toUpperCase();
  const images = roomCarouselImages[currentCarouselRoomType] || roomCarouselImages.default;
  currentCarouselIndex = 0;
  track.innerHTML = '';
  dots.innerHTML = '';

  images.forEach((item, index) => {
    const slide = document.createElement('div');
    slide.className = 'room-detail-carousel-slide';
    const image = document.createElement('img');
    image.src = item.src;
    image.alt = item.alt || 'Fotografia do alojamento';
    image.loading = index === 0 ? 'eager' : 'lazy';
    slide.appendChild(image);
    track.appendChild(slide);

    const dot = document.createElement('button');
    dot.className = 'room-detail-carousel-dot';
    dot.type = 'button';
    dot.setAttribute('aria-label', translateTemplate('Ver fotografia {{index}}', { index: index + 1 }));
    dot.onclick = () => {
      currentCarouselIndex = index;
      updateCarouselPosition();
      startRoomCarouselAutoplay();
    };
    dots.appendChild(dot);
  });

  updateCarouselPosition();
}

function updateCarouselPosition() {
  const track = document.getElementById('room-detail-carousel-track');
  const dots = Array.from(document.querySelectorAll('.room-detail-carousel-dot'));
  if (!track) return;
  track.style.transform = `translateX(calc(-${currentCarouselIndex * 100}%))`;
  dots.forEach((dot, index) => dot.classList.toggle('active', index === currentCarouselIndex));
}

function moveRoomCarousel(delta) {
  const images = roomCarouselImages[currentCarouselRoomType] || roomCarouselImages.default;
  currentCarouselIndex = (currentCarouselIndex + delta + images.length) % images.length;
  updateCarouselPosition();
  startRoomCarouselAutoplay();
}

function openRoomDetails(roomId) {
  const room = allRooms.find(r => r.id === roomId);
  if (!room) return;
  renderRoomCarousel(room);

  document.getElementById('room-detail-modal').classList.add('open');
  startRoomCarouselAutoplay();
}

const footerInfo = {
  accommodation: {
    title: 'Alojamento',
    content: '<p><strong>Casa do Ferreiro T2:</strong> 115 m², até 6 hóspedes, com cama extra insuflável e sofá confortável na sala.</p><p><strong>Casa do Ferreiro T3:</strong> 125 m², até 8 hóspedes, com sofá-cama na sala.</p><p><strong>Classificação:</strong> 9,6/10 · <strong>Localização:</strong> 10/10.</p><p><strong>Licença AL:</strong> 167437/AL.</p>'
  },
  comfort: {
    title: 'Conforto e comodidade',
    content: '<p>Estacionamento privado gratuito, Wi-Fi de alta velocidade, ar condicionado, quartos para não fumadores, toalhas e roupa de cama incluídas, gel de banho e champô, jardim e acesso a área de praia privada.</p><p>Cozinha equipada com frigorífico, máquina de café, micro-ondas, mesa de jantar e utensílios completos.</p><p>Em breve: carregamento de veículos elétricos (EV) para os hóspedes.</p>'
  },
  policies: {
    title: 'Regras da propriedade',
    content: '<ul><li>Check-in: a partir das 16:00. Informe a hora prevista de chegada com antecedência.</li><li>Check-out: até às 11:00.</li><li>Estadia mínima: 2 noites consecutivas.</li><li>Crianças bem-vindas; berço para bebés dos 0 aos 2 anos, com custo por noite.</li><li>T2: cama extra insuflável e sofá confortável na sala (até 6 hóspedes).</li><li>T3: sofá-cama na sala (até 8 hóspedes).</li><li>Não é permitido fumar no interior nem realizar festas ou eventos.</li><li>Não são admitidos animais de estimação.</li></ul>'
  },
  contact: {
    title: 'Contacto',
    content: '<p>Anfitrião: <strong>Sr. André</strong>. Idiomas: Português, Inglês e Espanhol.</p><p>Email: <button type="button" class="contact-email-link" onclick="openContactForm()">reservas@casadoferreirovn.pt</button></p><p>Telefone: <a href="tel:+351938750239">+351 938 750 239</a></p>'
  },
  location: {
    title: 'Localização e morada',
    content: '<p>Rua do Ferreiro nº 3, 5470-504 Venda Nova, Montalegre, Portugal. Em frente à albufeira, com vistas sobre o lago, as montanhas e o jardim, num ambiente tranquilo rodeado pela natureza.</p><iframe class="footer-map" title="Localização da Casa do Ferreiro no Google Maps" src="https://maps.google.com/maps?q=Rua%20do%20Ferreiro%203%2C%205470-504%20Venda%20Nova%2C%20Montalegre%2C%20Portugal&amp;output=embed" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe><a class="footer-map-link" href="https://www.google.com/maps/search/?api=1&amp;query=Rua%20do%20Ferreiro%203%2C%205470-504%20Venda%20Nova%2C%20Montalegre%2C%20Portugal" target="_blank" rel="noopener noreferrer">Abrir no Google Maps</a>'
  },
};

let footerInfoTrigger;

function openFooterInfo(infoKey, trigger) {
  const info = footerInfo[infoKey];
  if (!info) return;
  footerInfoTrigger = trigger;
  document.getElementById('footer-info-title').textContent = translateText(info.title);
  const body = document.getElementById('footer-info-body');
  body.innerHTML = info.content;
  translateSubtree(body);
  document.getElementById('footer-info-modal').classList.add('open');
  document.querySelector('#footer-info-modal .modal-close-btn').focus();
}

function closeFooterInfo() {
  document.getElementById('footer-info-modal').classList.remove('open');
  if (footerInfoTrigger) footerInfoTrigger.focus();
}

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (document.getElementById('promo-modal').classList.contains('open')) {
    closePromoModal();
  } else if (document.getElementById('contact-modal').classList.contains('open')) {
    closeContactForm();
  } else if (document.getElementById('footer-info-modal').classList.contains('open')) {
    closeFooterInfo();
  }
});

// Pop-up das promoções ativas, mostrado uma vez por sessão ao entrar no site
const PROMO_SEEN_KEY = 'casaDoFerreiroPromoSeen';

async function showActivePromotions() {
  let alreadySeen = false;
  try { alreadySeen = sessionStorage.getItem(PROMO_SEEN_KEY) === '1'; } catch (err) { /* sem armazenamento */ }
  if (alreadySeen) { startIntroAnimations(); return; }
  try {
    const res = await fetch(`${API}/rooms/promotions/active`, { signal: AbortSignal.timeout(2500) });
    const promotions = res.ok ? await res.json() : [];
    if (!Array.isArray(promotions) || !promotions.length) { startIntroAnimations(); return; }
    renderPromoModal(promotions);
    clearTimeout(window.introSafetyTimer); // o título fica escondido até o pop-up fechar
    document.getElementById('promo-modal').classList.add('open');
    document.querySelector('#promo-modal .promo-modal-content').focus();
  } catch (err) {
    startIntroAnimations();
  }
}

function renderPromoModal(promotions) {
  const formatDate = value => new Intl.DateTimeFormat(currentLanguage, { day: 'numeric', month: 'long', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
  const body = document.getElementById('promo-modal-body');
  body.replaceChildren(...promotions.slice(0, 3).map(promotion => {
    const item = document.createElement('div');
    item.className = 'promo-modal-item';
    const pct = document.createElement('div');
    pct.className = 'promo-modal-pct';
    pct.textContent = `−${promotion.discountPct}%`;
    const pctLabel = document.createElement('small');
    pctLabel.textContent = translateText('de desconto');
    pct.appendChild(pctLabel);
    const name = document.createElement('div');
    name.className = 'promo-modal-name';
    name.textContent = promotion.name;
    const text = document.createElement('p');
    text.className = 'promo-modal-text';
    text.textContent = [
      translateTemplate('Em estadias de {{nights}} ou mais noites, de {{start}} a {{end}}.', {
        nights: promotion.minNights, start: formatDate(promotion.startDate), end: formatDate(promotion.endDate) }),
      promotion.roomName ? translateTemplate('Válida na {{room}}.', { room: translateText(promotion.roomName) }) : '',
    ].filter(Boolean).join(' ');
    item.append(pct, name, text);
    return item;
  }));
}

function closePromoModal(goToAvailability = false) {
  document.getElementById('promo-modal').classList.remove('open');
  try { sessionStorage.setItem(PROMO_SEEN_KEY, '1'); } catch (err) { /* sem armazenamento */ }
  if (goToAvailability) document.getElementById('availability').scrollIntoView({ behavior: 'smooth' });
  startIntroAnimations();
}

// ── Verificação anti-robô (Cloudflare Turnstile) ─────────────
const TURNSTILE_SITE_KEY = '0x4AAAAAAFZhMKlEQihoOY71';
const turnstileWidgets = {};

// Mostra a verificação no formulário (só pede interação quando o Cloudflare desconfia)
function renderTurnstile(containerId) {
  if (!window.turnstile) { setTimeout(() => renderTurnstile(containerId), 500); return; }
  if (turnstileWidgets[containerId] !== undefined) return;
  turnstileWidgets[containerId] = window.turnstile.render(`#${containerId}`, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: 'interaction-only',
    language: currentLanguage === 'pt' ? 'pt-PT' : currentLanguage,
  });
}

function getTurnstileToken(containerId) {
  const widgetId = turnstileWidgets[containerId];
  return widgetId !== undefined && window.turnstile ? window.turnstile.getResponse(widgetId) || '' : '';
}

// Cada código só serve uma vez: depois de enviar, pede um novo
function resetTurnstile(containerId) {
  const widgetId = turnstileWidgets[containerId];
  if (widgetId !== undefined && window.turnstile) window.turnstile.reset(widgetId);
}

// Formulário de contacto (aberto a partir do email na janela "Contacto")
function openContactForm() {
  document.getElementById('footer-info-modal').classList.remove('open');
  document.getElementById('contact-modal').classList.add('open');
  renderTurnstile('contact-turnstile');
  document.getElementById('c-name').focus();
}

function closeContactForm() {
  document.getElementById('contact-modal').classList.remove('open');
  if (footerInfoTrigger) footerInfoTrigger.focus();
}

async function submitContactForm(event) {
  event.preventDefault();
  const name = document.getElementById('c-name').value.trim();
  const email = document.getElementById('c-email').value.trim();
  const phone = document.getElementById('c-phone').value.trim();
  const message = document.getElementById('c-message').value.trim();
  const website = document.getElementById('c-website').value;

  if (!name || !email) { showToast(translateText('Por favor preencha nome e email.')); return; }
  if (!document.getElementById('c-email').checkValidity()) { showToast(translateText('Introduza um endereço de email válido.')); return; }
  if (message.length < 10) { showToast(translateText('A mensagem deve ter pelo menos 10 caracteres.')); return; }
  const turnstileToken = getTurnstileToken('contact-turnstile');
  if (!turnstileToken) { showToast(translateText('Aguarde a verificação de segurança e tente novamente.')); return; }

  const btn = document.getElementById('c-submit');
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, message, website, turnstileToken }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      document.getElementById('contact-form').reset();
      closeContactForm();
      showToast(translateText('Mensagem enviada. Responderemos com a maior brevidade possível.'));
    } else {
      showToast(translateText(data.error || 'Não foi possível enviar a mensagem. Tente novamente mais tarde.'));
    }
  } catch (err) {
    console.error(err);
    showToast(translateText('Não foi possível ligar ao servidor. Verifique a sua ligação.'));
  } finally {
    btn.disabled = false;
    resetTurnstile('contact-turnstile');
  }
}

function closeRoomDetails() {
  clearInterval(roomCarouselTimer);
  roomCarouselTimer = null;
  document.getElementById('room-detail-modal').classList.remove('open');
}

// ── Modal de reserva ──────────────────────────────────────
function getBookingDateError(checkIn, checkOut) {
  if (!checkIn || !checkOut) {
    return 'Selecione as datas de entrada e saída antes de reservar.';
  }
  if (checkIn < getMinimumCheckInDate()) {
    return 'Essa data de entrada já não está disponível. Reservas para o próprio dia são aceites até às 22:00.';
  }
  const nights = Math.round((new Date(`${checkOut}T00:00:00`) - new Date(`${checkIn}T00:00:00`)) / 86400000);
  if (!Number.isFinite(nights) || nights < MINIMUM_STAY_NIGHTS) {
    return translateTemplate('A estadia mínima é de {{nights}} noites consecutivas.', { nights: MINIMUM_STAY_NIGHTS });
  }
  return null;
}

function openBooking() {
  const dateError = getBookingDateError(
    document.getElementById('f-checkin').value,
    document.getElementById('f-checkout').value
  );
  if (dateError) {
    showToast(dateError);
    return false;
  }
  syncAgeGroupOptions();
  updateBookingPolicyHint();
  updateArrivalTimeOptions();
  updateMinimumCheckoutDate();
  document.getElementById('booking-modal').classList.add('open');
  renderTurnstile('booking-turnstile');
  updateSummary();
  return true;
}
function openBookingForRoom(value) {
  const room = allRooms.find(r => r.id === value || r.name === value || r.type === value);
  if (room) document.getElementById('f-room').value = room.id;
  openBooking();
}
function openBookingForRoomId(id) {
  document.getElementById('f-room').value = id;
  openBooking();
}
function closeBooking() {
  document.getElementById('booking-modal').classList.remove('open');
}

function updateSummary() {
  updateArrivalTimeOptions();
  refreshCribAvailability();
  const sel = document.getElementById('f-room');
  const opt = sel.options[sel.selectedIndex];
  const roomName = opt?.dataset?.name || opt?.text || '—';
  const ci = new Date(document.getElementById('f-checkin').value);
  const co = new Date(document.getElementById('f-checkout').value);
  const nights = Math.max(0, Math.round((co - ci) / 86400000));
  const party = getBookingParty();
  const guests = countPartyGuests(party);
  document.getElementById('s-room').textContent = roomName;
  document.getElementById('s-dates').textContent = nights > 0
    ? `${document.getElementById('f-checkin').value.split('-').reverse().join('-')} → ${document.getElementById('f-checkout').value.split('-').reverse().join('-')}` : '—';
  document.getElementById('s-nights').textContent = nights > 0
    ? `${nights} ${translateText(nights === 1 ? 'Noite' : 'Noites').toLocaleLowerCase(currentLanguage)}`
    : '—';
  // Uma linha por faixa etária escolhida (ex.: "2 adultos", "1 criança (3–6 anos)")
  const partyLines = [
    [party.adults, 'adulto', 'adultos'],
    [party.teens, 'jovem (7–17 anos)', 'jovens (7–17 anos)'],
    [party.children, 'criança (3–6 anos)', 'crianças (3–6 anos)'],
    [party.infants, 'bebé (0–2 anos)', 'bebés (0–2 anos)'],
    [party.cribs, 'berço', 'berços'],
  ].filter(([count]) => count > 0).map(([count, one, many]) => `${count} ${translateText(count === 1 ? one : many)}`);
  document.getElementById('s-guests').textContent = partyLines.length ? partyLines.join('\n') : '—';
  updateQuote(sel.value, nights);
}

// Pede ao servidor o preço da estadia (épocas, fins de semana, feriados, idades e berço)
let quoteRequestId = 0;
let quoteTimer = null;
function updateQuote(roomId, nights) {
  const totalEl = document.getElementById('s-total');
  const breakdownEl = document.getElementById('s-breakdown');
  const promoEl = document.getElementById('s-promo-hint');
  const checkIn = document.getElementById('f-checkin').value;
  const checkOut = document.getElementById('f-checkout').value;
  const party = getBookingParty();
  const room = allRooms.find(item => item.id === roomId);
  clearTimeout(quoteTimer);
  const requestId = ++quoteRequestId;
  if (!roomId || nights <= 0 || (room && countPartyGuests(party) > getRoomMaxGuests(room))) {
    totalEl.textContent = '—';
    breakdownEl.textContent = '';
    promoEl.textContent = '';
    return;
  }
  totalEl.textContent = translateText('A calcular...');
  quoteTimer = setTimeout(async () => {
    try {
      const params = new URLSearchParams({ checkIn, checkOut, ...party });
      const res = await fetch(`${API}/rooms/${roomId}/quote?${params}`);
      const quote = await res.json();
      if (requestId !== quoteRequestId) return;
      if (!res.ok) throw new Error(quote.error);
      const money = value => `€${new Intl.NumberFormat(currentLanguage, { maximumFractionDigits: 2 }).format(value)}`;
      totalEl.textContent = money(quote.total);
      const parts = [`${translateText('Alojamento')} ${money(quote.accommodation)}`];
      if (quote.guestAdjustment > 0) parts.push(`${translateText('Pessoas a mais')} +${money(quote.guestAdjustment)}`);
      if (quote.guestAdjustment < 0) parts.push(`${translateText('Desconto por pessoas a menos')} −${money(-quote.guestAdjustment)}`);
      if (quote.crib > 0) parts.push(`${translateText('Berço')} ${money(quote.crib)}`);
      if (quote.promotion) parts.push(`${translateText('Promoção')} «${quote.promotion.name}» −${quote.promotion.discountPct}% −${money(-quote.promotion.discount)}`);
      breakdownEl.textContent = parts.join(' · ');
      // Desconto aplicado a verde; se ainda faltarem noites para uma promoção, sugestão por baixo
      promoEl.classList.toggle('applied', Boolean(quote.promotion));
      promoEl.textContent = [
        quote.promotion
          ? translateTemplate('✓ Desconto de {{pct}}% aplicado (promoção «{{name}}»).', { name: quote.promotion.name, pct: quote.promotion.discountPct })
          : '',
        quote.nextPromotion
          ? translateTemplate('Reserve pelo menos {{nights}} noites e tenha {{pct}}% de desconto (promoção «{{name}}»).', {
            nights: quote.nextPromotion.minNights, pct: quote.nextPromotion.discountPct, name: quote.nextPromotion.name })
          : '',
      ].filter(Boolean).join(' ');
    } catch (err) {
      if (requestId !== quoteRequestId) return;
      console.error('Erro ao calcular preço:', err);
      totalEl.textContent = '—';
      breakdownEl.textContent = '';
      promoEl.textContent = '';
    }
  }, 250);
}
function setMinimumCheckoutDate(checkInId, checkOutId) {
  const checkInValue = document.getElementById(checkInId).value;
  const checkOutInput = document.getElementById(checkOutId);
  const minDateValue = shiftDateString(checkInValue || getMinimumCheckInDate(), MINIMUM_STAY_NIGHTS);
  checkOutInput.min = minDateValue;
  if (checkOutInput.value && checkOutInput.value < minDateValue) checkOutInput.value = '';
}
function updateMinimumCheckoutDate() { setMinimumCheckoutDate('f-checkin', 'f-checkout'); }
function updateBarMinimumCheckoutDate() { setMinimumCheckoutDate('bar-checkin', 'bar-checkout'); }
function validateCheckInInput(checkInId, checkOutId, updateCheckoutDate) {
  const checkInInput = document.getElementById(checkInId);
  const minimumDate = getMinimumCheckInDate();
  checkInInput.min = minimumDate;
  if (checkInInput.value && checkInInput.value < minimumDate) {
    checkInInput.value = '';
    document.getElementById(checkOutId).value = '';
    showToast('Essa data de entrada já não está disponível. Reservas para o próprio dia são aceites até às 22:00.');
  }
  updateCheckoutDate();
}
document.getElementById('bar-checkin').addEventListener('change', () =>
  validateCheckInInput('bar-checkin', 'bar-checkout', updateBarMinimumCheckoutDate)
);
document.getElementById('f-checkin').addEventListener('change', () => {
  validateCheckInInput('f-checkin', 'f-checkout', updateMinimumCheckoutDate);
  updateSummary();
});
document.getElementById('f-checkout').addEventListener('change', updateSummary);
Object.values(AGE_GROUP_FIELDS).forEach(id => document.getElementById(id).addEventListener('change', () => {
  updateGuestLimitHint();
  updateSummary();
}));
document.getElementById('f-cribs').addEventListener('change', () => {
  cribChoiceTouched = true;
  updateSummary();
});
document.getElementById('bar-room').addEventListener('change', () => syncGuestOptions('bar-room', 'bar-guests'));
document.getElementById('f-room').addEventListener('change', function() {
  syncAgeGroupOptions();
  updateBookingPolicyHint();
  updateArrivalTimeOptions();
  updateMinimumCheckoutDate();
  updateSummary();
  // Atualiza calendário público com disponibilidade do quarto selecionado
  loadPublicCalAvailability(this.value);
});
const phoneCountryDialCodes = `
BD:880 BE:32 BF:226 BG:359 BA:387 BB:1246 WF:681 BL:590 BM:1441 BN:673 BO:591 BH:973 BI:257 BJ:229 BT:975 JM:1876 BW:267 WS:685 BQ:599 BR:55 BS:1242 JE:441534 BY:375 BZ:501 RU:7 RW:250 RS:381 TL:670 RE:262 TM:993 TJ:992 RO:40 TK:690 GW:245 GU:1671 GT:502 GR:30 GQ:240 GP:590 JP:81 GY:592 GG:441481 GF:594 GE:995 GD:1473 GB:44 GA:241 SV:503 GN:224 GM:220 GL:299 GI:350 GH:233 OM:968 TN:216 JO:962 HR:385 HT:509 HU:36 HK:852 HN:504 VE:58 PR:1787,1939 PS:970 PW:680 PT:351 SJ:47 PY:595 IQ:964 PA:507 PF:689 PG:675 PE:51 PK:92 PH:63 PN:870 PL:48 PM:508 ZM:260 EH:212 EE:372 EG:20 ZA:27 EC:593 IT:39 VN:84 SB:677 ET:251 SO:252 ZW:263 SA:966 ES:34 ER:291 ME:382 MD:373 MG:261 MA:212 MC:377 UZ:998 MM:95 ML:223 MO:853 MN:976 MH:692 MK:389 MU:230 MT:356 MW:265 MV:960 MQ:596 MP:1670 MS:1664 MR:222 IM:441624 UG:256 TZ:255 MY:60 MX:52 IL:972 FR:33 IO:246 SH:290 FI:358 FJ:679 FK:500 FM:691 FO:298 NI:505 NL:31 NO:47 NA:264 VU:678 NC:687 NE:227 NF:672 NG:234 NZ:64 NP:977 NR:674 NU:683 CK:682 CI:225 CH:41 CO:57 CN:86 CM:237 CL:56 CC:61 CA:1 CG:242 CF:236 CD:243 CZ:420 CY:357 CX:61 CR:506 CW:599 CV:238 CU:53 SZ:268 SY:963 SX:599 KG:996 KE:254 SS:211 SR:597 KI:686 KH:855 KN:1869 KM:269 ST:239 SK:421 KR:82 SI:386 KP:850 KW:965 SN:221 SM:378 SL:232 SC:248 KZ:7 KY:1345 SG:65 SE:46 SD:249 DO:1809,1829 DM:1767 DJ:253 DK:45 VG:1284 DE:49 YE:967 DZ:213 US:1 UY:598 YT:262 UM:1 LB:961 LC:1758 LA:856 TV:688 TW:886 TT:1868 TR:90 LK:94 LI:423 LV:371 TO:676 LT:370 LU:352 LR:231 LS:266 TH:66 TG:228 TD:235 TC:1649 LY:218 VA:379 VC:1784 AE:971 AD:376 AG:1268 AF:93 AI:1264 VI:1340 IS:354 IR:98 AM:374 AL:355 AO:244 AS:1684 AR:54 AU:61 AT:43 AW:297 IN:91 AX:35818 AZ:994 IE:353 ID:62 UA:380 QA:974 MZ:258 XK:383
`.trim().split(/\s+/).map(entry => {
  const [country, prefixes] = entry.split(':');
  return { country, prefixes: prefixes.split(',') };
});

function populatePhoneCountryCodes() {
  const select = document.getElementById('f-phone-code');
  const countryNames = new Intl.DisplayNames([currentLanguage], { type: 'region' });
  const options = phoneCountryDialCodes.flatMap(({ country, prefixes }) =>
    prefixes.map(prefix => ({
      country,
      name: countryNames.of(country) || country,
      value: `+${prefix}`,
    }))
  ).sort((a, b) => {
    if (a.country === 'PT') return -1;
    if (b.country === 'PT') return 1;
    return a.name.localeCompare(b.name, currentLanguage);
  });

  select.replaceChildren(...options.map(({ name, value }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = `${name} (${value})`;
    return option;
  }));
  select.value = '+351';
}

populatePhoneCountryCodes();

function resetPhoneHint() {
  const phoneHint = document.getElementById('phone-hint');
  phoneHint.classList.remove('error');
  phoneHint.textContent = 'Selecione o país e introduza o número.';
}

document.getElementById('f-phone-code').addEventListener('change', resetPhoneHint);
document.getElementById('f-phone').addEventListener('input', resetPhoneHint);

// ── Confirmar reserva → envia para a API ──────────────────
async function confirmBooking() {
  const name = document.getElementById('f-name').value.trim();
  const emailInput = document.getElementById('f-email');
  const email = emailInput.value.trim();
  emailInput.value = email;
  const phoneNumber = document.getElementById('f-phone').value.trim();
  const phoneCode = document.getElementById('f-phone-code').value.trim();
  const roomId = document.getElementById('f-room').value;
  const checkIn = document.getElementById('f-checkin').value;
  const checkOut = document.getElementById('f-checkout').value;
  const party = getBookingParty();
  const arrivalTime = document.getElementById('f-arrival-time').value;
  const specialRequests = document.getElementById('f-notes').value.trim();

  if (!name || !email) { showToast('Por favor preencha nome e email.'); return; }
  if (!emailInput.checkValidity()) {
    emailInput.reportValidity();
    showToast('Introduza um endereço de email válido.');
    return;
  }
  const phoneHint = document.getElementById('phone-hint');
  phoneHint.classList.remove('error');
  phoneHint.textContent = 'Selecione o país e introduza o número.';
  if (!phoneNumber) {
    phoneHint.textContent = 'O número de telefone é obrigatório.';
    phoneHint.classList.add('error');
    document.getElementById('f-phone').focus();
    showToast('Introduza um número de telefone para continuar.');
    return;
  }
  const nationalDigits = phoneNumber.replace(/[\s().-]/g, '');
  const callingCodeDigits = phoneCode.startsWith('+') ? phoneCode.slice(1) : '';
  const combinedDigits = callingCodeDigits + nationalDigits;
  if (!/^\+[1-9]\d{0,5}$/.test(phoneCode) || !/^\d+$/.test(nationalDigits) || !/^[1-9]\d{6,14}$/.test(combinedDigits)) {
    phoneHint.textContent = 'Verifique o país, indicativo e número: devem ter entre 7 e 15 algarismos no total.';
    phoneHint.classList.add('error');
    document.getElementById(/^\+[1-9]\d{0,5}$/.test(phoneCode) ? 'f-phone' : 'f-phone-code').focus();
    showToast('Introduza um telefone válido com indicativo internacional.');
    return;
  }
  const phone = `+${combinedDigits}`;
  if (!checkIn || !checkOut) { showToast('Por favor selecione as datas.'); return; }
  if (checkIn < getMinimumCheckInDate()) {
    showToast('Essa data de entrada já não está disponível. Reservas para o próprio dia são aceites até às 22:00.');
    return;
  }
  if (!roomId) { showToast('Por favor selecione um quarto.'); return; }
  if (!arrivalTime) { showToast('Indique a hora prevista de chegada.'); return; }
  const selectedRoom = allRooms.find(room => room.id === roomId);
  const maxGuests = selectedRoom ? getRoomMaxGuests(selectedRoom) : 8;
  if (party.adults < 1) {
    showToast(translateText('A reserva tem de incluir pelo menos um adulto.'));
    return;
  }
  if (countPartyGuests(party) > maxGuests) {
    showToast(translateTemplate('Esta unidade permite até {{max}} hóspedes (bebés até 2 anos não contam).', { max: maxGuests }));
    return;
  }
  const nights = Math.round((new Date(checkOut) - new Date(checkIn)) / 86400000);
  if (nights < MINIMUM_STAY_NIGHTS) {
    showToast(`A estadia mínima é de ${MINIMUM_STAY_NIGHTS} noites consecutivas.`);
    return;
  }
  const reservationNotes = [`Hora prevista de chegada: ${arrivalTime}`, specialRequests].filter(Boolean).join('\n');
  const turnstileToken = getTurnstileToken('booking-turnstile');
  if (!turnstileToken) { showToast(translateText('Aguarde a verificação de segurança e tente novamente.')); return; }
  const website = document.getElementById('f-website').value;

  const btn = document.querySelector('.btn-confirm');
  btn.disabled = true;
  btn.textContent = 'A enviar pedido...';

  try {
    const res = await fetch(`${API}/reservations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, phone, roomId, checkIn, checkOut, ...party, specialRequests: reservationNotes, website, turnstileToken, language: currentLanguage })
    });

    const data = await res.json();

    if (res.ok) {
      if (data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
      } else {
        closeBooking();
        showToast(data.message || 'Pedido enviado. Aguarde a resposta do proprietário.');
        ['f-name','f-email','f-phone','f-notes'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('f-phone-code').value = '+351';
        document.getElementById('f-arrival-time').value = '';
      }
    } else {
      showToast(data.error || 'Erro ao criar reserva. Tente novamente.');
    }
  } catch(err) {
    showToast('Não foi possível ligar ao servidor. Verifique a sua ligação.');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enviar pedido de reserva';
    resetTurnstile('booking-turnstile');
  }
}

// ── Inicialização ─────────────────────────────────────────
const paymentParams = new URLSearchParams(window.location.search);
const paymentResult = paymentParams.get('payment');
const paymentReservationId = paymentParams.get('reservation');
const paymentCancelSignature = paymentParams.get('sig');
if (paymentResult === 'success') {
  showToast('Pagamento concluído. A confirmação da reserva será enviada por email.');
} else if (paymentResult === 'cancelled') {
  if (paymentReservationId) {
    fetch(`${API}/reservations/${encodeURIComponent(paymentReservationId)}/cancel-checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sig: paymentCancelSignature })
    })
      .catch(err => console.error('Erro ao cancelar sessão de pagamento:', err));
  }
  showToast('Pagamento cancelado. Pode iniciar uma nova reserva.');
}
if (paymentResult) history.replaceState(null, '', window.location.pathname + window.location.hash);

loadRooms();
loadReviews();

// ── Avaliações publicadas (secção escondida enquanto não houver nenhuma) ──
const REVIEWS_FIRST_PAGE = 6;
function escapeReviewText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}
function reviewStars(value) {
  const full = Math.round(value);
  return `<span class="review-stars-display" aria-label="${value} / 5">${'★'.repeat(full)}<span class="off">${'★'.repeat(5 - full)}</span></span>`;
}
async function loadReviews() {
  try {
    const res = await fetchWithRetry(`${API}/reviews`);
    const data = await res.json();
    if (!res.ok || !data.summary?.count) return;
    const average = new Intl.NumberFormat(currentLanguage, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(data.summary.average);
    const roomChips = Object.entries(data.summary.rooms).map(([roomId, room]) => {
      const name = data.reviews.find(review => review.roomId === roomId)?.roomType || '';
      return `<span class="reviews-room">${escapeReviewText(name)} · ${new Intl.NumberFormat(currentLanguage, { maximumFractionDigits: 1 }).format(room.average)} ★</span>`;
    }).join('');
    document.getElementById('reviews-summary').innerHTML = `
      <div class="reviews-average"><span class="reviews-average-num">${average}</span>${reviewStars(data.summary.average)}</div>
      <span class="reviews-count">${data.summary.count} ${translateText(data.summary.count === 1 ? 'avaliação' : 'avaliações')}</span>
      ${Object.keys(data.summary.rooms).length > 1 ? roomChips : ''}`;
    const month = value => value ? new Date(`${value}-01T00:00:00Z`).toLocaleDateString(currentLanguage, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
    const grid = document.getElementById('reviews-grid');
    grid.innerHTML = data.reviews.map((review, index) => `
      <article class="review-item"${index >= REVIEWS_FIRST_PAGE ? ' hidden' : ''}>
        ${reviewStars(review.rating)}
        ${review.comment ? `<p class="review-item-comment">${escapeReviewText(review.comment)}</p>` : ''}
        ${review.ownerReply ? `<div class="review-item-reply"><strong>${translateText('Resposta da Casa do Ferreiro')}</strong>${escapeReviewText(review.ownerReply)}</div>` : ''}
        <div class="review-item-meta"><strong>${escapeReviewText(review.displayName)}</strong> · ${escapeReviewText(review.roomName)} · ${escapeReviewText(month(review.stayMonth))}</div>
      </article>`).join('');
    const more = document.getElementById('reviews-more');
    more.hidden = data.reviews.length <= REVIEWS_FIRST_PAGE;
    more.onclick = () => { grid.querySelectorAll('.review-item[hidden]').forEach(item => { item.hidden = false; }); more.hidden = true; };
    document.getElementById('reviews').hidden = false;
  } catch (err) {
    console.error('Erro ao carregar avaliações:', err);
  }
}
