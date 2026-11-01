/**
 * Что агент говорил о своём probe: его текст, любой блок.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const FILE = "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const stream = createReadStream(FILE, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

let shown = 0;
const kinds = new Map<string, number>();
for await (const line of lines) {
  if (!line.includes("EffortProbe")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  kinds.set(rec.type, (kinds.get(rec.type) ?? 0) + 1);
  const content = rec.message?.content;
  if (rec.type !== "assistant" || !Array.isArray(content)) continue;
  for (const b of content) {
    if (b?.type !== "text" || typeof b.text !== "string") continue;
    shown += 1;
    console.log(`\n--- ответ ${shown} ---`);
    console.log(b.text.replace(/\s+/g, " ").slice(0, 600));
    if (shown >= 5) { console.log("\nтипы записей с этим именем:", [...kinds]); process.exit(0); }
  }
}
console.log("типы записей:", [...kinds]);
