window.Game = window.Game || {};

(function () {
  function xpForDefeating(enemy, mode) {
    const base = enemy.level * 6 + 10;
    return mode === 'trainer' ? Math.round(base * 1.2) : base;
  }

  // Wraps one or more back-to-back Game.Battle instances so a single
  // encounter (a wild creature, a grind trainer, or a multi-creature gym
  // leader) can be driven the same way from the UI. Tracks XP earned and
  // the overall outcome once every opposing creature has been resolved.
  class Encounter {
    constructor(player, config) {
      this.player = player;
      this.mode = config.mode; // 'wild' | 'trainer'
      this.label = config.label; // display name of the wild creature/trainer
      this.team = config.team; // [{ species, level }, ...]
      this.badge = config.badge || null;
      this.teamIndex = 0;
      this.xpGained = 0;
      this.finished = false;
      this.outcome = null; // 'win' | 'lose' | 'captured' | 'fled'

      this.enemy = this._spawn(0);
      this.battle = new Game.Battle(this.player, this.enemy, { isWildBattle: this.mode === 'wild' });
    }

    _spawn(idx) {
      const spec = this.team[idx];
      return new Game.Creature(spec.species, spec.level, { isWild: this.mode === 'wild' });
    }

    get introText() {
      return this.mode === 'wild' ? `A wild ${this.enemy.name} appeared!` : `${this.label} sent out ${this.enemy.name}!`;
    }

    chooseMove(idx) {
      return this._postProcess(this.battle.chooseMove(idx));
    }

    throwCube() {
      return this._postProcess(this.battle.throwCube());
    }

    attemptRun() {
      return this._postProcess(this.battle.attemptRun());
    }

    _postProcess(events) {
      const endIdx = events.findIndex((e) => e.type === 'end');
      if (endIdx === -1) return events;
      const endEvent = events[endIdx];

      if (endEvent.result === 'win' || endEvent.result === 'captured') {
        this.xpGained += xpForDefeating(this.enemy, this.mode);
        this.teamIndex += 1;

        const hasMore = endEvent.result === 'win' && this.teamIndex < this.team.length;
        if (hasMore) {
          this.enemy = this._spawn(this.teamIndex);
          this.battle = new Game.Battle(this.player, this.enemy, { isWildBattle: false });
          events[endIdx] = { type: 'message', text: `${this.label} sent out ${this.enemy.name}!` };
          return events;
        }

        this.finished = true;
        this.outcome = endEvent.result;
        return events;
      }

      // 'lose' or 'fled'
      this.finished = true;
      this.outcome = endEvent.result;
      return events;
    }
  }

  Game.Encounter = Encounter;
})();
