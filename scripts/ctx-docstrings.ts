/**
 * Проверка гипотезы: дело не в составе списка, а в том, что он называет механизмы,
 * не описывая их. `context_schema` — параметр `StateGraph`, а не имя импорта.
 */

import { readFile } from "node:fs/promises";

import { classify } from "../src/classify.ts";

interface Turn {
  id: string;
  message: string;
}

const turns = JSON.parse(
  await readFile("E:/repos/anti-bike/test/fixtures/turns.json", "utf8"),
) as Turn[];
const BIKE = turns.find((turn) => turn.id === "[20252]")?.message ?? "";

const NAMES = `Что проект уже берёт из установленных библиотек:
- langgraph 1.2.12: AsyncSqliteSaver, StateGraph, Command, RetryPolicy, interrupt
- langchain 1.4.2: create_agent, ToolStrategy
- pydantic 2.13.5: BaseModel, Field, model_validator`;

const WITH_DOCS = `Что проект уже берёт из установленных библиотек, с описанием:
- langgraph 1.2.12:
  * StateGraph — граф состояний; принимает state_schema и context_schema, второй —
    схема неизменных зависимостей, которые узел получает через Runtime[Context].
  * Runtime — содержит context, store, stream_writer; подставляется в узел сам.
  * AsyncSqliteSaver — чекпоинты в SQLite, продолжение и перемотка на шаг.
  * Command — возвращает переход и обновление состояния; goto=[Send(...)] для веера.
  * interrupt — остановка прогона и продолжение после ответа человека.
- langchain 1.4.2:
  * ToolStrategy — ответ агента схемой через инструмент.
- pydantic 2.13.5: BaseModel — схема с проверкой, model_validator — проверка на объекте`;

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OPENROUTER_API_KEY");
  if (BIKE === "") throw new Error("фикстура не найдена");

  console.log(`ход [20252]: ${BIKE.slice(0, 70)}…\n`);
  let spend = 0;
  for (const [name, context] of Object.entries({
    "A только имена": NAMES,
    "B имена с описанием": WITH_DOCS,
  })) {
    const verdict = await classify(BIKE, context, { apiKey: key });
    spend += verdict.cost;
    console.log(
      `${name.padEnd(22)} ${String(context.length).padStart(5)} симв  `
      + `score=${verdict.score.toFixed(3)}  ${verdict.bike ? "БЛОК" : "пропуск"}`,
    );
  }
  console.log(`\nстоимость: $${spend.toFixed(6)}`);
}

await main();
