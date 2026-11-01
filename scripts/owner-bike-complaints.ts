/**
 * Все претензии владельца про велосипеды, по всем проектам.
 *
 * Это грунт истины: что автор сам назвал велосипедом. Машинные признаки
 * только помогают искать, но подтверждает владелец.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "C:/Users/stigm/.claude/projects";
const BIKE = /велосипед|костыл|самописн|заново изобр|изобрет/i;

const out: Record<string, { project: string; file: string; texts: string[] }> = {};
for (const project of await readdir(ROOT)) {
  let files: string[];
  try { files = (await readdir(join(ROOT, project))).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
  for (const file of files) {
    let raw: string;
    try { raw = await readFile(join(ROOT, project, file), "utf8"); } catch { continue; }
    if (!BIKE.test(raw)) continue;
    for (const line of raw.split("\n")) {
      if (!BIKE.test(line)) continue;
      let rec: any;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec.type !== "user" || rec.isMeta || rec.isCompactSummary) continue;
      const c = rec.message?.content;
      const text = typeof c === "string" ? c : "";
      if (!BIKE.test(text)) continue;
      const key = `${project}/${file.slice(0, 8)}`;
      out[key] ??= { project, file, texts: [] };
      if (!out[key].texts.includes(text)) out[key].texts.push(text);
    }
  }
}

let total = 0;
for (const [key, v] of Object.entries(out)) {
  total += v.texts.length;
  console.log(`\n### ${key}  (${v.texts.length})`);
  for (const t of v.texts.slice(0, 4)) {
    const clean = t.replace(/\s+/g, " ").trim();
    console.log(`  · ${clean.slice(0, 260)}`);
  }
}
console.log(`\nсессий с претензией: ${Object.keys(out).length}, реплик: ${total}`);
