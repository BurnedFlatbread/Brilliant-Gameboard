// Editable game configuration. Layout is derived from the supplied board image.
// Anything listed in `unverified` could NOT be confirmed against the official rulebook.
export const BRILLIANT_CONFIG = {
  name: 'Brilliant (image layout)',
  size: 7,

  // One area ID per cell; the leading letter selects the area type.
  areaGrid: [
    ['Y1', 'G1', 'B1', 'P1', 'P1', 'P1', 'Y2'],
    ['G1', 'G1', 'B1', 'B1', 'P1', 'P1', 'G2'],
    ['G1', 'R1', 'R1', 'B1', 'P1', 'G2', 'G2'],
    ['G1', 'R1', 'P2', 'Y3', 'G2', 'G2', 'G2'],
    ['G1', 'R1', 'P2', 'P2', 'R2', 'R2', 'B2'],
    ['R1', 'R1', 'P2', 'R2', 'R2', 'B2', 'B2'],
    ['Y4', 'P2', 'P2', 'R2', 'R2', 'B2', 'Y5'],
  ],

  // Rules: free | same | unique | max2 (provisional colour mapping from the task brief).
  areaTypes: {
    G: { color: 'green', rule: 'free' },
    B: { color: 'blue', rule: 'same' },
    R: { color: 'red', rule: 'unique' },
    Y: { color: 'yellow', rule: 'unique' },
    P: { color: 'purple', rule: 'max2' },
  },

  // Per-area overrides, e.g. { G1: { rewards: [5, 3, 1] } }.
  areaOverrides: {},

  // PLACEHOLDER rewards by completion rank (1st, 2nd, 3rd...). Not official.
  defaultRewards: [3, 2, 1],
  rewardAfterList: 0,

  // Cells marked X in the image. Numbers are assigned at setup.
  startCells: [[0, 2], [1, 5], [3, 1], [3, 4], [5, 2], [6, 4]],
  startNumbers: [1, 2, 3, 4, 5, 6],
  startNumbersShared: true,

  // PLACEHOLDER dice: two standard d6. Not verified as the official distribution.
  dice: [
    { faces: [1, 2, 3, 4, 5, 6] },
    { faces: [1, 2, 3, 4, 5, 6] },
  ],

  // PLACEHOLDER target scores per player count.
  targetScores: { 1: 15, 2: 15, 3: 15, 4: 15 },

  unverified: [
    'Starting numbers: X cells receive a random permutation of 1-6 (shared by all players). Official mapping unknown.',
    'Dice faces: two standard six-sided dice are used. Official distributions unknown.',
    'Area-rule colour assignments: provisional mapping from the task brief.',
    'Scoring values: placeholder [3, 2, 1] for 1st/2nd/3rd completion, 0 afterwards. Official values and any scoring-field connections unknown.',
    'Simultaneous completion: every player completing in the same round receives the reward of the same rank; the next rank is shifted by the number of completers. Official rule unknown.',
    'Placements per round: one number per player per round (choose either die). Official rule unknown.',
    'Target scores and end-of-round procedure: placeholder of 15 points; ties share the win. Official values unknown.',
  ],
};
