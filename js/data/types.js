window.Game = window.Game || {};

// Elemental types for creatures and moves. Original chart -- not a copy of any
// existing game's exact effectiveness values, just standard elemental logic
// (fire beats plant, water beats fire, ground grounds out electricity, etc).
Game.Types = {
  EMBER: 'Ember',
  AQUA: 'Aqua',
  VERDANT: 'Verdant',
  VOLT: 'Volt',
  TERRA: 'Terra',
  ZEPHYR: 'Zephyr',
  MIND: 'Mind',
  SHADOW: 'Shadow',
  BASIC: 'Basic',
};

Game.TypeColors = {
  Ember: '#e0562f',
  Aqua: '#3b8fd1',
  Verdant: '#4f9a4a',
  Volt: '#e0c22f',
  Terra: '#a9793f',
  Zephyr: '#8fc7d6',
  Mind: '#c162c9',
  Shadow: '#5b5b73',
  Basic: '#9a9a86',
};

// TypeChart[attackingType][defendingType] = damage multiplier
Game.TypeChart = {
  Ember: { Ember: 0.5, Aqua: 0.5, Verdant: 2, Volt: 1, Terra: 0.5, Zephyr: 1, Mind: 1, Shadow: 1, Basic: 1 },
  Aqua: { Ember: 2, Aqua: 0.5, Verdant: 0.5, Volt: 1, Terra: 2, Zephyr: 1, Mind: 1, Shadow: 1, Basic: 1 },
  Verdant: { Ember: 0.5, Aqua: 2, Verdant: 0.5, Volt: 1, Terra: 2, Zephyr: 0.5, Mind: 1, Shadow: 1, Basic: 1 },
  Volt: { Ember: 1, Aqua: 2, Verdant: 0.5, Volt: 0.5, Terra: 0, Zephyr: 2, Mind: 1, Shadow: 1, Basic: 1 },
  Terra: { Ember: 2, Aqua: 1, Verdant: 0.5, Volt: 2, Terra: 1, Zephyr: 0.5, Mind: 1, Shadow: 1, Basic: 1 },
  Zephyr: { Ember: 1, Aqua: 1, Verdant: 2, Volt: 0.5, Terra: 1, Zephyr: 1, Mind: 1, Shadow: 1, Basic: 1 },
  Mind: { Ember: 1, Aqua: 1, Verdant: 1, Volt: 1, Terra: 1, Zephyr: 1, Mind: 0.5, Shadow: 0.5, Basic: 1 },
  Shadow: { Ember: 1, Aqua: 1, Verdant: 1, Volt: 1, Terra: 1, Zephyr: 1, Mind: 2, Shadow: 0.5, Basic: 1 },
  Basic: { Ember: 1, Aqua: 1, Verdant: 1, Volt: 1, Terra: 1, Zephyr: 1, Mind: 1, Shadow: 0.5, Basic: 1 },
};

Game.getTypeMultiplier = function (attackType, defenderTypes) {
  const row = Game.TypeChart[attackType];
  if (!row) return 1;
  return defenderTypes.reduce((mult, t) => mult * (row[t] ?? 1), 1);
};
