/**
 * Контроль: окно той же сессии, где предложения нет.
 *
 * Без контроля нельзя сказать, находит ли классификатор велосипед или просто
 * всегда его находит. Окно того же размера, те же правила отбора.
 *
 * Запуск: node --experimental-strip-types scripts/control-window.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const STREAM = "bench/stream-carousel.jsonl";

interface Line {
  who: "owner" | "agent" | "agent-wrote" | "agent-proposed";
  text: string;
}

function main(): void {
  const lines = readFileSync(STREAM, "utf8")
    .split("\n")
    .filter((raw) => raw.trim() !== "")
    .map((raw) => JSON.parse(raw) as Line);

  // Окно с той же долей записей, но без единого упоминания случая.
  const size = Number(process.argv[2] ?? 300);
  for (let start = 0; start + size <= lines.length; start += 25) {
    const slice = lines.slice(start, start + size);
    const text = slice.map((line) => line.text).join("\n");
    if (text.includes("RunContext")) continue;
    const agents = slice.filter((line) => line.who === "agent");
    const proposals = slice.filter((line) => line.who === "agent-proposed");
    if (agents.length < 40) continue;

    const out = [
      ...agents.map((line) => line.text),
      ...proposals.map((line) => line.text),
    ].join("\n\n");
    writeFileSync("bench/agent-ctl.txt", out, "utf8");
    console.log(`контрольное окно: записи ${start}–${start + size}`);
    console.log(`  ответов агента ${agents.length}, предложений ${proposals.length}, знаков ${out.length}`);
    return;
  }
  throw new Error("подходящего окна нет");
}

main();
