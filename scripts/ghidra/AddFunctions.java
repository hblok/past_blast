// Create functions at extra entry points found by another tool. Generic, blind-safe.
// Usage: analyzeHeadless <proj> <name> -process <prog> -scriptPath <dir> -postScript AddFunctions.java <merged.csv> <imageBase e.g. 0x10000>
// Reads rows with tools == reko (second column group) from merge_functions.py; skips addresses that are already inside a function.
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import java.io.*;

public class AddFunctions extends GhidraScript {
    @Override
    public void run() throws Exception {
        String[] a = getScriptArgs(); long base = Long.decode(a.length > 1 ? a[1] : "0x10000"); int added = 0, skipped = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(a[0]))) {
            String l = r.readLine();
            while ((l = r.readLine()) != null) {
                String[] c = l.split(",", -1); if (c.length < 5 || !c[4].equals("reko")) continue;
                long lin = Long.decode(c[0]) + base; int seg = (int) (lin >> 4 & 0xF000) | 0; // seg:off with off < 16 for the paragraph-aligned form
                Address ad = currentProgram.getAddressFactory().getAddress(String.format("%04x:%04x", (lin - (lin & 0xFFFF)) >> 4, lin & 0xFFFF));
                if (ad == null || currentProgram.getFunctionManager().getFunctionContaining(ad) != null) { skipped++; continue; }
                new DisassembleCommand(ad, null, true).applyTo(currentProgram, monitor);
                if (new CreateFunctionCmd(ad).applyTo(currentProgram, monitor)) added++; else skipped++;
            }
        }
        println("added " + added + " functions, skipped " + skipped);
    }
}
