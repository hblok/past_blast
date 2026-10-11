"""Input-script parser (M3.2). Plain text, one line = `<frame>: <item> <item> ...`, `#` starts a comment, blank lines ignored.
  item  +Key | -Key     press / release a key by neutral name (names in game.json "keyboard.scancodes", case-insensitive)
        shot            capture the screen at this frame (checkpoint)
        end             stop recording after this frame (the last frame recorded is N; optional, else --frames decides)
        set:OFF=HEX     write bytes into DGROUP at DS:OFF (hex offset; HEX = bytes in memory order, e.g. set:8e4c=204e0000 = dword 20000)
                        STATE INJECTION: puts the game in a state the scenario cannot reach quickly (score near a threshold); runs using it are
                        not plain gameplay, say so in the scenario header
FRAME N = the N-th hit (0-based) of the frame hook after start-up, i.e. the frame counter `f` of state.jsonl. The items of line N are
applied while the emulator is halted at hook N, AFTER state N was recorded and BEFORE the next frame runs: so `+Right` at frame N is
first visible in state N+1, a `shot` at N shows the screen of state N (input of line N not yet applied). Lines must be in non-decreasing
frame order; +K on a held key and -K on a released key are errors (the game's table is level-triggered, a double press is a typo)."""
import re


class ScriptError(ValueError):
    pass


def parse(text, scancodes):
    """-> (events {frame: [(down, key)]}, shots set, end frame or None). Raises ScriptError('line N: ...')."""
    sc = {k.lower(): k for k in scancodes}
    ev, shots, end, last, held = {}, set(), None, -1, set()
    for n, raw in enumerate(text.splitlines(), 1):
        line = raw.split("#", 1)[0].strip()
        if not line: continue
        m = re.fullmatch(r"(\d+)\s*:\s*(.*)", line)
        if not m: raise ScriptError(f"line {n}: expected '<frame>: <items>', got {raw!r}")
        f, items = int(m[1]), m[2].split()
        if f < last: raise ScriptError(f"line {n}: frame {f} comes after frame {last} (frames must not decrease)")
        if end is not None: raise ScriptError(f"line {n}: line after 'end'")
        if not items: raise ScriptError(f"line {n}: no items after the colon")
        last = f
        for it in items:
            if it == "shot": shots.add(f)
            elif it == "end": end = f
            elif re.fullmatch(r"set:[0-9a-fA-F]{1,4}=(?:[0-9a-fA-F]{2})+", it):
                o, h = it[4:].split("=")
                ev.setdefault(f, []).append(("set", (int(o, 16), bytes.fromhex(h))))
            elif it[0] in "+-" and len(it) > 1:
                k = sc.get(it[1:].lower())
                if k is None: raise ScriptError(f"line {n}: unknown key {it[1:]!r} (known: {', '.join(sorted(scancodes))})")
                if (it[0] == "+") == (k in held): raise ScriptError(f"line {n}: {it} but {k} is already {'down' if k in held else 'up'}")
                held.add(k) if it[0] == "+" else held.discard(k)
                ev.setdefault(f, []).append((it[0] == "+", k))
            else: raise ScriptError(f"line {n}: bad item {it!r} (use +Key, -Key, set:OFF=HEX, shot, end)")
    return ev, shots, end


if __name__ == "__main__":                                       # self-check
    S = {"Right": 77, "ctrl": 29}
    ev, sh, end = parse("# c\n20: +Right\n185: -right +CTRL  # x\n300: shot end\n", S)
    assert ev == {20: [(True, "Right")], 185: [(False, "Right"), (True, "ctrl")]} and sh == {300} and end == 300
    assert parse("5: set:8e4c=204e0000", S)[0] == {5: [("set", (0x8e4c, bytes([0x20, 0x4e, 0, 0])))]}
    for bad in ("5: set:8e4c=2", "5: set:=20", "x", "5: +Foo", "5: +Right\n4: -Right", "5: -Right", "5: +Right +Right", "5:", "5: jump", "5: end\n6: shot"):
        try: parse(bad, S); raise SystemExit(f"accepted {bad!r}")
        except ScriptError as e: print("ok:", e)
