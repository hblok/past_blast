"""DOSBox-X debugger driver as a library: one emulator process, one persistent control connection (M3.4).
Private Xvfb display + private control port per instance, dummy audio, no core dumps, hard deadlines everywhere, kill -9 at the end.
    with Dbx(rundir, workdir, cycles=20000, deadline=600) as d:
        d.cmd("BPM 0000:0022"); d.run(); ... d.regs() ; d.read(seg, off, n); d.write(seg, off, value)
Generic: nothing here knows a game. Output files of MEMDUMPBIN etc. land in `workdir` (the emulator's cwd).
"""
import os, pty, random, signal, socket, subprocess, sys, threading, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DBX = os.path.join(ROOT, "vendor", "dosbox-x-dbg")


class DbxError(Exception):
    pass


class Dbx:
    def __init__(self, rundir, workdir, cycles=20000, deadline=900, autoexec=None, size="1024x768x24"):
        """rundir is mounted as C:. autoexec = DOS line run at start (None = stay at the prompt). deadline = hard wall limit in s."""
        self.rundir, self.workdir = os.path.abspath(rundir), os.path.abspath(workdir)
        os.makedirs(self.workdir, exist_ok=True)
        self.port = random.randint(20000, 40000)
        self.display = None; self.xvfb = None; self.proc = None; self.conn = None; self.rid = 0
        self.deadline = time.time() + deadline; self.cycles = cycles; self.autoexec = autoexec; self.size = size
        self.pgids = []

    # ---- lifecycle
    def __enter__(self):
        try:
            self.start()
        except BaseException:
            self.stop(); raise
        return self

    def __exit__(self, *a):
        self.stop()

    def _watchdog(self):
        while time.time() < self.deadline:
            time.sleep(1)
            if self.proc is None: return
        sys.stderr.write("dbx: hard deadline reached, killing emulator\n"); self.stop()

    def start(self):
        for n in random.sample(range(100, 900), 50):             # private X display; Xvfb refuses a taken number
            if os.path.exists(f"/tmp/.X11-unix/X{n}") or os.path.exists(f"/tmp/.X{n}-lock"): continue
            p = subprocess.Popen(["Xvfb", f":{n}", "-screen", "0", self.size], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            for _ in range(30):
                if os.path.exists(f"/tmp/.X11-unix/X{n}"): break
                time.sleep(0.1)
            if p.poll() is None: self.display, self.xvfb = f":{n}", p; break
        if not self.display: raise DbxError("no Xvfb")
        cyc = f"cycles={self.cycles}\ncore=normal" if str(self.cycles) != "max" else "cycles=max"
        ae = self.autoexec or ""
        conf = f"[dosbox]\nmcp_server={self.port}\n[sdl]\noutput=surface\n[mixer]\nnosound=true\n[midi]\nmididevice=none\n[sblaster]\nsbtype=none\n[cpu]\n{cyc}\n[autoexec]\nmount c \"{self.rundir}\"\nc:\n{ae}\n"
        self.conf = os.path.join(self.workdir, "dbx.conf"); open(self.conf, "w").write(conf)
        srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.port)); srv.listen(1); srv.settimeout(40)
        env = dict(os.environ, DISPLAY=self.display, SDL_AUDIODRIVER="dummy")
        master, slave = pty.openpty()                            # debugger refuses to work without a tty on stdio (LESSONS)
        self.proc = subprocess.Popen(["bash", "-c", f'ulimit -c 0 -f 100000; cd "{self.workdir}"; exec "{DBX}" -conf "{self.conf}"'],
                                     env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True)
        threading.Thread(target=lambda: [os.read(master, 65536) for _ in iter(int, 1)], daemon=True).start()
        threading.Thread(target=self._watchdog, daemon=True).start()
        try: self.conn, _ = srv.accept()
        except socket.timeout: raise DbxError("emulator did not connect")
        finally: srv.close()
        self.conn.settimeout(30); self.f = self.conn.makefile("rw", newline="\n")
        self.req("PING"); time.sleep(0.5); self.req("BREAK")      # halted; first thing the caller sets are breakpoints

    def stop(self):
        p, self.proc = self.proc, None
        for pr in (p, self.xvfb):
            if pr is not None:
                try: os.killpg(pr.pid, signal.SIGKILL); pr.wait(timeout=3)
                except Exception: pass
        self.xvfb = None
        try: self.conn.close()
        except Exception: pass

    # ---- protocol
    def req(self, body, timeout=30):
        if self.proc is None: raise DbxError("emulator gone")
        self.rid += 1; rid = self.rid
        self.conn.settimeout(min(timeout, max(1, self.deadline - time.time())))
        try:
            self.f.write(f"REQ {rid} {body}\n"); self.f.flush(); out = []
            while True:
                line = self.f.readline()
                if not line: raise DbxError(f"connection closed during {body!r}")
                line = line.rstrip("\n")
                if line.startswith(f"END {rid}"): return out
                if not line.startswith("BEGIN"): out.append(line)
        except (socket.timeout, OSError) as e:
            raise DbxError(f"timeout/IO on {body!r}: {e}")

    def cmd(self, c, timeout=30):
        return self.req("EXEC " + c, timeout)

    def run(self):
        return self.cmd("RUN")

    def step(self, regs=False, known=None):
        """Resume and return once the emulator is halted again at the next breakpoint hit. RUN replies at once and the debugger answers
        the first request after it in a race window, possibly still at the OLD halt (stale state); the throw-away EV closes that window,
        so every request after step() is executed at the new halt. (M3.4 finding; run()+read() directly gave stale/duplicate frames.)
        regs=True (M6.2a, capture.py has more breakpoints than the frame hook): one more request, returns {"CS","IP"} of the new halt; the
        first EV can be the stale one, so it is never used for the answer (+50 ms).
        known = set of physical addresses (cs*16+ip) of all breakpoints: then step() polls EV CS IP until it reads one of them. Reason (M6.2a): with
        more than one breakpoint a request sent right after RUN can be answered while the CPU is still RUNNING (value = random spot in the
        game's wait loop), and the real halt then goes unnoticed (a missed hit, run-dependent). A running CPU is never exactly on a breakpoint."""
        self.run(); self.cmd("EV CS")
        if known is None:
            if regs: return self.regs("CS", "IP")
            return
        end = time.time() + 60
        while time.time() < end:
            r = self.regs("CS", "IP")
            if r and ((r["CS"] * 16 + r["IP"]) & 0xFFFFF) in known: return r
            time.sleep(0.01)
        raise DbxError("step: no breakpoint hit within 60 s")

    def regs(self, *names):
        """EV <regs> -> dict of ints. Returns after the emulation stopped (call it right after run() to wait for a breakpoint hit)."""
        names = names or ("CS", "IP")
        out = self.cmd("EV " + " ".join(names))
        vals = out[-1].split() if out else []
        return {n: int(v, 16) for n, v in zip(names, vals)} if len(vals) == len(names) else None

    # ---- memory
    def read(self, seg, off, n, name="rd.bin"):
        self.cmd(f"MEMDUMPBIN {seg:04X}:{off:04X} {n:X} {name.upper()}")
        return open(os.path.join(self.workdir, name.upper()), "rb").read()

    def write(self, seg, off, value):
        self.cmd(f"SM {seg:04X}:{off:04X} {value:X}")

    # ---- host input (start-up only)
    def xdo(self, *args):
        subprocess.run(["xdotool", *args], env=dict(os.environ, DISPLAY=self.display), timeout=10)

    def shot_x(self, path, crop=None):
        a = ["import", "-window", "root"] + (["-crop", crop, "+repage"] if crop else []) + [path]
        subprocess.run(a, env=dict(os.environ, DISPLAY=self.display), timeout=20)
