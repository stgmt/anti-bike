/**
 * Собирает ходы из настоящих транскриптов Claude Code для разметки.
 *
 * Берём только текст ответов ассистента (то, что видит Stop-хук) и код,
 * который агент записал в этом же ходе через Write/Edit. Ходы, отсечённые
 * ступенью 1, в набор не входят: их гейт и так не пустит к модели.
 *
 * Запуск: node --experimental-strip-types scripts/extract-turns.ts <каталог-проекта> <имя-файла>
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { detectIntent, isCodeFile } from "../src/intent.ts";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface Turn {
  /** Стабильный ключ для разметки. */
  id: string;
  /** Какой проект: у разных проектов свои списки возможностей. */
  project: string;
  /** Текст ответа агента. */
  message: string;
  /** Новый файл целиком: вход jscpd. Пусто, если ход писал правками. */
  written: string;
  /** Куски правок: тоже код, но по фрагментам. */
  edited: string;
  /** Имена файлов, которые тронул ход. */
  files: string[];
  /** Разметка человеком: null — ещё не размечено. */
  label: "bike" | "ok" | null;
  /** Почему так: заполняет человек. */
  note: string;
}

/**
 * Текст блоков ответа плюс код из Write/Edit того же сообщения.
 *
 * `written` — только новые файлы целиком (`Write`). Это то, что стоит отдавать
 * в jscpd: `check_duplication` проверяет фрагмент целиком.
 * `edited` — куски правок (`Edit`, `MultiEdit`): по ним тоже видно повтор.
 */
function readRecord(record: Raw): { text: string; written: string; edited: string; files: string[] } {
  const content = record.message?.content;
  if (!Array.isArray(content)) return { text: "", written: "", edited: "", files: [] };
  const texts: string[] = [];
  const written: string[] = [];
  const edited: string[] = [];
  const files: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
    if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
    if (item.type !== "tool_use") continue;
    const input = item.input ?? {};
    if (typeof input.file_path === "string") files.push(input.file_path);
    if (item.name === "Write" && typeof input.content === "string") written.push(input.content);
    if (item.name === "Edit" && typeof input.new_string === "string") edited.push(input.new_string);
    if (item.name === "MultiEdit" && Array.isArray(input.edits)) {
      for (const edit of input.edits as { new_string?: unknown }[]) {
        if (typeof edit?.new_string === "string") edited.push(edit.new_string);
      }
    }
  }
  return {
    text: texts.join("\n").trim(),
    written: written.join("\n"),
    edited: edited.join("\n"),
    files,
  };
}

async function main(): Promise<void> {
  const [projectDir, outName] = process.argv.slice(2);
  if (!projectDir || !outName) {
    console.error("нужно: scripts/extract-turns.ts <каталог-проекта> <файл-выхода>");
    process.exit(2);
  }
  const files = (await readdir(projectDir)).filter((name) => name.endsWith(".jsonl"));
  const turns: Turn[] = [];

  for (const file of files) {
    const path = join(projectDir, file);
    let lines: string;
    try {
      lines = await readFile(path, "utf8");
    } catch {
      continue;
    }
    for (const [index, line] of lines.split("\n").entries()) {
      if (line.trim() === "") continue;
      let record: Raw;
      try {
        record = JSON.parse(line) as Raw;
      } catch {
        continue;
      }
      if (record.type !== "assistant") continue;
      const { text, written, edited, files: touched } = readRecord(record);
      // Ход без текста и без записи кода нечего проверять.
      if (text === "" && written === "" && edited === "") continue;
      // Ход без файла кода не проверяем: повтор абзаца в markdown — не велосипед.
      const codeFiles = touched.filter(isCodeFile);
      if (codeFiles.length === 0) continue;
      // Код записан или в тексте обещание — ход идёт в набор.
      if (written.length < 120 && edited.length < 120 && !detectIntent(text).promise) continue;
      turns.push({
        id: `${basename(file, ".jsonl").slice(0, 8)}-${index}`,
        project: basename(projectDir),
        message: text,
        written,
        edited,
        files: codeFiles,
        label: null,
        note: "",
      });
    }
  }

  const out = join(import.meta.dirname, "..", "bench", outName);
  await writeFile(out, JSON.stringify(turns, null, 2), "utf8");
  const withCode = turns.filter((turn) => turn.code !== "").length;
  console.log(`ходов: ${turns.length}, из них с кодом: ${withCode}`);
  console.log(`записано: ${out}`);
}

await main();
