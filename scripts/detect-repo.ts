/**
 * Детектор без модели: структурные клоны окна против готового репозитория.
 *
 * node --experimental-strip-types scripts/detect-repo.ts <транскрипт> <репозиторий> [корни,через,запятую] [расширения]
 */
import { readFileSync, readdirSync } from "node:fs";
import { corpus, countUses, detectBikes, ownFunctions, readyFunctions, relativeTo } from "../src/detect.ts";

const transcript = process.argv[2]!;
const repo = process.argv[3]!;
const roots = process.argv[4] ? process.argv[4].split(",") : ["src"];
const exts = process.argv[5] ? process.argv[5].split(",") : ["ts", "tsx", "js", "mjs", "cjs"];
const started = Date.now();

const filter = new RegExp(`/src/.*\\.(?:${exts.join("|")})$|/internal/.*\\.js$`);
const window = await ownFunctions(transcript, filter);
const written = new Set(window.map((w) => relativeTo(w.fn.source, repo)));
const ready = readyFunctions(repo, written, roots, exts);

const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor"]);
const texts: string[] = [];
const walk = (dir: string, d: number): void => {
  if (d > 7) return;
  let entries;
  try {
    entries = readdirSync(`${repo}/${dir}`, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(rel, d + 1);
      continue;
    }
    if (!exts.some((x) => e.name.endsWith(`.${x}`)) || /\.(test|spec|d)\./.test(e.name)) continue;
    try {
      texts.push(readFileSync(`${repo}/${rel}`, "utf8"));
    } catch {}
  }
};
for (const r of roots) walk(r, 0);

const uses = countUses(texts);
const result = detectBikes(window, corpus(ready), { uses });
console.log(`своих ${window.length}, готовых ${ready.length}, ${((Date.now() - started) / 1000).toFixed(1)} с`);
console.log(`форма ≥0.5: ${result.verdicts.length}`);
for (const v of result.verdicts.slice(0, 15)) {
  console.log(
    `  ${v.shape.toFixed(3)} предм ${v.topic.toFixed(2)}  готовое ${String(v.readyUses).padStart(3)}×  своё ${String(v.ownUses).padStart(3)}×  ${v.own.padEnd(28)} → ${v.ready}`,
  );
}
const rule = result.verdicts.filter((v) => v.readyUses >= 3 && v.ownUses === 0);
console.log(`\nпо правилу «готовое зовётся, своё нет»: ${rule.length}`);
for (const v of rule) console.log(`  ${v.shape.toFixed(3)}  ${v.own.padEnd(28)} → ${v.ready} (готовое ${v.readyUses}×)`);
