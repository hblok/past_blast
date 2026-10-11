// Pre-game screens (WL_MENU.C): PG-13 notice, title picture, main menu, episode and difficulty selection, drawn at the original positions with the real
// pictures, colours and the big menu font from VGAGRAPH. Pure state machine + draw into a 320x200 palette-index buffer; the page feeds key events.
import { PIC } from "./gfx_names.js"; import { blit } from "./hud.js";
const BORD = 0x29, BORD2 = 0x23, DEACTIVE = 0x2b, BKGD = 0x2d, STRIPE = 0x2c, READCOLOR = 0x4a, READHCOLOR = 0x47, TEXTCOLOR = 0x17, HIGHLIGHT = 0x13;
const HL = [DEACTIVE, HIGHLIGHT, READHCOLOR, 0x67], NORM = [DEACTIVE, TEXTCOLOR, READCOLOR, 0x6b];   // color_hlite / color_norml by item type
const MAIN = [["New Game", 1], ["Sound", 0], ["Control", 0], ["Load Game", 0], ["Save Game", 0], ["Change View", 0], ["Read This!", 0], ["View Scores", 0], ["Back to Demo", 1], ["Quit", 1]];
const EPISODES = ["Escape from Wolfenstein", "Operation: Eisenfaust", "Die, Fuhrer, Die!", "A Dark Secret", "Trail of the Madman", "Confrontation"];
const LEVELS = ["Can I play, Daddy?", "Don't hurt me.", "Bring 'em on!", "I am Death incarnate!"];
export function parseFont(d) {   // fontstruct: height, location[256], width[256], then 1 byte per pixel, rows of `width`
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  return { h: dv.getUint16(0, true), loc: i => dv.getUint16(2 + i * 2, true), wid: i => d[514 + i], d };
}
export class Menu {
  constructor(vg) { this.vg = vg; this.font = parseFont(vg.chunk(2)); this.screen = "title"; /* id shows a PG-13 notice first; dropped here */ this.cur = 0; this.t = 0; this.ingame = false; this.episode = 0; }
  open(ingame) { this.ingame = ingame; this.screen = "main"; this.cur = ingame ? 8 : 0; }   // Esc in a game: curpos on "Back to Game"
  items() { return MAIN.map(([s, a], i) => i === 8 && this.ingame ? ["Back to Game", 1] : [s, a]); }
  // key: "up" | "down" | "enter" | "esc" | "any"; returns {start: {episode, difficulty}} / {resume: true} / null
  key(k) {
    const s = this.screen;
    if (s === "pg13") { this.screen = "title"; return null; }
    if (s === "title") { this.open(false); return null; }
    const n = s === "main" ? MAIN.length : s === "episode" ? 6 : 4, act = i => s === "main" ? this.items()[i][1] : 1;
    if (k === "up" || k === "down") { const d = k === "up" ? -1 : 1; let c = this.cur; do c = (c + d + n) % n; while (!act(c)); this.cur = c; return null; }
    if (k === "esc") {
      if (s === "main") { if (this.ingame) return { resume: true }; this.screen = "title"; } else if (s === "episode") { this.screen = "main"; this.cur = 0; } else { this.screen = "episode"; this.cur = this.episode; }
      return null;
    }
    if (k !== "enter") return null;
    if (s === "main") {
      if (this.cur === 0) { this.screen = "episode"; this.cur = 0; } else if (this.cur === 8) { if (this.ingame) return { resume: true }; this.screen = "title"; } else if (this.cur === 9) this.screen = "title";
    } else if (s === "episode") { this.episode = this.cur; this.screen = "diff"; this.cur = 2; }
    else return { start: { episode: this.episode, difficulty: this.cur } };
    return null;
  }
  // ---- drawing ----
  bar(img, x, y, w, h, c) { for (let r = 0; r < h; r++) img.fill(c, (y + r) * 320 + x, (y + r) * 320 + x + w); }
  window(img, x, y, w, h) {
    this.bar(img, x, y, w, h, BKGD);
    this.bar(img, x, y, w + 1, 1, DEACTIVE); this.bar(img, x, y, 1, h + 1, DEACTIVE); this.bar(img, x, y + h, w + 1, 1, BORD2); this.bar(img, x + w, y, 1, h + 1, BORD2);
  }
  text(img, s, x, y, c, center = false) {
    const f = this.font; let cx = x;
    if (center) { let w = 0; for (const ch of s) w += f.wid(ch.charCodeAt(0)); cx = x + (320 - w >> 1); }
    for (const ch of s) {
      const code = ch.charCodeAt(0), w = f.wid(code), o = f.loc(code);
      for (let r = 0; r < f.h; r++) for (let c2 = 0; c2 < w; c2++) if (f.d[o + r * w + c2] && cx + c2 < 320 && y + r < 200) img[(y + r) * 320 + cx + c2] = c;
      cx += w;
    }
  }
  items_(img, x, y, items, cur, step = 13) {   // DrawMenu: one item per 13 pixel row, multi-line labels continue on the next font line
    items.forEach(([s, a], i) => s.split("\n").forEach((line, j) => this.text(img, line, x, y + i * step + j * this.font.h, (i === cur ? HL : NORM)[a])));
  }
  gun(img, x, y) { blit(img, 320, this.vg.pic(PIC[Math.floor(this.t / 8) % 2 ? "C_CURSOR2PIC" : "C_CURSOR1PIC"]), x, y); }
  draw(img) {
    const pic = n => this.vg.pic(PIC[n]); this.t++;
    if (this.screen === "pg13" || this.screen === "title") { blit(img, 320, pic(this.screen === "pg13" ? "PG13PIC" : "TITLEPIC"), 0, 0); return; }
    img.fill(BORD); blit(img, 320, pic("C_MOUSELBACKPIC"), 112, 184);
    if (this.screen === "main") {
      this.bar(img, 0, 10, 320, 24, 0); this.bar(img, 0, 32, 320, 1, STRIPE); blit(img, 320, pic("C_OPTIONSPIC"), 84, 0);
      this.window(img, 68, 52, 178, 136); this.items_(img, 100, 55, this.items(), this.cur); this.gun(img, 76, 55 + this.cur * 13 - 2);
    } else if (this.screen === "episode") {
      this.window(img, 6, 19, 308, 154); this.text(img, "Which episode to play?", 0, 2, READHCOLOR, true);
      const it = []; EPISODES.forEach((e, i) => { it.push([`Episode ${i + 1}\n${e}`, i ? 3 : 1]); if (i < 5) it.push(["", 0]); });
      this.items_(img, 98, 23, it, this.cur * 2); this.gun(img, 10, 23 + this.cur * 26 - 2);
      for (let i = 0; i < 6; i++) blit(img, 320, pic(`C_EPISODE${i + 1}PIC`), 42, 23 + i * 26);
    } else {
      this.text(img, "How tough are you?", 70, 68, READHCOLOR); this.window(img, 45, 90, 225, 67);
      this.items_(img, 74, 100, LEVELS.map(s => [s, 1]), this.cur); this.gun(img, 50, 100 + this.cur * 13 - 2);
      blit(img, 320, pic(["C_BABYMODEPIC", "C_EASYPIC", "C_NORMALPIC", "C_HARDPIC"][this.cur]), 235, 107);
    }
  }
}
