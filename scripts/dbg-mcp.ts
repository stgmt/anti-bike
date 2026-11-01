import { JscpdMcp } from "../src/mcp.ts";
import { readFile } from "node:fs/promises";

const c = new JscpdMcp("E:/repos/anti-bike/test/fixtures/bike-repo/src");
const code = await readFile("E:/repos/anti-bike/test/fixtures/bike-repo/src/agent_wrote.py", "utf8");

console.log("старт...");
const t0 = performance.now();
await c.start();
console.log("старт:", Math.round(performance.now() - t0), "мс");

const t1 = performance.now();
const a = await c.check(code, "python");
console.log("check:", Math.round(performance.now() - t1), "мс, клонов:", a.count);
c.close();
console.log("закрыт");
process.exit(0);
