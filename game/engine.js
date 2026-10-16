// Pure game engine: no DOM access. Deterministic given an rng and/or fixed dice.

const RULE_NL = { free: 'vrij', same: 'gelijk', unique: 'uniek', max2: 'max. 2 getallen', low: 'alleen 1-3', high: 'alleen 4-6' };

export function createRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildLayout(config) {
  const size = config.size;
  const cells = [];
  const areas = {};
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const areaId = config.areaGrid[r][c];
      const type = config.areaTypes[areaId[0]];
      const index = r * size + c;
      cells.push({ index, row: r, col: c, color: type.color, areaId });
      if (!areas[areaId]) {
        const o = (config.areaOverrides || {})[areaId] || {};
        areas[areaId] = {
          id: areaId,
          color: type.color,
          rule: o.rule || type.rule,
          rewards: o.rewards || type.rewards,
          cells: [],
        };
      }
      areas[areaId].cells.push(index);
    }
  }
  return { size, cells, areas };
}

export function neighbors(size, row, col) {
  const out = [];
  for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const r = row + dr;
    const c = col + dc;
    if (r >= 0 && r < size && c >= 0 && c < size) out.push(r * size + c);
  }
  return out;
}

export function rollDice(diceConfig, rng = Math.random) {
  return diceConfig.map((d) => d.faces[Math.floor(rng() * d.faces.length)]);
}

// existing: values already in the area; value: the number being added.
export function checkAreaRestriction(rule, existing, value) {
  switch (rule) {
    case 'free':
      return true;
    case 'same':
      return existing.every((v) => v === value);
    case 'unique':
      return !existing.includes(value);
    case 'max2':
      return new Set([...existing, value]).size <= 2;
    case 'low':
      return value >= 1 && value <= 3;
    case 'high':
      return value >= 4 && value <= 6;
    default:
      throw new Error(`Unknown area rule: ${rule}`);
  }
}

export function areaValues(game, playerIdx, areaId) {
  const cells = game.players[playerIdx].cells;
  return game.layout.areas[areaId].cells.map((i) => cells[i]).filter((v) => v !== null);
}

export function isAreaComplete(game, playerIdx, areaId) {
  return game.layout.areas[areaId].cells.every((i) => game.players[playerIdx].cells[i] !== null);
}

export function completedAreas(game, playerIdx) {
  return Object.keys(game.layout.areas).filter((id) => isAreaComplete(game, playerIdx, id));
}

export function rewardFor(area, rank, config) {
  return rank < area.rewards.length ? area.rewards[rank] : config.rewardAfterList;
}

export function targetScore(game) {
  return game.config.targetScores[game.players.length];
}

export function createGame(config, names) {
  if (!config.targetScores[names.length]) throw new Error('Unsupported player count.');
  const layout = buildLayout(config);
  const players = names.map((name) => ({
    name,
    cells: new Array(layout.cells.length).fill(null),
    score: 0,
    completed: [],
    ready: false,
  }));
  return {
    config,
    layout,
    players,
    phase: 'setup', // setup | rolling | placing | over
    order: [],
    rollerPos: 0,
    round: 0,
    dice: null,
    pending: {},
    roundCompletions: [],
    areaClaims: Object.fromEntries(Object.keys(layout.areas).map((id) => [id, { count: 0, claims: [] }])),
    winners: [],
    lastResolution: [],
  };
}

// ---- Setup phase: each player places 1-6 on the start cells themselves ----

function startIndexes(game) {
  return game.config.startCells.map(([r, c]) => r * game.layout.size + c);
}

export function placeStartNumber(game, playerIdx, { index, number }) {
  if (game.phase !== 'setup') return { ok: false, reason: 'De voorbereiding is afgelopen.' };
  const p = game.players[playerIdx];
  if (p.ready) return { ok: false, reason: 'Al bevestigd.' };
  const starts = startIndexes(game);
  if (!starts.includes(index)) return { ok: false, reason: 'Dit is geen startvakje.' };
  if (!game.config.startNumbers.includes(number)) return { ok: false, reason: 'Ongeldig getal.' };
  for (const s of starts) if (p.cells[s] === number) p.cells[s] = null; // move it
  p.cells[index] = number;
  return { ok: true };
}

export function clearStartNumber(game, playerIdx, index) {
  if (game.phase !== 'setup') return { ok: false, reason: 'De voorbereiding is afgelopen.' };
  const p = game.players[playerIdx];
  if (p.ready) return { ok: false, reason: 'Al bevestigd.' };
  if (!startIndexes(game).includes(index)) return { ok: false, reason: 'Dit is geen startvakje.' };
  p.cells[index] = null;
  return { ok: true };
}

export function setReady(game, playerIdx, { rng = Math.random } = {}) {
  if (game.phase !== 'setup') return { ok: false, reason: 'De voorbereiding is afgelopen.' };
  const p = game.players[playerIdx];
  const vals = startIndexes(game).map((i) => p.cells[i]);
  if (vals.some((v) => v === null)) return { ok: false, reason: 'Vul elk startvakje met een getal van 1-6.' };
  p.ready = true;
  if (game.players.every((q) => q.ready)) startPlay(game, rng);
  return { ok: true };
}

// Random roll order; the first entry rolls first, then the order repeats.
export function startPlay(game, rng = Math.random) {
  game.order = shuffle(game.players.map((_, i) => i), rng);
  game.rollerPos = 0;
  game.round = 0;
  game.phase = 'rolling';
  game.players.forEach((p, i) => { p.completed = completedAreas(game, i); });
}

export const currentRoller = (game) => game.order[game.rollerPos % game.order.length];

export function rollRound(game, playerIdx, { rng = Math.random, dice = null } = {}) {
  if (game.phase !== 'rolling') return { ok: false, reason: 'Er wordt niet op een worp gewacht.' };
  if (currentRoller(game) !== playerIdx) return { ok: false, reason: 'Jij bent niet aan de beurt om te gooien.' };
  game.round += 1;
  game.dice = dice ? [...dice] : rollDice(game.config.dice, rng);
  game.pending = {};
  game.roundCompletions = [];
  game.lastResolution = [];
  game.phase = 'placing';
  return { ok: true };
}

// ---- Placement ----

export function getLegalPlacements(game, playerIdx) {
  if (game.phase !== 'placing') return [];
  const out = [];
  const dieCount = game.dice[0] === game.dice[1] ? 1 : 2;
  for (const cell of game.layout.cells) {
    for (let die = 0; die < dieCount; die++) {
      if (validatePlacement(game, playerIdx, { index: cell.index, die }).ok) {
        out.push({ index: cell.index, die });
      }
    }
  }
  return out;
}

export function validatePlacement(game, playerIdx, { index, die }) {
  if (game.phase !== 'placing') return { ok: false, reason: 'Er kunnen nu geen getallen geplaatst worden.' };
  if (game.pending[playerIdx]) return { ok: false, reason: 'Je hebt deze ronde al geplaatst.' };
  if (die !== 0 && die !== 1) return { ok: false, reason: 'Kies een van de twee dobbelstenen.' };
  const cell = game.layout.cells[index];
  if (!cell) return { ok: false, reason: 'Onbekend vakje.' };
  const board = game.players[playerIdx].cells;
  if (board[index] !== null) return { ok: false, reason: 'Dit vakje is al gevuld.' };
  const value = game.dice[die];
  const other = game.dice[1 - die];
  const adjacent = neighbors(game.layout.size, cell.row, cell.col).some((n) => board[n] === other);
  if (!adjacent) return { ok: false, reason: `Moet naast een ingevulde ${other} liggen (niet diagonaal).` };
  const area = game.layout.areas[cell.areaId];
  if (!checkAreaRestriction(area.rule, areaValues(game, playerIdx, cell.areaId), value)) {
    return { ok: false, reason: `Dit vakje breekt de regel van het gebied (${RULE_NL[area.rule]}).` };
  }
  return { ok: true };
}

// placement === null means pass; allowed only when no legal placement exists.
export function submitPlacement(game, playerIdx, placement) {
  if (game.phase !== 'placing') return { ok: false, reason: 'Er kunnen nu geen getallen geplaatst worden.' };
  if (game.pending[playerIdx]) return { ok: false, reason: 'Je hebt deze ronde al geplaatst.' };
  if (placement === null) {
    if (getLegalPlacements(game, playerIdx).length > 0) {
      return { ok: false, reason: 'Er is een geldige plaatsing mogelijk; overslaan mag niet.' };
    }
    game.pending[playerIdx] = { pass: true };
    return { ok: true, pass: true };
  }
  const v = validatePlacement(game, playerIdx, placement);
  if (!v.ok) return v;
  const player = game.players[playerIdx];
  player.cells[placement.index] = game.dice[placement.die];
  game.pending[playerIdx] = { ...placement, value: game.dice[placement.die] };
  const areaId = game.layout.cells[placement.index].areaId;
  if (isAreaComplete(game, playerIdx, areaId) && !player.completed.includes(areaId)) {
    player.completed.push(areaId);
    game.roundCompletions.push({ player: playerIdx, areaId });
  }
  return { ok: true };
}

export function allSubmitted(game) {
  return game.players.every((_, i) => game.pending[i]);
}

export function checkEnd(game) {
  const reached = game.players.some((p) => p.score >= targetScore(game));
  const full = game.players.every((p) => p.cells.every((v) => v !== null));
  if (!reached && !full) return { over: false, winners: [] };
  const best = Math.max(...game.players.map((p) => p.score));
  const winners = game.players.map((p, i) => (p.score === best ? i : -1)).filter((i) => i >= 0);
  return { over: true, winners };
}

// Order-independent: all completers of an area in a round get the best open reward.
export function resolveRound(game) {
  if (game.phase !== 'placing' || !allSubmitted(game)) {
    throw new Error('Round cannot be resolved yet.');
  }
  const byArea = new Map();
  for (const { player, areaId } of game.roundCompletions) {
    if (!byArea.has(areaId)) byArea.set(areaId, []);
    byArea.get(areaId).push(player);
  }
  const results = [];
  for (const areaId of [...byArea.keys()].sort()) {
    const players = byArea.get(areaId).sort((a, b) => a - b);
    const claims = game.areaClaims[areaId];
    const rank = claims.count;
    const points = rewardFor(game.layout.areas[areaId], rank, game.config);
    for (const p of players) {
      game.players[p].score += points;
      claims.claims.push({ player: p, round: game.round, rank, points });
    }
    claims.count += 1;
    results.push({ areaId, players, rank, points });
  }
  game.lastResolution = results;
  game.roundCompletions = [];
  const end = checkEnd(game);
  game.winners = end.winners;
  if (end.over) {
    game.phase = 'over';
  } else {
    game.rollerPos += 1;
    game.phase = 'rolling';
  }
  return results;
}
