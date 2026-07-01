# Cube Tamers - Battle Arena

An original monster-battling game built from scratch with plain HTML5 Canvas
and vanilla JavaScript (no frameworks, no build step, no external assets).

This is **not** a Pokemon clone: all creatures, moves, and names are original,
and capturing wild creatures uses **Capture Cubes** instead of Poke Balls.
The mechanics (turn-based battles, elemental type matchups, catching wild
creatures) are inspired by the genre in general.

## Current milestone: battle system

This first milestone implements the turn-based battle engine end to end:

- 8 original creature species across 8 elemental types (Ember, Aqua, Verdant,
  Volt, Terra, Zephyr, Mind, Shadow) plus a neutral Basic type
- A type effectiveness chart and STAB (same-type attack bonus)
- Moves with power/accuracy/PP, plus a stat-boosting status move
- Speed-based turn order, damage calculation, fainting, and win/lose states
- A Capture Cube mechanic for catching wild creatures (catch chance scales
  with the target's remaining HP and per-species catch rate); trainer-owned
  creatures can't be captured
- A canvas-rendered battle UI (HP bars, message box, menus) with mouse and
  keyboard input

The overworld, towns, story, and multi-creature teams are out of scope for
this milestone and would come next.

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
js/engine/creature.js    - creature instance (stats, HP, PP, stat stages)
js/engine/battle.js      - turn-resolving battle state machine
js/ui/renderer.js        - canvas drawing (pure function of battle + UI state)
js/main.js               - input handling and game loop
```
