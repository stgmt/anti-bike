/**
 * Сколько знаков приходится на один Stop.
 *
 * Stop-хук срабатывает, когда агент закончил отвечать. Если каждое срабатывание
 * сжимать весь поток решений сессии, платим за одно и то же много раз. Здесь
 * считается размер куска между двумя Stop: что реально надо сжимать.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  const perStop: number[] = [];
  const perWrite: number[] = [];

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    let sinceStop = 0;
    let sinceWrite = 0;
    for (const line of text.split("\n")) {
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
      let chunk = 0;
      let wrote = false;
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const item = block as { type?: string; text?: string; name?: string; input?: unknown };
        if (item.type === "text") chunk += sizeOf(item.text);
        if (item.type === "tool_use") {
          chunk += sizeOf(item.input);
          if (WRITES.has(item.name ?? "")) wrote = true;
        }
      }
      sinceStop += chunk;
      sinceWrite += chunk;
      if (wrote) {
        perWrite.push(sinceWrite);
        sinceWrite = 0;
      }
      // Конец хода агента = Stop. Записи без инструментов после — тоже стоп.
      const hasTool = content.some(
        (block) => block && typeof block === "object" && (block as { type?: string }).type === "tool_use",
      );
      if (!hasTool) {
        perStop.push(sinceStop);
        sinceStop = 0;
      }
    }
    if (sinceStop > 0) perStop.push(sinceStop);
  }

  const report = (name: string, values: number[]): void => {
    if (values.length === 0) return;
    values.sort((left, right) => left - right);
    const at = (share: number): number => values[Math.min(values.length - 1, Math.floor(share * values.length))];
    console.log(`\n${name}: ${values.length} штук`);
    console.log(`  медиана         ${at(0.5).toLocaleString("ru")} знаков (≈${Math.round(at(0.5) / 3.2)} токенов)`);
    console.log(`  90-й перцентиль ${at(0.9).toLocaleString("ru")} знаков (≈${Math.round(at(0.9) / 3.2)} токенов)`);
    console.log(`  99-й перцентиль ${at(0.99).toLocaleString("ru")} знаков (≈${Math.round(at(0.99) / 3.2)} токенов)`);
    console.log(`  максимум        ${values[values.length - 1].toLocaleString("ru")} знаков`);
  };

  report("кусок между двумя Stop", perStop);
  report("кусок между двумя записями файлов", perWrite);
}

await main();
