// Player movement, exact 16.16 integer model of ControlMovement / Thrust / ClipMove / TryMove (id source WL_AGENT.C, WL_PLAY.C), one call = one tic.
// Positions are 16.16 integers (tile = x >> 16), angle is 0..359 degrees counter-clockwise.
export const BASEMOVE = 35, RUNMOVE = 70, MOVESCALE = 150, BACKMOVESCALE = 100, ANGLESCALE = 20, ANGLES = 360;
export const MINDIST = 0x5800, PLAYERSIZE = MINDIST;   // player radius [verified via PollKeyboardMove for BASEMOVE/RUNMOVE; the rest from source, checked by port/check_move.mjs]
// BuildTables: sin(i) = trunc(65536*sin(angle)), angle accumulated in float32, sign kept as bit 31; the 90 degree entry comes out 65535, not 65536 [measured: 5249 per tic walking]
const sintable = new Array(ANGLES + ANGLES / 4);
{ let angle = 0; const step = Math.fround(Math.PI / 2 / 90);
  for (let i = 0; i <= 90; i++) {
    const v = Math.trunc(65536 * Math.sin(angle)), neg = (v | 0x80000000) >>> 0;
    sintable[i] = sintable[i + ANGLES] = sintable[ANGLES / 2 - i] = v;
    sintable[ANGLES - i] = sintable[ANGLES / 2 + i] = neg;
    angle = Math.fround(angle + step);
  } }
export const sinOf = a => sintable[a], cosOf = a => sintable[a + ANGLES / 4];
// FixedByFrac: |a| * low word of b, sign = sign(a) xor bit 31 of b; the routine at 0x0f824 [verified]: hi16*frac + (lo16*frac >> 16)
export function fixedByFrac(a, b) {
  const neg = (a < 0) !== ((b >>> 31) === 1), m = Math.abs(a), f = b & 0xffff;
  const r = Math.floor(m / 65536) * f + Math.floor((m % 65536) * f / 65536);
  return neg ? -r : r;
}
// solid(tx, ty) -> true if the tile blocks the player (wall, closed door, blocking static)
function tryMove(p, solid, actorBlock) {
  const xl = (p.x - PLAYERSIZE) >> 16, yl = (p.y - PLAYERSIZE) >> 16, xh = (p.x + PLAYERSIZE) >> 16, yh = (p.y + PLAYERSIZE) >> 16;
  for (let y = yl; y <= yh; y++) for (let x = xl; x <= xh; x++) if (solid(x, y)) return false;
  return !(actorBlock && actorBlock(p));   // shootable actors within MINACTORDIST block, checked by the caller's callback
}
function clipMove(p, xm, ym, solid, ab) {
  const bx = p.x, by = p.y;
  p.x = bx + xm; p.y = by + ym; if (tryMove(p, solid, ab)) return;
  p.x = bx + xm; p.y = by; if (tryMove(p, solid, ab)) return;
  p.x = bx; p.y = by + ym; if (tryMove(p, solid, ab)) return;
  p.x = bx; p.y = by;
}
function thrust(p, angle, speed, solid, ab) {
  p.thrustspeed = (p.thrustspeed || 0) + speed;
  if (speed >= MINDIST * 2) speed = MINDIST * 2 - 1;
  clipMove(p, fixedByFrac(speed, cosOf(angle)), -fixedByFrac(speed, sinOf(angle)), solid, ab);
}
// keys: {up, down, left, right, strafe, run}; p: {x, y, angle, anglefrac}
export function stepPlayer(p, keys, solid, tics = 1, ab = null) {
  p.thrustspeed = 0;
  const m = (keys.run ? RUNMOVE : BASEMOVE) * tics;
  let cx = 0, cy = 0;
  if (keys.up) cy -= m; if (keys.down) cy += m; if (keys.left) cx -= m; if (keys.right) cx += m;
  if (keys.strafe) {
    if (cx > 0) thrust(p, (p.angle - ANGLES / 4 + ANGLES) % ANGLES, cx * MOVESCALE, solid, ab);
    else if (cx < 0) thrust(p, (p.angle + ANGLES / 4) % ANGLES, -cx * MOVESCALE, solid, ab);
  } else {
    p.anglefrac += cx * (keys.turnscale || 1);   // turnscale < 1 is a port option (finer keyboard turning); 1 = id's rate
    const u = Math.trunc(p.anglefrac / ANGLESCALE); p.anglefrac -= u * ANGLESCALE;
    p.angle = ((p.angle - u) % ANGLES + ANGLES) % ANGLES;
  }
  if (cy < 0) thrust(p, p.angle, -cy * MOVESCALE, solid, ab);
  else if (cy > 0) thrust(p, (p.angle + ANGLES / 2) % ANGLES, cy * BACKMOVESCALE, solid, ab);
}
