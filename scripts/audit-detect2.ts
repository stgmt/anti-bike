/**
 * Аудит прошлого прогона: держались ли вердикты на сломанной проверке.
 *
 * Вопрос автора: считать ли набор 4 из 4 настоящей выборкой, если проверка
 * существования разбирала только последнюю строку ответа ripgrep.
 */
import { readFileSync } from "node:fs";

const rows = readFileSync("bench/detect2-journal.jsonl", "utf8")
  .split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l));

const bikes = rows.filter((r) => r.kind === "bike");
const withExists = rows.filter((r) => (r.exists ?? []).length > 0);
const withProposed = rows.filter((r) => (r.proposed ?? []).length > 0);

console.log(`окон в журнале: ${rows.length}`);
console.log(`  с названным «вместо готового»: ${withProposed.length}`);
console.log(`  где проверка что-то нашла:    ${withExists.length}`);
console.log(`  велосипедов:                  ${bikes.length}`);
console.log();
for (const b of bikes) {
  console.log(`--- ${b.file.slice(0, 8)} окно ${b.window}  оценка ${b.score} ---`);
  console.log(`  названо: ${(b.proposed ?? []).join(", ") || "—"}`);
  console.log(`  уже есть: ${(b.exists ?? []).join(", ") || "—"}`);
  console.log(`  нет:     ${(b.absent ?? []).join(", ") || "—"}`);
}
