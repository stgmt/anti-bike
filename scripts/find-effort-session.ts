/**
 * Где в транскриптах шла работа про effort: тот самый случай.
 *
 * Ищем не слово «велосипед», а имена, которые агент построил. По ним видно
 * сессию, и уже в ней — что агент говорил словами.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { readdir } from "node:fs/promises";

const ROOTS = [
  "C:/Users/stigm/.claude/projects/E--repos-tokenplan",
  "C:/Users/stigm/.claude/projects/E--repos-agent-teams-ai",
];
const NAMES = ["createAnthropicEffortProbe", "recordAnthropicEffortOutcome", "probeAnthropicEffort", "effortProbes"];

for (const DIR of ROOTS) {
  for (const file of (await readdir(DIR)).filter((n) => n.endsWith(".jsonl"))) {
    let hits = 0;
    const texts: string[] = [];
    const stream = createReadStream(`${DIR}/${file}`, { encoding: "utf8" });
    const lines = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (!line.includes("EffortProbe") && !line.includes("recordAnthropicEffortOutcome")) continue;
      hits += 1;
      let rec: any;
      try { rec = JSON.parse(line); } catch { continue; }
      const content = rec.message?.content;
      if (rec.type === "assistant" && Array.isArray(content)) {
        for (const b of content) {
          if (b?.type === "text" && typeof b.text === "string" && texts.length < 4) {
            texts.push(b.text.replace(/\s+/g, " ").slice(0, 400));
          }
        }
      }
    }
    if (hits > 0) {
      console.log(`\n=== ${DIR.split("/").pop()}/${file.slice(0, 8)}: ${hits} записей ===`);
      for (const t of texts) console.log(`  · ${t}`);
    }
  }
}
