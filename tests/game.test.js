import test from 'node:test';
import assert from 'node:assert/strict';
import { BRILLIANT_CONFIG as CFG, LEVELS, getLevelConfig } from '../game/config.js';
import {
  createGame, createRng, neighbors, rollDice, validatePlacement, getLegalPlacements,
  submitPlacement, resolveRound, checkAreaRestriction, checkEnd, rewardFor, completedAreas,
  allSubmitted, placeStartNumber, setReady, rollRound, currentRoller, targetScore,
} from '../game/engine.js';

const ix = (r, c) => r * 7 + c;
const startIdx = CFG.startCells.map(([r, c]) => ix(r, c));

// Game in the placing phase with blank boards and fixed dice.
function newGame(dice, n = 2) {
  const g = createGame(CFG, ['A', 'B', 'C', 'D', 'E'].slice(0, n));
  g.players.forEach((_, p) => {
    startIdx.forEach((index, i) => placeStartNumber(g, p, { index, number: i + 1 }));
    setReady(g, p, { rng: createRng(1) });
  });
  rollRound(g, currentRoller(g), { dice });
  g.players.forEach((p) => p.cells.fill(null));
  return g;
}
function nextRound(g, dice) {
  assert.equal(g.phase, 'rolling');
  assert.ok(rollRound(g, currentRoller(g), { dice }).ok);
}
function set(g, p, map) {
  for (const [k, v] of Object.entries(map)) {
    const [r, c] = k.split(',').map(Number);
    g.players[p].cells[ix(r, c)] = v;
  }
}
const place = (g, p, r, c, die = 0) => assert.ok(submitPlacement(g, p, { index: ix(r, c), die }).ok);
// Four yellow cells filled; the fifth, (3,3), is completed by a 5 beside the 6 at (3,4). Dice [5,6].
const yellowReady = (g, p) => set(g, p, { '0,0': 1, '0,6': 2, '6,0': 3, '6,6': 4, '3,4': 6 });

test('levels: 49 cells, 6 start cells, expected area counts and white rewards', () => {
  const expected = { 1: 9, 2: 10, 3: 8, 4: 9 };
  const white = { 2: [3, 2, 1], 3: [8, 6, 4] };
  for (const level of Object.keys(LEVELS)) {
    const g = createGame(getLevelConfig(Number(level)), ['A', 'B']);
    assert.equal(g.layout.cells.length, 49);
    assert.equal(Object.keys(g.layout.areas).length, expected[level]);
    assert.equal(g.config.startCells.length, 6);
    if (white[level]) assert.deepEqual(g.layout.areas.W.rewards, white[level]);
  }
});

test('layout: 49 cells, 9 areas, yellow is one 5-cell area', () => {
  const g = createGame(CFG, ['A', 'B']);
  assert.equal(g.layout.cells.length, 49);
  assert.equal(Object.keys(g.layout.areas).length, 9);
  assert.equal(g.layout.areas.Y.cells.length, 5);
  assert.notEqual(g.layout.cells[ix(0, 1)].areaId, g.layout.cells[ix(1, 6)].areaId);
});

test('setup: starting cells begin empty and players place 1-6 themselves', () => {
  const g = createGame(CFG, ['A', 'B']);
  assert.ok(g.players[0].cells.every((v) => v === null));
  assert.ok(!setReady(g, 0).ok);
  assert.ok(!placeStartNumber(g, 0, { index: ix(0, 0), number: 1 }).ok); // not a start cell
  assert.ok(!placeStartNumber(g, 0, { index: startIdx[0], number: 7 }).ok);
  placeStartNumber(g, 0, { index: startIdx[0], number: 3 });
  placeStartNumber(g, 0, { index: startIdx[1], number: 3 }); // moves the 3
  assert.equal(g.players[0].cells[startIdx[0]], null);
  assert.equal(g.players[0].cells[startIdx[1]], 3);
  assert.equal(g.players[1].cells[startIdx[1]], null);
});

test('setup: play starts once everyone is ready; roll order is a permutation', () => {
  const g = createGame(CFG, ['A', 'B', 'C']);
  for (let p = 0; p < 3; p++) {
    startIdx.forEach((index, i) => placeStartNumber(g, p, { index, number: i + 1 }));
    assert.equal(g.phase, 'setup');
    setReady(g, p, { rng: createRng(5) });
  }
  assert.equal(g.phase, 'rolling');
  assert.deepEqual([...g.order].sort(), [0, 1, 2]);
  const roller = currentRoller(g);
  const other = (roller + 1) % 3;
  assert.ok(!rollRound(g, other, { dice: [1, 2] }).ok);
  assert.ok(rollRound(g, roller, { dice: [1, 2] }).ok);
});

test('roller order repeats after everyone has acted', () => {
  const g = newGame([2, 5], 4);
  const seen = [];
  for (let r = 0; r < 8; r++) {
    seen.push(currentRoller(g));
    g.players.forEach((_, p) => submitPlacement(g, p, null)); // nobody has a legal move on blank boards
    resolveRound(g);
    if (r < 7) nextRound(g, [2, 5]);
  }
  assert.deepEqual(seen.slice(4), seen.slice(0, 4));
  assert.equal(new Set(seen.slice(0, 4)).size, 4);
});

test('neighbors are orthogonal only', () => {
  assert.deepEqual(neighbors(7, 0, 0).sort((a, b) => a - b), [1, 7]);
  assert.equal(neighbors(7, 3, 3).length, 4);
});

test('orthogonal versus diagonal adjacency', () => {
  const g = newGame([2, 5]);
  set(g, 0, { '3,0': 5 });
  assert.ok(validatePlacement(g, 0, { index: ix(2, 0), die: 0 }).ok);
  assert.ok(validatePlacement(g, 0, { index: ix(3, 1), die: 0 }).ok);
  assert.ok(!validatePlacement(g, 0, { index: ix(2, 1), die: 0 }).ok);
  assert.ok(!validatePlacement(g, 0, { index: ix(4, 1), die: 0 }).ok);
});

test('empty versus occupied cells', () => {
  const g = newGame([2, 5]);
  set(g, 0, { '3,0': 5, '2,0': 1 });
  assert.equal(validatePlacement(g, 0, { index: ix(2, 0), die: 0 }).ok, false);
  assert.ok(validatePlacement(g, 0, { index: ix(4, 0), die: 0 }).ok);
});

test('both dice can be placed', () => {
  const g = newGame([2, 5]);
  set(g, 0, { '3,0': 5, '4,0': 2 });
  assert.ok(validatePlacement(g, 0, { index: ix(2, 0), die: 0 }).ok);
  assert.ok(validatePlacement(g, 0, { index: ix(5, 0), die: 1 }).ok);
  assert.ok(!validatePlacement(g, 0, { index: ix(2, 0), die: 1 }).ok);
});

test('only one result placeable', () => {
  const g = newGame([2, 5]);
  set(g, 0, { '3,0': 5 });
  const legal = getLegalPlacements(g, 0);
  assert.ok(legal.length > 0 && legal.every((m) => m.die === 0));
});

test('equal dice: a 3 needs an adjacent 3', () => {
  const g = newGame([3, 3]);
  set(g, 0, { '3,0': 3, '0,6': 4 });
  const legal = getLegalPlacements(g, 0);
  assert.ok(legal.every((m) => m.die === 0));
  assert.deepEqual(legal.map((m) => m.index).sort((a, b) => a - b), [ix(2, 0), ix(4, 0), ix(3, 1)]);
});

test('range rules: pink 1-3, orange 4-6', () => {
  assert.ok(checkAreaRestriction('low', [], 3));
  assert.ok(!checkAreaRestriction('low', [], 4));
  assert.ok(checkAreaRestriction('high', [5], 4));
  assert.ok(!checkAreaRestriction('high', [], 3));
});

test('level 4: start cells avoid pink and orange and use distinct areas', () => {
  const g = createGame(getLevelConfig(4), ['A', 'B']);
  const areas = g.config.startCells.map(([r, c]) => g.layout.cells[r * 7 + c].areaId);
  assert.ok(!areas.includes('K') && !areas.includes('O'));
  assert.equal(new Set(areas).size, 6);
});

test('area restrictions', () => {
  assert.ok(checkAreaRestriction('free', [1, 1, 6], 6));
  assert.ok(checkAreaRestriction('same', [4, 4], 4));
  assert.ok(!checkAreaRestriction('same', [4, 4], 5));
  assert.ok(checkAreaRestriction('unique', [1, 2], 3));
  assert.ok(!checkAreaRestriction('unique', [1, 2], 2));
  assert.ok(checkAreaRestriction('max2', [1, 2, 2], 1));
  assert.ok(!checkAreaRestriction('max2', [1, 2], 3));
});

test('restrictions apply to the whole area in placement validation', () => {
  const g = newGame([1, 2]);
  set(g, 0, { '0,2': 1, '1,1': 2 }); // blue B1 holds a 1
  assert.ok(!validatePlacement(g, 0, { index: ix(1, 2), die: 1 }).ok);
  assert.ok(validatePlacement(g, 0, { index: ix(1, 2), die: 0 }).ok);
  const r = newGame([1, 2]);
  set(r, 0, { '2,1': 1, '3,0': 2 }); // red R1 holds a 1
  assert.ok(!validatePlacement(r, 0, { index: ix(3, 1), die: 0 }).ok);
  const h = newGame([3, 2]);
  set(h, 0, { '0,3': 1, '0,4': 2 }); // purple P1 holds 1 and 2
  assert.ok(!validatePlacement(h, 0, { index: ix(1, 4), die: 0 }).ok);
});

test('yellow needs all five cells', () => {
  const g = newGame([5, 6]);
  set(g, 0, { '0,0': 1, '0,6': 2, '6,0': 3, '3,4': 6 }); // only 4 yellow filled after the move
  place(g, 0, 3, 3);
  assert.ok(!completedAreas(g, 0).includes('Y'));
  const h = newGame([5, 6]);
  yellowReady(h, 0);
  place(h, 0, 3, 3);
  assert.ok(completedAreas(h, 0).includes('Y'));
});

test('first, second and third yellow completions get 8/6/4', () => {
  const g = newGame([5, 6], 3);
  for (const p of [0, 1, 2]) yellowReady(g, p);
  place(g, 0, 3, 3); place(g, 1, 3, 5); place(g, 2, 3, 5); resolveRound(g);
  nextRound(g, [5, 6]);
  place(g, 0, 2, 4); place(g, 1, 3, 3); place(g, 2, 2, 4); resolveRound(g);
  nextRound(g, [5, 6]);
  place(g, 0, 4, 4); place(g, 1, 4, 4); place(g, 2, 3, 3); resolveRound(g);
  assert.deepEqual(g.players.map((p) => p.score), [8, 6, 4]);
  assert.equal(rewardFor(g.layout.areas.Y, 5, CFG), 0);
});

test('same-colour areas have independent reward tracks', () => {
  const g = newGame([6, 4]);
  set(g, 0, { '2,1': 1, '2,2': 2, '3,1': 3, '4,1': 4, '5,0': 5 }); // R1 minus (5,1)
  place(g, 0, 5, 1); // 6 beside the 4
  submitPlacement(g, 1, null);
  resolveRound(g);
  assert.equal(g.players[0].score, 6);
  assert.equal(g.areaClaims.R1.count, 1);
  assert.equal(g.areaClaims.R2.count, 0);
  assert.deepEqual(g.layout.areas.R2.rewards, [6, 4, 2]);
});

test('simultaneous completion: everyone gets the best open reward, order-independent', () => {
  const run = (order) => {
    const g = newGame([5, 6], 3);
    for (const p of [0, 1, 2]) yellowReady(g, p);
    for (const p of order) place(g, p, 3, p === 2 ? 5 : 3);
    resolveRound(g);
    nextRound(g, [5, 6]);
    place(g, 2, 3, 3);
    place(g, 0, 2, 4); place(g, 1, 2, 4);
    resolveRound(g);
    return g.players.map((p) => p.score);
  };
  assert.deepEqual(run([0, 1, 2]), [8, 8, 6]);
  assert.deepEqual(run([1, 0, 2]), [8, 8, 6]);
  assert.deepEqual(run([2, 1, 0]), [8, 8, 6]);
});

test('no legal moves: pass allowed only when none exist', () => {
  const g = newGame([1, 2]);
  set(g, 0, { '0,2': 6 });
  set(g, 1, { '3,4': 2 });
  assert.equal(getLegalPlacements(g, 0).length, 0);
  assert.ok(submitPlacement(g, 0, null).pass);
  assert.equal(submitPlacement(g, 1, null).ok, false);
  assert.ok(!allSubmitted(g));
});

test('round resolves only when all players placed or skipped', () => {
  const g = newGame([1, 2]);
  set(g, 1, { '3,4': 2 });
  submitPlacement(g, 0, null);
  assert.throws(() => resolveRound(g));
  place(g, 1, 3, 3);
  resolveRound(g);
  assert.equal(g.phase, 'rolling');
});

test('target scores by player count', () => {
  const t = (n) => targetScore(createGame(CFG, ['A', 'B', 'C', 'D', 'E'].slice(0, n)));
  assert.deepEqual([2, 3, 4, 5].map(t), [26, 24, 22, 20]);
});

test('end of game: goal reached, winner and ties', () => {
  const g = newGame([1, 2]);
  g.players[0].score = 26; g.players[1].score = 10;
  assert.deepEqual(checkEnd(g), { over: true, winners: [0] });
  g.players[1].score = 26;
  assert.deepEqual(checkEnd(g), { over: true, winners: [0, 1] });
  g.players[0].score = 25; g.players[1].score = 25;
  assert.equal(checkEnd(g).over, false);
});

test('end is evaluated after the round resolves', () => {
  const g = newGame([5, 6]);
  g.players[0].score = 20;
  for (const p of [0, 1]) yellowReady(g, p);
  place(g, 0, 3, 3);
  assert.equal(g.phase, 'placing');
  place(g, 1, 3, 3);
  resolveRound(g);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.winners, [0]);
});

test('players keep separate boards and share dice', () => {
  const g = newGame([2, 5]);
  set(g, 0, { '3,0': 5 });
  set(g, 1, { '3,3': 5 });
  submitPlacement(g, 0, { index: ix(2, 0), die: 0 });
  assert.equal(g.players[0].cells[ix(2, 0)], 2);
  assert.equal(g.players[1].cells[ix(2, 0)], null);
  assert.ok(!validatePlacement(g, 1, { index: ix(2, 0), die: 0 }).ok);
});

test('rollDice is deterministic with a seeded rng', () => {
  const a = rollDice(CFG.dice, createRng(7));
  assert.deepEqual(a, rollDice(CFG.dice, createRng(7)));
  assert.ok(a.every((v) => v >= 1 && v <= 6));
});
