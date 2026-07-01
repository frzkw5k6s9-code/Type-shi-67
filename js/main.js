window.Game = window.Game || {};

(function () {
  const canvas = document.getElementById('battle-canvas');
  const ctx = canvas.getContext('2d');

  let battle = null;
  const state = {
    phase: 'message', // 'message' | 'menu' | 'moves' | 'ended'
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
    state.phase = battle.over ? 'ended' : 'menu';
    render();
  }

  function render() {
    state.buttons = Game.UI.draw(ctx, battle, state);
  }

  function startBattle(scenario) {
    let player, enemy, isWildBattle, introText;

    if (scenario === 'trainer') {
      player = new Game.Creature('pyrekit', 9, { isWild: false });
      enemy = new Game.Creature('terrapin', 9, { isWild: false });
      isWildBattle = false;
      introText = `Rival sent out ${enemy.name}!`;
    } else {
      player = new Game.Creature('pyrekit', 8, { isWild: false });
      enemy = new Game.Creature('voltling', 6, { isWild: true });
      isWildBattle = true;
      introText = `A wild ${enemy.name} appeared!`;
    }

    battle = new Game.Battle(player, enemy, { isWildBattle });
    state.pending = [];
    enqueue([{ type: 'message', text: introText }]);
  }

  function handleAction(action) {
    if (!action || action === 'disabled') return;

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
      enqueue(battle.throwCube());
      return;
    }
    if (action === 'run') {
      enqueue(battle.attemptRun());
      return;
    }
    if (action.startsWith('move:')) {
      const idx = parseInt(action.split(':')[1], 10);
      enqueue(battle.chooseMove(idx));
      return;
    }
    if (action === 'restart:wild') {
      startBattle('wild');
      return;
    }
    if (action === 'restart:trainer') {
      startBattle('trainer');
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
      if (battle.player.moves[idx]) handleAction(`move:${idx}`);
    } else if (evt.key === 'Escape' && state.phase === 'moves') {
      handleAction('back');
    }
  });

  document.getElementById('btn-wild').addEventListener('click', () => startBattle('wild'));
  document.getElementById('btn-trainer').addEventListener('click', () => startBattle('trainer'));

  startBattle('wild');
})();
