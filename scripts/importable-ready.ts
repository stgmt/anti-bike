/**
 * Отбор пар, где готовое можно было импортировать.
 *
 * Тонкая обёртка: разбор и признак живут в `src/importable.ts`, чтобы их
 * проверял тест. Здесь только чтение отчёта jscpd и печать.
 *
 * Запуск:
 *   node --experimental-strip-types scripts/importable-ready.ts \
 *     <отчёт jscpd> <корень репо> <папка прогона от корня>
 */
import { readFileSync } from "node:fs";

import { importableReady } from "../src/importable.ts";
import type { Clone } from "../src/importable.ts";

const [, , REPORT, REPO, BASE] = process.argv;
if (!REPORT || !REPO || !BASE) {
  console.error("нужен отчёт jscpd, корень репозитория и папка прогона");
  process.exit(2);
}

const report = JSON.parse(readFileSync(REPORT, "utf8")) as { duplicates?: Clone[] };
const rows = importableReady(report, REPO, BASE);
const cheap = rows.filter((r) => r.importable).sort((x, y) => y.lines - x.lines);

console.log(`межфайловых пар с датами: ${rows.length}`);
console.log(`готовое лежит в объявлении: ${cheap.length}`);
for (const r of cheap) {
  console.log(`  ${String(r.lines).padStart(3)} стр  ${r.ready}:${r.readyLine}  [${r.where}]`);
  console.log(`            копия: ${r.copy}:${r.copyLine}`);
}
