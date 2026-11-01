/**
 * Что войдёт в сводку, если брать только ответы агента.
 *
 * Автор сказал: сводка из ответов агента, без рассуждений, без системных
 * промптов и без реплик и выборов пользователя. Здесь проверяется, не теряется
 * ли сам случай: он родился в вызове AskUserQuestion, а не в тексте.
 *
 * Наборы строятся из JSONL-выгрузки потока и входят в окно вокруг случая.
 *
 * Запуск: node --experimental-strip-types scripts/agent-only.ts
 */

import { readFileSync, writeFileSync } from "node:fs";

const STREAM = "bench/stream-carousel.jsonl";
const WINDOW_CHARS = 60_000;

interface Line {
  who: "owner" | "agent" | "agent-wrote" | "agent-proposed";
  text: string;
}

function load(): Line[] {
  return readFileSync(STREAM, "utf8")
    .split("\n")
    .filter((raw) => raw.trim() !== "")
    .map((raw) => JSON.parse(raw) as Line);
}

/** Окно вокруг первого упоминания случая у агента. */
function window(lines: Line[]): Line[] {
  const at = lines.findIndex((line) => line.who !== "owner" && line.text.includes("RunContext"));
  if (at < 0) throw new Error("случая нет в потоке");
  let chars = 0;
  let start = at;
  while (start > 0 && chars < WINDOW_CHARS / 3) {
    start -= 1;
    chars += lines[start].text.length;
  }
  let end = at;
  chars = 0;
  while (end < lines.length && chars < WINDOW_CHARS) {
    end += 1;
    chars += lines[end]?.text.length ?? 0;
  }
  return lines.slice(start, end);
}

function main(): void {
  const lines = load();
  const slice = window(lines);
  const counts = new Map<string, number>();
  for (const line of slice) counts.set(line.who, (counts.get(line.who) ?? 0) + 1);
  console.log(`окно: ${slice.length} записей`);
  for (const [who, count] of counts) console.log(`  ${who.padEnd(16)} ${count}`);

  const agentOnly = slice.filter((line) => line.who === "agent").map((line) => line.text);
  const withProposalNames = [
    ...agentOnly,
    ...slice.filter((line) => line.who === "agent-proposed").map((line) => `Вызов ${line.text.slice(0, 40)}`),
  ];
  const withProposalArgs = [
    ...agentOnly,
    ...slice.filter((line) => line.who === "agent-proposed").map((line) => line.text),
  ];

  const sets: [string, string[]][] = [
    ["только текст агента", agentOnly],
    ["текст + вызов агента", withProposalNames],
    ["текст + параметры вызова", withProposalArgs],
  ];
  console.log();
  for (const [name, parts] of sets) {
    const text = parts.join("\n\n");
    const hits = (text.match(/RunContext/g) ?? []).length;
    const proposes = /предлож|ввести|введ/i.test(text);
    const file = `bench/agent-${name === "только текст агента" ? "text" : name.includes("параметры") ? "args" : "names"}.txt`;
    writeFileSync(file, text, "utf8");
    console.log(
      `${name.padEnd(24)} ${String(text.length).padStart(6)} зн.  `
      + `RunContext: ${hits}, слово «предложить»: ${proposes ? "да" : "нет"}  → ${file}`,
    );
  }
}

main();
