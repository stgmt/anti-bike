/**
 * Где именно лежит фраза: в реплике владельца, в отчёте агента или в сводке.
 *
 * Скрипт не нашёл претензию среди реплик владельца, хотя фраза в файле есть.
 * Значит она пришла в другом виде, и это надо знать до сборки фикстуры.
 *
 * Запуск: node --experimental-strip-types scripts/where-text.ts <проект> "<фраза>"
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "C:/Users/stigm/.claude/projects";

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const phrase = process.argv[3];
  const dir = join(ROOT, project);
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl"))) {
    const lines = (await readFile(join(dir, file), "utf8")).split("\n");
    for (const [index, line] of lines.entries()) {
      if (!line.includes(phrase)) continue;
      let record: Raw;
      try {
        record = JSON.parse(line) as Raw;
      } catch {
        continue;
      }
      const role = record.message?.role ?? "-";
      const content = record.message?.content;
      const kinds: string[] = [];
      if (typeof content === "string") kinds.push("строка");
      else if (Array.isArray(content)) {
        for (const block of content) {
          if (block && typeof block === "object") kinds.push((block as { type?: string }).type ?? "?");
        }
      }
      const flags = [record.isCompactSummary ? "compact" : "", record.isMeta ? "meta" : ""].filter(Boolean).join("+");
      const at = line.indexOf(phrase);
      console.log(
        `${file.slice(0, 8)} строка ${index + 1}: тип=${record.type} роль=${role} `
        + `блоки=[${[...new Set(kinds)].join(",")}]${flags ? ` ${flags}` : ""}`,
      );
      console.log(`  …${line.slice(Math.max(0, at - 160), at + 120).replace(/\\n/g, " ")}…`);
    }
  }
}

await main();
