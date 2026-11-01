/**
 * Поток решений: что агент написал сам, без прочитанных файлов.
 *
 * Транскрипт на 74 МБ почти целиком — это то, что агент ПРОЧИТАЛ. Его
 * собственные слова — 0,1% файла. Здесь считается отдельно по каждому
 * инструменту, сколько входа он приносит, и собирается «поток решений»:
 * что сказал автор, что сказал агент, что он записал в файлы.
 *
 * Разделение автор/агент — по типу записи в транскрипте, без разбора текста.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

/** Инструменты, чей вход — решение агента, а не прочитанное. */
const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
/** Предложения автору: рождаются в тексте, не в файле. */
const PROPOSALS = new Set(["AskUserQuestion", "ExitPlanMode"]);

interface Totals {
  ownerChars: number;
  ownerTurns: number;
  agentChars: number;
  agentTurns: number;
  writeChars: number;
  writes: number;
  proposalChars: number;
  proposals: number;
  byTool: Map<string, { count: number; chars: number }>;
}

function bump(into: Totals, name: string, chars: number): void {
  const row = into.byTool.get(name) ?? { count: 0, chars: 0 };
  row.count += 1;
  row.chars += chars;
  into.byTool.set(name, row);
}

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function main(): void {
  const totals: Totals = {
    ownerChars: 0,
    ownerTurns: 0,
    agentChars: 0,
    agentTurns: 0,
    writeChars: 0,
    writes: 0,
    proposalChars: 0,
    proposals: 0,
    byTool: new Map(),
  };
  return totals as never;
}

function count(totals: Totals, record: Raw): void {
  const content = record.message?.content;
  const role = record.message?.role ?? record.type;

  if (role === "user" || record.type === "user") {
    // Текст автора — это реплики без tool_result. Результаты инструментов
    // приходят тем же типом и репликой автора не считаются.
    if (typeof content === "string") {
      totals.ownerChars += content.length;
      totals.ownerTurns += 1;
      return;
    }
    if (!Array.isArray(content)) return;
    const hasResult = content.some(
      (block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_result",
    );
    if (hasResult) return;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const item = block as { type?: string; text?: string };
      if (item.type === "text") totals.ownerChars += sizeOf(item.text);
    }
    totals.ownerTurns += 1;
    return;
  }

  if (record.type !== "assistant") return;
  if (!Array.isArray(content)) return;

  let spoke = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (item.type === "text") {
      totals.agentChars += sizeOf(item.text);
      spoke = true;
      continue;
    }
    if (item.type !== "tool_use") continue;
    const name = item.name ?? "?";
    const inputSize = sizeOf(item.input);
    bump(totals, name, inputSize);
    if (WRITES.has(name)) {
      totals.writeChars += inputSize;
      totals.writes += 1;
    }
    if (PROPOSALS.has(name)) {
      totals.proposalChars += inputSize;
      totals.proposals += 1;
    }
  }
  if (spoke) totals.agentTurns += 1;
}

async function main2(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("нужно: scripts/decision-stream.ts <каталог проекта>");
    process.exit(2);
  }
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  files.sort();

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const totals = main();
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let record: Raw;
      try {
        record = JSON.parse(line) as Raw;
      } catch {
        continue;
      }
      count(totals, record);
    }

    const stream = totals.ownerChars + totals.agentChars + totals.writeChars + totals.proposalChars;
    const tokens = Math.round(stream / 3.2);
    console.log(`\n${file}  (${(text.length / 1048576).toFixed(1)} МБ)`);
    console.log(`  автор сказал      ${(totals.ownerChars / 1024).toFixed(0).padStart(6)} КБ  ${String(totals.ownerTurns).padStart(6)} реплик`);
    console.log(`  агент сказал      ${(totals.agentChars / 1024).toFixed(0).padStart(6)} КБ  ${String(totals.agentTurns).padStart(6)} ответов`);
    console.log(`  записал в файлы   ${(totals.writeChars / 1024).toFixed(0).padStart(6)} КБ  ${String(totals.writes).padStart(6)} записей`);
    console.log(`  предложил автору  ${(totals.proposalChars / 1024).toFixed(0).padStart(6)} КБ  ${String(totals.proposals).padStart(6)} раз`);
    console.log(`  ─ поток решений   ${(stream / 1024).toFixed(0).padStart(6)} КБ из ${(text.length / 1048576).toFixed(1)} МБ = ${((stream / text.length) * 100).toFixed(1)}%, ≈${tokens.toLocaleString("ru")} токенов`);

    const top = [...totals.byTool.entries()].sort((a, b) => b[1].chars - a[1].chars).slice(0, 6);
    console.log(`  крупнейший вход: ${top.map(([name, row]) => `${name} ${(row.chars / 1024).toFixed(0)}КБ×${row.count}`).join(", ")}`);
  }
}

await main2();
