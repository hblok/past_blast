#!/usr/bin/env python3
"""M3.3 determinism study. Boots the game under the DOSBox-X debugger, counts the game's own timer interrupts (breakpoint on the
INT 8 handler, installed before the run so hit n = a fixed emulated time since the game hooked the timer), optionally injects a
key at a chosen tick by writing the game's key-state memory, and dumps the data segment at chosen ticks. Two runs are then compared.
Usage: determinism.py <rundir> <exe> <cycles-setting> <outdir> <tag> [ticks=200,400,800] [key_tick=200]
  cycles-setting: 'max' or a fixed number, e.g. 20000 (written to [cpu] cycles=; core=normal when fixed)
Writes <outdir>/<tag>_t<tick>.bin per dump. Generic parts (timer hook via IVT, tick counting) work on any DOS game; the key injection
needs the address of the game's key table (pass KEYADDR=seg:off[:value] in env, found by memory diff)."""
import os, pty, socket, struct, subprocess, sys, threading, time
rundir, exe, cycles, outdir, tag = sys.argv[1:6]
ticks = [int(x) for x in (sys.argv[6] if len(sys.argv) > 6 else '200,400,800').split(',')]
key_tick = int(sys.argv[7]) if len(sys.argv) > 7 else 200
KEY = os.environ.get('KEYADDR')                      # e.g. "2C17:E3BC:1"  (dgroup offset of a word the game polls)
DSEG = os.environ.get('DSEG', '2C17'); PORT = 58993
d = os.path.abspath(rundir); os.makedirs(outdir, exist_ok=True); outdir = os.path.abspath(outdir)
os.environ['DISPLAY'] = ':99'
if subprocess.run(['pgrep', '-x', 'Xvfb'], capture_output=True).returncode:
    subprocess.Popen(['Xvfb', ':99', '-screen', '0', '1024x768x24'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
cyc = f"cycles={cycles}\ncore=normal" if cycles != 'max' else "cycles=max"
open(f"{d}/dbx_det.conf", 'w').write(f"[dosbox]\nmcp_server={PORT}\n[sdl]\noutput=surface\n[mixer]\nnosound=true\n[midi]\nmididevice=none\n[sblaster]\nsbtype=none\n[cpu]\n{cyc}\n[autoexec]\nmount c \"{d}\"\nc:\n")
srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); srv.bind(('127.0.0.1', PORT)); srv.listen(1); srv.settimeout(40)
master, slave = pty.openpty()
here = os.path.dirname(os.path.abspath(__file__))
proc = subprocess.Popen(['bash', '-c', f'ulimit -c 0; cd "{outdir}"; exec "{here}/../vendor/dosbox-x-dbg" -conf "{d}/dbx_det.conf"'], stdin=slave, stdout=slave, stderr=slave, close_fds=True)
threading.Thread(target=lambda: [os.read(master, 65536) for _ in iter(int, 1)], daemon=True).start()
conn, _ = srv.accept(); conn.settimeout(20); f = conn.makefile('rw', newline='\n'); rid = 0
def req(body):
    if os.environ.get('DET_DEBUG'): print('>>', body, file=sys.stderr, flush=True)
    global rid; rid += 1; f.write(f"REQ {rid} {body}\n"); f.flush(); out = []
    while True:
        l = f.readline()
        if not l or l.startswith(f"END {rid}"): break
        if not l.startswith('BEGIN'): out.append(l.rstrip('\n'))
    return out
try:
    req('PING'); time.sleep(1); req('BREAK')
    req('EXEC BPM 0000:0022')                       # memory-change breakpoint on the INT 8 vector's segment word: halts exactly when the game hooks the timer
    req('EXEC RUN'); time.sleep(1)
    subprocess.run(['xdotool', 'type', '--delay', '60', exe]); subprocess.run(['xdotool', 'key', 'Return'])
    seg = off = 0
    for _ in range(400):                            # each halt = one write to the vector; stop at the first write that installs a non-BIOS handler
        time.sleep(0.15); r = req('EXEC EV CS IP')
        req(f'EXEC MEMDUMPBIN 0000:0020 4 {tag.upper()}_IVT.BIN')
        off, seg = struct.unpack('<HH', open(f'{outdir}/{tag.upper()}_IVT.BIN', 'rb').read()[:4])
        print('halt', r[-1] if r else r, f'vec {seg:04X}:{off:04X}', file=sys.stderr, flush=True)
        want = os.environ.get('ISR')               # e.g. 176E:0E4E: the game's persistent timer handler (the game re-hooks INT 8 several times at start-up)
        if (want and f'{seg:04X}:{off:04X}' == want.upper()) or (not want and seg not in (0xF000, 0) and seg > 0x800 and off != 0): break
        req('EXEC RUN')
    req('EXEC BPDEL *')
    # now halted right after the hook was installed: tick 0 of the emulated game clock
    req(f'EXEC BP {seg:04X}:{off:04X}'); req('EXEC RUN')
    hit = 0; t0 = time.time(); done = set()
    while hit < max(ticks):
        r = req('EXEC EV CS IP')
        if len(r) >= 2 and r[-1].split()[0] == f'{seg:04x}':      # halted inside the timer handler = one tick
            hit += 1
            if KEY and hit == key_tick:
                s, o, v = KEY.split(':'); req(f'EXEC SM {s}:{o} {v}')
            if hit in ticks and hit not in done:
                done.add(hit); req(f'EXEC MEMDUMPBIN {DSEG}:0000 FFFF {tag.upper()}_T{hit}.BIN')
        req('EXEC RUN')
    print(f"{tag}: {hit} ticks in {time.time() - t0:.1f} s wall, timer handler at {seg:04X}:{off:04X}")
finally:
    proc.kill()
