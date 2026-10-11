// Minimal adapter for js/oracle.mjs. Copy, rename, fill in. `ref` records come from harness/run.py (fields of your ref.state.json), `ev` is the parsed scenario {frame: [tokens]}.
// Tokens: "+Up" "-Up" "+space" "shot" "set:AC5E=00801d00" ("set:" = state injection into the ORIGINAL's memory: mirror it in the port or the runs diverge).
import { Game } from "../port/src/game.js";   // your port
const KEYS = { Up: "up", Down: "down", Left: "left", Right: "right", space: "use", ctrl: "fire", rshift: "run" };   // scancode names of game.json -> port inputs
export async function init({ ref, ev }) { return { game: new Game(/* level, difficulty, rndtable ... */), keys: {} }; }
export function start(s, ref) { s.game.tick({}, 1); }                                   // the first record is already after one logic step
export function event(s, tok, f) {
  if (/^[+-]/.test(tok) && KEYS[tok.slice(1)]) s.keys[KEYS[tok.slice(1)]] = tok[0] === "+";
  const m = tok.match(/^set:([0-9A-F]+)=([0-9a-f]+)$/); if (m) { /* map the DS offset to a port field here (position, health, ammo, level warp ...) */ }
}
export function step(s, tics, f) { s.game.tick({ ...s.keys }, tics); }
export function compare(s, rec, f) {                                                   // -> [[field, mine, theirs], ...] for every field that differs
  const g = s.game, bad = [];
  for (const [k, mine] of [["player.x", g.pl.x], ["player.y", g.pl.y], ["player.angle", g.pl.angle], ["health", g.state.health], ["rndindex", g.rnd.index]]) if (rec[k] !== undefined && rec[k] !== mine) bad.push([k, mine, rec[k]]);
  return bad;
}
