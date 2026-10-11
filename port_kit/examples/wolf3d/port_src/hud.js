// Status bar (DrawPlayScreen / LatchNumber / DrawFace of WL_AGENT.C): the 320x40 bar picture with face, numbers, keys and weapon drawn at the original positions.
import { PIC } from "./gfx_names.js";
export const blit = (img, W, p, x, y) => { for (let r = 0; r < p.h; r++) for (let c = 0; c < p.w; c++) img[(y + r) * W + x + c] = p.px[r * p.w + c]; };
// img: Uint8Array of palette indices W x 200; the bar occupies rows 160..199
export function drawHud(img, W, vg, gs, keys, level) {
  const Y = 160, pic = n => vg.pic(PIC[n]), num = (x, width, v) => {      // LatchNumber: right justified in `width` cells of 8 pixels, blank padded
    const s = String(Math.max(0, v)).slice(-width).padStart(width, " ");
    for (let i = 0; i < width; i++) { const ch = s[i]; blit(img, W, pic(ch === " " ? "N_BLANKPIC" : `N_${ch}PIC`), (x + i) * 8, Y + 16); }
  };
  blit(img, W, pic("STATUSBARPIC"), 0, Y);
  num(2, 2, level % 10 + 1); num(6, 6, gs.score); num(14, 1, gs.lives); num(21, 3, gs.health); num(27, 2, gs.ammo);
  const face = gs.health > 0 ? `FACE${Math.min(7, Math.floor((100 - gs.health) / 16)) + 1}${"ABC"[gs.faceframe || 0]}PIC` : "FACE8APIC";   // DrawFace: 3 * ((100 - health) / 16) + faceframe
  blit(img, W, pic(face), 17 * 8, Y + 4);
  blit(img, W, pic(keys & 1 ? "GOLDKEYPIC" : "NOKEYPIC"), 30 * 8, Y + 4); blit(img, W, pic(keys & 2 ? "SILVERKEYPIC" : "NOKEYPIC"), 30 * 8, Y + 20);
  blit(img, W, pic(["KNIFEPIC", "GUNPIC", "MACHINEGUNPIC", "GATLINGGUNPIC"][gs.weapon] || "KNIFEPIC"), 32 * 8, Y + 8);
}
