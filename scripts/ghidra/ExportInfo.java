// Generic post-analysis report for a headless Ghidra import (safe for blind agents: knows nothing about the target).
// Usage: analyzeHeadless ... -postScript ExportInfo.java <out.txt>
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import java.io.*;

public class ExportInfo extends GhidraScript {
    @Override
    public void run() throws Exception {
        String out = getScriptArgs().length > 0 ? getScriptArgs()[0] : "ghidra_info.txt";
        try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
            w.println("program " + currentProgram.getName() + "  language " + currentProgram.getLanguageID() + "  compiler " + currentProgram.getCompilerSpec().getCompilerSpecID());
            w.println("image base " + currentProgram.getImageBase());
            w.println("-- memory blocks");
            for (MemoryBlock b : currentProgram.getMemory().getBlocks())
                w.println(String.format("%-14s %s - %s  size %d  %s%s%s", b.getName(), b.getStart(), b.getEnd(), b.getSize(), b.isRead() ? "r" : "-", b.isWrite() ? "w" : "-", b.isExecute() ? "x" : "-"));
            w.println("-- entry points");
            for (Address a : currentProgram.getSymbolTable().getExternalEntryPointIterator()) w.println(a);
            w.println("-- functions (address, byte size, name)");
            int n = 0; long bytes = 0;
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                long sz = f.getBody().getNumAddresses(); n++; bytes += sz;
                w.println(String.format("%s %6d %s", f.getEntryPoint(), sz, f.getName()));
            }
            w.println("-- summary: " + n + " functions covering " + bytes + " bytes; instructions " + currentProgram.getListing().getNumInstructions() + "; defined data " + currentProgram.getListing().getNumDefinedData());
        }
        println("wrote " + out);
    }
}
