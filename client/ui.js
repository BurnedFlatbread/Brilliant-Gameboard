import { LEVELS, getLevelConfig } from '../game/config.js';
import { buildLayout, neighbors } from '../game/engine.js';

const $ = (id) => document.getElementById(id);
const S = 7;
let cfg;
let layout;
let startSet;
let sortedAreas;
let currentLevel = null;

let session = JSON.parse(sessionStorage.getItem('brilliant') || 'null'); // { lobbyId, token }
let view = null;
let stream = null;
let selectedDie = null;
let selectedNum = null;
let lobbyTimer = null;
let animatedRound = null;
let hoverArea = null;
let rolling = false;
let rollTimer = null;

const COLOR_NL = { green: 'Groen', blue: 'Blauw', red: 'Rood', yellow: 'Geel', purple: 'Paars', white: 'Wit', pink: 'Roze', orange: 'Oranje' };
const RULE_NL = { free: 'vrij', same: 'gelijk', unique: 'uniek', max2: 'max. 2 getallen', low: 'alleen 1-3', high: 'alleen 4-6' };
const areaName = (a) => (a.id.length > 1 ? `${COLOR_NL[a.color]} ${a.id.slice(1)}` : COLOR_NL[a.color]);
const levelTitle = (n) => LEVELS[n].title ?? `Level ${n}`;

function setLevel(level) {
  currentLevel = level;
  cfg = getLevelConfig(level);
  layout = buildLayout(cfg);
  startSet = new Set(cfg.startCells.map(([r, c]) => r * S + c));
  sortedAreas = Object.values(layout.areas).sort((a, b) => areaName(a).localeCompare(areaName(b), 'nl'));
}
setLevel(1);

// Pixel-art gems: '.' empty, o outline, d dark, m mid, l light, h highlight, w white.
const GEM_BASE = [
  '..oooooooooo..', '.olhhwwwwhhmo.', 'olhhhwwwwhhhmo', 'omlllmmmmmmddo', 'ommllmmmmmmddo',
  '.ommlmmmmmddo.', '..ommmmmmddo..', '...ommmmddo...', '....ommddo....', '.....omdo.....', '......oo......',
];
const withRows = (rows) => GEM_BASE.map((r, i) => rows[i] ?? r);
const GEMS = {
  1: { rows: GEM_BASE, sparkles: [], colors: { o: '#10101f', d: '#123d3f', m: '#1f8a50', l: '#3ac422', h: '#8ff060', w: '#ffffff' } },
  2: {
    rows: withRows({ 6: '..omlmmmmddo..', 7: '...omlmmddo...', 8: '....omlddo....' }),
    sparkles: [[16, 2]],
    colors: { o: '#10101f', d: '#14305e', m: '#1d6fd0', l: '#3aa4ff', h: '#9ad8ff', w: '#ffffff' },
  },
  3: {
    rows: withRows({ 3: 'omlllmmwmmmddo', 5: '.omllmlmmmddo.', 6: '..omlmlmmddo..', 7: '...omlmlmdo...', 8: '....omlddo....' }),
    sparkles: [[16, 2], [1, 7], [15, 12]],
    colors: { o: '#ffcf33', d: '#4a1673', m: '#8b3fd0', l: '#c279ff', h: '#ecc8ff', w: '#ffffff' },
  },
  4: {
    rows: GEM_BASE,
    sparkles: [],
    colors: { o: '#ffa94d', d: '#b0245a', m: '#ff3fa4', l: '#ff8a3d', h: '#ffc27a', w: '#ffffff' },
  },
};

function thumbHtml(level) {
  const gem = GEMS[level];
  let rects = '';
  gem.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') rects += `<rect x="${x + 2}" y="${y + 2}" width="1" height="1" fill="${gem.colors[ch]}"/>`;
  }));
  for (const [x, y] of gem.sparkles) {
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      rects += `<rect x="${x + dx}" y="${y + dy}" width="1" height="1" fill="#fff"/>`;
    }
  }
  return `<svg class="gem gem${level}" viewBox="0 0 18 15" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
$('levelPicker').innerHTML = Object.keys(LEVELS).map((n) =>
  `<label class="lvl"><input type="radio" name="level" value="${n}" ${n === '1' ? 'checked' : ''}>${thumbHtml(n)}<span>${levelTitle(n)}</span></label>`).join('');

function startRollAnimation() {
  rolling = true;
  clearInterval(rollTimer);
  rollTimer = setInterval(() => {
    for (const d of $('dice').children) d.textContent = 1 + Math.floor(Math.random() * 6);
  }, 90);
  setTimeout(() => { clearInterval(rollTimer); rolling = false; render(); }, 1000);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, method = 'GET', body) {
  const r = await fetch(`/api/lobbies${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || 'Verzoek mislukt.');
  return data;
}

const act = (body) => api(`/${session.lobbyId}/action`, 'POST', { token: session.token, ...body });

function show(screen) {
  for (const id of ['home', 'waiting', 'game']) $(id).hidden = id !== screen;
  if (screen !== 'home') { clearInterval(lobbyTimer); lobbyTimer = null; }
}

// ---- Home ----
async function refreshLobbies() {
  try {
    const list = await api('');
    $('lobbyList').innerHTML = list.length ? list.map((l) =>
      `<li><span>${esc(l.name)} · ${levelTitle(l.level)} (${l.players}/${l.maxPlayers})</span>
       <button data-id="${l.id}" ${l.players >= l.maxPlayers ? 'disabled' : ''}>Deelnemen</button></li>`).join('')
      : '<li class="hint">Nog geen lobbies.</li>';
  } catch (e) { $('homeMsg').textContent = e.message; }
}

function homeMsg(t) { $('homeMsg').textContent = t; }
function playerNameValue() { return $('playerName').value.trim(); }

function enter(res) {
  session = res;
  sessionStorage.setItem('brilliant', JSON.stringify(session));
  connect();
}

$('lobbyList').onclick = async (e) => {
  const id = e.target.dataset?.id;
  if (!id) return;
  const playerName = playerNameValue();
  if (!playerName) return homeMsg('Vul eerst je naam in.');
  const password = prompt('Lobby wachtwoord');
  if (password === null) return;
  try { enter(await api(`/${id}/join`, 'POST', { playerName, password })); }
  catch (err) { homeMsg(err.message); }
};

$('createForm').onsubmit = async (e) => {
  e.preventDefault();
  const playerName = playerNameValue();
  if (!playerName) return homeMsg('Vul eerst je naam in.');
  try {
    enter(await api('', 'POST', {
      name: $('lobbyName').value, password: $('lobbyPw').value,
      level: Number(document.querySelector('input[name="level"]:checked').value),
      maxPlayers: Number($('lobbyMax').value), playerName,
    }));
  } catch (err) { homeMsg(err.message); }
};

function goHome() {
  if (session) {
    fetch(`/api/lobbies/${session.lobbyId}/leave`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: session.token }), keepalive: true,
    }).catch(() => {});
  }
  stream?.close(); stream = null;
  session = null; view = null;
  sessionStorage.removeItem('brilliant');
  $('over').hidden = true;
  show('home');
  refreshLobbies();
  lobbyTimer = setInterval(refreshLobbies, 3000);
}
$('leaveBtn').onclick = goHome;
$('homeBtn').onclick = goHome;

// ---- Live connection ----
function connect() {
  stream?.close();
  stream = new EventSource(`/api/lobbies/${session.lobbyId}/events?token=${encodeURIComponent(session.token)}`);
  stream.onmessage = (ev) => { view = JSON.parse(ev.data); render(); };
  stream.onerror = () => { if (stream.readyState === EventSource.CLOSED) goHome(); };
}

// ---- Rendering ----
function render() {
  if (!view) return;
  if (view.lobby.level !== currentLevel) setLevel(view.lobby.level);
  const g = view.game;
  if (!g) return renderWaiting();
  show('game');
  renderGame(g);
}

function renderWaiting() {
  const l = view.lobby;
  show('waiting');
  $('waitTitle').textContent = `${l.name} · ${levelTitle(l.level)} (${l.players.length}/${l.maxPlayers})`;
  $('waitPlayers').innerHTML = l.players.map((n, i) => `<li>${esc(n)}${i === 0 ? ' (maker)' : ''}</li>`).join('');
  const full = l.players.length === l.maxPlayers;
  $('startBtn').hidden = !l.isHost;
  $('startBtn').disabled = !full;
  $('waitMsg').textContent = full ? (l.isHost ? 'De lobby is vol.' : 'Wachten tot de maker het spel start.') : 'Wachten op meer spelers...';
}

// Cuts a gap along area borders and notches corners where only the diagonal neighbour differs.
function clipFor(cell) {
  const G = 3;
  const areaAt = (r, c) => (r < 0 || c < 0 || r >= S || c >= S ? null : layout.cells[r * S + c].areaId);
  const same = (r, c) => areaAt(r, c) === cell.areaId;
  const diagDiff = (r, c) => { const a = areaAt(r, c); return a !== null && a !== cell.areaId; };
  const { row, col } = cell;
  const up = same(row - 1, col); const down = same(row + 1, col);
  const left = same(row, col - 1); const right = same(row, col + 1);
  const t = up ? 0 : G; const b = down ? 0 : G; const l = left ? 0 : G; const r = right ? 0 : G;
  const W = (n) => `calc(100% - ${n}px)`;
  cell.gaps = `${t}px ${r}px ${b}px ${l}px`;
  const pts = [];
  if (up && left && diagDiff(row - 1, col - 1)) pts.push(`0 ${G}px`, `${G}px ${G}px`, `${G}px 0`);
  else pts.push(`${l}px ${t}px`);
  if (up && right && diagDiff(row - 1, col + 1)) pts.push(`${W(G)} 0`, `${W(G)} ${G}px`, `100% ${G}px`);
  else pts.push(`${W(r)} ${t}px`);
  if (down && right && diagDiff(row + 1, col + 1)) pts.push(`100% ${W(G)}`, `${W(G)} ${W(G)}`, `${W(G)} 100%`);
  else pts.push(`${W(r)} ${W(b)}`);
  if (down && left && diagDiff(row + 1, col - 1)) pts.push(`${G}px 100%`, `${G}px ${W(G)}`, `0 ${W(G)}`);
  else pts.push(`${l}px ${W(b)}`);
  return `polygon(${pts.join(', ')})`;
}

// Bounding box per connected group of same-area cells, so each blob gets its own gradient.
function componentBoxes() {
  const boxes = new Map();
  for (const start of layout.cells) {
    if (boxes.has(start.index)) continue;
    const members = [start.index];
    const seen = new Set(members);
    for (let k = 0; k < members.length; k++) {
      const c = layout.cells[members[k]];
      for (const n of neighbors(S, c.row, c.col)) {
        if (!seen.has(n) && layout.cells[n].areaId === start.areaId) { seen.add(n); members.push(n); }
      }
    }
    const rows = members.map((i) => layout.cells[i].row);
    const cols = members.map((i) => layout.cells[i].col);
    const box = { r0: Math.min(...rows), r1: Math.max(...rows), c0: Math.min(...cols), c1: Math.max(...cols) };
    for (const i of members) boxes.set(i, box);
  }
  return boxes;
}

function highlight(areaId) {
  hoverArea = areaId;
  $('board').classList.toggle('focus', !!areaId);
  for (const c of $('board').children) c.classList.toggle('hl', !!areaId && c.dataset.area === areaId);
}
$('areas').onmouseover = (e) => highlight(e.target.closest('li')?.dataset.area ?? null);
$('areas').onmouseleave = () => highlight(null);
$('areas').onclick = (e) => {
  highlight(e.target.closest('li')?.dataset.area ?? null);
  setTimeout(() => highlight(null), 2000);
};

function say(text, bad = false) {
  $('msg').textContent = text;
  $('msg').classList.toggle('bad', bad);
}

function renderGame(g) {
  const me = view.lobby.me;
  const names = g.scores.map((s) => s.name);
  const setup = g.phase === 'setup';
  const placing = g.phase === 'placing';
  const myReady = g.scores[me].ready;

  $('round').textContent = g.round;
  $('target').textContent = `(doel ${g.target})`;
  $('order').textContent = g.order.length ? `Volgorde: ${g.order.map((i) => names[i]).join(' > ')}` : '';
  $('turn').textContent = setup ? 'Plaats je startgetallen'
    : g.phase === 'rolling' ? `${names[g.roller]} gooit`
    : placing ? 'Plaats een getal' : 'Einde spel';

  if (animatedRound === null) animatedRound = g.round;
  else if (g.round !== animatedRound) { animatedRound = g.round; startRollAnimation(); }
  const legal = rolling ? [] : g.legal;

  // Dice
  const usable = new Set(legal.map((m) => m.die));
  if (selectedDie === null || !usable.has(selectedDie)) selectedDie = usable.size ? [...usable][0] : null;
  $('dice').innerHTML = '';
  if (g.dice) {
    g.dice.forEach((v, i) => {
      const b = document.createElement('button');
      b.className = 'die' + (selectedDie === i ? ' sel' : '') + (rolling ? ' rolling' : '');
      b.textContent = v;
      b.disabled = !usable.has(i);
      b.onclick = () => { selectedDie = i; render(); };
      $('dice').append(b);
    });
  }

  // Starting-number palette
  $('palette').hidden = !(setup && !myReady);
  $('palette').innerHTML = '';
  const used = new Set(cfg.startCells.map(([r, c]) => g.cells[r * S + c]).filter((v) => v !== null));
  for (const n of cfg.startNumbers) {
    const b = document.createElement('button');
    b.className = 'die' + (selectedNum === n ? ' sel' : '');
    b.textContent = n;
    b.style.opacity = used.has(n) ? '.5' : '1';
    b.onclick = () => { selectedNum = n; render(); };
    $('palette').append(b);
  }

  // Board
  const legalSet = new Set(legal.filter((m) => m.die === selectedDie).map((m) => m.index));
  const done = new Set(g.completed);
  $('board').innerHTML = '';
  const boxes = componentBoxes();
  for (const cell of layout.cells) {
    const d = document.createElement('button');
    const isStart = startSet.has(cell.index);
    d.style.clipPath = clipFor(cell);
    const [gt, gr, gb, gl] = cell.gaps.split(' ');
    d.style.setProperty('--gt', gt); d.style.setProperty('--gr', gr);
    d.style.setProperty('--gb', gb); d.style.setProperty('--gl', gl);
    const box = boxes.get(cell.index);
    const nc = box.c1 - box.c0 + 1;
    const nr = box.r1 - box.r0 + 1;
    d.style.backgroundSize = `${nc * 100}% ${nr * 100}%`;
    d.style.backgroundPosition = `${nc > 1 ? ((cell.col - box.c0) / (nc - 1)) * 100 : 0}% ${nr > 1 ? ((cell.row - box.r0) / (nr - 1)) * 100 : 0}%`;
    d.className = ['cell', cell.color,
      isStart && 'start', isStart && setup && !myReady && 'target',
      legalSet.has(cell.index) && 'legal', done.has(cell.areaId) && 'done'].filter(Boolean).join(' ');
    const val = g.cells[cell.index];
    const marker = isStart
      ? `<svg class="mk${val === null ? ' big' : ''}" viewBox="0 0 12 10" aria-hidden="true"><polygon points="1,3.5 3.5,1 8.5,1 11,3.5 6,9" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/><path d="M1 3.5H11M3.5 1L5 3.5L6 9M8.5 1L7 3.5L6 9" fill="none" stroke="currentColor" stroke-width=".6"/></svg>`
      : '';
    d.innerHTML = `${marker}<span class="n">${val ?? ''}</span>`;
    d.dataset.area = cell.areaId;
    d.onclick = () => onCell(g, cell.index, d);
    $('board').append(d);
  }

  // Messages and buttons
  const resolution = g.lastResolution.map((r) =>
    `${areaName(layout.areas[r.areaId])} voltooid door ${r.players.map((i) => names[i]).join(', ')} (+${r.points})`).join('; ');
  if (setup) say(myReady ? 'Wachten op de andere spelers...' : 'Kies een getal en klik op een vakje met diamant. Elk getal van 1-6 één keer.');
  else if (rolling) say('De dobbelstenen rollen...');
  else if (g.phase === 'rolling') say(resolution || 'Wachten op de worp.');
  else if (placing && g.pending) say('Wachten op de andere spelers...');
  else if (placing && legal.length === 0) say('Geen geldige plaatsing: sla deze ronde over.');
  else if (placing) say('Kies een dobbelsteen en daarna een gemarkeerd vakje.');
  else say(resolution);

  $('readyBtn').hidden = !(setup && !myReady);
  $('rollBtn').hidden = !(g.phase === 'rolling' && g.roller === me);
  $('passBtn').hidden = !(placing && !g.pending && !rolling && legal.length === 0);

  $('scores').innerHTML = g.scores.map((s, i) => {
    const tag = setup ? (s.ready ? ' (klaar)' : '') : placing && s.done ? ' (gedaan)' : '';
    return `<li class="${i === me ? 'current' : ''}">${esc(s.name)}: ${s.score}${tag}</li>`;
  }).join('');
  $('areas').innerHTML = sortedAreas.map((a) => {
    const taken = g.claims[a.id].count;
    const rewards = a.rewards.map((p, i) => `<span class="rw${i < taken ? ' taken' : ''}">${p}</span>`).join('');
    const num = a.id.length > 1 ? a.id.slice(1) : '';
    return `<li data-area="${a.id}"><span class="chip ${a.color}">${num}</span><span class="aname">${areaName(a)}</span>`
      + `<span class="rule">${RULE_NL[a.rule]}</span><span class="rws">${rewards}</span></li>`;
  }).join('');
  if (hoverArea) highlight(hoverArea);

  const groups = {};
  for (const [id, c] of Object.entries(g.claims)) {
    for (const cl of c.claims) {
      const entry = groups[`${cl.round}|${id}`] ||= { round: cl.round, id, players: [], points: cl.points };
      entry.players.push(cl.player);
    }
  }
  const logs = Object.values(groups).sort((a, b) => b.round - a.round);
  $('logs').innerHTML = logs.length ? logs.map((e) => {
    const who = e.players.map((i) => esc(names[i])).join(', ');
    const a = layout.areas[e.id];
    return `<li><span class="lr">R${e.round}</span><span class="chip sm ${a.color}">${a.id.slice(1)}</span><span class="lw">${who}</span><b>+${e.points}</b></li>`;
  }).join('') : '<li class="hint">Nog niets voltooid.</li>';

  if (g.phase === 'over') {
    $('winner').textContent = g.winners.length > 1
      ? `Gelijkspel: ${g.winners.map((i) => names[i]).join(', ')}` : `Winnaar: ${names[g.winners[0]]}`;
    $('finalScores').innerHTML = [...g.scores].sort((a, b) => b.score - a.score)
      .map((s) => `<li>${esc(s.name)}: ${s.score}</li>`).join('');
    $('over').hidden = false;
  }
}

async function onCell(g, index, el) {
  try {
    if (g.phase === 'setup' && startSet.has(index) && !g.scores[view.lobby.me].ready) {
      if (g.cells[index] !== null && selectedNum === null) await act({ type: 'clearStart', index });
      else if (selectedNum !== null) await act({ type: 'startNumber', index, number: selectedNum });
      return;
    }
    if (g.phase === 'placing' && !g.pending) {
      if (rolling || selectedDie === null) return;
      await act({ type: 'place', index, die: selectedDie });
    }
  } catch (err) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    say(err.message, true);
  }
}

$('startBtn').onclick = () => api(`/${session.lobbyId}/start`, 'POST', { token: session.token }).catch((e) => ($('waitMsg').textContent = e.message));
$('rollBtn').onclick = () => act({ type: 'roll' }).catch((e) => say(e.message, true));
$('passBtn').onclick = () => act({ type: 'pass' }).catch((e) => say(e.message, true));
$('readyBtn').onclick = () => act({ type: 'ready' }).catch((e) => say(e.message, true));

const FONT = {
  B: ['####.', '#...#', '####.', '#...#', '####.'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
};

function titleSvg(text) {
  const rowColor = ['h', 'l', 'l', 'm', 'd'];
  let x = 1;
  let shadow = '';
  let body = '';
  [...text].forEach((ch) => {
    const glyph = FONT[ch];
    const colors = { h: '#e0e7ff', l: '#a5b4fc', m: '#6366f1', d: '#3730a3' };
    glyph.forEach((row, y) => [...row].forEach((p, dx) => {
      if (p !== '#') return;
      shadow += `<rect x="${x + dx + 0.5}" y="${y + 1.5}" width="1" height="1" fill="#05060f"/>`;
      body += `<rect x="${x + dx}" y="${y + 1}" width="1" height="1" fill="${colors[rowColor[y]]}"/>`;
    }));
    x += glyph[0].length + 1;
  });
  return `<svg class="title-svg" viewBox="0 0 ${x + 1} 8" shape-rendering="crispEdges" aria-hidden="true">${shadow}${body}</svg>`;
}
$('title').innerHTML = titleSvg('BRILLIANT');
if (session) connect(); else goHome();
