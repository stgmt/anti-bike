/**
 * Проверка отбора слов владельца: что попало и что отброшено.
 *
 * После чистки объём владельца упал с 1894 КБ до 48 КБ. Надо убедиться, что
 * упало только машинное, а живые реплики на месте: печатаем случайные
 * выжившие и всё, что отброшено по каждому правилу.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

const MACHINE_PREFIXES = [
  "<task-notification>",
  "<system-reminder>",
  "[SYSTEM NOTIFICATION",
  "<command-name>",
  "<command-message>",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "<cross-session-message",
  "<side-sessions-event>",
  "<ci-monitor-event>",
  "<browsers>",
  "<context_window_protection>",
  "This session is being continued from a previous conversation",
  "Caveat: The messages below were generated",
];

function textBlocks(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string };
    if (item.type === "text" && typeof item.text === "string") parts.push(item.text);
  }
  return parts;
}

function hasToolResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_result",
  );
}

function rule(text: string): string {
  const head = text.trimStart();
  for (const prefix of MACHINE_PREFIXES) {
    if (head.startsWith(prefix)) return `prefix ${prefix.slice(0, 30)}`;
  }
  return "живое";
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  const kept: string[] = [];
  const dropped = new Map<string, { count: number; chars: number; sample: string }>();

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let record: Raw;
      try {
        record = JSON.parse(line) as Raw;
      } catch {
        continue;
      }
      const role = record.message?.role ?? record.type;
      if (record.type !== "user" && role !== "user") continue;
      const content = record.message?.content;
      if (hasToolResult(content)) continue;
      for (const body of textBlocks(content)) {
        if (body.trim() === "") continue;
        if (record.isCompactSummary) {
          const row = dropped.get("флаг compact") ?? { count: 0, chars: 0, sample: body.replace(/\s+/g, " ").slice(0, 70) };
          row.count += 1;
          row.chars += body.length;
          dropped.set("флаг compact", row);
          continue;
        }
        if (record.isMeta) {
          const row = dropped.get("флаг meta") ?? { count: 0, chars: 0, sample: body.replace(/\s+/g, " ").slice(0, 70) };
          row.count += 1;
          row.chars += body.length;
          dropped.set("флаг meta", row);
          continue;
        }
        const why = rule(body);
        if (why === "живое") {
          kept.push(body);
          continue;
        }
        const row = dropped.get(why) ?? { count: 0, chars: 0, sample: body.replace(/\s+/g, " ").slice(0, 70) };
        row.count += 1;
        row.chars += body.length;
        dropped.set(why, row);
      }
    }
  }

  const keptChars = kept.reduce((sum, text) => sum + text.length, 0);
  console.log(`живых реплик: ${kept.length}, ${(keptChars / 1024).toFixed(0)} КБ\n`);
  console.log("отброшено:");
  for (const [why, row] of [...dropped.entries()].sort((a, b) => b[1].chars - a[1].chars)) {
    console.log(`  ${why.padEnd(40)} ${String(row.count).padStart(5)} шт ${(row.chars / 1024).toFixed(0).padStart(5)} КБ  ${row.sample}`);
  }
  console.log("\nживые реплики, последние 12:");
  for (const text of kept.slice(-12)) {
    console.log(`  ${text.replace(/\s+/g, " ").slice(0, 120)}`);
  }
}

await main();
