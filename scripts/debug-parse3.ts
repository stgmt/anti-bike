import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { declarationArgs, parseFound, nameIn, declaredKind } from "../src/exists.ts";
const run = promisify(execFile);
const names = ["FigureVerdicts", "RunContext", "Storyboard", "CardSpec"];
const args = declarationArgs(names, ["E:/repos/carousel-demo/carousel"]);
const { stdout } = await run("rg", args, { maxBuffer: 4 * 1024 * 1024 });
const first = stdout.split("\n").filter(Boolean);
for (const line of first) {
  const m = /^(.*?):(\d+):(.*)$/.exec(line);
  console.log("line:", JSON.stringify(line.slice(0, 100)));
  console.log("  match:", m ? "да" : "НЕТ");
  if (m) {
    const head = m[3].trimStart();
    console.log("  head:", JSON.stringify(head), "nameIn:", nameIn(head));
    console.log("  kind дубль:", declaredKind(head, names));
  }
}
console.log("parseFound:", parseFound(stdout, names).length);
