/**
 * От претензии автора к окну, где родился велосипед.
 *
 * Автор сказал «ты накостылял навелосипед» в tokenplan. Надо найти окно, где
 * агент это сделал, и вытащить его как второй случай фикстуры.
 *
 * Запуск: node --experimental-strip-types scripts/trace-case.ts <проект> "<цитата>"
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Turn, buildAgentWindow, readTranscript } from "../src/window.ts";

const ROOT = "C:/Users/stigm/.claude/projects";

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
  const project = process.argv[2];
  const quote = process.argv[3] ?? "накостылял навелосипед";
  const dir = join(ROOT, project);
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));

  for (const file of files) {
    const raw = await readFile(join(dir, file), "utf8");
    if (!raw.includes(quote)) continue;
    const turns = readTranscript(raw);
    const windows = splitWindows(turns);

    // Окно перед претензией — то, где агент и наделал.
    let hitIndex = -1;
    let cursor = 0;
    for (const window of windows) {
      const text = window.map((turn) => turn.text).join("\n");
      if (text.includes(quote)) {
        hitIndex = cursor;
        break;
      }
      cursor += 1;
    }
    console.log(`файл ${file.slice(0, 8)}: окон ${windows.length}, претензия в окне ${hitIndex}`);

    // Показываем окно с претензией и предыдущее: что агент делал до неё.
    for (const index of [hitIndex - 1, hitIndex]) {
      if (index < 0 || index >= windows.length) continue;
      const built = buildAgentWindow(windows[index]);
      console.log(`\n--- окно ${index}: ${built.text.length} знаков, ответов ${built.agentTurns}`);
      console.log(built.text.replace(/\s+/g, " ").slice(0, 900));
      const owner = built.ownerSaid.join(" | ").slice(0, 200);
      if (owner) console.log(`\n  слова автора: ${owner}`);
      await writeFile(`bench/case-tokenplan-${index}.txt`, built.text, "utf8");
    }
  }
}

await main();
