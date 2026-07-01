window.Game = window.Game || {};

(function () {
  function computeStats(base, level) {
    return {
      maxHP: Math.floor(base.hp * (1 + level * 0.12)) + level * 3 + 10,
      atk: Math.floor(base.atk * (1 + level * 0.09)) + level,
      def: Math.floor(base.def * (1 + level * 0.09)) + level,
      spd: Math.floor(base.spd * (1 + level * 0.09)) + level,
    };
  }

  class Creature {
    constructor(speciesKey, level, opts = {}) {
      const species = Game.Species[speciesKey];
      if (!species) throw new Error(`Unknown species: ${speciesKey}`);

      this.speciesKey = speciesKey;
      this.species = species;
      this.level = level;
      this.stats = computeStats(species.base, level);
      this.currentHP = this.stats.maxHP;
      this.moves = species.moves.map((key) => ({
        key,
        ...Game.Moves[key],
        currentPP: Game.Moves[key].pp,
      }));
      this.stages = { atk: 0, def: 0, spd: 0 };
      this.isWild = !!opts.isWild;
      this.fainted = false;
    }

    get name() {
      return this.species.name;
    }

    get types() {
      return this.species.types;
    }

    hpFraction() {
      return this.currentHP / this.stats.maxHP;
    }

    applyDamage(amount) {
      this.currentHP = Math.max(0, this.currentHP - amount);
      if (this.currentHP === 0) this.fainted = true;
    }

    stageMultiplier(stat) {
      const stage = this.stages[stat] ?? 0;
      return Math.min(3, Math.max(0.25, 1 + stage * 0.25));
    }

    raiseStage(stat, amount) {
      const next = (this.stages[stat] ?? 0) + amount;
      this.stages[stat] = Math.max(-6, Math.min(6, next));
    }

    resetStages() {
      this.stages = { atk: 0, def: 0, spd: 0 };
    }
  }

  Game.Creature = Creature;
})();
