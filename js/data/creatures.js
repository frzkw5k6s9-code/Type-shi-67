window.Game = window.Game || {};

// Original species roster. `catchRate` is 0-1, higher = easier to capture.
Game.Species = {
  pyrekit: {
    name: 'Pyrekit',
    types: ['Ember'],
    base: { hp: 40, atk: 55, def: 40, spd: 65 },
    moves: ['ram', 'cinderjab', 'flareburst', 'guard'],
    catchRate: 0.45,
  },
  aquilo: {
    name: 'Aquilo',
    types: ['Aqua'],
    base: { hp: 44, atk: 48, def: 48, spd: 50 },
    moves: ['ram', 'aquaslap', 'tidalrush', 'guard'],
    catchRate: 0.45,
  },
  sproutling: {
    name: 'Sproutling',
    types: ['Verdant'],
    base: { hp: 45, atk: 49, def: 49, spd: 45 },
    moves: ['ram', 'vinesnare', 'leafcutter', 'guard'],
    catchRate: 0.45,
  },
  voltling: {
    name: 'Voltling',
    types: ['Volt'],
    base: { hp: 35, atk: 50, def: 34, spd: 80 },
    moves: ['ram', 'voltnip', 'staticshock'],
    catchRate: 0.8,
  },
  terrapin: {
    name: 'Terrapin',
    types: ['Terra'],
    base: { hp: 50, atk: 44, def: 65, spd: 30 },
    moves: ['ram', 'bulwarkcharge', 'guard'],
    catchRate: 0.7,
  },
  zephyrit: {
    name: 'Zephyrit',
    types: ['Zephyr'],
    base: { hp: 38, atk: 50, def: 38, spd: 75 },
    moves: ['ram', 'galeslice'],
    catchRate: 0.75,
  },
  mindra: {
    name: 'Mindra',
    types: ['Mind'],
    base: { hp: 40, atk: 42, def: 42, spd: 60 },
    moves: ['ram', 'mindneedle', 'guard'],
    catchRate: 0.65,
  },
  shadelet: {
    name: 'Shadelet',
    types: ['Shadow'],
    base: { hp: 38, atk: 54, def: 38, spd: 58 },
    moves: ['ram', 'umbralbite'],
    catchRate: 0.6,
  },
};
