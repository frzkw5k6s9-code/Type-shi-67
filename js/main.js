window.Game = window.Game || {};

(function () {
  const canvas = document.getElementById('battle-canvas');
  const ctx = canvas.getContext('2d');

  const badges = new Set();
  const player = new Game.Creature('pyrekit', 5, { isWild: false });

  let encounter = null;
  const state = {
    phase: 'hub', // 'hub' | 'message' | 'menu' | 'moves' | 'encounterEnd'
    pending: [],
    currentMessage: '',
    buttons: [],
  };

  function enqueue(events) {
    state.pending.push(...events);
    advance();
  }

  function advance() {
    while (state.pending.length) {
      const e = state.pending.shift();
      if (e.type === 'message' || e.type === 'end') {
        state.currentMessage = e.text;
        state.phase = 'message';
        render();
        return;
      }
      // 'damage' and 'faint' events have already mutated the creature model;
      // nothing to display beyond the next render.
    }
    state.phase = encounter && encounter.finished ? 'encounterEnd' : 'menu';
    render();
  }

  function render() {
    if (state.phase === 'hub') {
      state.buttons = Game.UI.drawHub(ctx, { player, badges, gyms: Game.GymLeaders });
    } else {
      state.buttons = Game.UI.drawBattle(ctx, encounter.battle, state);
    }
  }

  function goToHub() {
    encounter = null;
    state.pending = [];
    state.phase = 'hub';
    render();
  }

  function buildRecapMessages(enc) {
    const msgs = [];

    if (enc.outcome === 'lose') {
      msgs.push({ type: 'message', text: `${enc.player.name} was defeated...` });
    } else if (enc.outcome === 'fled') {
      msgs.push({ type: 'message', text: 'You got away safely.' });
    } else if (enc.outcome === 'captured') {
      msgs.push({ type: 'message', text: `${enc.enemy.name} was tamed and studied! (capture demo)` });
    } else if (enc.outcome === 'win') {
      if (enc.badge && !badges.has(enc.badge.id)) {
        badges.add(enc.badge.id);
        msgs.push({ type: 'message', text: `You defeated ${enc.label}! You earned the ${enc.badge.name}!` });
      } else if (enc.mode === 'trainer') {
        msgs.push({ type: 'message', text: `You defeated ${enc.label}!` });
      }
    }

    if (enc.xpGained > 0) {
      const levelsReached = enc.player.gainXP(enc.xpGained);
      msgs.push({ type: 'message', text: `${enc.player.name} gained ${enc.xpGained} XP!` });
      levelsReached.forEach((lvl) => {
        msgs.push({ type: 'message', text: `${enc.player.name} grew to level ${lvl}!` });
      });
    }

    enc.player.healFully();
    msgs.push({ type: 'message', text: 'Back at the Hub, your creature is fully rested.' });
    return msgs;
  }

  function runEncounterAction(fn) {
    let events = fn();
    if (encounter.finished) {
      events = events.concat(buildRecapMessages(encounter));
    }
    enqueue(events);
  }

  function startEncounter(config) {
    encounter = new Game.Encounter(player, config);
    state.pending = [];
    enqueue([{ type: 'message', text: encounter.introText }]);
  }

  function startWildEncounter() {
    const wildPool = ['voltling', 'zephyrit', 'mindra', 'shadelet'];
    const species = wildPool[Math.floor(Math.random() * wildPool.length)];
    const level = Math.max(3, player.level - 2 + Math.floor(Math.random() * 3));
    startEncounter({ mode: 'wild', team: [{ species, level }] });
  }

  function startGrindTrainer() {
    const t = Game.GrindTrainers[Math.floor(Math.random() * Game.GrindTrainers.length)];
    const level = Math.max(3, player.level - 1 + Math.floor(Math.random() * 4)); // playerLevel-1 .. playerLevel+2
    startEncounter({ mode: 'trainer', label: t.name, team: [{ species: t.species, level }] });
  }

  function startGym(index) {
    const gym = Game.GymLeaders[index];
    startEncounter({ mode: 'trainer', label: gym.leader, team: gym.team, badge: gym.badge });
  }

  function handleAction(action) {
    if (!action || action === 'disabled') return;

    if (action === 'hub:train') return startGrindTrainer();
    if (action === 'hub:wild') return startWildEncounter();
    if (action.startsWith('hub:gym:')) return startGym(parseInt(action.split(':')[2], 10));
    if (action === 'gotoHub') return goToHub();

    if (action === 'continue') {
      advance();
      return;
    }
    if (action === 'fight') {
      state.phase = 'moves';
      render();
      return;
    }
    if (action === 'back') {
      state.phase = 'menu';
      render();
      return;
    }
    if (action === 'cube') {
      runEncounterAction(() => encounter.throwCube());
      return;
    }
    if (action === 'run') {
      runEncounterAction(() => encounter.attemptRun());
      return;
    }
    if (action.startsWith('move:')) {
      const idx = parseInt(action.split(':')[1], 10);
      runEncounterAction(() => encounter.chooseMove(idx));
      return;
    }
  }

  function pointFromEvent(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  canvas.addEventListener('click', (evt) => {
    const { x, y } = pointFromEvent(evt);
    for (const b of state.buttons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        handleAction(b.action);
        return;
      }
    }
  });

  window.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter' && state.phase === 'message') {
      handleAction('continue');
    } else if (evt.key >= '1' && evt.key <= '4' && state.phase === 'moves') {
      const idx = parseInt(evt.key, 10) - 1;
      if (encounter.player.moves[idx]) handleAction(`move:${idx}`);
    } else if (evt.key === 'Escape' && state.phase === 'moves') {
      handleAction('back');
    }
  });

  render();
})();
