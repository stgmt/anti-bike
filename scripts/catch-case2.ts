/**
 * После двух правок: ловится ли известный случай и не ушёл ли он вместе с
 * ложными.
 *
 * Инструкция сводки теперь просит называть только «вместо готового». Риск:
 * сводка утаит предложение и случай пропадёт. Проверяем на том же окне 51,
 * что и до правки.
 *
 * Запуск: node --experimental-strip-types scripts/catch-case2.ts
 */

import { readFileSync } from "node:fs";

import { judgeWindow, proposedNames } from "../src/judge.ts";
import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const TRANSCRIPT =
  "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/5991cc66-3b95-43fa-a8ce-5122dd0292c7.jsonl";
const MAX_WINDOW_CHARS = 60_000;

const READY = `Что уже есть в проекте carousel-demo и его библиотеках: langgraph 1.2.12 с
StateGraph(state_schema, context_schema=…), Runtime с context/store/stream_writer/previous,
AsyncSqliteSaver, Command, interrupt, retrypolicy; deepagents 0.7.19 с ToolStrategy;
langchain 1.4.2; pydantic 2.13.5. В проекте: порты typing.Protocol в carousel/ports.py;
Pydantic-схемы в carousel/schemas.py; кеш платных вызовов в calls/; бюджет в
carousel/budget.py; сборка адаптеров в carousel/wiring.py.`;

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
  const windows = splitWindows(readTranscript(readFileSync(TRANSCRIPT, "utf8")));
  const withCase = windows
    .map((window, index) => ({ index, window }))
    .filter((item) => item.window.some((turn) => turn.text.includes("RunContext")));

  console.log(`окон: ${windows.length}, из них с RunContext: ${withCase.length}\n`);

  for (const item of withCase) {
    const built = buildAgentWindow(item.window);
    for (let run = 1; run <= 3; run += 1) {
      const result = await judgeWindow(built.text, {
        apiKey: key,
        roots: ["E:/repos/carousel-demo/carousel"],
        ready: READY,
      });
      const names = result.summary ? proposedNames(result.summary.text) : [];
      console.log(
        `окно ${item.index} прогон ${run}: ${result.kind.toUpperCase()}  `
        + `оценка ${result.verdict?.score?.toFixed(3) ?? "—"}  `
        + `названо: ${names.join(", ") || "—"}  `
        + `нет в пакете: ${result.absent.join(", ") || "—"}`,
      );
      console.log(`  причина: ${result.reason}`);
      if (result.summary && run === 2) {
        const head = result.summary.text.split("СОЗДАЛ НОВОЕ")[0];
        console.log(`  сводка, раздел «вместо готового»:\n${head.trim().split("\n").slice(0, 6).map((line) => `    ${line}`).join("\n")}`);
      }
    }
    console.log();
  }
}

await main();
