// Generic oracle runner: replay a harness scenario in YOUR port and compare it, frame by frame, with the recording of the original (harness/run.py state.jsonl, optionally .gz).
//   node oracle.mjs <adapter.mjs> <recording.jsonl[.gz]> <scenario.txt> [frames]
// The adapter is the only game-specific part (see examples/adapter_template.mjs and examples/wolf3d/check_enemy_oracle.mjs, a full one with warps, deaths and object slots).
// Frame conventions learned the hard way (LESSONS "Frame alignment"):
//   * the recorded state of frame f is the state AFTER the logic of frame f; the step f -> f+1 uses the `tics` field of record f; script events of frame f act in that step.
//   * the first record is the state after the first logic step, which ran with the minimum tic count whatever record 0 says: adapter.start() should perform it.
//   * a level warp / restart appears as a record in which the freshly set-up level is visible BEFORE its first logic step: the adapter returns {jump: n} from event() to say "re-synchronised,
//     compare record f+1 now and carry on" (see the Wolf adapter).
import { readFileSync } from "node:fs"; import { gunzipSync } from "node:zlib"; import { pathToFileURL } from "node:url"; import { resolve } from "node:path";
const [adapterPath, refFile, scenFile, nfr] = process.argv.slice(2);
const A = await import(pathToFileURL(resolve(adapterPath)).href);
const text = refFile.endsWith(".gz") ? gunzipSync(readFileSync(refFile)).toString() : readFileSync(refFile, "utf8");
const ref = text.trim().split("\n").map(JSON.parse), N = +nfr || ref.length;
const ev = {};   // several script lines with the same frame number are merged, like harness/script.py does
for (const l of readFileSync(scenFile, "utf8").split("\n")) { const m = l.match(/^(\d+):\s*(.*)/); if (m) ev[m[1]] = (ev[m[1]] || []).concat(m[2].trim().split(/\s+/)); }
const s = await A.init({ ref, ev });
const stats = { frames: 0, fieldsBad: {} }; let first = null;
const compare = f => {
  stats.frames++;
  for (const [field, mine, theirs] of A.compare(s, ref[f], f)) { stats.fieldsBad[field] = (stats.fieldsBad[field] || 0) + 1; if (!first) first = { frame: f, field, port: mine, orig: theirs, ...(A.context ? A.context(s, field, f) : {}) }; }
};
A.start?.(s, ref); compare(0);
for (let f = 0; f < N - 1; f++) {
  let handled = false;
  for (const tok of ev[f] || []) { const r = A.event(s, tok, f); if (r && r.jump !== undefined) handled = true; }
  if (handled) { compare(f + 1); continue; }
  const r = A.step(s, ref[f].tics, f);   // may return {jump: j}: the port restarted and re-synchronised with record j
  if (r && r.jump !== undefined) { f = r.jump - 1; compare(r.jump); continue; }
  compare(f + 1);
}
console.log(JSON.stringify(stats), first ? "FIRST DIFFERENCE " + JSON.stringify(first) : "ALL MATCH"); process.exit(first ? 1 : 0);
