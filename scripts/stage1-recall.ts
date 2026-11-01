/**
 * Сколько кода ступень 1 пропускает мимо себя.
 *
 * Это главный риск дешёвого отсева: если агент молча пишет код, не объявляя
 * «введу класс», ступень 1 его не увидит, а третий слой не получит шанса.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { shouldCheck } from "../src/intent.ts";

interface Raw {
  type?: string;
  message?: { content?: unknown };
}

function codeOf(record: Raw): { written: string; edited: string; names: string[] } {
  const content = record.message?.content;
  if (!Array.isArray(content)) return { written: "", edited: "", names: [] };
  const written: string[] = [];
  const edited: string[] = [];
  const names: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; name?: string; input?: Record<string, unknown> };
    if (item.type !== "tool_use") continue;
    if (!["Write", "Edit", "MultiEdit"].includes(item.name ?? "")) continue;
    const input = item.input ?? {};
    if (typeof input.file_path === "string") names.push(input.file_path);
    if (item.name === "Write" && typeof input.content === "string") written.push(input.content);
    if (item.name === "Edit" && typeof input.new_string === "string") edited.push(input.new_string);
    if (item.name === "MultiEdit" && Array.isArray(input.edits)) {
      for (const edit of input.edits as { new_string?: unknown }[]) {
        if (typeof edit?.new_string === "string") edited.push(edit.new_string);
      }
    }
  }
  return { written: written.join("\n"), edited: edited.join("\n"), names };
}

function textOf(record: Raw): string {
  const content = record.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type?: string; text?: string } => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();
}

async function main(): Promise<void> {
  const dirs = process.argv.slice(2);
  if (dirs.length === 0) {
    console.error("нужно: scripts/stage1-recall.ts <каталог-проекта>...");
    process.exit(2);
  }

  let codeTurns = 0;
  let newFiles = 0;
  let passed = 0;
  let passedNewFiles = 0;
  const missedNewFiles: { file: string; bytes: number; preview: string }[] = [];
  const missedEdits: { file: string; bytes: number }[] = [];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      let lines: string;
      try {
        lines = await readFile(join(dir, file), "utf8");
      } catch {
        continue;
      }
      for (const line of lines.split("\n")) {
        if (line.trim() === "") continue;
        let record: Raw;
        try {
          record = JSON.parse(line) as Raw;
        } catch {
          continue;
        }
        if (record.type !== "assistant") continue;
        const { written, edited, names } = codeOf(record);
        if (written === "" && edited === "") continue;

        codeTurns += 1;
        const isNewFile = written !== "";
        if (isNewFile) newFiles += 1;

        const text = textOf(record);
        // Решает факт записи кода, а не обещание в тексте: замер показал,
        // что по обещанию отсеивается 100% файлов кода.
        if (shouldCheck(written !== "" ? written : edited, text)) {
          passed += 1;
          if (isNewFile) passedNewFiles += 1;
          continue;
        }

        // Отсечён ход. Для новых файлов это дороже: там целый класс или модуль.
        if (isNewFile && missedNewFiles.length < 2000) {
          missedNewFiles.push({
            file: names[0] ?? "?",
            bytes: written.length,
            preview: written.slice(0, 200).replace(/\s+/g, " "),
          });
        } else if (!isNewFile && missedEdits.length < 2000) {
          missedEdits.push({ file: names[0] ?? "?", bytes: edited.length });
        }
      }
    }
  }

  const pct = (part: number, whole: number): string =>
    whole === 0 ? "—" : `${((part / whole) * 100).toFixed(1)}%`;

  console.log("Ступень 1 на настоящих ходах");
  console.log("=".repeat(50));
  console.log(`ходов с записью кода:        ${codeTurns}`);
  console.log(`из них новых файлов (Write): ${newFiles}`);
  console.log(`прошли ступень 1:            ${passed} (${pct(passed, codeTurns)})`);
  console.log(`из новых файлов прошли:      ${passedNewFiles} (${pct(passedNewFiles, newFiles)})`);
  console.log(`ПРОПУЩЕНО новых файлов:      ${newFiles - passedNewFiles} (${pct(newFiles - passedNewFiles, newFiles)})`);

  const biggest = missedNewFiles.sort((left, right) => right.bytes - left.bytes).slice(0, 10);
  if (biggest.length > 0) {
    console.log("\nСамые крупные пропущенные новые файлы:");
    for (const item of biggest) {
      console.log(`  ${String(item.bytes).padStart(6)} симв  ${item.file}`);
      console.log(`           ${item.preview.slice(0, 140)}`);
    }
  }

  const totalMissedBytes = missedEdits.reduce((sum, item) => sum + item.bytes, 0);
  console.log(`\nпропущенных правок: ${missedEdits.length}, суммарно ${totalMissedBytes} символов`);
}

await main();
