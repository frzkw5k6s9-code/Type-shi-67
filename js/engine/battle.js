window.Game = window.Game || {};

(function () {
  const CUBE = { name: 'Capture Cube', power: 1.0 };

  function stab(attacker, move) {
    return attacker.types.includes(move.type) ? 1.5 : 1;
  }

  function calcDamage(attacker, defender, move) {
    if (move.power <= 0) return { damage: 0, typeMult: 1 };
    const atkStat = attacker.stats.atk * attacker.stageMultiplier('atk');
    const defStat = defender.stats.def * defender.stageMultiplier('def');
    const typeMult = Game.getTypeMultiplier(move.type, defender.types);
    if (typeMult === 0) return { damage: 0, typeMult };
    const levelFactor = 1 + attacker.level * 0.02;
    const randomFactor = 0.85 + Math.random() * 0.15;
    const raw = move.power * (atkStat / defStat) * 0.22 * levelFactor * stab(attacker, move) * typeMult * randomFactor;
    return { damage: Math.max(1, Math.round(raw)), typeMult };
  }

  function captureChance(target) {
    const hpFactor = 1 - target.hpFraction() * 0.75;
    const base = CUBE.power * target.species.catchRate * (0.35 + hpFactor * 0.65);
    return Math.min(0.95, Math.max(0.03, base));
  }

  // Battle is a turn-resolving state machine. Each public action method
  // (chooseMove / throwCube / attemptRun) returns an ordered array of
  // "events" describing what happened, which the UI plays back one at a time.
  class Battle {
    constructor(player, enemy, opts = {}) {
      this.player = player;
      this.enemy = enemy;
      this.isWildBattle = !!opts.isWildBattle;
      this.over = false;
      this.result = null; // 'win' | 'lose' | 'captured' | 'fled'
    }

    _pickEnemyMove() {
      const usable = this.enemy.moves.filter((m) => m.currentPP > 0);
      const pool = usable.length ? usable : this.enemy.moves;
      // Mostly attack, occasionally use a status move -- a fully random AI
      // ends up spamming stat-boosting moves (they're ~1 in 4 moves on some
      // creatures) often enough to stall fights out indefinitely.
      const attackMoves = pool.filter((m) => m.power > 0);
      if (attackMoves.length && Math.random() < 0.8) {
        return attackMoves[Math.floor(Math.random() * attackMoves.length)];
      }
      return pool[Math.floor(Math.random() * pool.length)];
    }

    _useMove(attacker, defender, move, events) {
      if (move.currentPP > 0) move.currentPP -= 1;
      events.push({ type: 'message', text: `${attacker.name} used ${move.name}!` });

      const hit = Math.random() * 100 < move.accuracy;
      if (!hit) {
        events.push({ type: 'message', text: `${attacker.name}'s attack missed!` });
        return;
      }

      if (move.effect === 'defenseUp') {
        attacker.raiseStage('def', 1);
        events.push({ type: 'message', text: `${attacker.name}'s defense rose!` });
        return;
      }

      const { damage, typeMult } = calcDamage(attacker, defender, move);
      defender.applyDamage(damage);
      events.push({ type: 'damage', target: defender === this.player ? 'player' : 'enemy', amount: damage, hpFraction: defender.hpFraction() });

      if (typeMult > 1) events.push({ type: 'message', text: "It's super effective!" });
      else if (typeMult > 0 && typeMult < 1) events.push({ type: 'message', text: "It's not very effective..." });
      else if (typeMult === 0) events.push({ type: 'message', text: `It had no effect on ${defender.name}!` });

      if (defender.fainted) {
        events.push({ type: 'faint', target: defender === this.player ? 'player' : 'enemy' });
      }
    }

    _checkEnd(events) {
      if (this.enemy.fainted) {
        this.over = true;
        this.result = 'win';
        events.push({ type: 'end', result: 'win', text: `${this.enemy.name} fainted! You won the battle!` });
        return true;
      }
      if (this.player.fainted) {
        this.over = true;
        this.result = 'lose';
        events.push({ type: 'end', result: 'lose', text: `${this.player.name} fainted! You lost the battle...` });
        return true;
      }
      return false;
    }

    chooseMove(moveIndex) {
      if (this.over) return [];
      const events = [];
      const playerMove = this.player.moves[moveIndex];
      const enemyMove = this._pickEnemyMove();

      const playerFirst =
        this.player.stats.spd * this.player.stageMultiplier('spd') >=
        this.enemy.stats.spd * this.enemy.stageMultiplier('spd');

      const first = playerFirst ? [this.player, this.enemy, playerMove] : [this.enemy, this.player, enemyMove];
      const second = playerFirst ? [this.enemy, this.player, enemyMove] : [this.player, this.enemy, playerMove];

      this._useMove(first[0], first[1], first[2], events);
      if (this._checkEnd(events)) return events;

      this._useMove(second[0], second[1], second[2], events);
      this._checkEnd(events);
      return events;
    }

    throwCube() {
      if (this.over || !this.isWildBattle) return [];
      const events = [];
      events.push({ type: 'message', text: `You threw a Capture Cube at ${this.enemy.name}!` });

      const chance = captureChance(this.enemy);
      const success = Math.random() < chance;

      if (success) {
        this.over = true;
        this.result = 'captured';
        events.push({ type: 'message', text: `Gotcha! ${this.enemy.name} was captured!` });
        events.push({ type: 'end', result: 'captured', text: `${this.enemy.name} was added to your team!` });
        return events;
      }

      events.push({ type: 'message', text: `Oh no! ${this.enemy.name} broke free!` });

      const enemyMove = this._pickEnemyMove();
      this._useMove(this.enemy, this.player, enemyMove, events);
      this._checkEnd(events);
      return events;
    }

    attemptRun() {
      if (this.over) return [];
      const events = [];
      if (!this.isWildBattle) {
        events.push({ type: 'message', text: "You can't run from a trainer battle!" });
        const enemyMove = this._pickEnemyMove();
        this._useMove(this.enemy, this.player, enemyMove, events);
        this._checkEnd(events);
        return events;
      }

      const escapeChance = 0.5 + (this.player.stats.spd - this.enemy.stats.spd) * 0.01;
      const success = Math.random() < Math.min(0.95, Math.max(0.25, escapeChance));
      if (success) {
        this.over = true;
        this.result = 'fled';
        events.push({ type: 'message', text: 'You got away safely!' });
        events.push({ type: 'end', result: 'fled', text: 'You fled the battle.' });
        return events;
      }

      events.push({ type: 'message', text: "You couldn't get away!" });
      const enemyMove = this._pickEnemyMove();
      this._useMove(this.enemy, this.player, enemyMove, events);
      this._checkEnd(events);
      return events;
    }
  }

  Game.Battle = Battle;
  Game.Cube = CUBE;
  Game._calcDamage = calcDamage; // exposed for tests
  Game._captureChance = captureChance;
})();
