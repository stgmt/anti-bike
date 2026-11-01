/**
 * Пересуживание сохранённых сводок новым разбором.
 *
 * Сводки уже лежат в журнале: модель не зовём, деньги не тратим. Что меняется:
 * случаи, которые парсер терял, теперь доходят до классификатора.
 *
 * Запуск: node --experimental-strip-types scripts/rejudge.ts
 */
import { readFileSync } from "node:fs";
import { proposedNames } from "../src/judge.ts";
import { findDeclarations, splitByExistence } from "../src/exists.ts";

const rows = readFileSync("bench/detect2-journal.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const roots = ["E:/repos/carousel-demo/carousel"];
let changed = 0;
for (const r of rows) {
  if (!r.summary) continue;
  const before = (r.proposed ?? []).length;
  const after = proposedNames(r.summary);
  if (after.length === before) continue;
  changed += 1;
  const { found } = await findDeclarations(after, { roots });
  const { exists, absent } = splitByExistence(after, found);
  console.log(`окно ${r.window} (${r.file.slice(0, 8)}) было ${r.kind} ${before === 0 ? "имён ноль" : before}`);
  console.log(`  стало имён: ${after.length}`);
  for (const n of after) console.log(`    · ${n.slice(0, 70)}`);
  console.log(`  есть в репо: ${exists.map((e) => `${e.name}@${e.where.split(/[\/]/).pop()}`).join(", ") || "—"}`);
  console.log(`  нет в репо:  ${absent.length} из ${after.length}`);
  console.log();
}
console.log(`окон, где разбор изменился: ${changed}`);
