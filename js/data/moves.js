window.Game = window.Game || {};

// Original move set. `power` of 0 marks a status move handled via `effect`.
Game.Moves = {
  ram: { name: 'Ram', type: 'Basic', power: 40, accuracy: 100, pp: 35 },
  guard: { name: 'Guard Up', type: 'Basic', power: 0, accuracy: 100, pp: 20, effect: 'defenseUp' },

  cinderjab: { name: 'Cinderjab', type: 'Ember', power: 45, accuracy: 100, pp: 30 },
  flareburst: { name: 'Flare Burst', type: 'Ember', power: 70, accuracy: 90, pp: 15 },

  aquaslap: { name: 'Aqua Slap', type: 'Aqua', power: 40, accuracy: 100, pp: 30 },
  tidalrush: { name: 'Tidal Rush', type: 'Aqua', power: 70, accuracy: 90, pp: 15 },

  vinesnare: { name: 'Vine Snare', type: 'Verdant', power: 45, accuracy: 100, pp: 25 },
  leafcutter: { name: 'Leaf Cutter', type: 'Verdant', power: 70, accuracy: 90, pp: 15 },

  voltnip: { name: 'Volt Nip', type: 'Volt', power: 40, accuracy: 100, pp: 30 },
  staticshock: { name: 'Static Shock', type: 'Volt', power: 70, accuracy: 90, pp: 15 },

  bulwarkcharge: { name: 'Bulwark Charge', type: 'Terra', power: 60, accuracy: 95, pp: 20 },
  galeslice: { name: 'Gale Slice', type: 'Zephyr', power: 55, accuracy: 95, pp: 20 },
  mindneedle: { name: 'Mind Needle', type: 'Mind', power: 55, accuracy: 95, pp: 20 },
  umbralbite: { name: 'Umbral Bite', type: 'Shadow', power: 55, accuracy: 95, pp: 20 },
};
