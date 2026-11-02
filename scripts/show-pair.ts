/**
 * Показывает обе стороны пары: что окно написало и что уже было готово.
 * Нужно для проверки находки глазами, а не по числу.
 */
import { readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { functionsIn } from "../src/bodies.ts";

const transcript = process.argv[2]!;
const ownName = process.argv[3]!;
const readyFile = process.argv[4]!;
const readyName = process.argv[5]!;

const lines = createInterface({ input: createReadStream(transcript, { encoding: "utf8" }), crlfDelay: Infinity });
const found: { name: string; body: string; source: string; via: string }[] = [];
for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try {
    rec = JSON.parse(line);
  } catch {
    continue;
  }
  const c = rec.message?.content;
  if (!Array.isArray(c)) continue;
  for (const b of c) {
    if (b?.type !== "tool_use") continue;
    if (b.name !== "Write" && b.name !== "Edit") continue;
    const p = String(b.input?.file_path ?? "").split("\\").join("/");
    const body = typeof b.input?.content === "string" ? b.input.content : typeof b.input?.new_string === "string" ? b.input.new_string : "";
    if (!body) continue;
    for (const fn of functionsIn(body, p)) found.push({ ...fn, via: b.name });
  }
}

const own = found.filter((f) => f.name === ownName).sort((a, b) => b.body.length - a.body.length)[0];
console.log(`СВОЁ ${ownName} — ${own?.source} (${own?.via})`);
console.log(own ? own.body.slice(0, 1400) : "не найдено");

console.log(`\nГОТОВОЕ ${readyName} — ${readyFile}`);
const ready = functionsIn(readFileSync(readyFile, "utf8"), readyFile).find((f) => f.name === readyName);
console.log(ready ? ready.body.slice(0, 1400) : "не найдено");
