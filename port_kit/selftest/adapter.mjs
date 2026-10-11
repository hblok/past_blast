// toy "game": a counter that moves by 2 per tic while "up" is held; one injected set; the port source lives in toy.js so the mutation runner has something to mutate
import { move } from "./toy.js";
export async function init() { return { x: 0, keys: {} }; }
export function start(s) { s.x = move(s.x, 1, false); }
export function event(s, tok) { if (tok === "+Up") s.keys.up = true; if (tok === "-Up") s.keys.up = false; const m = tok.match(/^set:X=(\d+)$/); if (m) s.x = +m[1]; }
export function step(s, tics) { s.x = move(s.x, tics, !!s.keys.up); }
export function compare(s, rec) { return rec.x !== s.x ? [["x", s.x, rec.x]] : []; }
