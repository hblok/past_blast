// VSWAP.WL6: u16 chunks, u16 spriteStart, u16 soundStart, u32 offset[chunks], u16 length[chunks].
// Chunks [0, spriteStart) are 64x64 wall textures stored column-major (pixel (x,y) = data[x*64+y]); [spriteStart, soundStart) are sprites; the rest is sound.
export function parseVswap(buf) {
  const v = new DataView(buf), n = v.getUint16(0, true), spriteStart = v.getUint16(2, true), soundStart = v.getUint16(4, true);
  const off = [], len = [];
  for (let i = 0; i < n; i++) { off.push(v.getUint32(6 + 4 * i, true)); len.push(v.getUint16(6 + 4 * n + 2 * i, true)); }
  const chunk = i => new Uint8Array(buf, off[i], len[i]);
  return { n, spriteStart, soundStart, chunk, buf };
}
// Sprite chunk -> {first, last, cols}: u16 firstCol, u16 lastCol, u16 colOfs[last-first+1]; each column is a list of posts
// (u16 end*2, u16 pixelOfs, u16 start*2) terminated by end==0; the pixel for row y of a post is chunk[pixelOfs + y].
export function spriteColumns(vs, idx) {
  const c = vs.chunk(idx), d = new DataView(c.buffer, c.byteOffset, c.byteLength);
  const first = d.getUint16(0, true), last = d.getUint16(2, true), cols = [];
  for (let x = first; x <= last; x++) {
    let p = d.getUint16(4 + 2 * (x - first), true); const posts = [];
    for (; d.getUint16(p, true) !== 0; p += 6) posts.push({ end: d.getUint16(p, true) >> 1, ofs: d.getUint16(p + 2, true), start: d.getUint16(p + 4, true) >> 1 });
    cols.push(posts);
  }
  return { first, last, cols, data: c };
}
