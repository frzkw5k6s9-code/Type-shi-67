# Cube Tamers - Battle Arena

An original monster-battling game built from scratch with plain HTML5 Canvas
and vanilla JavaScript (no frameworks, no build step, no external assets).

This is **not** a Pokemon clone: all creatures, moves, and names are original,
and capturing wild creatures uses **Capture Cubes** instead of Poke Balls.
The mechanics (turn-based battles, elemental type matchups, catching wild
creatures) are inspired by the genre in general.

## Current milestone: battle system + gyms/leveling hub

The turn-based battle engine (8 original creature species across 8 elemental
types, a type effectiveness chart with STAB, moves with power/accuracy/PP,
speed-based turn order, and a Capture Cube mechanic) now sits behind a
**Trainer Hub** menu instead of a fixed demo battle -- there's still no
overworld, just buttons:

- Your creature (starts as Pyrekit, Lv5) persists across battles, with a
  real XP/leveling system: win a fight, gain XP, level up (stats recompute,
  current HP carries over as a raw number, matching how leveling works in
  the genre)
- **Battle a Trainer**: an optional, repeatable grind encounter against a
  randomly picked trainer, scaled to your creature's current level, purely
  for earning XP
- **4 Gym Challenges**, unlocked in order as you defeat each one: Ember Gym
  (Rook), Volt Gym (Marin), Zephyr Gym (Dorian), Shadow Gym (Nyx). Each gym
  leader fields a themed 2-3 creature team that gets tougher as you go, and
  clearing one awards a badge
- Gym typing was deliberately chosen to avoid a double-disadvantage matchup
  against the starter -- some types both resist Ember *and* hit it back
  super effectively, which (combined with only ever having one active
  creature, no team swapping) made a gym of that type nearly unwinnable at
  any level
- Between encounters your creature is automatically healed and its PP
  refilled back at the Hub, so the challenge is the fight itself, not
  attrition from a lack of healing items

Recommended levels shown on each gym button come from actual simulated
win-rate testing, not guesses -- see `js/engine/encounter.js` for the
XP/battle-sequencing logic.

An overworld, towns, story, and multi-creature teams (with switching) are
still out of scope and would come next.

## Running it

Just open `index.html` in a browser. If your browser blocks local script
loading, serve the folder instead, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.

## Project layout

```
index.html
css/style.css
js/data/types.js        - element types and the effectiveness chart
js/data/moves.js        - move definitions
js/data/creatures.js     - species definitions
js/data/trainers.js      - grind trainers and the 4 gym leaders' teams
js/engine/creature.js    - creature instance (stats, HP, PP, stat stages, XP/leveling)
js/engine/battle.js      - turn-resolving battle state machine (single opponent)
js/engine/encounter.js   - wraps Battle to handle multi-creature trainer/gym fights + XP
js/ui/renderer.js        - canvas drawing (hub screen + battle screens)
js/main.js               - input handling, hub/encounter state machine, game loop
```
