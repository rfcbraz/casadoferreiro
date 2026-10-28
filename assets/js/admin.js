// Casa do Ferreiro — painel de gestão (depois de common.js)
// ── Admin panel ───────────────────────────────────────────
const ADMIN_TOKEN_KEY = 'casadaserra-admin-token';
let adminToken = sessionStorage.getItem(ADMIN_TOKEN_KEY);
let adminReservationsFilter = null;
const ADMIN_RESERVATIONS_PAGE = 50;
let adminReservationsLimit = ADMIN_RESERVATIONS_PAGE; // aumenta com "Mostrar mais"
let adminReservationPollTimer = null;

function showAdminPanel() {
  document.getElementById('admin-login').hidden = true;
  document.getElementById('admin-panel').classList.add('open');
  loadAdminStats();
  loadAdminReservations();
  startAdminReservationPolling();
  loadAdminReviews(); // contador de avaliações por publicar no menu
}

function startAdminReservationPolling() {
  clearInterval(adminReservationPollTimer);
  adminReservationPollTimer = setInterval(() => {
    const panel = document.getElementById('admin-panel');
    const reservationsTab = document.getElementById('admin-tab-reservations');
    if (!adminToken || !panel?.classList.contains('open') || reservationsTab?.style.display === 'none') return;
    loadAdminReservations(adminReservationsFilter);
    loadAdminStats();
  }, 30000);
}

async function restoreAdminSession() {
  if (!adminToken) return;
  showAdminPanel();

  try {
    const res = await fetch(`${API}/admin/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (res.status === 401) {
      logoutAdmin();
    } else if (!res.ok) {
      throw new Error(`Erro ao validar sessão admin (HTTP ${res.status}).`);
    }
  } catch(err) {
    console.error('Erro ao validar sessão admin:', err);
  }
}

function closeAdmin() {
  document.getElementById('admin-panel').classList.remove('open');
  clearInterval(adminReservationPollTimer);
  adminReservationPollTimer = null;
}
function logoutAdmin() {
  adminToken = null;
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  closeAdmin();
  showAdminLogin();
}
function adminTab(tab, el) {
  document.querySelectorAll('[id^="admin-tab-"]').forEach(e => e.style.display = 'none');
  document.getElementById('admin-tab-' + tab).style.display = 'block';
  document.querySelectorAll('.admin-nav-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  if (tab === 'reservations') loadAdminReservations();
  if (tab === 'stats') loadAdminStats();
  if (tab === 'reviews') loadAdminReviews();
  if (tab === 'rooms') loadAdminRooms();
  if (tab === 'prices') loadPriceAdminRooms();
  if (tab === 'availability') {
    resetAdminSelection();
    adminOccupiedDates = new Set();
    adminBlockedDates = new Set();
    adminImportedDates = new Map();
    renderAdminCal();
    loadAdminRooms().then(() => { if (document.getElementById('avail-room-select')?.value) loadRoomAvailability(); });
    loadCribs();
  }
}

function showAdminLogin() {
  document.getElementById('admin-login').hidden = false;
  document.getElementById('admin-login-error').style.display = 'none';
  document.getElementById('admin-pass-input').value = '';
  document.getElementById('admin-email-input').focus();
}

async function doAdminLogin(event) {
  event?.preventDefault();
  const email = document.getElementById('admin-email-input').value;
  const password = document.getElementById('admin-pass-input').value;
  const errEl = document.getElementById('admin-login-error');
  try {
    const res = await fetch(`${API}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token;
      sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
      document.getElementById('admin-pass-input').value = '';
      showAdminPanel();
    } else {
      errEl.textContent = data.error || 'Credenciais inválidas.';
      errEl.style.display = 'block';
    }
  } catch(err) {
    errEl.textContent = 'Erro de ligação ao servidor.';
    errEl.style.display = 'block';
  }
}

function setAdminText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

async function loadAdminStats() {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API}/admin/stats`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const d = await res.json();
    if (res.status === 401) { logoutAdmin(); return; }
    if (!res.ok) throw new Error(d.error);

    // Cards do separador Reservas
    const resTotal = document.getElementById('res-card-total');
    const resTotalSub = document.getElementById('res-card-total-sub');
    const resPending = document.getElementById('res-card-pending');
    const resPendingSub = document.getElementById('res-card-pending-sub');
    const growthText = d.revenueGrowth != null
      ? `${d.revenueGrowth > 0 ? '+' : ''}${String(d.revenueGrowth).replace('.', ',')}% vs ${d.lastMonthName}`
      : `Sem receita em ${d.lastMonthName}`;
    if (resTotal) resTotal.textContent = d.totalReservations ?? '—';
    if (resTotalSub) resTotalSub.textContent = 'Sem canceladas nem recusadas';
    if (resPending) resPending.textContent = d.pendingReservations ?? '—';
    if (resPendingSub) resPendingSub.textContent = d.pendingReservations === 0 ? 'Tudo em dia' : 'Aguardam confirmação';
    setAdminText('res-card-occupancy', `${d.occupancyRate ?? 0}%`);
    setAdminText('res-card-occupancy-sub', d.monthLabel);
    setAdminText('res-card-revenue', adminMoney(d.monthRevenue || 0));
    setAdminText('res-card-revenue-sub', growthText);

    // Cards do separador Estatísticas
    const rev = document.getElementById('stat-month-revenue');
    const revGrowth = document.getElementById('stat-revenue-growth');
    const totalRes = document.getElementById('stat-total-res');
    const pending = document.getElementById('stat-pending');
    const occ = document.getElementById('stat-occupancy');
    const occDetail = document.getElementById('stat-occupancy-detail');
    const upcoming = document.getElementById('stat-upcoming');
    const upcomingList = document.getElementById('stat-upcoming-list');

    if (rev) rev.textContent = adminMoney(d.monthRevenue || 0);
    if (revGrowth) revGrowth.textContent = growthText;
    setAdminText('stat-revenue-label', `Receita ${d.monthLabel}`);
    setAdminText('stat-occupancy-label', `Ocupação ${d.monthLabel}`);
    if (totalRes) totalRes.textContent = d.totalReservations ?? '—';
    if (pending) pending.textContent = `${d.pendingReservations ?? 0} pendente(s)`;
    if (occ) occ.textContent = (d.occupancyRate ?? 0) + '%';
    if (occDetail) occDetail.textContent = `${d.occupiedNights ?? 0} de ${d.availableNights ?? 0} noites · ${d.occupancyToday ?? 0} de ${d.totalRooms ?? 0} unidade(s) ocupada(s) hoje`;
    if (upcoming) upcoming.textContent = d.upcomingCheckIns?.length ?? 0;

    if (upcomingList) {
      if (!d.upcomingCheckIns || d.upcomingCheckIns.length === 0) {
        upcomingList.innerHTML = '<div style="padding:1.5rem;color:var(--muted);font-size:.85rem">Sem check-ins próximos.</div>';
      } else {
        upcomingList.innerHTML = d.upcomingCheckIns.map(r => `
          <div class="admin-table-row" style="grid-template-columns:2fr 1.5fr 1fr 1fr">
            <div><div class="admin-guest-name">${escapeAdminHtml(r.contactName || r.guest.name)}</div><div class="admin-guest-email">${escapeAdminHtml(r.guest.email)}</div><div class="admin-ref">#${r.id.slice(0, 8).toUpperCase()}</div></div>
            <div><span class="admin-room-badge">${escapeAdminHtml(r.room.name)}</span></div>
            <div style="font-size:.85rem">${new Date(r.checkIn).toLocaleDateString('pt-PT',{day:'numeric',month:'short'})}</div>
            <div style="font-size:.85rem">${new Date(r.checkOut).toLocaleDateString('pt-PT',{day:'numeric',month:'short'})}</div>
          </div>`).join('');
      }
    }
  } catch(err) { console.error('Erro stats:', err); }
}

async function loadAdminReservations(statusFilter) {
  if (!adminToken) return;
  const tbody = document.getElementById('admin-reservations-body');
  if (!tbody) return;
  try {
    const params = new URLSearchParams({ limit: adminReservationsLimit });
    if (statusFilter) params.set('status', statusFilter);
    const url = `${API}/reservations?${params}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro ao carregar reservas (HTTP ${res.status}).`);
    }
    if (!Array.isArray(data.reservations)) {
      throw new Error('Resposta inválida ao carregar reservas.');
    }
    const statusLabel = { PENDING: 'Pendente', AWAITING_PAYMENT: 'Aguardar pagamento', CONFIRMED: 'Confirmada', DECLINED: 'Recusada', CANCELLED: 'Cancelada', PAID: 'Paga', COMPLETED: 'Concluída' };
    const statusClass = { PENDING: 'pending', AWAITING_PAYMENT: 'pending', CONFIRMED: 'confirmed', DECLINED: 'declined', CANCELLED: 'cancelled', PAID: 'confirmed', COMPLETED: 'confirmed' };
    tbody.innerHTML = data.reservations.map(r => `
      <div class="admin-table-row">
        <div><div class="admin-guest-name">${escapeAdminHtml(r.contactName || r.guest.name)}</div><div class="admin-guest-email">${escapeAdminHtml(r.guest.email)}</div><div class="admin-ref">#${r.id.slice(0, 8).toUpperCase()}</div></div>
        <div><span class="admin-room-badge">${r.room.name}</span></div>
        <div style="font-size:.85rem">${new Date(r.checkIn).toLocaleDateString('pt-PT',{day:'numeric',month:'short'})}</div>
        <div style="font-size:.85rem">${new Date(r.checkOut).toLocaleDateString('pt-PT',{day:'numeric',month:'short'})}</div>
        <div><span class="admin-status ${statusClass[r.status]||'pending'}">${typeof statusLabel[r.status] === 'function' ? statusLabel[r.status](r) : statusLabel[r.status]||r.status}</span></div>
        <div class="admin-actions">
          ${r.status==='PENDING' && !r.stripeCheckoutSessionId?`<button class="admin-action" onclick="updateReservationStatus('${r.id}','CONFIRMED')">✓ Aceitar</button>`:''}
          ${r.status==='PENDING'?`<button class="admin-action" onclick="updateReservationStatus('${r.id}','DECLINED')">✕ Recusar</button>`:''}
          ${r.status!=='CANCELLED' && r.status!=='DECLINED' && r.status!=='PENDING'?`<button class="admin-action" onclick="updateReservationStatus('${r.id}','CANCELLED')">↺ Cancelar</button>`:''}
          ${['AWAITING_PAYMENT','CONFIRMED','DECLINED'].includes(r.status)?`<button class="admin-action" onclick="deleteDecidedReservation('${r.id}')">🗑 Apagar</button>`:''}
        </div>
      </div>
      <div style="grid-column:1/-1;padding:.4rem 0 .6rem;border-bottom:1px solid var(--warm);font-size:.75rem;color:var(--muted);display:flex;gap:1.5rem;flex-wrap:wrap">
        <span>💰 Total: <strong style="color:var(--dark)">${adminMoney(r.totalPrice)}</strong></span>
        <span>👥 Hóspedes: <strong style="color:var(--dark)">${formatReservationParty(r)}</strong></span>
        ${r.specialRequests ? `<span>📝 Pedidos: <strong style="color:var(--dark)">${escapeAdminHtml(r.specialRequests)}</strong></span>` : ''}
      </div>`).join('')
      + (data.total > data.reservations.length
        ? `<div class="admin-more"><span>${data.reservations.length} de ${data.total}</span><button type="button" class="admin-action" onclick="showMoreReservations()">Mostrar mais</button></div>`
        : '');
  } catch(err) {
    console.error('Erro reservas:', err);
    const message = document.createElement('div');
    message.style.cssText = 'padding:2rem;color:#dc2626;font-size:.85rem';
    message.textContent = err.message || 'Não foi possível carregar as reservas.';
    tbody.replaceChildren(message);
  }
}

function showMoreReservations() {
  adminReservationsLimit += ADMIN_RESERVATIONS_PAGE;
  loadAdminReservations(adminReservationsFilter);
}

function filterReservations(status, el) {
  adminReservationsFilter = status;
  adminReservationsLimit = ADMIN_RESERVATIONS_PAGE;
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  loadAdminReservations(status);
}

async function updateReservationStatus(id, status) {
  if (!adminToken) return;
  try {
    const res = await fetch(`${API}/reservations/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ status })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Não foi possível atualizar a reserva.');
      return;
    }
    showToast(data.message || (status === 'CONFIRMED' ? 'Pedido aprovado; link de pagamento enviado.' : status === 'DECLINED' ? 'Reserva recusada.' : 'Reserva cancelada.'));
    loadAdminReservations();
    loadAdminStats();
  } catch(err) { showToast('Erro ao atualizar reserva.'); }
}

async function deleteDecidedReservation(id) {
  if (!adminToken) return;
  if (!window.confirm('Apagar permanentemente esta reserva? Esta ação não pode ser anulada.')) return;

  try {
    const res = await fetch(`${API}/reservations/${id}/record`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Não foi possível apagar a reserva.');
      return;
    }
    showToast(data.message || 'Reserva apagada com sucesso.');
    await loadAdminReservations();
    loadAdminStats();
  } catch(err) {
    showToast('Erro de ligação ao apagar a reserva.');
  }
}

// ── Gestão de Quartos ────────────────────────────────────
async function loadAdminRooms() {
  if (!adminToken) return;
  const tbody = document.getElementById('admin-rooms-body');
  if (!tbody) return;
  try {
    const res = await fetch(`${API}/rooms/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Erro ao carregar quartos (HTTP ${res.status}).`);
    }
    if (!Array.isArray(data)) {
      throw new Error('Resposta inválida ao carregar quartos.');
    }
    adminRooms = data;

    // Only active units can have availability managed for new bookings.
    const sel = document.getElementById('avail-room-select');
    if (sel) {
      sel.innerHTML = '<option value="">Seleciona um quarto...</option>';
      const previous = sel.value;
      adminRooms.filter(r => r.isActive).forEach(r => sel.innerHTML += `<option value="${r.id}">${escapeAdminHtml(r.name)}</option>`);
      if ([...sel.options].some(option => option.value === previous)) sel.value = previous;
    }

    tbody.innerHTML = adminRooms.map(r => `
      <div class="admin-table-row" style="grid-template-columns:2fr 1fr 1fr 1fr 1fr 2fr">
        <div class="admin-guest-name">${r.name}</div>
        <div><span class="admin-room-badge">${r.type}</span></div>
        <div style="font-size:.9rem;font-weight:500">€${r.pricePerNight}</div>
        <div style="font-size:.85rem">${r.capacity} pessoa${r.capacity > 1 ? 's' : ''}</div>
        <div><span class="admin-status ${r.isActive ? 'confirmed' : 'cancelled'}">${r.isActive ? 'Ativo' : 'Inativo'}</span></div>
        <div style="display:flex;gap:.4rem">
          <button class="admin-action" onclick="openEditRoom('${r.id}')">✏ Editar</button>
          <button class="admin-action" onclick="toggleRoomActive('${r.id}', ${r.isActive})">${r.isActive ? '🚫 Desativar' : '✓ Ativar'}</button>
        </div>
      </div>`).join('');
  } catch(err) {
    console.error('Erro quartos:', err);
    tbody.innerHTML = `<div style="padding:2rem;color:#dc2626;font-size:.85rem">${err.message || 'Não foi possível carregar os quartos.'}</div>`;
  }
}

function openEditRoom(id) {
  const room = adminRooms.find(r => r.id === id);
  if (!room) return;
  document.getElementById('edit-room-id').value = room.id;
  document.getElementById('edit-room-name').value = room.name;
  document.getElementById('edit-room-type').value = room.type;
  document.getElementById('edit-room-price').value = room.pricePerNight;
  document.getElementById('edit-room-capacity').value = room.capacity;
  document.getElementById('edit-room-size').value = room.sizeSqm || '';
  document.getElementById('edit-room-bedrooms').value = room.bedrooms || '';
  document.getElementById('edit-room-beds').value = room.beds || '';
  document.getElementById('edit-room-desc').value = room.description;
  document.getElementById('edit-room-amenities').value = (room.amenities || []).join(', ');
  document.getElementById('edit-room-booking-ical').value = room.bookingIcalUrl || '';
  document.getElementById('edit-room-airbnb-ical').value = room.airbnbIcalUrl || '';
  document.getElementById('edit-room-export-booking').value = icalExportUrl(room.id, 'booking');
  document.getElementById('edit-room-export-airbnb').value = icalExportUrl(room.id, 'airbnb');
  document.getElementById('edit-room-active').value = String(room.isActive);
  document.getElementById('edit-room-modal').style.display = 'flex';
}

// Calendário que o Booking/Airbnb lê (sem as noites que vieram dessa mesma plataforma)
function icalExportUrl(roomId, platform) {
  return `${API.replace(/\/api$/, '')}/ical/${roomId}.ics?para=${platform}`;
}

async function copyIcalLink(inputId) {
  const input = document.getElementById(inputId);
  try {
    await navigator.clipboard.writeText(input.value);
  } catch (err) {
    input.select();
    document.execCommand('copy');
  }
  showToast('✓ Link copiado.');
}

// ── Alterar password ──────────────────────────────────────
function openPasswordModal() {
  ['pw-current', 'pw-new', 'pw-confirm'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pw-error').style.display = 'none';
  document.getElementById('password-modal').hidden = false;
  document.getElementById('pw-current').focus();
}

function closePasswordModal() {
  document.getElementById('password-modal').hidden = true;
}

async function changeAdminPassword(event) {
  event.preventDefault();
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  const errEl = document.getElementById('pw-error');
  const fail = message => { errEl.textContent = message; errEl.style.display = 'block'; };
  if (newPassword.length < 12) return fail('A nova password deve ter pelo menos 12 caracteres.');
  if (newPassword !== document.getElementById('pw-confirm').value) return fail('As duas passwords novas não são iguais.');
  if (newPassword === currentPassword) return fail('A nova password tem de ser diferente da atual.');
  const btn = document.getElementById('pw-submit');
  btn.disabled = true;
  try {
    const res = await fetch(`${API}/admin/password`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'Não foi possível alterar a password.');
    closePasswordModal();
    logoutAdmin();
    showToast('✓ Password alterada. Entre com a nova password.');
  } catch (err) {
    fail('Erro de ligação ao servidor.');
  } finally {
    btn.disabled = false;
  }
}

// ── Avaliações ────────────────────────────────────────────
let adminReviews = [];
let adminReviewsFilter = 'PENDING';
const REVIEW_STATUS_LABEL = { PENDING: 'Por publicar', PUBLISHED: 'Publicada', HIDDEN: 'Oculta' };

function adminStars(value) {
  return value ? `<span class="admin-stars">${'★'.repeat(value)}<span class="off">${'★'.repeat(5 - value)}</span></span>` : '—';
}

async function loadAdminReviews() {
  const list = document.getElementById('reviews-admin-list');
  if (!list || !adminToken) return;
  try {
    const res = await fetch(`${API}/reviews/admin`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    adminReviews = data;
    renderAdminReviews();
  } catch (err) {
    console.error('Erro avaliações:', err);
    list.innerHTML = '<div class="price-rule-empty" style="color:#dc2626">Não foi possível carregar as avaliações.</div>';
  }
}

function filterReviews(status, el) {
  adminReviewsFilter = status;
  document.querySelectorAll('.review-filter').forEach(tab => tab.classList.remove('active'));
  el.classList.add('active');
  renderAdminReviews();
}

function renderAdminReviews() {
  const published = adminReviews.filter(review => review.status === 'PUBLISHED');
  const pending = adminReviews.filter(review => review.status === 'PENDING');
  const average = list => list.length ? (list.reduce((sum, review) => sum + review.rating, 0) / list.length).toLocaleString('pt-PT', { maximumFractionDigits: 1 }) : '—';
  document.getElementById('reviews-cards').innerHTML = `
    <div class="admin-card"><div class="admin-card-label">Média (todas)</div><div class="admin-card-num">${average(adminReviews)}</div><div class="admin-card-sub">${adminReviews.length} avaliação(ões)</div></div>
    <div class="admin-card"><div class="admin-card-label">Média no site</div><div class="admin-card-num">${average(published)}</div><div class="admin-card-sub">${published.length} publicada(s)</div></div>
    <div class="admin-card"><div class="admin-card-label">Por publicar</div><div class="admin-card-num">${pending.length}</div><div class="admin-card-sub">${pending.length ? 'Aguardam a sua decisão' : 'Tudo em dia'}</div></div>`;
  const badge = document.getElementById('reviews-pending-badge');
  if (badge) { badge.hidden = !pending.length; badge.textContent = pending.length; }

  const list = document.getElementById('reviews-admin-list');
  const visible = adminReviews.filter(review => !adminReviewsFilter || review.status === adminReviewsFilter);
  if (!visible.length) {
    list.innerHTML = '<div class="price-rule-empty">Sem avaliações nesta lista.</div>';
    return;
  }
  list.innerHTML = visible.map(review => `
    <div class="review-admin-item">
      <div class="review-admin-head">
        <div>${adminStars(review.rating)} <strong>${escapeAdminHtml(review.displayName)}</strong> · ${escapeAdminHtml(review.roomName)} · ${formatAdminDate(review.checkIn)} → ${formatAdminDate(review.checkOut)}</div>
        <span class="admin-status ${review.status === 'PUBLISHED' ? 'confirmed' : review.status === 'HIDDEN' ? 'cancelled' : 'pending'}">${REVIEW_STATUS_LABEL[review.status] || review.status}</span>
      </div>
      <div class="review-admin-sub">#${review.ref} · ${escapeAdminHtml(review.guestEmail)} · recebida ${formatAdminDate(review.createdAt)} · Limpeza ${adminStars(review.cleanliness)} · Conforto ${adminStars(review.comfort)} · Localização ${adminStars(review.location)}</div>
      ${review.comment ? `<p class="review-admin-comment">${escapeAdminHtml(review.comment)}</p>` : '<p class="review-admin-comment empty">Sem comentário.</p>'}
      ${review.consent ? '' : '<p class="review-admin-private">🔒 O hóspede não autorizou a publicação: esta avaliação é só para si.</p>'}
      ${review.consent ? `<div class="form-field review-admin-reply"><label for="reply-${review.id}">Resposta pública (opcional)</label><textarea id="reply-${review.id}" maxlength="1000" rows="2" placeholder="Ex.: Obrigado, Maria! Foi um prazer recebê-la.">${escapeAdminHtml(review.ownerReply || '')}</textarea></div>` : ''}
      <div class="admin-actions">
        ${review.status !== 'PUBLISHED' && review.consent ? `<button class="admin-action" type="button" onclick="updateReview('${review.id}', { status: 'PUBLISHED' })">✓ Publicar</button>` : ''}
        ${review.status !== 'HIDDEN' ? `<button class="admin-action" type="button" onclick="updateReview('${review.id}', { status: 'HIDDEN' })">Ocultar</button>` : ''}
        ${review.consent ? `<button class="admin-action" type="button" onclick="updateReview('${review.id}', { ownerReply: document.getElementById('reply-${review.id}').value })">Guardar resposta</button>` : ''}
        <button class="admin-action" type="button" onclick="deleteReview('${review.id}')">🗑 Apagar</button>
      </div>
    </div>`).join('');
}

async function updateReview(id, changes) {
  try {
    const res = await fetch(`${API}/reviews/admin/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(changes)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'Erro ao guardar.'); return; }
    showToast(changes.status === 'PUBLISHED' ? '✓ Avaliação publicada no site.' : changes.status === 'HIDDEN' ? 'Avaliação ocultada.' : '✓ Resposta guardada.');
    loadAdminReviews();
  } catch (err) { showToast('Erro de ligação.'); }
}

async function deleteReview(id) {
  if (!confirm('Apagar esta avaliação? Esta ação não pode ser anulada.')) return;
  try {
    const res = await fetch(`${API}/reviews/admin/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
    if (!res.ok) { showToast('Erro ao apagar.'); return; }
    showToast('Avaliação apagada.');
    loadAdminReviews();
  } catch (err) { showToast('Erro de ligação.'); }
}

function closeEditRoom() {
  document.getElementById('edit-room-modal').style.display = 'none';
}

async function saveRoom() {
  const id = document.getElementById('edit-room-id').value;
  const data = {
    name: document.getElementById('edit-room-name').value,
    type: document.getElementById('edit-room-type').value,
    pricePerNight: parseFloat(document.getElementById('edit-room-price').value),
    capacity: parseInt(document.getElementById('edit-room-capacity').value),
    sizeSqm: document.getElementById('edit-room-size').value ? parseFloat(document.getElementById('edit-room-size').value) : null,
    bedrooms: document.getElementById('edit-room-bedrooms').value ? parseInt(document.getElementById('edit-room-bedrooms').value) : null,
    beds: document.getElementById('edit-room-beds').value ? parseInt(document.getElementById('edit-room-beds').value) : null,
    description: document.getElementById('edit-room-desc').value,
    amenities: document.getElementById('edit-room-amenities').value.split(',').map(s => s.trim()).filter(Boolean),
    bookingIcalUrl: document.getElementById('edit-room-booking-ical').value.trim() || null,
    airbnbIcalUrl: document.getElementById('edit-room-airbnb-ical').value.trim() || null,
    isActive: document.getElementById('edit-room-active').value === 'true',
  };
  try {
    const res = await fetch(`${API}/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(data)
    });
    if (res.ok) {
      closeEditRoom();
      showToast('✓ Quarto atualizado com sucesso!');
      await loadAdminRooms();
    } else {
      const err = await res.json();
      showToast(err.error || 'Erro ao guardar.');
    }
  } catch(err) { showToast('Erro de ligação.'); }
}

// Idades de uma reserva; reservas antigas só têm o total de hóspedes
function formatReservationParty(r) {
  const groups = [[r.adults, 'adulto(s)'], [r.teens, '7–17 anos'], [r.children, '3–6 anos'], [r.infants, 'bebé(s) 0–2']]
    .filter(([count]) => count > 0)
    .map(([count, label]) => `${count} ${label}`);
  if (r.infants > 0) groups.push(r.cribs > 0 ? `${r.cribs} berço(s)` : 'sem berço (traz o seu)');
  return groups.length ? groups.join(' · ') : `${r.guests}`;
}

// ── Berços ────────────────────────────────────────────────
// Agrupa noites seguidas com o mesmo número de berços: "10 nov → 14 nov · 2 berços"
function groupCribUsage(usage) {
  const groups = [];
  usage.forEach(({ date, used }) => {
    const last = groups[groups.length - 1];
    if (last && last.used === used && shiftDateString(last.end, 1) === date) last.end = date;
    else groups.push({ start: date, end: date, used });
  });
  return groups;
}

async function loadCribs() {
  const list = document.getElementById('crib-holds-list');
  const usageEl = document.getElementById('crib-usage');
  if (!list || !adminToken) return;
  try {
    const res = await fetch(`${API}/admin/cribs`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    document.getElementById('crib-total').value = data.total;
    list.innerHTML = data.holds.length ? data.holds.map(hold => `
      <div class="price-rule-row crib-hold-row">
        <strong>${hold.cribs} berço(s)</strong>
        <span>${formatAdminShortDate(hold.startDate)} → ${formatAdminShortDate(hold.endDate)}</span>
        <span>${escapeAdminHtml(hold.note || '—')}</span>
        <button class="admin-action" type="button" onclick="deleteCribHold('${hold.id}')">🗑 Apagar</button>
      </div>`).join('')
      : '<div class="price-rule-empty">Sem registos manuais.</div>';
    const groups = groupCribUsage(data.usage);
    usageEl.innerHTML = groups.length ? groups.map(group => `
      <div class="crib-usage-row${group.used >= data.total ? ' full' : ''}">
        <span>${formatAdminShortDate(group.start)}${group.end !== group.start ? ` → ${formatAdminShortDate(group.end)}` : ''}</span>
        <strong>${group.used} de ${data.total}${group.used >= data.total ? ' · esgotados' : ''}</strong>
      </div>`).join('')
      : '<div class="price-rule-empty">Nenhum berço ocupado nos próximos 6 meses.</div>';
  } catch (err) {
    console.error('Erro berços:', err);
    list.innerHTML = '<div class="price-rule-empty" style="color:#dc2626">Não foi possível carregar os berços.</div>';
  }
}

async function saveCribTotal() {
  try {
    const res = await fetch(`${API}/admin/cribs`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ total: Number(document.getElementById('crib-total').value) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'Erro ao guardar.'); return; }
    showToast(`✓ Total de berços: ${data.total}.`);
    loadCribs();
  } catch (err) { showToast('Erro de ligação.'); }
}

async function addCribHold() {
  const body = {
    startDate: document.getElementById('crib-hold-start').value,
    endDate: document.getElementById('crib-hold-end').value,
    cribs: Number(document.getElementById('crib-hold-count').value),
    note: document.getElementById('crib-hold-note').value,
  };
  try {
    const res = await fetch(`${API}/admin/cribs/holds`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'Erro ao registar.'); return; }
    ['crib-hold-start', 'crib-hold-end', 'crib-hold-note'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('crib-hold-count').value = 1;
    showToast('✓ Berços registados.');
    loadCribs();
  } catch (err) { showToast('Erro de ligação.'); }
}

async function deleteCribHold(id) {
  if (!confirm('Apagar este registo de berços?')) return;
  try {
    const res = await fetch(`${API}/admin/cribs/holds/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminToken}` } });
    if (!res.ok) { showToast('Erro ao apagar.'); return; }
    loadCribs();
  } catch (err) { showToast('Erro de ligação.'); }
}

// ── Preços ────────────────────────────────────────────────
function adminMoney(value) {
  const amount = Number(value) || 0;
  return `€${new Intl.NumberFormat('pt-PT', { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 }).format(amount)}`;
}

function formatAdminDate(value) {
  return new Date(value).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function loadPriceAdminRooms() {
  if (!adminToken) return;
  if (!adminRooms.length) await loadAdminRooms();
  const select = document.getElementById('price-room-select');
  const previous = select.value;
  select.innerHTML = '<option value="">Seleciona uma unidade...</option>'
    + adminRooms.map(room => `<option value="${room.id}">${escapeAdminHtml(room.name)}</option>`).join('');
  select.value = adminRooms.some(room => room.id === previous) ? previous : (adminRooms[0]?.id || '');
  loadPriceAdmin();
}

function escapeAdminHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function loadPriceAdmin() {
  const roomId = document.getElementById('price-room-select').value;
  const content = document.getElementById('price-admin-content');
  content.style.display = roomId ? '' : 'none';
  if (!roomId) return;
  const room = adminRooms.find(item => item.id === roomId);
  document.getElementById('pr-base-price').value = room.pricePerNight ?? '';
  document.getElementById('pr-weekend-price').value = room.weekendPrice ?? '';
  document.getElementById('pr-base-occupancy').value = room.baseOccupancy ?? room.capacity;
  document.getElementById('pr-discount-pct').value = room.fewerGuestDiscountPct ?? 0;
  document.getElementById('pr-extra-fee').value = room.extraGuestFee ?? 0;
  document.getElementById('pr-crib-fee').value = room.cribFeePerNight ?? 0;
  document.getElementById('sim-result').innerHTML = '';
  await Promise.all([loadPriceRules(roomId), loadPromotions(roomId)]);
}

async function loadPriceRules(roomId) {
  const list = document.getElementById('price-rules-list');
  list.innerHTML = '<div class="price-rule-empty">A carregar...</div>';
  try {
    const res = await fetch(`${API}/rooms/${roomId}/price-rules`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const rules = await res.json();
    if (!res.ok) throw new Error(rules.error);
    list.innerHTML = rules.length ? rules.map(rule => `
      <div class="price-rule-row">
        <span class="price-rule-kind">${rule.kind === 'SEASON' ? 'Época' : 'Feriado'}</span>
        <strong>${escapeAdminHtml(rule.name)}</strong>
        <span>${formatAdminDate(rule.startDate)} → ${formatAdminDate(rule.endDate)}</span>
        <span>${adminMoney(rule.price)} / noite</span>
        <span>${rule.weekendPrice != null ? `${adminMoney(rule.weekendPrice)} fim de semana` : '—'}</span>
        <button class="admin-action" type="button" onclick="deletePriceRule('${rule.id}')">🗑 Apagar</button>
      </div>`).join('')
      : '<div class="price-rule-empty">Sem épocas nem feriados. Todas as noites usam o preço base.</div>';
  } catch (err) {
    console.error('Erro ao carregar preços:', err);
    list.innerHTML = '<div class="price-rule-empty" style="color:#dc2626">Não foi possível carregar as épocas e feriados.</div>';
  }
}

async function savePriceSettings() {
  const roomId = document.getElementById('price-room-select').value;
  const value = id => document.getElementById(id).value.trim();
  const data = {
    pricePerNight: value('pr-base-price'),
    weekendPrice: value('pr-weekend-price'),
    baseOccupancy: value('pr-base-occupancy'),
    fewerGuestDiscountPct: value('pr-discount-pct'),
    extraGuestFee: value('pr-extra-fee'),
    cribFeePerNight: value('pr-crib-fee'),
  };
  if (!(parseFloat(data.pricePerNight) > 0)) { showToast('Indique um preço base válido.'); return; }
  try {
    const res = await fetch(`${API}/rooms/${roomId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(data)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(result.error || 'Erro ao guardar.'); return; }
    adminRooms = adminRooms.map(room => room.id === roomId ? result : room);
    showToast('✓ Preços guardados.');
  } catch (err) { showToast('Erro de ligação.'); }
}

async function addPriceRule() {
  const roomId = document.getElementById('price-room-select').value;
  const kind = document.getElementById('rule-kind').value;
  const data = {
    kind,
    name: document.getElementById('rule-name').value.trim(),
    startDate: document.getElementById('rule-start').value,
    endDate: document.getElementById('rule-end').value,
    price: document.getElementById('rule-price').value,
    weekendPrice: kind === 'SEASON' ? document.getElementById('rule-weekend').value : null,
  };
  try {
    const res = await fetch(`${API}/rooms/${roomId}/price-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(data)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(result.error || 'Erro ao adicionar.'); return; }
    ['rule-name', 'rule-start', 'rule-end', 'rule-price', 'rule-weekend'].forEach(id => { document.getElementById(id).value = ''; });
    showToast('✓ Adicionado.');
    await loadPriceRules(roomId);
  } catch (err) { showToast('Erro de ligação.'); }
}

async function deletePriceRule(ruleId) {
  if (!confirm('Apagar esta época/feriado?')) return;
  try {
    const res = await fetch(`${API}/rooms/price-rules/${ruleId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!res.ok) { showToast('Erro ao apagar.'); return; }
    await loadPriceRules(document.getElementById('price-room-select').value);
  } catch (err) { showToast('Erro de ligação.'); }
}

async function loadPromotions(roomId) {
  const list = document.getElementById('promotions-list');
  list.innerHTML = '<div class="price-rule-empty">A carregar...</div>';
  try {
    const res = await fetch(`${API}/rooms/${roomId}/promotions`, { headers: { Authorization: `Bearer ${adminToken}` } });
    const promotions = await res.json();
    if (!res.ok) throw new Error(promotions.error);
    list.innerHTML = promotions.length ? promotions.map(promo => `
      <div class="price-rule-row promo-row">
        <strong>${escapeAdminHtml(promo.name)}</strong>
        <span>${formatAdminDate(promo.startDate)} → ${formatAdminDate(promo.endDate)}</span>
        <span>−${promo.discountPct}%</span>
        <span>${promo.minNights}+ noites · ${promo.roomId ? 'esta unidade' : 'todas'}</span>
        <span class="promo-status ${promo.isActive ? 'on' : 'off'}">${promo.isActive ? '● Ativa' : '○ Inativa'}</span>
        <span style="display:flex;gap:.4rem">
          <button class="admin-action" type="button" onclick="togglePromotion('${promo.id}', ${!promo.isActive})">${promo.isActive ? 'Desativar' : 'Ativar'}</button>
          <button class="admin-action" type="button" onclick="deletePromotion('${promo.id}')">🗑 Apagar</button>
        </span>
      </div>`).join('')
      : '<div class="price-rule-empty">Sem promoções.</div>';
  } catch (err) {
    console.error('Erro ao carregar promoções:', err);
    list.innerHTML = '<div class="price-rule-empty" style="color:#dc2626">Não foi possível carregar as promoções.</div>';
  }
}

async function addPromotion() {
  const roomId = document.getElementById('price-room-select').value;
  const data = {
    name: document.getElementById('promo-name').value.trim(),
    startDate: document.getElementById('promo-start').value,
    endDate: document.getElementById('promo-end').value,
    discountPct: document.getElementById('promo-pct').value,
    minNights: document.getElementById('promo-min-nights').value,
    allRooms: document.getElementById('promo-scope').value === 'all',
  };
  try {
    const res = await fetch(`${API}/rooms/${roomId}/promotions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(data)
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(result.error || 'Erro ao adicionar a promoção.'); return; }
    ['promo-name', 'promo-start', 'promo-end', 'promo-pct'].forEach(id => { document.getElementById(id).value = ''; });
    showToast('✓ Promoção criada e ativa.');
    await loadPromotions(roomId);
  } catch (err) { showToast('Erro de ligação.'); }
}

async function togglePromotion(promotionId, isActive) {
  try {
    const res = await fetch(`${API}/rooms/promotions/${promotionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ isActive })
    });
    if (!res.ok) { showToast('Erro ao alterar a promoção.'); return; }
    showToast(isActive ? '✓ Promoção ativada.' : 'Promoção desativada.');
    await loadPromotions(document.getElementById('price-room-select').value);
  } catch (err) { showToast('Erro de ligação.'); }
}

async function deletePromotion(promotionId) {
  if (!confirm('Apagar esta promoção?')) return;
  try {
    const res = await fetch(`${API}/rooms/promotions/${promotionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    if (!res.ok) { showToast('Erro ao apagar.'); return; }
    await loadPromotions(document.getElementById('price-room-select').value);
  } catch (err) { showToast('Erro de ligação.'); }
}

async function simulatePrice() {
  const roomId = document.getElementById('price-room-select').value;
  const result = document.getElementById('sim-result');
  const params = new URLSearchParams({
    checkIn: document.getElementById('sim-checkin').value,
    checkOut: document.getElementById('sim-checkout').value,
    adults: document.getElementById('sim-adults').value || 0,
    teens: document.getElementById('sim-teens').value || 0,
    children: document.getElementById('sim-children').value || 0,
    infants: document.getElementById('sim-infants').value || 0,
  });
  try {
    const res = await fetch(`${API}/rooms/${roomId}/quote?${params}`);
    const quote = await res.json();
    if (!res.ok) { result.innerHTML = `<span style="color:#dc2626">${escapeAdminHtml(quote.error)}</span>`; return; }
    const sourceLabel = night => night.source === 'HOLIDAY' ? escapeAdminHtml(night.ruleName)
      : night.source === 'SEASON' ? `${escapeAdminHtml(night.ruleName)}${night.weekend ? ' (fim de semana)' : ''}`
      : night.weekend ? 'Base (fim de semana)' : 'Base';
    result.innerHTML = `
      <strong>Total: ${adminMoney(quote.total)}</strong> · ${quote.nightsCount} noites ·
      ${quote.equivalentGuests} pessoa(s) para ${quote.baseOccupancy} incluídas
      ${quote.promotion ? `<br>🎉 Promoção «${escapeAdminHtml(quote.promotion.name)}» −${quote.promotion.discountPct}%: −${adminMoney(Math.abs(quote.promotion.discount))}` : ''}
      ${quote.nextPromotion ? `<br>Com ${quote.nextPromotion.minNights}+ noites teria −${quote.nextPromotion.discountPct}% («${escapeAdminHtml(quote.nextPromotion.name)}»)` : ''}
      <table>${quote.nights.map(night => `<tr><td>${formatAdminDate(night.date)}</td><td>${sourceLabel(night)}</td><td>${adminMoney(night.price)}${night.guestAdjustment ? ` ${night.guestAdjustment > 0 ? '+' : '−'}${adminMoney(Math.abs(night.guestAdjustment))}` : ''}${night.crib ? ` + berço ${adminMoney(night.crib)}` : ''}${night.promotionDiscount ? ` −${adminMoney(Math.abs(night.promotionDiscount))} promo` : ''}</td><td>${adminMoney(night.total)}</td></tr>`).join('')}</table>`;
  } catch (err) {
    result.innerHTML = '<span style="color:#dc2626">Erro de ligação.</span>';
  }
}

async function toggleRoomActive(id, currentActive) {
  try {
    const res = await fetch(`${API}/rooms/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ isActive: !currentActive })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || 'Não foi possível atualizar a unidade.');
      return;
    }
    showToast(`Quarto ${currentActive ? 'desativado' : 'ativado'}.`);
    await loadAdminRooms();
  } catch(err) { showToast('Erro de ligação.'); }
}

// ── Disponibilidade Admin ─────────────────────────────────
// ── Disponibilidade (painel) ─────────────────────────────
// Seleção por intervalos: clicar na primeira e na última data, ou arrastar. Podem juntar-se vários
// intervalos (ex.: 15–19 e 26–30), também em meses diferentes. Só datas de hoje em diante.
const ADMIN_CAL_RANGE_DAYS = 730;
let adminCalYear = Number(getPortugalDateString().slice(0, 4));
let adminCalMonth = Number(getPortugalDateString().slice(5, 7)) - 1;
let adminRanges = [];          // [{ start, end }] inclusive
let adminRangeStart = null;    // primeira data de um intervalo ainda por fechar
let adminDrag = null;
let adminOccupiedDates = new Set();
let adminBlockedDates = new Set();   // bloqueios manuais
let adminImportedDates = new Map();  // data → 'Booking.com' / 'Airbnb' (sincronizado, não se altera aqui)

const IMPORTED_SOURCE_LABELS = { BOOKING_COM: 'Booking.com', AIRBNB: 'Airbnb' };

// Noite ocupada por uma reserva do site ou por uma reserva sincronizada do Booking/Airbnb
function isAdminOccupied(date) {
  return adminOccupiedDates.has(date) || adminImportedDates.has(date);
}

function adminRangeDates(range) {
  const dates = [];
  for (let date = range.start; date <= range.end; date = shiftDateString(date, 1)) dates.push(date);
  return dates;
}

// Datas selecionadas que podem mudar de estado (sem dias passados nem dias reservados)
function adminSelectedDates() {
  const dates = new Set();
  adminRanges.forEach(range => adminRangeDates(range).forEach(date => {
    if (!isAdminOccupied(date)) dates.add(date);
  }));
  return [...dates].sort();
}

function resetAdminSelection() {
  adminRanges = [];
  adminRangeStart = null;
  adminDrag = null;
}

function changeAdminMonth(dir) {
  adminCalMonth += dir;
  if (adminCalMonth > 11) { adminCalMonth = 0; adminCalYear++; }
  if (adminCalMonth < 0) { adminCalMonth = 11; adminCalYear--; }
  renderAdminCal();
}

async function loadRoomAvailability() {
  const roomId = document.getElementById('avail-room-select')?.value;
  resetAdminSelection();
  adminOccupiedDates = new Set();
  adminBlockedDates = new Set();
  adminImportedDates = new Map();
  if (!roomId) { renderAdminCal(); return; }

  try {
    const from = getPortugalDateString();
    const to = shiftDateString(from, ADMIN_CAL_RANGE_DAYS);
    const res = await fetch(`${API}/availability/room/${roomId}?from=${from}&to=${to}`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    adminOccupiedDates = new Set(data.occupiedDates || []);
    const blocks = data.blockedDates || [];
    adminBlockedDates = new Set(blocks.filter(b => !IMPORTED_SOURCE_LABELS[b.source]).map(b => b.date));
    adminImportedDates = new Map(blocks.filter(b => IMPORTED_SOURCE_LABELS[b.source]).map(b => [b.date, IMPORTED_SOURCE_LABELS[b.source]]));
  } catch(err) {
    console.error('Erro disponibilidade admin:', err);
    showToast('Não foi possível carregar a disponibilidade.');
  }
  renderAdminCal();
}

function adminDayFromEvent(e) {
  return e.target.closest?.('#admin-cal-grid [data-date]')?.dataset.date || null;
}

function addAdminRange(a, b) {
  const [start, end] = [a, b].sort();
  // Um novo intervalo substitui os que se sobrepõem a ele
  adminRanges = adminRanges.filter(range => range.end < start || range.start > end);
  adminRanges.push({ start, end });
  adminRanges.sort((x, y) => (x.start < y.start ? -1 : 1));
}

function clickAdminDate(date) {
  if (adminRangeStart) {
    addAdminRange(adminRangeStart, date);
    adminRangeStart = null;
  } else {
    const existing = adminRanges.findIndex(range => range.start <= date && date <= range.end);
    if (existing !== -1) adminRanges.splice(existing, 1); // clicar num intervalo já escolhido remove-o
    else adminRangeStart = date;
  }
  renderAdminCal();
}

function removeAdminRange(index) {
  adminRanges.splice(index, 1);
  renderAdminCal();
}

function renderAdminCal() {
  const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const titleEl = document.getElementById('admin-cal-title');
  const grid = document.getElementById('admin-cal-grid');
  if (!titleEl || !grid) return;

  titleEl.textContent = `${months[adminCalMonth]} ${adminCalYear}`;
  grid.innerHTML = '';
  const today = getPortugalDateString();
  const preview = adminDrag ? [adminDrag.start, adminDrag.end].sort() : null;

  const first = new Date(adminCalYear, adminCalMonth, 1).getDay();
  const days = new Date(adminCalYear, adminCalMonth + 1, 0).getDate();
  for (let i = 0; i < first; i++) {
    const el = document.createElement('div');
    el.style.cssText = 'aspect-ratio:1';
    grid.appendChild(el);
  }

  for (let d = 1; d <= days; d++) {
    const dateStr = `${adminCalYear}-${String(adminCalMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const el = document.createElement('div');
    el.textContent = d;
    el.className = 'admin-cal-day';
    const isPast = dateStr < today;
    const isSelected = adminRanges.some(range => range.start <= dateStr && dateStr <= range.end)
      || dateStr === adminRangeStart
      || (preview && preview[0] <= dateStr && dateStr <= preview[1]);

    if (isPast) {
      el.classList.add('past');
      el.title = 'Data passada';
    } else if (adminOccupiedDates.has(dateStr)) {
      el.classList.add('reserved');
      el.title = 'Reservado (não pode ser bloqueado)';
    } else if (adminImportedDates.has(dateStr)) {
      el.classList.add('imported');
      el.title = `Ocupado no ${adminImportedDates.get(dateStr)} (sincronizado automaticamente)`;
    } else if (adminBlockedDates.has(dateStr)) {
      el.classList.add('blocked');
      el.title = 'Bloqueado';
    } else {
      el.classList.add('free');
      el.title = 'Disponível';
    }
    if (isSelected && !isPast) el.classList.add('selected');
    if (dateStr === adminRangeStart) el.classList.add('range-start');
    if (!isPast) {
      el.dataset.date = dateStr;
      el.addEventListener('click', () => {
        if (adminSuppressClick) return;
        clickAdminDate(dateStr);
      });
    }
    grid.appendChild(el);
  }
  updateSelectedDatesPanel();
  renderMonthReservations();
}

// Arrastar entre datas cria um intervalo
let adminSuppressClick = false;
document.getElementById('admin-cal-grid')?.addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const date = adminDayFromEvent(e);
  if (!date) return;
  adminDrag = { start: date, end: date, moved: false };
});
document.getElementById('admin-cal-grid')?.addEventListener('pointerover', e => {
  if (!adminDrag) return;
  const date = adminDayFromEvent(e);
  if (!date || date === adminDrag.end) return;
  adminDrag.end = date;
  adminDrag.moved = true;
  renderAdminCal();
});
document.addEventListener('pointerup', () => {
  if (!adminDrag) return;
  const { start, end, moved } = adminDrag;
  adminDrag = null;
  if (start === end) { if (moved) renderAdminCal(); return; } // clique simples: tratado pelo click
  adminRangeStart = null;
  addAdminRange(start, end);
  adminSuppressClick = true;
  setTimeout(() => { adminSuppressClick = false; }, 0);
  renderAdminCal();
});

function formatAdminShortDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function updateSelectedDatesPanel() {
  const el = document.getElementById('admin-selected-dates');
  if (!el) return;
  if (!adminRanges.length && !adminRangeStart) {
    el.textContent = 'Nenhuma data selecionada. Clica na primeira e na última data (ou arrasta). Podes juntar vários intervalos.';
    return;
  }
  const rows = adminRanges.map((range, index) => {
    const dates = adminRangeDates(range);
    const reserved = dates.filter(isAdminOccupied).length;
    return `<div class="admin-range-row">
      <span><strong>${formatAdminShortDate(range.start)}</strong> → <strong>${formatAdminShortDate(range.end)}</strong>
      · ${dates.length} dia(s)${reserved ? ` <em>(${reserved} reservado(s), ignorado(s))</em>` : ''}</span>
      <button type="button" class="admin-range-remove" aria-label="Remover intervalo" onclick="removeAdminRange(${index})">×</button>
    </div>`;
  });
  if (adminRangeStart) {
    rows.push(`<div class="admin-range-row pending">Início em <strong>${formatAdminShortDate(adminRangeStart)}</strong> — clica na última data do intervalo.</div>`);
  }
  el.innerHTML = rows.join('');
}

// Reservas e bloqueios do mês que está no calendário
function renderMonthReservations() {
  const el = document.getElementById('admin-month-reservations');
  if (!el) return;
  const prefix = `${adminCalYear}-${String(adminCalMonth + 1).padStart(2, '0')}-`;
  const occupied = [...adminOccupiedDates].filter(date => date.startsWith(prefix));
  const blocked = [...adminBlockedDates].filter(date => date.startsWith(prefix)).sort();
  const imported = [...adminImportedDates.keys()].filter(date => date.startsWith(prefix));
  if (!document.getElementById('avail-room-select')?.value) {
    el.textContent = 'Seleciona um quarto para ver as reservas.';
    return;
  }
  if (occupied.length === 0 && blocked.length === 0 && imported.length === 0) {
    el.textContent = 'Sem reservas ou bloqueios neste mês.';
    return;
  }
  let html = '';
  if (occupied.length > 0) {
    html += `<div style="margin-bottom:.75rem"><strong style="font-size:.78rem;color:var(--dark)">${occupied.length} dia(s) reservado(s)</strong></div>`;
  }
  if (imported.length > 0) {
    html += `<div style="margin-bottom:.75rem"><strong style="font-size:.78rem;color:var(--dark)">${imported.length} noite(s) ocupada(s) no Booking.com/Airbnb</strong></div>`;
  }
  if (blocked.length > 0) {
    html += `<div><strong style="font-size:.78rem;color:var(--dark)">${blocked.length} dia(s) bloqueado(s):</strong><div style="margin-top:.4rem">${blocked.map(date => `<span style="display:inline-block;background:#5a1d1d;color:#f3dede;font-size:.75rem;padding:.2rem .6rem;border-radius:2px;margin:.2rem">${formatAdminShortDate(date)}</span>`).join('')}</div></div>`;
  }
  el.innerHTML = html;
}

async function changeSelectedDates(method) {
  const roomId = document.getElementById('avail-room-select')?.value;
  if (!roomId) { showToast('Seleciona um quarto primeiro.'); return; }
  if (adminRangeStart) { showToast('Falta escolher a última data do intervalo.'); return; }
  const selected = adminSelectedDates();
  // Bloquear: só os dias ainda livres; desbloquear: só os que estão bloqueados
  const dates = method === 'POST'
    ? selected.filter(date => !adminBlockedDates.has(date))
    : selected.filter(date => adminBlockedDates.has(date));
  if (!dates.length) {
    showToast(method === 'POST' ? 'Não há dias livres para bloquear na seleção.' : 'Não há dias bloqueados na seleção.');
    return;
  }
  try {
    const res = await fetch(`${API}/availability/block`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify(method === 'POST' ? { roomId, dates, reason: 'Bloqueado pelo admin' } : { roomId, dates })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { showToast(data.error || 'Erro ao guardar.'); return; }
    showToast(`✓ ${dates.length} dia(s) ${method === 'POST' ? 'bloqueado(s)' : 'desbloqueado(s)'}.`);
    await loadRoomAvailability();
  } catch(err) { showToast('Erro de ligação.'); }
}

function blockSelectedDates() { return changeSelectedDates('POST'); }
function unblockSelectedDates() { return changeSelectedDates('DELETE'); }


// ── Inicialização ─────────────────────────────────────────
if (adminToken) restoreAdminSession();
else showAdminLogin();
