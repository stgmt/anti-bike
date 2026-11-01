/**
 * Разбор чернового прогона: распределение оценок и выборка для чтения глазами.
 *
 * Черновая разметка — не эталон. Она отвечает на другой вопрос: сколько ходов
 * гейт трогает и похожи ли заблокированные на велосипед.
 */

import { readFile } from "node:fs/promises";

interface Row {
  id: string;
  project: string;
  file?: string;
  bytes?: number;
  prerun: { verdict: string; score?: number; clones?: number; reason?: string; error?: string };
}

async function main(): Promise<void> {
  const [path, turnsPath] = process.argv.slice(2);
  if (!path) {
    console.error("нужно: scripts/analyze-prerun.ts <prerun.jsonl> [ходы.json]");
    process.exit(2);
  }
  const rows = (await readFile(path, "utf8"))
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as Row);

  const byVerdict = new Map<string, number>();
  const scores: number[] = [];
  for (const row of rows) {
    byVerdict.set(row.prerun.verdict, (byVerdict.get(row.prerun.verdict) ?? 0) + 1);
    if (typeof row.prerun.score === "number") scores.push(row.prerun.score);
  }
  scores.sort((left, right) => left - right);

  console.log(`строк: ${rows.length}`);
  for (const [verdict, count] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${verdict.padEnd(8)} ${count}`);
  }
  if (scores.length > 0) {
    const at = (share: number): number => scores[Math.min(scores.length - 1, Math.floor(share * scores.length))];
    console.log(`\nоценка модели (${scores.length} измеренных):`);
    console.log(`  10-й перцентиль ${at(0.1).toFixed(3)}`);
    console.log(`  медиана         ${at(0.5).toFixed(3)}`);
    console.log(`  90-й перцентиль ${at(0.9).toFixed(3)}`);
    console.log(`  максимум        ${scores[scores.length - 1].toFixed(3)}`);
    for (const threshold of [0.3, 0.5, 0.7]) {
      console.log(`  выше ${threshold}: ${scores.filter((score) => score >= threshold).length}`);
    }
  }

  const scored = rows.filter((row) => typeof row.prerun.score === "number");
  const top = [...scored].sort((left, right) => (right.prerun.score ?? 0) - (left.prerun.score ?? 0)).slice(0, 15);

  // Показываем текст хода, если передан набор: без него выборку не прочитать.
  let texts = new Map<string, { message: string; written: string; edited: string }>();
  if (turnsPath) {
    const turns = JSON.parse(await readFile(turnsPath, "utf8")) as {
      id: string; message: string; written: string; edited: string;
    }[];
    texts = new Map(turns.map((turn) => [turn.id, turn]));
  }

  console.log("\nсамые высокие оценки:");
  for (const row of top) {
    console.log(`\n[${row.id}] ${row.prerun.score} клонов=${row.prerun.clones} ${row.file ?? ""}`);
    const turn = texts.get(row.id);
    if (turn) {
      console.log(`  текст: ${turn.message.replace(/\s+/g, " ").slice(0, 200) || "(пусто)"}`);
      const code = turn.written || turn.edited;
      console.log(`  код:   ${code.replace(/\s+/g, " ").slice(0, 200)}`);
    }
  }
}

await main();
