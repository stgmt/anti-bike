/**
 * Главный вопрос автора: ловит ли гейт велосипеды на настоящем потоке.
 *
 * Идёт по настоящим транскриптам, режет их на окна по Stop, каждое окно
 * сжимает qwen3.7-flash и классифицирует drex-max. Печатает все попадания
 * с текстом предложения, чтобы их можно было прочитать глазами и разметить.
 *
 * Запуск: node --experimental-strip-types scripts/detect.ts [каталог] [--limit N]
 */

import { readFileSync } from "node:fs";
import { appendFile, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { classify } from "../src/classify.ts";
import { summarize } from "../src/summarize.ts";
import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const JOURNAL = "bench/detect-journal.jsonl";
const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";

const READY = `Что уже есть в проекте carousel-demo и его библиотеках:

- langgraph 1.2.12: StateGraph(state_schema, context_schema=…) — context_schema задаёт схему
  неизменных зависимостей; узел получает их через Runtime[Context]. Runtime содержит context,
  store, stream_writer, previous и подставляется в узел сам, если в подписи назван runtime.
  AsyncSqliteSaver — чекпоинты в SQLite. Command — переход и обновление состояния,
  goto=[Send(...)] для веера. interrupt — остановка и продолжение после ответа человека.
  retrypolicy — повтор узла.
- deepagents 0.7.19: агент с ToolStrategy отвечает схемой; FilesystemBackend читает папку.
- langchain 1.4.2: create_agent, ToolStrategy, middleware.
- pydantic 2.13.5: BaseModel, Field, model_validator, TypeAdapter.
- В проекте уже есть: порты typing.Protocol в carousel/ports.py; Pydantic-схема на каждый
  контракт в carousel/schemas.py; шаг calls/ с кешем платных вызовов по хешу входа; бюджет
  прогона в carousel/budget.py; сборка адаптеров в carousel/wiring.py; проверки текста кодом
  в carousel/nodes/checks.py; реестр шагов в carousel/graph.py.`;

/**
 * Режет поток по репликам владельца.
 *
 * Окно — участок работы после слова автора, то есть тот самый «час работы», в
 * котором агент мог наделать велосипедов. Разрез по одиночному Stop не годится:
 * медиана окна между Stop — один ход агента и 52 знака, ловить там нечего.
 * Слишком большой участок тоже режется по потолку знаков.
 */
const MAX_WINDOW_CHARS = 60_000;

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

function apiKey(): string {
  const match = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"));
  if (!match) throw new Error("ключ не найден");
  return match[0];
}

/** Временная занятость модели — не повод терять окно: ждём и повторяем. */
async function retry<T>(call: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      last = error;
      const text = String(error);
      const busy = text.includes("429") || text.includes("busy");
      if (!busy) throw error;
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    }
  }
  throw last;
}

interface Finding {
  project: string;
  file: string;
  window: number;
  score: number;
  summaryChars: number;
  inputChars: number;
  lead: string;
}

async function main(): Promise<void> {
  const dir = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-carousel-demo";
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : 40;
  const key = apiKey();

  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl")).sort();
  const findings: Finding[] = [];
  let seen = 0;
  let kept = 0;
  let empty = 0;
  let cost = 0;

  for (const file of files) {
    if (seen >= limit) break;
    const raw = await readFile(join(dir, file), "utf8");
    const turns = readTranscript(raw);
    const windows = splitWindows(turns);
    let index = 0;
    for (const window of windows) {
      index += 1;
      if (seen >= limit) break;
      const built = buildAgentWindow(window);
      if (built.agentTurns < 1) continue;
      // Окно без единого вызова агента ничего не решает: он только говорил.
      const hasCall = window.some((turn) => turn.author === "agent-wrote" || turn.author === "agent-proposed");
      if (!hasCall) continue;
      seen += 1;

      const summary = await summarize(built.text, { apiKey: key });
      cost += summary.cost;
      if (summary.empty) {
        empty += 1;
        continue;
      }
      const verdict = await retry(() => classify(summary.text, READY, { apiKey: key }));
      cost += verdict.cost;
      // Строка на окно сразу: прогон может оборваться, разметка не должна.
      await appendFile(
        JOURNAL,
        JSON.stringify({
          file,
          window: index,
          score: verdict.score,
          inputChars: summary.inputChars,
          summaryChars: summary.outputChars,
          summary: summary.text,
        }) + "\n",
        "utf8",
      );
      if (!verdict.bike) continue;
      kept += 1;
      const finding: Finding = {
        project: dir.split(/[\\/]/).pop() ?? dir,
        file,
        window: index,
        score: verdict.score,
        summaryChars: summary.outputChars,
        inputChars: summary.inputChars,
        lead: summary.text.replace(/\s+/g, " ").slice(0, 260),
      };
      findings.push(finding);

    }
  }

  console.log(`окон проверено: ${seen}, пустых сводок: ${empty}`);
  console.log(`журнал: ${JOURNAL}`);
  console.log(`попаданий: ${kept}`);
  console.log(`потрачено: $${cost.toFixed(5)}\n`);

  const sorted = [...findings].sort((a, b) => b.score - a.score);
  for (const finding of sorted) {
    console.log(`[${finding.score.toFixed(3)}] ${finding.project}/${finding.file.slice(0, 8)} окно ${finding.window}`);
    console.log(`         ${finding.lead.slice(0, 230)}\n`);
  }
  await writeFile("bench/detect.json", JSON.stringify({ findings, seen, empty, cost }, null, 2), "utf8");
}

await main();
