// Software raycaster: textured walls, doors (sliding, recessed to the tile centre), door jambs, moving pushwalls, flat floor and ceiling. No sprites yet (W4).
// Pure function over an RGBA buffer so it runs in node (tests) and the browser (canvas ImageData).
export const FOV = 2 * Math.atan(0x8000 / (0x5700 + 0x5800));   // [source] CalcProjection: tan(half) = (VIEWGLOBAL/2)/(FOCALLENGTH+MINDIST), 72.4 degrees
const FLOOR = 0x19;                                             // palette index [source memory, matches gallery/]
// vgaCeiling[] per level (episode*10 + map), low byte [source WL_DRAW.C]
export const CEILING = [0x1d,0x1d,0x1d,0x1d,0x1d,0x1d,0x1d,0x1d,0x1d,0xbf, 0x4e,0x4e,0x4e,0x1d,0x8d,0x4e,0x1d,0x2d,0x1d,0x8d, 0x1d,0x1d,0x1d,0x1d,0x1d,0x2d,0xdd,0x1d,0x1d,0x98,
  0x1d,0x9d,0x2d,0xdd,0xdd,0x9d,0x2d,0x4d,0x1d,0xdd, 0x7d,0x1d,0x2d,0x2d,0xdd,0xd7,0x1d,0x1d,0x1d,0x2d, 0x1d,0x1d,0x1d,0x1d,0xdd,0xdd,0x7d,0xdd,0xdd,0xdd];
import { spriteColumns } from "./vswap.js"; import { STATES, SPR } from "./states_data.js";
const FOCAL = 0x5700 / 65536, MINDIST = 0x5800 / 65536, OBJSIZE = 0x2000 / 65536;   // the view point sits FOCALLENGTH behind the player [source WL_DRAW.C ThreeDRefresh]
// Tiles touched by the rays of a W-column view from the view point behind the player, like spotvis[][] of WL_DRAW.C (hit tile included; closed doors and walls stop a ray).
export function castSpots(world, pl, W = 320) {
  const spots = new Uint8Array(world.w * world.h), dx = Math.cos(pl.a), dy = -Math.sin(pl.a), k = Math.tan(FOV / 2), plx = -dy * k, ply = dx * k, cx = pl.x - FOCAL * dx, cy = pl.y - FOCAL * dy;
  for (let col = 0; col < W; col += 2) {
    const cam = 2 * col / W - 1, rx = dx + plx * cam, ry = dy + ply * cam; let mx = Math.floor(cx), my = Math.floor(cy);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
    let sdx = (rx < 0 ? cx - mx : mx + 1 - cx) * ddx, sdy = (ry < 0 ? cy - my : my + 1 - cy) * ddy;
    if (mx >= 0 && my >= 0 && mx < world.w && my < world.h) spots[my * world.w + mx] = 1;
    for (let n = 0; n < 128; n++) {
      const sidex = sdx < sdy; if (sidex) { sdx += ddx; mx += sx; } else { sdy += ddy; my += sy; }
      if (mx < 0 || my < 0 || mx >= world.w || my >= world.h) break;
      const i = my * world.w + mx, tv = world.tilemap[i]; spots[i] = 1;
      if (!tv) continue;
      if (tv & 0x80) {                                             // door: the ray goes on if it passes through the open gap (same test as render())
        const d = world.doors[tv & 0x7f], p = d.pos / 65536, entry = sidex ? sdx - ddx : sdy - ddy;
        let t, lat;
        if (d.vertical) { t = (mx + .5 - cx) / rx; lat = cy + t * ry - my; } else { t = (my + .5 - cy) / ry; lat = cx + t * rx - mx; }
        if (t < entry || lat < 0 || lat >= 1 || lat < p) continue;
      }
      break;
    }
  }
  return spots;
}
export function render(img, W, H, world, pl, vs, pal, level = 0) {
  const px = new Uint32Array(img.buffer), rgb = i => 0xff000000 | pal[i][2] << 16 | pal[i][1] << 8 | pal[i][0];
  px.fill(rgb(FLOOR)); px.fill(rgb(CEILING[level]), 0, W * (H >> 1));
  const dx = Math.cos(pl.a), dy = -Math.sin(pl.a);                 // angle grows counter-clockwise, y grows down
  const k = Math.tan(FOV / 2), plx = -dy * k, ply = dx * k;        // camera plane, right of the view direction
  const cx = pl.x - FOCAL * dx, cy = pl.y - FOCAL * dy, zbuf = new Float64Array(W).fill(1e9);
  const proj = (W / 2) / k, DOORWALL = vs.spriteStart - 8, wd = world.w, pw = world.pw;
  for (let col = 0; col < W; col++) {
    const cam = 2 * col / W - 1, rx = dx + plx * cam, ry = dy + ply * cam;
    let mx = Math.floor(cx), my = Math.floor(cy);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry), sx = rx < 0 ? -1 : 1, sy = ry < 0 ? -1 : 1;
    let sdx = (rx < 0 ? cx - mx : mx + 1 - cx) * ddx, sdy = (ry < 0 ? cy - my : my + 1 - cy) * ddy, side = 0;
    let dist = 0, u = 0, chunk = -1;
    for (let n = 0; n < 128 && chunk < 0; n++) {
      if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
      if (mx < 0 || my < 0 || mx >= world.w || my >= world.h) break;
      const tv = world.tilemap[my * wd + mx]; if (!tv) continue;
      const entry = side ? sdy - ddy : sdx - ddx;
      if (tv & 0x80) {                                             // door: plane through the tile centre, slides along the wall
        const d = world.doors[tv & 0x7f], p = d.pos / 65536;
        let t, lat;
        if (d.vertical) { t = (mx + .5 - cx) / rx; lat = cy + t * ry - my; }
        else { t = (my + .5 - cy) / ry; lat = cx + t * rx - mx; }
        if (t < entry || lat < 0 || lat >= 1 || lat < p) continue;   // exits through the side first, or passes the open gap
        dist = t; u = lat - p;
        chunk = DOORWALL + (d.lock === 0 ? 0 : d.lock === 5 ? 4 : 6) + (d.vertical ? 1 : 0);
      } else {
        const id = tv & 0x3fff;
        let t = entry, hit = side ? cx + t * rx : cy + t * ry;
        if ((tv & 0x4000) && mx === pw.x && my === pw.y) {          // pushwall in motion: the face moves along the push direction
          const off = pw.pos / 64, along = pw.dir === 0 || pw.dir === 2 ? 0 : 1;
          if (side === along) {
            const sign = [1, -1, -1, 1][pw.dir], face = (side ? my + (sy < 0 ? 1 : 0) : mx + (sx < 0 ? 1 : 0)) + sign * off;
            t = side ? (face - cy) / ry : (face - cx) / rx; hit = side ? cx + t * rx : cy + t * ry;
            if (hit < (side ? mx : my) || hit >= (side ? mx : my) + 1) continue;
          }
        }
        dist = t; u = hit - Math.floor(hit);
        if (side ? ry > 0 : rx < 0) u = 1 - u;                      // keep the texture un-mirrored
        const pt = side ? world.tilemap[(my - sy) * wd + mx] : world.tilemap[my * wd + mx - sx];
        chunk = pt & 0x80 && !(pt & 0x4000) ? DOORWALL + (side ? 2 : 3) : (id - 1) * 2 + (side ? 0 : 1);   // door jamb, else horizontal faces use the even chunk, vertical (dark) the odd one
      }
    }
    if (chunk < 0) continue;
    zbuf[col] = dist;
    const tex = vs.chunk(chunk), tx = Math.min(63, u * 64 | 0), h = proj / dist, top = (H >> 1) - h / 2;
    const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H, Math.ceil(top + h));
    for (let y = y0; y < y1; y++) px[y * W + col] = rgb(tex[tx * 64 + Math.min(63, (y - top) / h * 64 | 0)]);
  }
  // static sprites, far to near; a sprite column is drawn only where the wall behind it is farther [source: wallheight[x] < height]
  const vis = [];
  for (const st of world.statics) {
    if (st.shape < 0) continue;
    const gx = st.x + .5 - cx, gy = st.y + .5 - cy, nx = gx * dx + gy * dy - OBJSIZE, ny = gx * -dy + gy * dx;   // depth, lateral (right of view)
    if (nx >= MINDIST) vis.push({ st, nx, ny });
  }
  const A = world.actors;
  if (A) for (const ob of A.list) {                                // actors: shape from the state, rotated by the viewing angle (CalcRotate)
    if (ob.removed || !(ob.flags & 8)) continue;
    const gx = ob.x / 65536 - cx, gy = ob.y / 65536 - cy, nx = gx * dx + gy * dy - 0.25, ny = gx * -dy + gy * dx; if (nx < MINDIST) continue;
    const stt = STATES[ob.state]; let shape = stt[1];
    if (stt[0]) {
      const viewx = W / 2 + ny / nx * proj; let ang = Math.round(pl.a * 180 / Math.PI) + Math.trunc((W / 2 - viewx) / 8) - 180 - (ob.cls === "rocket" ? ob.angle : [0, 45, 90, 135, 180, 225, 270, 315, 0][ob.dir]) + 22;
      ang = ((ang % 360) + 360) % 360; shape += stt[0] === 2 ? 4 * Math.trunc(ang / 180) : Math.trunc(ang / 45);
    }
    vis.push({ st: { shape }, nx, ny });
  }
  vis.sort((a, b) => b.nx - a.nx);
  for (const { st, nx, ny } of vis) {
    const sp = (vs.sprites ||= {})[st.shape] ||= spriteColumns(vs, vs.spriteStart + st.shape);
    const size = proj / nx, left = W / 2 + ny / nx * proj - size / 2, top = (H >> 1) - size / 2;
    for (let col = Math.max(0, Math.ceil(left)); col < Math.min(W, Math.ceil(left + size)); col++) {
      if (zbuf[col] <= nx) continue;
      const tx = Math.min(63, (col - left) / size * 64 | 0), cl = sp.cols[tx - sp.first]; if (!cl) continue;
      for (const post of cl) for (let r = post.start; r < post.end; r++) {
        const y0 = Math.max(0, Math.ceil(top + r * size / 64)), y1 = Math.min(H, Math.ceil(top + (r + 1) * size / 64));
        for (let y = y0; y < y1; y++) px[y * W + col] = rgb(sp.data[post.ofs + r & 0xffff]);
      }
    }
  }
  if (world.gs && world.gs.weapon !== undefined && H > 8 && !world.victory) {           // player weapon, drawn full view height and centred (ScaleShape(viewwidth/2, shape, viewheight+1))
    const g = world.gs, shape = [SPR.SPR_KNIFEREADY, SPR.SPR_PISTOLREADY, SPR.SPR_MACHINEGUNREADY, SPR.SPR_CHAINREADY][g.weapon] + (g.weaponframe || 0);
    const sp = (vs.sprites ||= {})[shape] ||= spriteColumns(vs, vs.spriteStart + shape), size = H + 1, left = W / 2 - size / 2, top = (H >> 1) - size / 2;
    for (let col = Math.max(0, Math.ceil(left)); col < Math.min(W, Math.ceil(left + size)); col++) {
      const tx = Math.min(63, (col - left) / size * 64 | 0), cl = sp.cols[tx - sp.first]; if (!cl) continue;
      for (const post of cl) for (let r = post.start; r < post.end; r++) {
        const y0 = Math.max(0, Math.ceil(top + r * size / 64)), y1 = Math.min(H, Math.ceil(top + (r + 1) * size / 64));
        for (let y = y0; y < y1; y++) px[y * W + col] = rgb(sp.data[post.ofs + r & 0xffff]);
      }
    }
  }
}
