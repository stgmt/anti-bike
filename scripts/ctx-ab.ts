/**
 * Сравнение трёх видов списка готового на одном и том же ходе.
 *
 * Вопрос: почему настоящий список репозитория дал 0,077 там, где рукописный
 * список механизмов дал 0,97. Гипотеза — дело в составе списка, не в модели.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { classify } from "../src/classify.ts";
import { buildReadyContext } from "../src/context.ts";
import { detectIntent } from "../src/intent.ts";

const REPO = "E:/repos/carousel-demo";
const CASES = join(import.meta.dirname, "..", "test", "fixtures", "turns.json");

interface Turn {
  id: string;
  label: string;
  message: string;
  code: string;
}

/** Список механизмов: то, что проект реально использует, с названиями. */
const MECHANISMS = `Что уже есть в проекте и в установленных библиотеках:
- langgraph 1.2.12: StateGraph(state_schema, context_schema=Context), Runtime[Context] в узле —
  штатная передача неизменных зависимостей в узлы графа.
- langgraph: AsyncSqliteSaver + durability="sync" — чекпоинты, продолжение, перемотка на шаг.
- langgraph: Command(goto=[Send(...)]) — переделать только затронутые карточки.
- langgraph: interrupt — остановка прогона и продолжение после ответа.
- deepagents 0.7.19: агент с ToolStrategy отвечает схемой.
- В проекте: порты typing.Protocol на внешний мир, Pydantic-схема на каждый контракт,
  общий шаг calls/ для платных вызовов с кешем по хешу входа.`;

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("нет OPENROUTER_API_KEY");

  const turns = JSON.parse(await readFile(CASES, "utf8")) as Turn[];
  const picked = turns.filter((turn) => ["[20252]", "[20497]", "[code]"].includes(turn.id));
  const ready = await buildReadyContext(join(REPO, "carousel"), join(REPO, "uv.lock"));

  // Третий вариант: модули пакета с их назначением, но без чужих библиотек.
  const modulesOnly = ready.markdown.split("\nУстановленные библиотеки:")[0];

  const variants: Record<string, string> = {
    "1 механизмы с названиями": MECHANISMS,
    "2 модули проекта, 40 шт": modulesOnly,
    "3 модули + библиотеки": ready.markdown,
    "4 без списка": "",
  };

  let spend = 0;
  for (const [name, context] of Object.entries(variants)) {
    console.log(`\n=== ${name} (${context.length} символов) ===`);
    for (const turn of picked) {
      const intent = detectIntent(turn.message);
      if (!intent.promise) {
        console.log(`  ${turn.id.padEnd(9)} ${turn.label.padEnd(14)} отсечён ступенью 1`);
        continue;
      }
      const verdict = await classify(turn.message, context, { apiKey: key });
      spend += verdict.cost;
      const mark = verdict.bike ? "БЛОК" : "    ";
      console.log(`  ${turn.id.padEnd(9)} ${turn.label.padEnd(14)} ${mark} ${verdict.score.toFixed(3)}`);
    }
  }
  console.log(`\nстоимость: $${spend.toFixed(6)}`);
}

await main();
