/**
 * Какие записи бывают в транскрипте и что из них — слова автора.
 *
 * Ловушка, найденная в этом измерении: запись вида api-request-blob с ролью
 * user — это не автор, а вставленная машинная сводка прошлого разговора.
 * Если считать её за автора, «слова автора» раздуваются в разы, и гейт
 * принимает машинный текст за решение владельца.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let text = "";
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      text += (block as { text?: string }).text ?? "";
    }
  }
  return text;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  files.sort();

  const byKind = new Map<string, { count: number; chars: number; sample: string }>();

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
      const role = record.message?.role ?? "-";
      const body = textOf(record.message?.content);
      const flags = [
        record.isCompactSummary ? "compact" : "",
        record.isMeta ? "meta" : "",
      ].filter(Boolean).join("+");
      const key = `${record.type ?? "?"} роль=${role}${flags ? " " + flags : ""}`;
      const row = byKind.get(key) ?? { count: 0, chars: 0, sample: "" };
      row.count += 1;
      row.chars += sizeOf(record.message?.content);
      if (!row.sample && body.trim() !== "") row.sample = body.replace(/\s+/g, " ").slice(0, 90);
      byKind.set(key, row);
    }
  }

  console.log("Записи транскрипта по видам (7 файлов, 345 МБ)\n");
  console.log(`${"вид".padEnd(34)} ${"штук".padStart(7)} ${"объём".padStart(10)}  образец`);
  const rows = [...byKind.entries()].sort((a, b) => b[1].chars - a[1].chars);
  for (const [key, row] of rows.slice(0, 16)) {
    console.log(
      `${key.padEnd(34)} ${String(row.count).padStart(7)} `
      + `${(row.chars / 1048576).toFixed(1).padStart(8)} МБ  ${row.sample.slice(0, 60)}`,
    );
  }
}

await main();
