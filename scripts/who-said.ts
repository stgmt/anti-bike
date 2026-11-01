/**
 * Окно вокруг хода-фикстуры: кто что сказал.
 *
 * Случай RunContext живёт в трёх видах: предложение агента, цитата автора
 * внутри отчёта агента, и просто упоминание. Здесь печатается по порядку,
 * кто сказал и что, чтобы увидеть, различимо ли это вообще.
 */

import { readFile } from "node:fs/promises";

const TRANSCRIPT =
  "C:/Users/stigm/.claude/projects/E--repos-carousel-demo/5991cc66-3b95-43fa-a8ce-5122dd0292c7.jsonl";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

function shorten(text: string, limit: number): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

async function main(): Promise<void> {
  const lines = (await readFile(TRANSCRIPT, "utf8")).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("RunContext")) continue;
    let record: Raw;
    try {
      record = JSON.parse(line) as Raw;
    } catch {
      continue;
    }
    const content = record.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const item = block as { type?: string; text?: string; name?: string; input?: unknown; content?: unknown };
      const blob = JSON.stringify(item);
      if (!blob.includes("RunContext")) continue;
      const role = record.message?.role ?? record.type;
      console.log(`\n--- строка ${index + 1}  запись=${record.type} роль=${role} блок=${item.type} ${item.name ?? ""}`);
      if (item.type === "text") console.log(shorten(item.text ?? "", 700));
      if (item.type === "tool_use") console.log(shorten(blob, 700));
    }
  }
}

await main();
