import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { declarationsIn, callsIn } from "../src/astgraph.ts";
const run = promisify(execFile);
for (const repo of ["E:/repos/tokenplan", "E:/repos/carousel-demo", "E:/repos/agent-teams-ai"]) {
  try {
    const { stdout } = await run("rg", ["-n","--no-heading","-g","*.ts","-g","*.tsx","-g","!*test*","-g","!node_modules",".","src"],
      { cwd: repo, maxBuffer: 64*1024*1024, timeout: 30000 });
    const calls = callsIn(stdout);
    const decls = declarationsIn(stdout, repo);
    const both = decls.filter(d => calls.has(d.name));
    console.log(`${repo}: ответ ${stdout.length}, объявлений ${decls.length}, вызовов ${calls.size}, объявлено+зовётся ${both.length}`);
  } catch (e) {
    console.log(`${repo}: ОШИБКА ${String(e).slice(0,80)}`);
  }
}
