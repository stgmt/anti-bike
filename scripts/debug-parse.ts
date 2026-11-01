import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { declarationArgs, parseFound } from "../src/exists.ts";

const run = promisify(execFile);
const names = ["FigureVerdicts", "RunContext", "Storyboard", "CardSpec"];
const args = declarationArgs(names, ["E:/repos/carousel-demo/carousel"]);
console.log("аргументы:", args.join(" ").slice(0, 300));
try {
  const { stdout } = await run("rg", args, { maxBuffer: 4 * 1024 * 1024 });
  console.log("--- stdout ---");
  console.log(stdout.slice(0, 800));
  console.log("--- parseFound ---");
  console.log(JSON.stringify(parseFound(stdout, names), null, 2));
} catch (e) {
  console.log("ошибка:", String(e).slice(0, 300));
  console.log("stdout:", ((e as any).stdout ?? "").slice(0, 500));
}
