/**
 * Опыт: различает ли классификатор предложение, признание ошибки и выбор автора.
 *
 * Одна строка «RunContext» встречается в трёх разных ролях. Если классификатор
 * ставит высокую оценку всем трём, он ловит слово, а не решение. Автор про это
 * и говорил: «стоп хуке не видно будет что это не решения владельца в решения
 * агента».
 *
 * Запуск: node --experimental-strip-types scripts/classify-probe.ts
 */

import { readFileSync } from "node:fs";

import { classify } from "../src/classify.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

const READY = `Что уже есть в проекте carousel-demo:

- langgraph 1.2.12:
  * StateGraph(state_schema, context_schema=…) — context_schema задаёт схему неизменных
    зависимостей; узел получает их через Runtime[Context].
  * Runtime — содержит context, store, stream_writer, previous; подставляется в узел сам,
    если в подписи узла названо runtime.
  * AsyncSqliteSaver — чекпоинты в SQLite.
  * Command — возвращает переход и обновление состояния; goto=[Send(...)] для веера.
  * interrupt — остановка прогона и продолжение после ответа человека.
- pydantic 2.13.5: BaseModel, Field, model_validator, TypeAdapter.
- В самом проекте уже есть: порты typing.Protocol в carousel/ports.py; Pydantic-схема на
  каждый контракт в carousel/schemas.py; шаг calls/ с кешем платных вызовов; бюджет прогона.`;

interface Case {
  name: string;
  expect: "bike" | "clean";
  text: string;
}

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

/** Достать из окна нужные реплики по подписи. */
function line(windowText: string, startsWith: string, contains: string): string {
  for (const block of windowText.split("\n\n")) {
    const head = block.split("\n")[0] ?? "";
    if (!head.startsWith(startsWith)) continue;
    if (contains && !block.includes(contains)) continue;
    return block;
  }
  return "";
}

async function main(): Promise<void> {
  const windowText = readFileSync("bench/case-positive.txt", "utf8");
  const key = apiKey();

  const proposal = line(windowText, "[agent-proposed]", "RunContext");
  const admission = line(windowText, "[agent]", "RunContext");
  const ownerChoice = line(windowText, "[owner]", "делай");
  const clean = line(windowText, "[owner]", "комить");

  const cases: Case[] = [
    { name: "предложение агента (RunContext)", expect: "bike", text: proposal },
    { name: "признание ошибки агентом", expect: "clean", text: admission },
    { name: "выбор автора «делай»", expect: "clean", text: ownerChoice },
    { name: "реплика автора про чистку", expect: "clean", text: clean },
  ];

  console.log("Отдельные реплики, исходный текст\n");
  for (const item of cases) {
    if (item.text.trim() === "") {
      console.log(`  ${item.name.padEnd(34)} (не найдена в окне)`);
      continue;
    }
    const verdict = await classify(item.text, READY, { apiKey: key });
    const mark = (verdict.bike ? "bike" : "clean") === item.expect ? "верно" : "ОШИБКА";
    console.log(
      `  ${item.name.padEnd(34)} ${verdict.score.toFixed(3)} → ${verdict.bike ? "велосипед" : "чисто"} `
      + `(ждём ${item.expect}) ${mark}  ${verdict.ms} мс $${verdict.cost.toFixed(6)}`,
    );
  }

  // То же по сводкам: сохраняет ли сводка различие ролей.
  const summaries: { name: string; path: string }[] = [
    { name: "сводка scaledown (с RunContext)", path: "bench/sum-scaledown.txt" },
    { name: "сводка ling (без RunContext)", path: "bench/sum-ling.txt" },
  ];
  console.log("\nСводки целого окна\n");
  for (const item of summaries) {
    let text = "";
    try {
      text = readFileSync(item.path, "utf8");
    } catch {
      continue;
    }
    const verdict = await classify(text, READY, { apiKey: key });
    console.log(
      `  ${item.name.padEnd(34)} ${verdict.score.toFixed(3)} → ${verdict.bike ? "велосипед" : "чисто"}  `
      + `${verdict.ms} мс $${verdict.cost.toFixed(6)}`,
    );
  }
}

await main();
