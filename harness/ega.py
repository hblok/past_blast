"""EGA screen capture through the debugger (no host screenshot, so it is tied to emulated time): read the 4 planes of A000:0000
with the graphics-controller read-map-select register, the visible start address / line stride from the CRTC and the pixel pan +
16 palette entries from the attribute controller. Registers touched are restored (GC index + map select, CRTC index, attribute
flip-flop, video enable). Palette = attribute registers -> DAC. Generic for 16-colour planar modes (EGA 0Dh/0Eh, VGA 10h, tweaked 320x200). Call while halted."""
import numpy as np
from PIL import Image


def _inp(d, port):
    return int(d.cmd(f"INP {port:X}")[-1].split()[-1], 16)


def _out(d, port, v):
    d.cmd(f"OUTP {port:X} {v:X}")


def capture(d, w=320, h=200):
    """-> (indices uint8[h,w] in 0..15, palette[16] of (r,g,b)). w/h: visible size of the game's mode."""
    gc_idx = _inp(d, 0x3CE); _out(d, 0x3CE, 4); ms = _inp(d, 0x3CF)
    crtc_idx = _inp(d, 0x3D4)
    crtc = {}
    for r in (0x0C, 0x0D, 0x13, 0x09):
        _out(d, 0x3D4, r); crtc[r] = _inp(d, 0x3D5)
    _out(d, 0x3D4, crtc_idx)
    _inp(d, 0x3DA)                                          # reset the attribute flip-flop to "index"
    attr = []
    for i in range(16):
        _inp(d, 0x3DA); _out(d, 0x3C0, 0x20 | i); attr.append(_inp(d, 0x3C1))   # bit 5 keeps the video enabled; reading 3C1 does not reset the flip-flop, so reset (3DA) before every index write
    _inp(d, 0x3DA); _out(d, 0x3C0, 0x33); pan = _inp(d, 0x3C1) & 7
    _inp(d, 0x3DA); _out(d, 0x3C0, 0x20)
    _inp(d, 0x3DA)
    planes = []
    for p in range(4):
        _out(d, 0x3CE, 4); _out(d, 0x3CF, p)
        planes.append(np.frombuffer(d.read(0xA000, 0, 0x10000, "pl.bin"), np.uint8))
    _out(d, 0x3CE, 4); _out(d, 0x3CF, ms); _out(d, 0x3CE, gc_idx)
    start = (crtc[0x0C] << 8) | crtc[0x0D]; stride = crtc[0x13] * 2
    nb = (w + 7) // 8 + 1
    img = np.zeros((h, nb * 8), np.uint8)
    for y in range(h):
        o = (start + y * stride) & 0xFFFF
        idx = [(o + k) & 0xFFFF for k in range(nb)]
        img[y] = sum(np.unpackbits(planes[p][idx]) << p for p in range(4))
    img = img[:, pan:pan + w]
    dac = {}
    for a in sorted(set(attr)):                              # attribute palette holds DAC indices on VGA: read the DAC (6 bit per channel)
        _out(d, 0x3C7, a); dac[a] = tuple(_inp(d, 0x3C9) * 255 // 63 for _ in range(3))
    return img, [dac[a] for a in attr], dict(start=start, stride=stride, pan=pan, attr=attr)


def to_png(img, pal, path, scale=2):
    rgb = np.array(pal, np.uint8)[img]
    Image.fromarray(rgb).resize((img.shape[1] * scale, img.shape[0] * scale), Image.NEAREST).save(path)
