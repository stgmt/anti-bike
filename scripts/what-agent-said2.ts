/** Где именно имя: в тексте, в вызове или во вложении. */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const FILE = "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const stream = createReadStream(FILE, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

for await (const line of lines) {
  if (!line.includes("EffortProbe")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message?.content;
  if (rec.type !== "assistant" || !Array.isArray(content)) continue;
  for (const b of content) {
    const where = b?.type ?? "?";
    const text = typeof b?.text === "string" ? b.text : JSON.stringify(b?.input ?? "").slice(0, 400);
    console.log(`[${where}] ${String(text).replace(/\s+/g, " ").slice(0, 320)}`);
  }
}
