/**
 * Сколько на самом деле пишет агент за один ответ.
 *
 * Прошлое измерение разбило выгрузку по пустым строкам и потеряло длинные
 * ответы: они сами содержат пустые строки. Здесь считается по записям.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  const lengths: number[] = [];
  const longest: { file: string; chars: number; head: string }[] = [];

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
      if (record.type !== "assistant") continue;
      const content = record.message?.content;
      if (!Array.isArray(content)) continue;
      let whole = "";
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        const item = block as { type?: string; text?: string };
        if (item.type === "text" && typeof item.text === "string") whole += item.text;
      }
      if (whole.trim() === "") continue;
      lengths.push(whole.length);
      longest.push({ file, chars: whole.length, head: whole.replace(/\s+/g, " ").slice(0, 110) });
    }
  }

  lengths.sort((left, right) => left - right);
  const at = (share: number): number => lengths[Math.min(lengths.length - 1, Math.floor(share * lengths.length))];
  console.log(`ответов агента с текстом: ${lengths.length}`);
  console.log(`  медиана          ${at(0.5)} знаков`);
  console.log(`  90-й перцентиль  ${at(0.9)} знаков`);
  console.log(`  99-й перцентиль  ${at(0.99)} знаков`);
  console.log(`  максимум         ${lengths[lengths.length - 1]} знаков (≈${Math.round(lengths[lengths.length - 1] / 3.2)} токенов)`);
  for (const bound of [1000, 2000, 4000, 8000, 16000]) {
    console.log(`  длиннее ${String(bound).padStart(5)}: ${lengths.filter((value) => value > bound).length}`);
  }
  console.log("\nсамые длинные:");
  for (const row of longest.sort((a, b) => b.chars - a.chars).slice(0, 4)) {
    console.log(`  ${String(row.chars).padStart(6)} ${row.head}`);
  }
}

await main();
