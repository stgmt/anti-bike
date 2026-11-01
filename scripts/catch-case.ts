/**
 * Ловит ли конвейер известный случай в настоящем потоке.
 *
 * Случай RunContext — единственный велосипед, в котором автор уверен. Он живёт
 * в транскрипте 5991cc66. Здесь окно с ним прогоняется целиком тем же путём,
 * что и гейт: окно → сводка → классификатор.
 *
 * Запуск: node --experimental-strip-types scripts/catch-case.ts
 */

import { readFileSync } from "node:fs";

import { classify } from "../src/classify.ts";
import { summarize } from "../src/summarize.ts";
import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const TRANSCRIPT =
  "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/5991cc66-3b95-43fa-a8ce-5122dd0292c7.jsonl";

const READY = `Что уже есть в проекте carousel-demo и его библиотеках:

- langgraph 1.2.12: StateGraph(state_schema, context_schema=…) — context_schema задаёт схему
  неизменных зависимостей; узел получает их через Runtime[Context]. Runtime содержит context,
  store, stream_writer, previous и подставляется в узел сам, если в подписи назван runtime.
  AsyncSqliteSaver — чекпоинты в SQLite. Command — переход и обновление состояния.
  interrupt — остановка и продолжение после ответа человека. retrypolicy — повтор узла.
- deepagents 0.7.19: агент с ToolStrategy отвечает схемой; FilesystemBackend читает папку.
- langchain 1.4.2: create_agent, ToolStrategy, middleware.
- pydantic 2.13.5: BaseModel, Field, model_validator, TypeAdapter.
- В проекте уже есть: порты typing.Protocol в carousel/ports.py; Pydantic-схема на каждый
  контракт в carousel/schemas.py; шаг calls/ с кешем платных вызовов по хешу входа; бюджет
  прогона в carousel/budget.py; сборка адаптеров в carousel/wiring.py.`;

const MAX_WINDOW_CHARS = 60_000;

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

function splitWindows(turns: Turn[]): Turn[][] {
  const windows: Turn[][] = [];
  let current: Turn[] = [];
  let size = 0;
  for (const turn of turns) {
    if (turn.author === "owner") {
      if (current.length > 0) windows.push(current);
      current = [];
      size = 0;
      continue;
    }
    if (turn.tool === "__stop__") continue;
    current.push(turn);
    size += turn.text.length;
    if (size >= MAX_WINDOW_CHARS) {
      windows.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length > 0) windows.push(current);
  return windows;
}

async function main(): Promise<void> {
  const key = apiKey();
  const turns = readTranscript(readFileSync(TRANSCRIPT, "utf8"));
  const windows = splitWindows(turns);

  // В каком окне живёт предложение: ищем вызов, в котором родилось слово.
  const withCase = windows
    .map((window, index) => ({ index, window }))
    .filter((item) => item.window.some((turn) => turn.text.includes("RunContext")));

  console.log(`окон в транскрипте: ${windows.length}`);
  console.log(`окон с RunContext: ${withCase.length} → ${withCase.map((item) => item.index).join(", ")}\n`);

  for (const item of withCase) {
    const built = buildAgentWindow(item.window);
    console.log(`окно ${item.index}: ${built.text.length} зн., ответов агента ${built.agentTurns}`);
    const summary = await summarize(built.text, { apiKey: key });
    if (summary.empty) {
      console.log(`  сводка пуста: ${summary.note}\n`);
      continue;
    }
    const verdict = await classify(summary.text, READY, { apiKey: key });
    const named = summary.text.includes("RunContext");
    console.log(
      `  сводка ${summary.outputChars} зн. (${((summary.outputChars / summary.inputChars) * 100).toFixed(0)}%), `
      + `RunContext в сводке: ${named ? "да" : "НЕТ"}`,
    );
    console.log(`  оценка ${verdict.score.toFixed(3)} → ${verdict.bike ? "ВЕЛОСИПЕД, блок" : "пропуск"}`);
    console.log(`  $${(summary.cost + verdict.cost).toFixed(5)}, ${summary.ms + verdict.ms} мс`);
    const lead = summary.text.split("\n").filter((line) => line.includes("RunContext")).slice(0, 2);
    for (const line of lead) console.log(`    ${line.trim().slice(0, 200)}`);
    console.log();
  }
}

await main();
