const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const ROOT = __dirname;
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'players.json'), 'utf8'));
const expectedTeams = [
  'Atalanta', 'Bologna', 'Cagliari', 'Como', 'Fiorentina', 'Frosinone', 'Genoa', 'Inter',
  'Juventus', 'Lazio', 'Lecce', 'Milan', 'Monza', 'Napoli', 'Parma', 'Roma', 'Sassuolo',
  'Torino', 'Udinese', 'Venezia'
];

assert.equal(catalog.season, '2026/2027');
assert.equal(catalog.players.length, 494);
assert.deepEqual([...new Set(catalog.players.map((player) => player.team))].sort(), expectedTeams.sort());
assert.equal(new Set(catalog.players.map((player) => player.id)).size, catalog.players.length);
assert(catalog.players.every((player) => ['P', 'D', 'C', 'A'].includes(player.role)));
assert(catalog.players.every((player) => Number.isFinite(player.quotation) && Number.isFinite(player.initialQuotation) && Number.isFinite(player.fvm)));
for (const team of expectedTeams) {
  const slug = team.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  assert(fs.existsSync(path.join(ROOT, `team-${slug}.svg`)), `Badge mancante: ${team}`);
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
for (const id of ['createBtn', 'qrImage', 'tvBtn', 'playersCatalog', 'buzzBtn', 'tvItem', 'statsTotal', 'rostersView']) {
  assert(html.includes(`id="${id}"`), `Elemento UI mancante: ${id}`);
}
assert(css.includes('env(safe-area-inset-bottom)'));
assert(css.includes('@media (max-width: 640px)'));

function emitAck(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timeout evento ${event}`)), 4000);
    client.emit(event, payload, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
  });
}

function nextState(client, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.off('state', listener);
      reject(new Error('Timeout aggiornamento stato'));
    }, 4000);
    const listener = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timeout);
      client.off('state', listener);
      resolve(state);
    };
    client.on('state', listener);
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Server non avviato');
}

async function integrationTest() {
  const port = 33127;
  const url = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fantabid-test-'));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverErrors = '';
  child.stderr.on('data', (chunk) => { serverErrors += chunk.toString(); });

  let host;
  let player;
  try {
    await waitForServer(url);
    const health = await fetch(`${url}/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.version, '2.1.0');
    assert.equal(health.season, '2026/2027');

    const servedCatalog = await fetch(`${url}/players.json`).then((response) => response.json());
    assert.equal(servedCatalog.players.length, 494);
    assert.equal((await fetch(`${url}/package.json`)).status, 404);
    assert.equal((await fetch(`${url}/import-listone`, { method: 'POST' })).status, 400);

    host = io(url, { transports: ['websocket'] });
    player = io(url, { transports: ['websocket'] });
    await Promise.all([
      new Promise((resolve, reject) => { host.once('connect', resolve); host.once('connect_error', reject); }),
      new Promise((resolve, reject) => { player.once('connect', resolve); player.once('connect_error', reject); })
    ]);

    const created = await emitAck(host, 'createRoom', { credits: 500, minReserve: 1, p: 3, d: 8, c: 8, a: 6 });
    assert.equal(created.ok, true);
    const joined = await emitAck(player, 'joinRoom', { code: created.code, name: 'Luca' });
    assert.equal(joined.ok, true);

    const featuredPlayer = catalog.players[0];
    assert.equal((await emitAck(host, 'hostAction', {
      code: created.code,
      hostToken: created.hostToken,
      action: 'prepare',
      payload: { item: featuredPlayer.name, itemTeam: featuredPlayer.team, itemRole: featuredPlayer.role, basePrice: 1, duration: 3 }
    })).ok, true);
    assert.equal((await emitAck(host, 'hostAction', { code: created.code, hostToken: created.hostToken, action: 'start', payload: {} })).ok, true);
    const bid = await emitAck(player, 'bid', { code: created.code, playerToken: joined.playerToken, increment: 1 });
    assert.deepEqual(bid, { ok: true, amount: 1 });

    const soldStatePromise = nextState(host, (currentState) => currentState.status === 'sold');
    assert.equal((await emitAck(host, 'hostAction', { code: created.code, hostToken: created.hostToken, action: 'sell', payload: {} })).ok, true);
    const soldState = await soldStatePromise;
    assert.equal(soldState.assignments.length, 1);
    assert.equal(soldState.assignments[0].ownerName, 'Luca');
    assert.equal(soldState.players[0].remaining, 499);
    assert.equal(soldState.stats.total, 1);

    const exportResponse = await fetch(`${url}/export.xls?code=${created.code}&token=${created.hostToken}`);
    assert.equal(exportResponse.status, 200);
    assert.match(exportResponse.headers.get('content-disposition'), /FantaBid_Rose_/);
    assert.match(await exportResponse.text(), new RegExp(featuredPlayer.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const qrResponse = await fetch(`${url}/qr?data=${encodeURIComponent(`${url}/?room=${created.code}`)}`);
    assert.equal(qrResponse.status, 200);
    assert.match(qrResponse.headers.get('content-type'), /^image\/png/);
  } finally {
    host?.disconnect();
    player?.disconnect();
    child.kill('SIGTERM');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  assert.equal(serverErrors, '');
}

integrationTest()
  .then(() => console.log('FantaBid 2.1: controlli dati e funzioni superati'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
