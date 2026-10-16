// Shared settings; the board of each level is defined in LEVELS below.
// Anything listed in `unverified` could NOT be confirmed against the official rulebook.
const BASE = {
  name: 'Brilliant',
  size: 7,

  // Rules: free | same | unique | max2. Rewards are by completion order; each area has its own track.
  areaTypes: {
    G: { color: 'green', rule: 'free', rewards: [4, 3, 2] },
    B: { color: 'blue', rule: 'same', rewards: [7, 5, 3] },
    R: { color: 'red', rule: 'unique', rewards: [6, 4, 2] },
    Y: { color: 'yellow', rule: 'unique', rewards: [8, 6, 4] },
    P: { color: 'purple', rule: 'max2', rewards: [6, 4, 2] },
    W: { color: 'white', rule: 'same', rewards: [3, 2, 1] },
    K: { color: 'pink', rule: 'low', rewards: [5, 3, 2] },
    O: { color: 'orange', rule: 'high', rewards: [5, 3, 2] },
  },

  rewardAfterList: 0,

  startNumbers: [1, 2, 3, 4, 5, 6],

  // PLACEHOLDER dice: two standard d6. Not verified as the official distribution.
  dice: [
    { faces: [1, 2, 3, 4, 5, 6] },
    { faces: [1, 2, 3, 4, 5, 6] },
  ],

  targetScores: { 2: 26, 3: 24, 4: 22, 5: 20 },

  unverified: [
    'Dobbelstenen: er worden twee gewone zeszijdige dobbelstenen gebruikt. De officiële verdeling is onbekend.',
    'De regels per kleur (groen vrij, blauw gelijk, rood/geel uniek, paars max. 2 getallen) zijn voorlopig.',
    'Bij gelijktijdig voltooien wordt maar één beloningsplek verbruikt; de volgende voltooiing krijgt de volgende plek.',
    'Na de laatste beloning in de lijst is de beloning 0.',
    'Zelfgemaakt level: roze (alleen 1-3) en oranje (alleen 4-6) hebben beloning 5/3/2 en paars (4 vakjes, max. 2 getallen) 5/3/2; de rest volgt de standaardbeloningen. Dit is door mij gekozen en niet officieel.',
    'Zelfgemaakt level: de twee blauwtinten in de afbeelding zijn als één blauw gebied gelezen. Startvakjes zijn zelf gekozen (niet in roze of oranje, elk in een ander gebied).',
    'Gelijkspel aan het einde: alle spelers met de hoogste score winnen.',
    'Wit (level 2 en 3): alle witte vakjes moeten hetzelfde getal bevatten (gelijk, zoals blauw).',
    'Level 2 en 3: de beloningen per kleur zijn gelijk aan level 1, behalve wit (level 2: 3/2/1, level 3: 8/6/4), geel in level 2 (6/4/2) en de level 3-afwijkingen: paars 7/5/3, groen 6/5/4, geel 7/5/3.',
    'Geel en wit tellen als één gebied, ook als de vakjes los van elkaar liggen. Level 3: het paars onderaan is één gebied. Andere kleuren zijn losse gebieden per aaneengesloten groep.',
  ],
};

// areaGrid: one area ID per cell. startCells: the X cells, as [row, col].
export const LEVELS = {
  1: {
    level: 1,
    areaGrid: [
      ['Y', 'G1', 'B1', 'P1', 'P1', 'P1', 'Y'],
      ['G1', 'G1', 'B1', 'B1', 'P1', 'P1', 'G2'],
      ['G1', 'R1', 'R1', 'B1', 'P1', 'G2', 'G2'],
      ['G1', 'R1', 'P2', 'Y', 'G2', 'G2', 'G2'],
      ['G1', 'R1', 'P2', 'P2', 'R2', 'R2', 'B2'],
      ['R1', 'R1', 'P2', 'R2', 'R2', 'B2', 'B2'],
      ['Y', 'P2', 'P2', 'R2', 'R2', 'B2', 'Y'],
    ],
    startCells: [[0, 2], [1, 5], [3, 1], [3, 4], [5, 2], [6, 4]],
    areaOverrides: {},
  },
  2: {
    level: 2,
    areaGrid: [
      ['P1', 'P1', 'P1', 'W', 'G1', 'G1', 'G1'],
      ['P1', 'Y', 'B1', 'B1', 'B1', 'Y', 'G1'],
      ['P1', 'R1', 'R1', 'B1', 'B1', 'R2', 'G1'],
      ['R1', 'R1', 'R1', 'Y', 'R2', 'R2', 'R2'],
      ['G2', 'R1', 'B2', 'B2', 'R2', 'R2', 'P2'],
      ['G2', 'Y', 'B2', 'B2', 'B2', 'Y', 'P2'],
      ['G2', 'G2', 'G2', 'W', 'P2', 'P2', 'P2'],
    ],
    startCells: [[0, 4], [2, 0], [3, 2], [4, 5], [5, 1], [6, 4]],
    areaOverrides: { W: { rewards: [3, 2, 1] }, Y: { rewards: [6, 4, 2] } },
  },
  3: {
    level: 3,
    areaGrid: [
      ['Y', 'Y', 'P1', 'W', 'P1', 'Y', 'Y'],
      ['W', 'Y', 'P1', 'P1', 'P1', 'Y', 'W'],
      ['R1', 'R1', 'R1', 'P1', 'R2', 'R2', 'R2'],
      ['R1', 'R1', 'R1', 'W', 'R2', 'R2', 'R2'],
      ['G', 'B', 'B', 'B', 'B', 'B', 'G'],
      ['G', 'G', 'G', 'G', 'G', 'G', 'G'],
      ['P2', 'P2', 'P2', 'W', 'P2', 'P2', 'P2'],
    ],
    startCells: [[1, 2], [1, 5], [3, 3], [4, 1], [4, 6], [6, 2]],
    areaOverrides: {
      W: { rewards: [8, 6, 4] },
      P1: { rewards: [7, 5, 3] },
      P2: { rewards: [7, 5, 3] },
      G: { rewards: [6, 5, 4] },
      Y: { rewards: [7, 5, 3] },
    },
  },
  // Zelfgemaakt level (naam nog te bepalen): roze neemt alleen 1-3, oranje alleen 4-6.
  4: {
    level: 4,
    title: 'Level X',
    areaGrid: [
      ['K', 'K', 'B', 'R1', 'G1', 'G1', 'G1'],
      ['K', 'K', 'B', 'R1', 'G1', 'G1', 'G1'],
      ['K', 'K', 'B', 'R1', 'R1', 'R1', 'R1'],
      ['Y', 'Y', 'B', 'Y', 'P', 'Y', 'Y'],
      ['R2', 'R2', 'R2', 'R2', 'P', 'O', 'O'],
      ['G2', 'G2', 'G2', 'R2', 'P', 'O', 'O'],
      ['G2', 'G2', 'G2', 'R2', 'P', 'O', 'O'],
    ],
    startCells: [[1, 2], [1, 5], [3, 3], [4, 1], [5, 4], [6, 1]],
    areaOverrides: { P: { rewards: [5, 3, 2] } },
  },
};

export const getLevelConfig = (level) => {
  if (!LEVELS[level]) throw new Error('Onbekend level.');
  return { ...BASE, ...LEVELS[level] };
};

export const BRILLIANT_CONFIG = getLevelConfig(1);
