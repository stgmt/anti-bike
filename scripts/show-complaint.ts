/** Реплики владельца про велосипед в tokenplan: что именно сказано. */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const dir = "C:/Users/stigm/.claude/projects/E--repos-tokenplan";
for (const file of (await readdir(dir)).filter((n) => n.endsWith(".jsonl"))) {
  const raw = await readFile(join(dir, file), "utf8");
  if (!/велосипед/.test(raw)) continue;
  for (const line of raw.split("\n")) {
    if (!/велосипед/i.test(line)) continue;
    let r: any;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.isMeta || r.isCompactSummary) continue;
    const role = r.message?.role ?? r.type;
    if (role !== "user") continue;
    const c = r.message?.content;
    const text = typeof c === "string" ? c : "";
    if (!text.includes("велосипед")) continue;
    console.log(`--- ${file.slice(0, 8)} ---`);
    console.log(text.replace(/\s+/g, " ").slice(0, 900));
    console.log();
  }
}
