/**
 * Окно вокруг настоящего случая, а не первые N КБ.
 *
 * Прошлая выборка взяла начало файла, где случая нет вовсе: 34 вхождения
 * RunContext начинаются с 1061 КБ. Так мерить нечего — сводка не могла
 * сохранить то, чего не видела.
 *
 * Здесь: окно вокруг известного случая (позитив) и такое же окно из конца
 * сессии, где случая нет (контроль на ложные срабатывания).
 *
 * Запуск: node --experimental-strip-types scripts/sample-window.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "bench/stream-carousel.txt";
/** Начало первого скопления вхождений RunContext, знаков. */
const CASE_AT = 1061 * 1024;
const WINDOW = 60_000;

function main(): void {
  const stream = readFileSync(SOURCE, "utf8");
  const hits: number[] = [];
  let at = -1;
  while ((at = stream.indexOf("RunContext", at + 1)) !== -1) hits.push(at);
  if (hits.length === 0) throw new Error("случая нет в потоке");

  // Окно с запасом до и после случая, выровненное по границе сообщения.
  const start = Math.max(0, hits[0] - Math.floor(WINDOW / 3));
  const end = Math.min(stream.length, start + WINDOW);
  let from = stream.lastIndexOf("\n\n[", start);
  if (from < 0 || from < start - 3000) from = start;
  const positive = stream.slice(from, end);

  // Контроль: кусок той же сессии, где вхождений нет.
  const controlStart = 2_400_000;
  let controlFrom = stream.lastIndexOf("\n\n[", controlStart);
  if (controlFrom < 0) controlFrom = controlStart;
  const control = stream.slice(controlFrom, controlFrom + WINDOW);

  writeFileSync("bench/case-positive.txt", positive, "utf8");
  writeFileSync("bench/case-control.txt", control, "utf8");

  const count = (text: string): number => (text.match(/RunContext/g) ?? []).length;
  console.log(`случай в потоке: ${hits.length} вхождений, первое на ${(hits[0] / 1024).toFixed(0)} КБ`);
  console.log(`позитив: ${(positive.length / 1024).toFixed(0)} КБ, вхождений ${count(positive)}`);
  console.log(`контроль: ${(control.length / 1024).toFixed(0)} КБ, вхождений ${count(control)}`);

  // Показать, что именно в окне: кто говорит и о чём.
  for (const line of positive.split("\n")) {
    if (!line.startsWith("[")) continue;
    if (!line.includes("RunContext") && !line.startsWith("[owner]")) continue;
    console.log(`  ${line.replace(/\s+/g, " ").slice(0, 190)}`);
  }
}

main();
