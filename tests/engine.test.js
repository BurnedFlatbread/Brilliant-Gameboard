import test from 'node:test';
import assert from 'node:assert/strict';
import { BRILLIANT_CONFIG as CFG } from '../src/config.js';
import {
  createGame, createRng, neighbors, rollDice, validatePlacement, getLegalPlacements,
  submitPlacement, resolveRound, advanceRound, checkAreaRestriction, checkEnd,
  rewardFor, completedAreas, allSubmitted,
} from '../src/engine.js';

const ix = (r, c) => r * 7 + c;

function newGame(dice, n = 2) {
  const names = ['A', 'B', 'C', 'D'].slice(0, n);
  const g = createGame(CFG, names, { rng: createRng(1), dice });
  g.players.forEach((p) => p.cells.fill(null));
  return g;
}
function set(g, p, map) {
  for (const [k, v] of Object.entries(map)) {
    const [r, c] = k.split(',').map(Number);
    g.players[p].cells[ix(r, c)] = v;
  }
}

test('layout: 49 cells, 13 independent areas', () => {
  const g = newGame([1, 2]);
  assert.equal(g.layout.cells.length, 49);
  assert.equal(Object.keys(g.layout.areas).length, 13);
  assert.equal(g.layout.cells[ix(0, 2)].color, 'blue');
  assert.notEqual(g.layout.cells[ix(0, 1)].areaId, g.layout.cells[ix(1, 6)].areaId);
});

test('setup: X cells receive 1-6 once each', () => {
  const g = createGame(CFG, ['A', 'B'], { rng: createRng(3), dice: [1, 2] });
  const vals = CFG.startCells.map(([r, c]) => g.players[0].cells[ix(r, c)]).sort();
  assert.deepEqual(vals, [1, 2, 3, 4, 5, 6]);
  assert.equal(g.players[0].cells.filter((v) => v !== null).length, 6);
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
  assert.ok(validatePlacement(g, 0, { index: ix(2, 0), die: 0 }).ok); // 2 beside 5
  assert.ok(validatePlacement(g, 0, { index: ix(5, 0), die: 1 }).ok); // 5 beside 2
  assert.ok(!validatePlacement(g, 0, { index: ix(2, 0), die: 1 }).ok); // 5 not beside a 2
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
  // blue B1: (0,2),(1,2),(1,3),(2,3) must share a number
  set(g, 0, { '0,2': 1, '1,1': 2 });
  assert.ok(!validatePlacement(g, 0, { index: ix(1, 2), die: 1 }).ok); // 2 into blue holding 1
});

test('same-number rule accepted when matching', () => {
  const g = newGame([1, 2]);
  set(g, 0, { '0,2': 1, '1,1': 2 });
  assert.ok(validatePlacement(g, 0, { index: ix(1, 2), die: 0 }).ok);
});

test('red area rejects duplicates, purple rejects a third number', () => {
  const g = newGame([1, 2]);
  set(g, 0, { '2,1': 1, '3,0': 2 }); // red R1 holds 1
  assert.ok(!validatePlacement(g, 0, { index: ix(3, 1), die: 0 }).ok); // 1 again in red
  const h = newGame([3, 2]);
  set(h, 0, { '0,3': 1, '0,4': 2 }); // purple P1 holds 1,2
  assert.ok(!validatePlacement(h, 0, { index: ix(1, 4), die: 0 }).ok); // 3 would be third distinct
});

test('area completion and first reward', () => {
  const g = newGame([1, 2]);
  set(g, 0, { '3,4': 2 });
  set(g, 1, { '3,4': 2 });
  assert.ok(submitPlacement(g, 0, { index: ix(3, 3), die: 0 }).ok);
  assert.ok(completedAreas(g, 0).includes('Y3'));
  assert.ok(submitPlacement(g, 1, { index: ix(3, 5), die: 0 }).ok);
  resolveRound(g);
  assert.equal(g.players[0].score, 3);
  assert.equal(g.players[1].score, 0);
});

test('first, second and subsequent rewards', () => {
  const g = newGame([1, 2], 3);
  for (const p of [0, 1, 2]) set(g, p, { '3,4': 2 });
  const place = (p, r, c) => assert.ok(submitPlacement(g, p, { index: ix(r, c), die: 0 }).ok);
  place(0, 3, 3); place(1, 3, 5); place(2, 3, 5); resolveRound(g);
  advanceRound(g, { dice: [1, 2] });
  place(0, 2, 4); place(1, 3, 3); place(2, 2, 4); resolveRound(g);
  advanceRound(g, { dice: [1, 2] });
  place(0, 4, 4); place(1, 4, 4); place(2, 3, 3); resolveRound(g);
  assert.deepEqual(g.players.map((p) => p.score), [3, 2, 1]);
  assert.equal(rewardFor(g.layout.areas.Y3, 5, CFG), 0);
});

test('simultaneous completions share a rank, independent of order', () => {
  const run = (order) => {
    const g = newGame([1, 2]);
    for (const p of [0, 1]) set(g, p, { '3,4': 2 });
    for (const p of order) submitPlacement(g, p, { index: ix(3, 3), die: 0 });
    resolveRound(g);
    return g;
  };
  const a = run([0, 1]);
  const b = run([1, 0]);
  assert.deepEqual(a.players.map((p) => p.score), [3, 3]);
  assert.deepEqual(b.players.map((p) => p.score), [3, 3]);
  assert.equal(a.areaClaims.Y3.count, 2);
});

test('simultaneous completers shift later ranks', () => {
  const g = newGame([1, 2], 3);
  for (const p of [0, 1, 2]) set(g, p, { '3,4': 2 });
  submitPlacement(g, 0, { index: ix(3, 3), die: 0 });
  submitPlacement(g, 1, { index: ix(3, 3), die: 0 });
  submitPlacement(g, 2, { index: ix(3, 5), die: 0 });
  resolveRound(g);
  advanceRound(g, { dice: [1, 2] });
  assert.equal(g.areaClaims.Y3.count, 2);
  submitPlacement(g, 0, { index: ix(2, 4), die: 0 });
  submitPlacement(g, 1, { index: ix(2, 4), die: 0 });
  submitPlacement(g, 2, { index: ix(3, 3), die: 0 });
  resolveRound(g);
  assert.deepEqual(g.players.map((p) => p.score), [3, 3, 1]);
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

test('end of game: target reached, winner and ties', () => {
  const g = newGame([1, 2]);
  g.players[0].score = 15; g.players[1].score = 10;
  assert.deepEqual(checkEnd(g), { over: true, winners: [0] });
  g.players[1].score = 15;
  assert.deepEqual(checkEnd(g), { over: true, winners: [0, 1] });
  g.players[0].score = 14; g.players[1].score = 14;
  assert.equal(checkEnd(g).over, false);
});

test('end is evaluated after the round resolves', () => {
  const g = newGame([1, 2]);
  g.players[0].score = 13;
  for (const p of [0, 1]) set(g, p, { '3,4': 2 });
  submitPlacement(g, 0, { index: ix(3, 3), die: 0 });
  assert.equal(g.phase, 'placing');
  submitPlacement(g, 1, { index: ix(3, 3), die: 0 });
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
  const b = rollDice(CFG.dice, createRng(7));
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 1 && v <= 6));
});
