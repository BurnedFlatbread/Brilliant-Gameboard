import { BRILLIANT_CONFIG as CFG } from './config.js';
import {
  createGame, getLegalPlacements, validatePlacement, submitPlacement, resolveRound,
  advanceRound, allSubmitted, targetScore,
} from './engine.js';

const $ = (id) => document.getElementById(id);
let game = null;
let names = [];
let selectedDie = null;

function renderNames() {
  const n = Number($('playerCount').value);
  const old = [...$('names').querySelectorAll('input')].map((i) => i.value);
  $('names').innerHTML = '';
  for (let i = 0; i < n; i++) {
    const inp = document.createElement('input');
    inp.value = old[i] || `Player ${i + 1}`;
    inp.maxLength = 20;
    $('names').append(inp);
  }
}

function startGame(list) {
  names = list;
  game = createGame(CFG, names);
  selectedDie = null;
  $('setup').hidden = true;
  $('game').hidden = false;
  $('over').hidden = true;
  render();
}

const currentPlayer = () => game.players.findIndex((_, i) => !game.pending[i]);

function say(text, bad = false) {
  $('msg').textContent = text;
  $('msg').classList.toggle('bad', bad);
}

function render() {
  const cur = currentPlayer();
  const view = cur === -1 ? game.players.length - 1 : cur;
  const placing = game.phase === 'placing';
  $('round').textContent = game.round;
  $('turn').textContent = placing ? `Turn: ${game.players[cur].name}` : 'Round resolved';
  $('target').textContent = `(target ${targetScore(game)})`;

  const legal = placing ? getLegalPlacements(game, cur) : [];
  const usable = new Set(legal.map((m) => m.die));
  if (selectedDie === null || !usable.has(selectedDie)) selectedDie = usable.size ? [...usable][0] : null;
  const equal = game.dice[0] === game.dice[1];

  $('dice').innerHTML = '';
  game.dice.forEach((v, i) => {
    const b = document.createElement('button');
    b.className = 'die' + (selectedDie === i || (equal && selectedDie !== null) ? ' sel' : '');
    b.textContent = v;
    b.disabled = !placing || !usable.has(i) && !(equal && usable.size);
    b.onclick = () => { selectedDie = equal ? 0 : i; render(); };
    $('dice').append(b);
  });

  const legalSet = new Set(legal.filter((m) => m.die === selectedDie).map((m) => m.index));
  const p = game.players[view];
  const start = new Set(CFG.startCells.map(([r, c]) => r * game.layout.size + c));
  const completed = new Set(p.completed);
  $('board').innerHTML = '';
  for (const cell of game.layout.cells) {
    const d = document.createElement('button');
    const at = (r, c) => game.layout.cells[r * game.layout.size + c]?.areaId;
    const s = game.layout.size;
    const diff = (r, c) => r < 0 || c < 0 || r >= s || c >= s || at(r, c) !== cell.areaId;
    d.className = ['cell', cell.color,
      diff(cell.row - 1, cell.col) && 'bt', diff(cell.row + 1, cell.col) && 'bb',
      diff(cell.row, cell.col - 1) && 'bl', diff(cell.row, cell.col + 1) && 'br',
      start.has(cell.index) && 'start', legalSet.has(cell.index) && 'legal',
      completed.has(cell.areaId) && 'done'].filter(Boolean).join(' ');
    d.textContent = p.cells[cell.index] ?? '';
    d.dataset.index = cell.index;
    d.onclick = () => place(cur, cell.index, d);
    $('board').append(d);
  }

  if (placing && legal.length === 0) say(`${game.players[cur].name}: no legal placement.`);
  else if (placing) say(`${game.players[cur].name}: pick a die, then a highlighted cell.`);
  else if (game.lastResolution.length) {
    say(game.lastResolution.map((r) => `${r.areaId} completed by ${r.players.map((i) => game.players[i].name).join(', ')} (+${r.points})`).join('; '));
  } else say('No areas completed this round.');

  $('passBtn').hidden = !(placing && legal.length === 0);
  $('nextBtn').hidden = game.phase !== 'resolved';

  $('scores').innerHTML = game.players.map((q, i) =>
    `<li class="${i === cur ? 'current' : ''}">${esc(q.name)}: ${q.score}${game.pending[i] ? ' (done)' : ''}</li>`).join('');
  $('areas').innerHTML = Object.values(game.layout.areas).map((a) => {
    const claims = game.areaClaims[a.id].claims;
    const txt = claims.length ? claims.map((c) => `${esc(game.players[c.player].name)} +${c.points}`).join(', ') : `rewards ${a.rewards.join('/')}`;
    return `<li><span class="chip ${a.color}"></span>${a.id} (${a.rule}): ${txt}</li>`;
  }).join('');
}

function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function place(cur, index, el) {
  if (game.phase !== 'placing' || selectedDie === null) return;
  const res = submitPlacement(game, cur, { index, die: selectedDie });
  if (!res.ok) {
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
    say(validatePlacement(game, cur, { index, die: selectedDie }).reason || res.reason, true);
    return;
  }
  afterSubmit();
}

function afterSubmit() {
  if (allSubmitted(game)) {
    resolveRound(game);
    if (game.phase === 'over') showOver();
  }
  render();
}

function showOver() {
  const best = game.players.filter((_, i) => game.winners.includes(i)).map((q) => q.name);
  $('winner').textContent = best.length > 1 ? `Tie: ${best.join(', ')}` : `Winner: ${best[0]}`;
  $('finalScores').innerHTML = [...game.players].sort((a, b) => b.score - a.score)
    .map((q) => `<li>${esc(q.name)}: ${q.score}</li>`).join('');
  $('over').hidden = false;
}

$('playerCount').onchange = renderNames;
$('startBtn').onclick = () => startGame([...$('names').querySelectorAll('input')].map((i, k) => i.value.trim() || `Player ${k + 1}`));
$('passBtn').onclick = () => { const r = submitPlacement(game, currentPlayer(), null); if (!r.ok) say(r.reason, true); else afterSubmit(); };
$('nextBtn').onclick = () => { advanceRound(game); render(); };
const restart = () => startGame(names);
const newGame = () => { $('game').hidden = true; $('over').hidden = true; $('setup').hidden = false; };
$('restartBtn').onclick = restart;
$('againBtn').onclick = restart;
$('newBtn').onclick = newGame;
$('newBtn2').onclick = newGame;

$('unverified').innerHTML = CFG.unverified.map((t) => `<li>${esc(t)}</li>`).join('');
renderNames();
