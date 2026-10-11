// Episode flow (W6): level order (elevator -> next level, secret elevator -> level 9 of the episode and back via ElevatorBackTo), level-end bonus, lives and death,
// state carried between levels. Follows GameLoop / LevelCompleted / Died of id's source (behaviour only); no screens here, the UI shows `result`.
import { decodeLevel } from "./map.js"; import { Game } from "./game.js"; import { PAR } from "./states_data.js";
const ELEVATOR_BACK_TO = [1, 1, 7, 3, 5, 3], PAR_AMOUNT = 500, PERCENT100AMT = 10000;
export class Session {
  // head, maps: ArrayBuffers of MAPHEAD/GAMEMAPS; rndtable: 256 numbers
  constructor(head, maps, rndtable, { level = 0, difficulty = 2, keys = 0, randomize = false } = {}) {
    Object.assign(this, { head, maps, rndtable, difficulty, debugKeys: keys, randomize, last: 0, oldscore: 0, state: "playing", result: null });
    this.carry = null; this.begin(level);
  }
  begin(level, gs = this.carry) {
    this.last = this.randomize ? Math.random() * 256 | 0 : 0;   // SetupGameLevel reseeds the generator (from the clock in the real game; the harness patch makes it 0)
    this.level = level; this.game = new Game(decodeLevel(this.head, this.maps, level), { level, difficulty: this.difficulty, rndtable: this.rndtable, keys: this.debugKeys, gs, last: this.last });
    this.state = "playing"; this.result = null;
  }
  tick(input, tics = 1) {
    if (this.state !== "playing") return this.state;
    const r = this.game.tick(input, tics); this.last = this.game.last;
    if (r === "completed" || r === "secret") this.finishLevel(r);
    else if (r === "died") this.state = "died";
    else if (r === "victorious") this.state = "victory";   // Hans is dead and the player stepped on the exit tile; BJ jumped
    return this.state;
  }
  // LevelCompleted: time bonus 500 per second under par, 10000 for 100% kills / secrets / treasure; the bonus is added to the score
  finishLevel(kind) {
    const g = this.game, w = g.w, A = g.actors, gs = w.gs, secs = Math.min(Math.floor(g.timecount / 70), 99 * 60), par = PAR[this.level] || 0;
    const timeleft = g.timecount < par * 4200 ? Math.floor(par * 4200 / 70) - secs : 0;
    const pct = (n, t) => t ? Math.floor(n * 100 / t) : 0, kr = pct(A.kills, A.killtotal), sr = pct(w.secrets, w.secrettotal), tr = pct(gs.treasure, w.treasuretotal);
    let bonus = timeleft * PAR_AMOUNT + (kr === 100 ? PERCENT100AMT : 0) + (sr === 100 ? PERCENT100AMT : 0) + (tr === 100 ? PERCENT100AMT : 0);
    w.givePoints(bonus);
    this.result = { level: this.level, kind, time: secs, par, kr, sr, tr, bonus, score: gs.score };
    const ep = Math.floor(this.level / 10), map = this.level % 10;
    this.nextLevel = map === 9 ? ep * 10 + ELEVATOR_BACK_TO[ep] : kind === "secret" ? ep * 10 + 9 : this.level + 1;
    this.carry = { health: gs.health, ammo: gs.ammo, score: gs.score, lives: gs.lives, nextextra: gs.nextextra, bestweapon: gs.bestweapon, weapon: gs.weapon, chosenweapon: gs.chosenweapon };
    this.oldscore = gs.score; this.state = "intermission";
  }
  next() {   // after the intermission or the death screen
    if (this.state === "intermission") this.begin(this.nextLevel);
    else if (this.state === "died") {      // Died(): one life less; 100 health, pistol, 8 ammo, no keys; the score goes back to the level start
      const gs = this.game.w.gs, lives = gs.lives - 1;
      if (lives < 0) { this.carry = null; this.oldscore = 0; this.begin(Math.floor(this.level / 10) * 10); return; }
      this.carry = { health: 100, ammo: 8, score: this.oldscore, lives, nextextra: gs.nextextra, bestweapon: 1, weapon: 1, chosenweapon: 1 };
      this.begin(this.level);
    }
  }
}
