/**
 * Сколько стоит дыра в выборке: ходы без записи кода.
 *
 * Тот случай (`RunContext`) родился в AskUserQuestion — предложении, а не в
 * файле. Мой отбор требовал файл кода, поэтому такой ход в набор не попал.
 * Здесь считается, сколько таких ходов в настоящем транскрипте.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  message?: { content?: unknown };
}

const PROPOSAL_TOOLS = ["AskUserQuestion", "ExitPlanMode"];

async function main(): Promise<void> {
  const dirs = process.argv.slice(2);
  let asks = 0;
  let asksWithRunContext = 0;
  let planWrites = 0;
  let codeWrites = 0;
  const samples: string[] = [];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      const lines = (await readFile(join(dir, file), "utf8")).split("\n");
      for (const line of lines) {
        if (line.trim() === "") continue;
        let record: Raw;
        try {
          record = JSON.parse(line) as Raw;
        } catch {
          continue;
        }
        if (record.type !== "assistant") continue;
        const content = record.message?.content;
        if (!Array.isArray(content)) continue;
        for (const block of content) {
          if (!block || typeof block !== "object") continue;
          const item = block as { type?: string; name?: string; input?: Record<string, unknown> };
          if (item.type !== "tool_use") continue;
          if (item.name === "Write" || item.name === "Edit" || item.name === "MultiEdit") codeWrites += 1;
          if (!PROPOSAL_TOOLS.includes(item.name ?? "")) continue;
          if (item.name === "AskUserQuestion") asks += 1;
          if (item.name === "ExitPlanMode") planWrites += 1;
          const blob = JSON.stringify(item.input ?? {});
          if (blob.includes("RunContext")) {
            asksWithRunContext += 1;
            samples.push(blob.slice(0, 300));
          }
        }
      }
    }
  }

  console.log("Ходы-предложения против ходов-записей");
  console.log("=".repeat(50));
  console.log(`записей файлов (Write/Edit):  ${codeWrites}`);
  console.log(`вопросов автору (AskUserQuestion): ${asks}`);
  console.log(`планов (ExitPlanMode):        ${planWrites}`);
  console.log(`из них с RunContext:          ${asksWithRunContext}`);
  console.log(`\nдоля предложений от записей:  ${((asks / Math.max(codeWrites, 1)) * 100).toFixed(1)}%`);
  for (const sample of samples.slice(0, 2)) {
    console.log(`\nобразец: ${sample.slice(0, 280)}`);
  }
}

await main();
