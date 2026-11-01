/**
 * Классификатор по трём наборам «только агент»: что теряется без вызовов.
 *
 * Автор сказал брать в сводку ответы агента без рассуждений, без системных
 * промптов и без выборов пользователя. Здесь видно цену каждого отсечения.
 *
 * Запуск: node --experimental-strip-types scripts/agent-only-classify.ts
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

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

async function main(): Promise<void> {
  const key = apiKey();
  const sets: [string, string][] = [
    ["только текст агента", "bench/agent-text.txt"],
    ["текст + название вызова", "bench/agent-names.txt"],
    ["текст + параметры вызова", "bench/agent-args.txt"],
  ];

  console.log("Вход: только ответы агента, без рассуждений, промптов и реплик автора\n");
  for (const [name, path] of sets) {
    const text = readFileSync(path, "utf8");
    const verdict = await classify(text, READY, { apiKey: key });
    const found = text.includes("RunContext");
    console.log(
      `${name.padEnd(26)} ${String(text.length).padStart(6)} зн.  `
      + `${verdict.score.toFixed(3)} → ${verdict.bike ? "велосипед" : "чисто"}  `
      + `RunContext в тексте: ${found ? "есть" : "нет"}  ${verdict.ms} мс $${verdict.cost.toFixed(5)}`,
    );
  }
}

await main();
