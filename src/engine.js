// Pure game engine: no DOM access. Deterministic given an rng and/or fixed dice.

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
          rewards: o.rewards || config.defaultRewards,
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

function startNumbers(config, rng) {
  const nums = [...config.startNumbers];
  for (let i = nums.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [nums[i], nums[j]] = [nums[j], nums[i]];
  }
  return nums;
}

export function createGame(config, names, { rng = Math.random, dice = null } = {}) {
  const layout = buildLayout(config);
  const shared = config.startNumbersShared ? startNumbers(config, rng) : null;
  const players = names.map((name) => {
    const cells = new Array(layout.cells.length).fill(null);
    const nums = shared || startNumbers(config, rng);
    config.startCells.forEach(([r, c], i) => { cells[r * layout.size + c] = nums[i]; });
    return { name, cells, score: 0, completed: [] };
  });
  const game = {
    config,
    layout,
    players,
    round: 0,
    dice: null,
    phase: 'placing', // placing | resolved | over
    pending: {},
    roundCompletions: [],
    areaClaims: Object.fromEntries(Object.keys(layout.areas).map((id) => [id, { count: 0, claims: [] }])),
    winners: [],
    lastResolution: [],
  };
  for (let p = 0; p < players.length; p++) players[p].completed = completedAreas(game, p);
  advanceRound(game, { rng, dice });
  return game;
}

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
  if (game.phase !== 'placing') return { ok: false, reason: 'Round is not accepting placements.' };
  if (game.pending[playerIdx]) return { ok: false, reason: 'Player already placed this round.' };
  if (die !== 0 && die !== 1) return { ok: false, reason: 'Choose one of the two dice.' };
  const cell = game.layout.cells[index];
  if (!cell) return { ok: false, reason: 'Unknown cell.' };
  const board = game.players[playerIdx].cells;
  if (board[index] !== null) return { ok: false, reason: 'Cell is already filled.' };
  const value = game.dice[die];
  const other = game.dice[1 - die];
  const adjacent = neighbors(game.layout.size, cell.row, cell.col).some((n) => board[n] === other);
  if (!adjacent) return { ok: false, reason: `Must be next to a filled ${other} (not diagonal).` };
  const area = game.layout.areas[cell.areaId];
  if (!checkAreaRestriction(area.rule, areaValues(game, playerIdx, cell.areaId), value)) {
    return { ok: false, reason: `Breaks the ${area.color} area rule (${area.rule}).` };
  }
  return { ok: true };
}

// placement === null means pass; allowed only when no legal placement exists.
export function submitPlacement(game, playerIdx, placement) {
  if (game.phase !== 'placing') return { ok: false, reason: 'Round is not accepting placements.' };
  if (game.pending[playerIdx]) return { ok: false, reason: 'Player already placed this round.' };
  if (placement === null) {
    if (getLegalPlacements(game, playerIdx).length > 0) {
      return { ok: false, reason: 'A legal placement exists; passing is not allowed.' };
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
  const target = targetScore(game);
  const reached = game.players.some((p) => p.score >= target);
  const full = game.players.every((p) => p.cells.every((v) => v !== null));
  if (!reached && !full) return { over: false, winners: [] };
  const best = Math.max(...game.players.map((p) => p.score));
  const winners = game.players.map((p, i) => (p.score === best ? i : -1)).filter((i) => i >= 0);
  return { over: true, winners };
}

// Order-independent: all completers of an area in a round share the same rank.
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
    claims.count += players.length;
    results.push({ areaId, players, rank, points });
  }
  game.lastResolution = results;
  game.roundCompletions = [];
  const end = checkEnd(game);
  game.phase = end.over ? 'over' : 'resolved';
  game.winners = end.winners;
  return results;
}

export function advanceRound(game, { rng = Math.random, dice = null } = {}) {
  if (game.phase === 'over') throw new Error('Game is over.');
  if (game.round > 0 && game.phase !== 'resolved') throw new Error('Resolve the round first.');
  game.round += 1;
  game.dice = dice ? [...dice] : rollDice(game.config.dice, rng);
  game.pending = {};
  game.roundCompletions = [];
  game.lastResolution = [];
  game.phase = 'placing';
  return game.dice;
}
