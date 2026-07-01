window.Game = window.Game || {};

// Optional trainers you can battle from the Hub to earn XP and level up
// outside of gym challenges. No fixed level -- their creature's level is
// picked relative to your creature's current level (see startGrindTrainer
// in main.js), so this stays a fair, repeatable grind at any point.
Game.GrindTrainers = [
  { name: 'Scout Wes', species: 'voltling' },
  { name: 'Camper Lila', species: 'zephyrit' },
  { name: 'Hiker Boro', species: 'terrapin' },
  { name: 'Drifter Suna', species: 'shadelet' },
  { name: 'Angler Tam', species: 'aquilo' },
  { name: 'Botanist Ivy', species: 'sproutling' },
  { name: 'Seer Talia', species: 'mindra' },
  { name: 'Diver Coral', species: 'tidalfin' },
  { name: 'Miner Gus', species: 'stonemaw' },
];

// The 4 gyms. Each gym leader's whole team shares the gym's element, and
// teams get bigger/stronger as you go, so grinding the trainers above
// between gyms matters. Gym types are deliberately chosen to avoid a
// double-disadvantage matchup against the starter (Pyrekit/Ember) -- Aqua
// and Terra both resist Ember *and* hit it super effectively, which made
// an early gym of either type nearly unwinnable no matter how much you
// grind, since your one creature can't be swapped out mid-fight.
Game.GymLeaders = [
  {
    id: 'gym1',
    gymName: 'Ember Gym',
    leader: 'Rook',
    badge: { id: 'gym1', name: 'Cinder Badge' },
    recommendedLevel: 17,
    team: [
      { species: 'cindermite', level: 10 },
      { species: 'emberhorn', level: 13 },
    ],
  },
  {
    id: 'gym2',
    gymName: 'Volt Gym',
    leader: 'Marin',
    badge: { id: 'gym2', name: 'Storm Badge' },
    recommendedLevel: 24,
    team: [
      { species: 'voltling', level: 18 },
      { species: 'voltmane', level: 21 },
    ],
  },
  {
    id: 'gym3',
    gymName: 'Zephyr Gym',
    leader: 'Dorian',
    badge: { id: 'gym3', name: 'Gale Badge' },
    recommendedLevel: 29,
    team: [
      { species: 'zephyrit', level: 23 },
      { species: 'galevane', level: 26 },
    ],
  },
  {
    id: 'gym4',
    gymName: 'Shadow Gym',
    leader: 'Nyx',
    badge: { id: 'gym4', name: 'Umbral Badge' },
    recommendedLevel: 35,
    team: [
      { species: 'shadelet', level: 24 },
      { species: 'mindra', level: 25 },
      { species: 'duskveil', level: 27 },
    ],
  },
];
