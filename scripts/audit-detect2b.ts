/** Что было в окнах 53 и 55 и в первом прогоне. */
import { readFileSync } from "node:fs";

for (const [name, kind] of [["bench/detect2-journal.jsonl","после правок"],["bench/detect-journal.jsonl","первый прогон"]]) {
  let rows: any[] = [];
  try { rows = readFileSync(name, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { continue; }
  console.log(`\n===== ${kind} (${rows.length} окон) =====`);
  console.log(`  названо «вместо готового»: ${rows.filter(r => (r.proposed??[]).length).length}`);
  console.log(`  проверка нашла в репо:    ${rows.filter(r => (r.exists??[]).length).length}`);
  for (const r of rows.filter(r => r.kind === "bike")) {
    console.log(`\n  окно ${r.window} (${r.file.slice(0,8)}) оценка ${Number(r.score).toFixed(3)}`);
    console.log(`    названо: ${(r.proposed??[]).join(", ")||"—"}   нет: ${(r.absent??[]).join(", ")||"—"}`);
    const s = (r.summary ?? "").split("СОЗДАЛ НОВОЕ")[0].replace(/\s+/g," ").trim();
    console.log(`    сводка: ${s.slice(0, 260)}`);
  }
}
