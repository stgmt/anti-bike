/**
 * Что на самом деле пишет сводка: заголовки и первая строка каждого раздела.
 *
 * Разбор имён шёл по заголовку «ВМЕСТО ГОТОВОГО», а модель может писать
 * «**ВМЕСТО ГОТОВОГО**» или другим словом. Здесь видно, что пришло.
 *
 * Запуск: node --experimental-strip-types scripts/show-summary.ts [окно]
 */

import { readFileSync } from "node:fs";

import { summarize } from "../src/summarize.ts";
import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const KEY_FILE =
  "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const TRANSCRIPT =
  "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/5991cc66-3b95-43fa-a8ce-5122dd0292c7.jsonl";

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
    if (size >= 60_000) {
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
  const target = Number(process.argv[2] ?? 50);
  const windows = splitWindows(readTranscript(readFileSync(TRANSCRIPT, "utf8")));
  const window = windows[target];
  if (!window) throw new Error(`окна ${target} нет`);
  const built = buildAgentWindow(window);
  console.log(`окно ${target}: ${built.text.length} знаков\n`);
  for (let run = 1; run <= 2; run += 1) {
    const summary = await summarize(built.text, { apiKey: key });
    console.log(`--- прогон ${run}: ${summary.outputChars} знаков, пусто=${summary.empty} ${summary.note}`);
    console.log(summary.text.slice(0, 1200));
    console.log();
  }
}

await main();
