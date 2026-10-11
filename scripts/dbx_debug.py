#!/usr/bin/env python3
"""Drive the DOSBox-X debugger headless through its MCP text control channel (no curses UI needed).

Also "@CONT" resumes after a breakpoint hit without retyping the command.
Usage: dbx_debug.py <dir-mounted-as-C> "<dos command line>" CMD...
  Each CMD is a debugger command (e.g. "BPINT 21 40", "CPU", "MEMDUMP 1234 0 256").
  The special CMD "@RUN" resumes emulation, types the DOS command line into the prompt, and waits ~3 s
  "@WAIT n" sleeps n s, "@BREAK" pauses a running emulation, "@CONT" resumes it (hang sampling: @RUN @WAIT 15 @BREAK "EV CS IP" @CONT @WAIT 2 @BREAK "EV CS IP" ...).
  (so put breakpoints BEFORE @RUN, inspection commands AFTER it).
Protocol (DOSBox-X README.debugger): server sends `REQ <id> PING|BREAK|EXEC <cmd>`;
reply `BEGIN <id> OK|ERR` ... `END <id>`. Needs `[dosbox] mcp_server=<port>` and Xvfb on :99.
"""
import os, pty, socket, subprocess, sys, threading, time

PORT = 58991
here = os.path.dirname(os.path.abspath(__file__))
d, dosline, cmds = os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3:]
os.environ["DISPLAY"] = ":99"
conf = f"""[dosbox]
mcp_server={PORT}
[sdl]
output=surface
[mixer]
nosound=true
[midi]
mididevice=none
[sblaster]
sbtype=none
[cpu]
cycles=max
[autoexec]
mount c "{d}"
c:
"""
open(f"{d}/dbx_mcp.conf", "w").write(conf)

srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", PORT)); srv.listen(1); srv.settimeout(40)
if subprocess.run(["pgrep", "-x", "Xvfb"], capture_output=True).returncode:
    subprocess.Popen(["Xvfb", ":99", "-screen", "0", "1024x768x24"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
env = dict(os.environ, SDL_AUDIODRIVER="dummy")
# LESSON: the debugger refuses to work ("not available unless you start DOSBox-X from a terminal") without a tty
# on stdio, so give it a pty and drain it (the curses UI output is discarded; we use the control channel instead).
master, slave = pty.openpty()
proc = subprocess.Popen(["bash", "-c", f'ulimit -c 0; exec "{here}/../vendor/dosbox-x-dbg" -conf "{d}/dbx_mcp.conf"'],
                        env=env, stdin=slave, stdout=slave, stderr=slave, close_fds=True)
def _drain():
    try:
        while os.read(master, 65536): pass
    except OSError: pass
threading.Thread(target=_drain, daemon=True).start()
conn, _ = srv.accept(); conn.settimeout(15); f = conn.makefile("rw", newline="\n")
rid = 0
def req(body):
    global rid; rid += 1
    f.write(f"REQ {rid} {body}\n"); f.flush()
    out = []
    while True:
        line = f.readline()
        if not line: break
        line = line.rstrip("\n")
        if line.startswith(f"END {rid}"): break
        if not line.startswith("BEGIN"): out.append(line)
    return out
try:
    print("PING:", req("PING")); time.sleep(1)
    print("BREAK:", req("BREAK"))
    for c in cmds:
        if c == "@RUN":
            print("RUN:", req("EXEC RUN"))
            time.sleep(1); subprocess.run(["xdotool", "type", "--delay", "60", dosline]); subprocess.run(["xdotool", "key", "Return"]); time.sleep(3)
            continue
        if c.startswith("@XDO"):  # "@XDO keydown F10" etc: raw xdotool args, 0.4 s apart
            subprocess.run(["xdotool"] + c.split()[1:]); time.sleep(0.4); continue
        if c.startswith("@KEY"):  # "@KEY space Return": xdotool keys into the game window, 1.5 s apart
            for k in c.split()[1:]: subprocess.run(["xdotool", "key", k]); time.sleep(1.5)
            continue
        if c.startswith("@WAIT"):  # "@WAIT 10": let the emulation run N seconds
            time.sleep(float(c.split()[1])); continue
        if c == "@BREAK":  # pause a running emulation (to sample CS:IP of a hang)
            print("BREAK:", req("BREAK")); continue
        if c == "@CONT":  # resume without retyping the DOS line (after a breakpoint hit)
            print("CONT:", req("EXEC RUN")); time.sleep(0.5); continue
        print(f"> {c}"); print("\n".join(req(f"EXEC {c}")))
finally:
    proc.kill(); conn.close(); srv.close()
