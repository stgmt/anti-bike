/**
 * Повтор прогона после двух правок: та же выборка, те же окна.
 *
 * Правка 1: проверка существования по пакету carousel/ (342 мс).
 * Правка 2: сводка называет только «предложено вместо готового».
 *
 * Сравнение с прошлым прогоном (208 окон, 11 попаданий, 1 настоящий велосипед)
 * идёт по тем же самым окнам, чтобы разница была от правок, а не от выборки.
 *
 * Запуск: node --experimental-strip-types scripts/detect2.ts [--limit N]
 */

import { readFileSync } from "node:fs";
import { appendFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { judgeWindow } from "../src/judge.ts";
import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const JOURNAL = "bench/detect2-journal.jsonl";
const MAX_WINDOW_CHARS = 60_000;

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
  const dir = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-carousel-demo";
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : 60;
  const key = apiKey();
  const roots = ["E:/repos/carousel-demo/carousel"];

  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  let seen = 0;
  let bikes = 0;
  let clean = 0;
  let noSignal = 0;
  let errors = 0;
  let cost = 0;

  for (const file of files) {
    if (seen >= limit) break;
    const raw = await readFile(join(dir, file), "utf8");
    const windows = splitWindows(readTranscript(raw));
    let index = 0;
    for (const window of windows) {
      index += 1;
      if (seen >= limit) break;
      const built = buildAgentWindow(window);
      if (built.agentTurns < 1) continue;
      if (!window.some((turn) => turn.author === "agent-wrote" || turn.author === "agent-proposed")) continue;
      seen += 1;

      const result = await judgeWindow(built.text, { apiKey: key, roots, ready: READY });
      cost += result.cost;
      if (result.kind === "bike") bikes += 1;
      else if (result.kind === "clean") clean += 1;
      else if (result.kind === "no-signal") noSignal += 1;
      else errors += 1;

      await appendFile(
        JOURNAL,
        JSON.stringify({
          file,
          window: index,
          kind: result.kind,
          reason: result.reason,
          proposed: result.proposed,
          exists: result.exists.map((item) => `${item.name}@${item.where}`),
          absent: result.absent,
          score: result.verdict?.score ?? null,
          ms: result.ms,
          summary: result.summary?.text ?? "",
          error: result.error,
        }) + "\n",
        "utf8",
      );
      process.stdout.write(`\rокон ${seen}: велосипед ${bikes}, чисто ${clean}, без сигнала ${noSignal}, ошибок ${errors}`);
    }
  }

  console.log(`\n\nокон проверено: ${seen}`);
  console.log(`  велосипед ${bikes}`);
  console.log(`  чисто     ${clean}`);
  console.log(`  без сигнала ${noSignal}`);
  console.log(`  ошибок    ${errors}`);
  console.log(`потрачено: $${cost.toFixed(5)}`);
}

await main();
