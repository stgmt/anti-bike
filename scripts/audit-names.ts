/**
 * Сколько раз сводка назвала «вместо готового», а парсер имён это проглотил.
 */
import { readFileSync } from "node:fs";
import { proposedNames } from "../src/judge.ts";

const rows = readFileSync("bench/detect2-journal.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

const NO_SIGNAL = /предложений вместо готового нет|вместо готового нет/i;
let hasSection = 0, realCases = 0, parsedNothing = 0, parsedSomething = 0;
const missed: any[] = [];

for (const r of rows) {
  const s = r.summary ?? "";
  if (s === "") continue;
  const at = s.search(/ВМЕСТО ГОТОВОГО/i);
  if (at < 0) continue;
  hasSection += 1;
  const tail = s.slice(at);
  const end = tail.search(/СОЗДАЛ НОВОЕ/i);
  const section = end > 0 ? tail.slice(0, end) : tail;
  if (NO_SIGNAL.test(section)) continue;
  realCases += 1;
  const names = proposedNames(s);
  if (names.length === 0) { parsedNothing += 1; missed.push({ r, section }); }
  else parsedSomething += 1;
}

console.log(`окон со сводкой: ${rows.filter(r => (r.summary??"") !== "").length}`);
console.log(`  раздел «вместо готового» есть: ${hasSection}`);
console.log(`  в нём названо что-то:          ${realCases}`);
console.log(`  парсер достал имена:           ${parsedSomething}`);
console.log(`  парсер проглотил:              ${parsedNothing}`);
console.log();
for (const { r, section } of missed.slice(0, 6)) {
  console.log(`--- окно ${r.window} вердикт ${r.kind} оценка ${r.score?.toFixed?.(3)} ---`);
  console.log(section.replace(/\s+/g, " ").slice(0, 320));
  console.log();
}
