import { proposedNames } from "../src/judge.ts";
const CASES: [string, string][] = [
  ["55", "ВМЕСТО ГОТОВОГО — главное «Проводка через замыкания и общий контейнер зависимостей — вместо `Runtime` из SDK, который не передаёт неизменные зависимости в узлы без замыкания».\n\nСОЗДАЛ НОВОЕ\nx"],
  ["45", "ВМЕСТО ГОТОВОГО** самописная отправка запросов — вместо OpenAI SDK, который формирует запросы.\n\nСОЗДАЛ НОВОЕ\nx"],
  ["10", "ВМЕСТО ГОТОВОГО — главное.** Отдельный шаг отбора фактов по решениям читателя — вместо текущего графа.\n\nСОЗДАЛ НОВОЕ\nx"],
];
for (const [label, text] of CASES) {
  const at = text.indexOf("ВМЕСТО ГОТОВОГО");
  const section = text.slice(at, text.indexOf("СОЗДАЛ НОВОЕ", at));
  console.log(`--- ${label} ---`);
  for (const rawLine of section.split("\n")) {
    const line = rawLine.replace(/^[\s*`«»"]+|[\s*`«»"]+$/g, "").trim();
    console.log(`  line=${JSON.stringify(line.slice(0,90))}`);
    console.log(`    /^ВМЕСТО ГОТОВОГО/i → ${/^ВМЕСТО ГОТОВОГО/i.test(line)}`);
    console.log(`    вместо split → ${line.search(/вместо|замен|обход/i)}`);
  }
  console.log(`  итог: ${JSON.stringify(proposedNames(text))}\n`);
}
