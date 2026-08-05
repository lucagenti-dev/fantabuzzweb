const socket = io();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const CATALOG_CACHE_KEY = 'fbCatalog_2026_27_v2';

let mode = 'home';
let code = '';
let hostToken = '';
let playerToken = '';
let playerId = '';
let state = null;
let catalog = [];
let catalogMeta = { season: '2026/2027', custom: false };
let activeRole = 'ALL';
let selectedPlayer = null;
let timerLoop = null;
let toastTimer = null;

function show(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.remove('active'));
  $(id).classList.add('active');
  mode = id;
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400);
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}

const teamSlug = (team) => String(team || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-|-$/g, '');

const teamColors = (team) => team ? `/team-${teamSlug(team)}.svg` : '';

function setTeamLogo(id, team) {
  const element = $(id);
  if (!element) return;
  if (team) {
    element.src = teamColors(team);
    element.alt = `Colori sociali ${team}`;
    element.style.display = 'block';
  } else {
    element.removeAttribute('src');
    element.alt = '';
    element.style.display = 'none';
  }
}

function logoImg(team, className = 'team-logo') {
  return team
    ? `<img class="${className}" src="${teamColors(team)}" alt="Colori sociali ${esc(team)}" loading="lazy">`
    : '';
}

function roleName(role) {
  return ({ P: 'Portiere', D: 'Difensore', C: 'Centrocampista', A: 'Attaccante' })[role] || role || '';
}

function statusName(status) {
  return ({ waiting: 'ATTESA', ready: 'PRONTA', open: 'APERTA', paused: 'PAUSA', sold: 'CHIUSA' })[status] || status;
}

function startTimer() {
  clearInterval(timerLoop);
  timerLoop = setInterval(() => {
    if (!state) return;
    const seconds = state.endAt ? Math.max(0, (state.endAt - Date.now()) / 1000) : null;
    ['hostTimer', 'playerTimer', 'tvTimer'].forEach((id) => {
      if ($(id)) $(id).textContent = seconds == null ? '—' : seconds.toFixed(1);
    });
  }, 100);
}

function selectPlayer(player) {
  selectedPlayer = player;
  $('itemInput').value = player.name;
  $('selectedName').textContent = player.name;
  $('selectedMeta').textContent = [
    player.team,
    roleName(player.role),
    `QA ${player.quotation}`,
    `QI ${player.initialQuotation}`,
    `FVM ${player.fvm}`
  ].join(' • ');
  renderCatalog();
}

function renderCatalog() {
  if (!$('playersCatalog')) return;
  const query = ($('playerSearch').value || '').trim().toLowerCase();
  const assigned = new Set((state?.assignments || []).map((item) =>
    `${item.player}|${item.team}|${item.role}`.toLowerCase()
  ));
  const filtered = catalog.filter((player) =>
    (activeRole === 'ALL' || player.role === activeRole) &&
    (!query || player.name.toLowerCase().includes(query) || player.team.toLowerCase().includes(query))
  );

  $('playersCatalog').innerHTML = filtered.map((player) => {
    const sold = assigned.has(`${player.name}|${player.team}|${player.role}`.toLowerCase());
    return `<button class="catalog-card ${selectedPlayer?.id === player.id ? 'selected' : ''} ${sold ? 'sold' : ''}" data-id="${esc(player.id)}" ${sold ? 'disabled' : ''}>
      ${logoImg(player.team, 'team-logo catalog-logo')}
      <span class="role-icon role-${player.role}">${player.role}</span>
      <span><strong>${esc(player.name)}</strong><small>${esc(player.team)} • QA ${player.quotation} • FVM ${player.fvm}</small></span>
    </button>`;
  }).join('') || '<div class="empty-catalog">Nessun calciatore trovato.</div>';

  document.querySelectorAll('.catalog-card[data-id]').forEach((button) => {
    button.onclick = () => selectPlayer(catalog.find((player) => String(player.id) === button.dataset.id));
  });
  $('listStatus').textContent = `${catalog.length} calciatori • ${catalogMeta.season}${catalogMeta.custom ? ' • listone importato' : ''}`;
}

async function loadCatalog() {
  const cached = readStorage(CATALOG_CACHE_KEY);
  try {
    if (cached?.custom && Array.isArray(cached.players)) {
      catalog = cached.players;
      catalogMeta = { season: cached.season || '2026/2027', custom: true };
    } else {
      const response = await fetch('/players.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Listone non disponibile');
      const data = await response.json();
      catalog = data.players || [];
      catalogMeta = { season: data.season || '2026/2027', custom: false };
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ ...catalogMeta, players: catalog }));
    }
  } catch {
    if (Array.isArray(cached?.players)) {
      catalog = cached.players;
      catalogMeta = { season: cached.season || '2026/2027', custom: Boolean(cached.custom) };
    }
  }
  renderCatalog();
}

function renderHistory(element, historyItems) {
  if (!element) return;
  element.innerHTML = (historyItems || []).slice().reverse().map((item) =>
    `<p><span>${new Date(item.at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>${esc(item.text)}</p>`
  ).join('') || '<small>Nessun rilancio.</small>';
}

function renderStats(currentState) {
  $('statsTotal').textContent = `${currentState.stats.total} assegnazioni`;
  $('avgAll').textContent = currentState.stats.average;
  $('avgP').textContent = currentState.stats.byRole.P;
  $('avgD').textContent = currentState.stats.byRole.D;
  $('avgC').textContent = currentState.stats.byRole.C;
  $('avgA').textContent = currentState.stats.byRole.A;
  $('topBuys').innerHTML = currentState.stats.top.map((assignment, index) =>
    `<div class="rank-row"><b>${logoImg(assignment.team, 'team-logo inline-logo')}${index + 1}. ${esc(assignment.player)}</b><span>${esc(assignment.ownerName)} • ${assignment.price}</span></div>`
  ).join('') || '<small>Nessun acquisto</small>';
  $('spendRank').innerHTML = currentState.stats.spend.map((player, index) =>
    `<div class="rank-row"><b>${index + 1}. ${esc(player.name)}</b><span>${player.spent} spesi • ${player.remaining} residui</span></div>`
  ).join('') || '<small>Nessun partecipante</small>';
}

function renderRosters(currentState) {
  $('assignmentCount').textContent = `${currentState.assignments.length} calciatori assegnati`;
  $('rostersView').innerHTML = currentState.players.map((player) =>
    `<div class="roster-box"><h3>${esc(player.name)}</h3>
      <div class="roster-summary">${player.roster.length} giocatori • ${player.spent} spesi • ${player.remaining} residui</div>
      ${player.roster.map((item) => `<div class="roster-line">${logoImg(item.team, 'team-logo roster-logo')}<b>${item.role}</b><span>${esc(item.player)}<small>${esc(item.team)}</small></span><strong>${item.price}</strong></div>`).join('') || '<small>Nessun acquisto</small>'}
    </div>`
  ).join('');
}

function renderPlayerCard(currentState) {
  const me = currentState.players.find((player) => player.id === playerId);
  if (!me) return;
  $('myCredits').textContent = me.remaining;
  $('myMaxBid').textContent = me.maxBid;
  $('mySlots').textContent = `P ${me.counts.P}/${currentState.settings.limits.P} • D ${me.counts.D}/${currentState.settings.limits.D} • C ${me.counts.C}/${currentState.settings.limits.C} • A ${me.counts.A}/${currentState.settings.limits.A}`;
  $('myRoster').innerHTML = `<h3>La tua rosa</h3>${me.roster.map((item) =>
    `<p>${logoImg(item.team, 'team-logo inline-logo')}<b>${item.role}</b> ${esc(item.player)} — ${esc(item.team)} <strong>${item.price}</strong></p>`
  ).join('') || '<p>Nessun acquisto.</p>'}`;
}

function renderTV(currentState) {
  $('tvCode').textContent = `STANZA ${currentState.code}`;
  $('tvPlayers').textContent = currentState.playerCount;
  $('tvItem').textContent = currentState.item || 'In attesa';
  setTeamLogo('tvTeamLogo', currentState.itemTeam);
  $('tvMeta').textContent = [currentState.itemTeam, roleName(currentState.itemRole)].filter(Boolean).join(' • ');
  $('tvBid').textContent = currentState.currentBid >= currentState.basePrice ? currentState.currentBid : '—';
  $('tvLeader').textContent = currentState.leaderName ? `In testa: ${currentState.leaderName}` : 'Nessun offerente';
  $('tvTop').innerHTML = currentState.stats.top.slice(0, 5).map((assignment) =>
    `<div class="tv-row"><span>${logoImg(assignment.team, 'team-logo inline-logo')}${esc(assignment.player)}</span><b>${assignment.price}</b></div>`
  ).join('') || '<small>Nessun acquisto</small>';
  $('tvCredits').innerHTML = currentState.stats.spend.slice().sort((a, b) => a.remaining - b.remaining).map((player) =>
    `<div class="tv-row"><span>${esc(player.name)}</span><b>${player.remaining}</b></div>`
  ).join('');
  $('tvLast').innerHTML = currentState.assignments.slice(-5).reverse().map((assignment) =>
    `<div class="tv-row"><span>${logoImg(assignment.team, 'team-logo inline-logo')}${esc(assignment.player)} → ${esc(assignment.ownerName)}</span><b>${assignment.price}</b></div>`
  ).join('') || '<small>Nessuna aggiudicazione</small>';
}

function render(currentState) {
  state = currentState;

  if (mode === 'host') {
    $('hostItem').textContent = currentState.item || 'In attesa';
    setTeamLogo('hostTeamLogo', currentState.itemTeam);
    $('hostItemMeta').textContent = [currentState.itemTeam, roleName(currentState.itemRole)].filter(Boolean).join(' • ');
    $('hostBid').textContent = currentState.currentBid >= currentState.basePrice ? currentState.currentBid : '—';
    $('hostLeader').textContent = currentState.leaderName ? `In testa: ${currentState.leaderName}` : 'Nessun offerente';
    $('statusBadge').textContent = statusName(currentState.status);
    $('playerCount').textContent = currentState.playerCount;
    $('saveStatus').textContent = currentState.savedAt
      ? `salvata ${new Date(currentState.savedAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
      : 'salvataggio automatico';
    $('pauseBtn').textContent = currentState.status === 'paused' ? 'Riprendi' : 'Pausa';
    $('playersList').innerHTML = currentState.players.map((player) =>
      `<div class="credit-card"><div><strong>${player.connected ? '●' : '○'} ${esc(player.name)}</strong><small>${player.roster.length} giocatori • max ${player.maxBid}</small></div><div><b>${player.remaining}</b><small>residui</small></div><button data-kick="${player.id}" aria-label="Rimuovi ${esc(player.name)}">×</button></div>`
    ).join('') || '<p>Nessun partecipante</p>';
    document.querySelectorAll('[data-kick]').forEach((button) => {
      button.onclick = () => hostAction('kick', { playerId: button.dataset.kick });
    });
    renderHistory($('hostHistory'), currentState.history);
    renderStats(currentState);
    renderRosters(currentState);
    renderCatalog();
  } else if (mode === 'player') {
    $('playerItem').textContent = currentState.item || 'In attesa del banditore';
    setTeamLogo('playerTeamLogo', currentState.itemTeam);
    $('playerItemMeta').textContent = [currentState.itemTeam, roleName(currentState.itemRole)].filter(Boolean).join(' • ');
    $('playerBid').textContent = currentState.currentBid >= currentState.basePrice ? currentState.currentBid : '—';
    $('playerLeader').textContent = currentState.leaderName
      ? (currentState.leaderId === playerId ? '🔥 Sei in testa!' : `In testa: ${currentState.leaderName}`)
      : 'Nessun offerente';
    const open = currentState.status === 'open';
    $('buzzBtn').disabled = !open;
    document.querySelectorAll('.increments button').forEach((button) => { button.disabled = !open; });
    $('playerMessage').textContent = open
      ? 'Premi per rilanciare. Il countdown riparte a ogni offerta.'
      : currentState.status === 'sold'
        ? (currentState.leaderId === playerId ? '🏆 Aggiudicato a te!' : 'Asta conclusa.')
        : 'Aspetta l’apertura.';
    renderPlayerCard(currentState);
  } else if (mode === 'tv') {
    renderTV(currentState);
  }
}

function roomLinks() {
  const joinUrl = `${location.origin}/?room=${code}`;
  const tvUrl = `${location.origin}/?tv=${code}`;
  $('joinUrl').textContent = joinUrl;
  $('qrImage').src = `/qr?data=${encodeURIComponent(joinUrl)}&t=${Date.now()}`;
  $('tvQrImage').src = `/qr?data=${encodeURIComponent(tvUrl)}&t=${Date.now()}`;
}

$('createBtn').onclick = () => {
  $('homeError').textContent = '';
  socket.emit('createRoom', {
    credits: $('creditsInput').value,
    minReserve: $('reserveInput').value,
    p: $('limitP').value,
    d: $('limitD').value,
    c: $('limitC').value,
    a: $('limitA').value
  }, (response) => {
    if (!response.ok) {
      $('homeError').textContent = response.error;
      return;
    }
    code = response.code;
    hostToken = response.hostToken;
    localStorage.setItem('fbHostV1', JSON.stringify({ code, hostToken }));
    history.replaceState(null, '', `/?host=${code}`);
    show('host');
    $('hostCode').textContent = code;
    roomLinks();
    render(response.state);
    startTimer();
  });
};

function join() {
  const roomCode = ($('joinCode').value || params.get('room') || '').toUpperCase().trim();
  const name = $('joinName').value.trim();
  const saved = readStorage(`fbPlayer_${roomCode}`);
  $('homeError').textContent = '';
  socket.emit('joinRoom', { code: roomCode, name, playerToken: saved?.playerToken }, (response) => {
    if (!response.ok) {
      $('homeError').textContent = response.error;
      return;
    }
    code = roomCode;
    playerToken = response.playerToken;
    playerId = response.playerId;
    localStorage.setItem(`fbPlayer_${roomCode}`, JSON.stringify({ playerToken, playerId, name }));
    history.replaceState(null, '', `/?room=${code}`);
    show('player');
    $('playerIdentity').textContent = name;
    $('playerRoom').textContent = `STANZA ${code}`;
    render(response.state);
    startTimer();
  });
}

$('joinBtn').onclick = join;
$('joinName').addEventListener('keydown', (event) => { if (event.key === 'Enter') join(); });
$('exitHostBtn').onclick = () => { location.href = '/'; };

function hostAction(action, payload = {}) {
  socket.emit('hostAction', { code, hostToken, action, payload }, (response) => {
    if (!response.ok) toast(response.error);
  });
}

$('prepareBtn').onclick = () => hostAction('prepare', {
  item: $('itemInput').value,
  itemTeam: selectedPlayer?.team || '',
  itemRole: selectedPlayer?.role || '',
  basePrice: $('baseInput').value,
  duration: $('durationInput').value
});
$('startBtn').onclick = () => hostAction('start');
$('pauseBtn').onclick = () => hostAction(state?.status === 'paused' ? 'resume' : 'pause');
$('sellBtn').onclick = () => hostAction('sell');
$('resetBtn').onclick = () => hostAction('reset');
$('exportBtn').onclick = $('exportBtn2').onclick = () => {
  location.href = `/export.xls?code=${encodeURIComponent(code)}&token=${encodeURIComponent(hostToken)}`;
};
$('tvBtn').onclick = () => window.open(`/?tv=${code}`, '_blank', 'noopener');

function bid(increment) {
  socket.emit('bid', { code, playerToken, increment: Number(increment) }, (response) => {
    if (!response.ok) toast(response.error);
    else navigator.vibrate?.(35);
  });
}

$('buzzBtn').onclick = () => bid(1);
document.querySelectorAll('.increments button').forEach((button) => {
  button.onclick = () => bid(button.dataset.inc);
});

$('playerSearch').addEventListener('input', renderCatalog);
document.querySelectorAll('[data-role]').forEach((button) => {
  button.onclick = () => {
    activeRole = button.dataset.role;
    document.querySelectorAll('[data-role]').forEach((item) => item.classList.toggle('active', item === button));
    renderCatalog();
  };
});

$('xlsInput').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const response = await fetch('/import-listone', { method: 'POST', body: form });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || 'Importazione non riuscita');
    catalog = data.players;
    catalogMeta = { season: data.season || '2026/2027', custom: true };
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify({ ...catalogMeta, players: catalog }));
    selectedPlayer = null;
    renderCatalog();
    toast(`${data.count} calciatori importati da ${data.file}`);
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = '';
  }
});

$('itemInput').addEventListener('input', () => {
  if (selectedPlayer && $('itemInput').value !== selectedPlayer.name) {
    selectedPlayer = null;
    $('selectedName').textContent = 'Inserimento manuale';
    $('selectedMeta').textContent = 'Squadra e ruolo non associati';
    renderCatalog();
  }
});

socket.on('state', render);
socket.on('kicked', () => { alert('Sei stato rimosso.'); location.href = '/'; });
socket.on('disconnect', () => {
  if (mode === 'player') {
    $('connectionDot').textContent = '● OFFLINE';
    $('connectionDot').className = 'offline';
  }
});
socket.on('connect', () => {
  if (mode === 'player') {
    $('connectionDot').textContent = '● ONLINE';
    $('connectionDot').className = 'online';
  }
  if (mode === 'host' && code && hostToken) {
    socket.emit('restoreHost', { code, hostToken }, (response) => response.ok && render(response.state));
  }
  if (mode === 'tv' && code) {
    socket.emit('joinViewer', { code }, (response) => response.ok && render(response.state));
  }
  if (mode === 'player' && code && playerToken) {
    const saved = readStorage(`fbPlayer_${code}`);
    socket.emit('joinRoom', { code, name: saved?.name || 'Giocatore', playerToken }, (response) => response.ok && render(response.state));
  }
});

(function boot() {
  loadCatalog();
  const room = params.get('room');
  if (room) {
    $('joinCode').value = room.toUpperCase();
    $('joinCode').readOnly = true;
  }

  const tv = params.get('tv');
  if (tv) {
    code = tv.toUpperCase();
    show('tv');
    socket.emit('joinViewer', { code }, (response) => {
      if (response.ok) {
        render(response.state);
        startTimer();
      } else {
        location.href = '/';
      }
    });
    return;
  }

  const host = params.get('host');
  const saved = readStorage('fbHostV1');
  if (host && saved?.code === host && saved.hostToken) {
    code = host;
    hostToken = saved.hostToken;
    socket.emit('restoreHost', { code, hostToken }, (response) => {
      if (!response.ok) return;
      show('host');
      $('hostCode').textContent = code;
      roomLinks();
      render(response.state);
      startTimer();
    });
  }
})();
