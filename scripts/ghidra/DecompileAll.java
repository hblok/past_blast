// Decompile every function of the current program to one C-like text file (generic, blind-safe).
// Usage: analyzeHeadless <proj> <name> -process <prog> -noanalysis -scriptPath <this dir> -postScript DecompileAll.java <out.c>
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.listing.*;
import java.io.*;

public class DecompileAll extends GhidraScript {
    @Override
    public void run() throws Exception {
        String out = getScriptArgs().length > 0 ? getScriptArgs()[0] : "decompiled.c";
        DecompInterface di = new DecompInterface(); di.openProgram(currentProgram);
        int ok = 0, fail = 0;
        try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                DecompileResults r = di.decompileFunction(f, 60, monitor);
                if (r != null && r.decompileCompleted()) { w.println("// " + f.getEntryPoint() + " " + f.getName()); w.println(r.getDecompiledFunction().getC()); ok++; }
                else { w.println("// " + f.getEntryPoint() + " " + f.getName() + " DECOMPILE FAILED"); fail++; }
            }
        }
        println("decompiled " + ok + ", failed " + fail + " -> " + out);
    }
}
