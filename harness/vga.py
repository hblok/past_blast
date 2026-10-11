"""VGA screen capture through the debugger (first used on a VGA game): same idea as ega.py (no host screenshot, tied to emulated time) for
256-colour modes: mode 13h (chain-4, linear) and the unchained "mode X" 320x200 that tweaked games use (4 planes, pixel x in plane x&3 at
byte start + y*stride + x/4). The visible start address comes from CRTC 0Ch/0Dh, the row stride from CRTC 13h (x2, byte mode) and the
plane layout from sequencer register 4 (bit 3 = chain-4). Palette = DAC (6 bit per channel -> 8 bit). Registers touched are restored.
Cost: the planes are 4 requests of 64 KB; the DAC is the expensive part (4 requests per palette entry), so only entries the image uses are
read, and later shots reuse them after a spot check of up to 6 cached entries (a changed palette -> the used entries are re-read).
Known gaps: horizontal pel panning (attribute 13h) is reported in info, not applied; split screen (line compare) is ignored. Call while halted."""
import numpy as np
from PIL import Image


def _inp(d, port):
    return int(d.cmd(f"INP {port:X}")[-1].split()[-1], 16)


def _out(d, port, v):
    d.cmd(f"OUTP {port:X} {v:X}")


def _dac(d, i):
    _out(d, 0x3C7, i); return tuple(_inp(d, 0x3C9) * 255 // 63 for _ in range(3))


def capture(d, w=320, h=200):
    """-> (indices uint8[h,w] 0..255, palette[256] of (r,g,b) (unused entries black), info)."""
    gc_idx = _inp(d, 0x3CE); _out(d, 0x3CE, 4); ms = _inp(d, 0x3CF)
    sq_idx = _inp(d, 0x3C4); _out(d, 0x3C4, 4); seq4 = _inp(d, 0x3C5); _out(d, 0x3C4, sq_idx)
    crtc_idx = _inp(d, 0x3D4); crtc = {}
    for r in (0x0C, 0x0D, 0x13, 0x14, 0x17):
        _out(d, 0x3D4, r); crtc[r] = _inp(d, 0x3D5)
    _out(d, 0x3D4, crtc_idx)
    _inp(d, 0x3DA); _out(d, 0x3C0, 0x33); pan = _inp(d, 0x3C1) & 15; _inp(d, 0x3DA); _out(d, 0x3C0, 0x20); _inp(d, 0x3DA)
    start = (crtc[0x0C] << 8) | crtc[0x0D]; chain4 = bool(seq4 & 8)
    stride = crtc[0x13] * (2 if crtc[0x17] & 0x40 else 4)     # bytes per row: offset register x2 in byte mode (x4 in word mode); dword mode (CRTC 14h bit 6) not handled
    if chain4:                                               # mode 13h: linear A000:0000, one byte per pixel
        mem = np.frombuffer(d.read(0xA000, 0, 0x10000, "pl.bin"), np.uint8)
        img = mem[(np.arange(h)[:, None] * 320 + np.arange(w)[None, :] + start) & 0xFFFF]
    else:
        planes = []
        for p in range(4):
            _out(d, 0x3CE, 4); _out(d, 0x3CF, p); planes.append(np.frombuffer(d.read(0xA000, 0, 0x10000, "pl.bin"), np.uint8))
        _out(d, 0x3CE, 4); _out(d, 0x3CF, ms)
        x = np.arange(w)[None, :]; y = np.arange(h)[:, None]
        off = (start + y * stride + (x >> 2)) & 0xFFFF
        img = np.zeros((h, w), np.uint8)
        for p in range(4):
            sel = (x & 3) == p; img = np.where(sel, planes[p][off], img)
    _out(d, 0x3CE, gc_idx)
    used = sorted(int(v) for v in np.unique(img)); cache = getattr(d, "_vga_pal", {})
    probe = used[::max(1, len(used) // 6)][:6]
    if any(i not in cache or _dac(d, i) != cache[i] for i in probe): cache = {}    # spot check failed (or first shot): palette changed
    for i in used:
        if i not in cache: cache[i] = _dac(d, i)
    d._vga_pal = cache
    pal = [cache.get(i, (0, 0, 0)) for i in range(256)]
    return img, pal, dict(start=start, stride=stride, pan=pan, chain4=chain4, seq4=seq4, used=len(used))


def to_png(img, pal, path, scale=2):
    rgb = np.array(pal, np.uint8)[img]
    Image.fromarray(rgb).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST).save(path)
