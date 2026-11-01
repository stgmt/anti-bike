/**
 * Поток решений из настоящего транскрипта: что сказал владелец, что агент.
 *
 * Три вещи, которые нельзя делать:
 *   1. Отдавать модели весь транскрипт — 95% это прочитанные файлы.
 *   2. Считать записью владельца всё, у чего role=user: там же машинные
 *      сводки после сжатия и уведомления фоновых задач.
 *   3. Ловить машинный текст регекспом — автора это раздражает по делу.
 *      Здесь литеральные префиксы из списка.
 *
 * Запуск: node --experimental-strip-types scripts/stream.ts <каталог> [--dump файл]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

/**
 * Начала текста, который написал не владелец, а машина.
 *
 * Список собран по замеру: эти строки лежат в записях с ролью user и без
 * этого списка идут в сводку как «слова владельца». Сводку прошлого
 * разговора тоже подсовывает машина — она приходит с флагом не всегда.
 */
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

/** Инструменты, чей вход — решение агента, а не прочитанное. */
const WRITES = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const PROPOSALS = new Set(["AskUserQuestion", "ExitPlanMode"]);

type Who = "owner" | "agent" | "agent-wrote" | "agent-proposed";

interface Line {
  who: Who;
  text: string;
}

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function isMachine(text: string): boolean {
  const head = text.trimStart();
  for (const prefix of MACHINE_PREFIXES) {
    if (head.startsWith(prefix)) return true;
  }
  return false;
}

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

function collect(record: Raw, into: Line[]): void {
  const role = record.message?.role ?? record.type;
  const content = record.message?.content;

  if (record.type === "user" || role === "user") {
    if (hasToolResult(content)) return;
    if (record.isCompactSummary) return;
    if (record.isMeta) return;
    for (const text of textBlocks(content)) {
      if (text.trim() === "") continue;
      if (isMachine(text)) continue;
      into.push({ who: "owner", text });
    }
    return;
  }

  if (record.type !== "assistant") return;
  if (!Array.isArray(content)) return;

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; name?: string; input?: unknown };
    if (item.type === "text" && typeof item.text === "string" && item.text.trim() !== "") {
      into.push({ who: "agent", text: item.text });
      continue;
    }
    if (item.type !== "tool_use") continue;
    const name = item.name ?? "?";
    if (PROPOSALS.has(name)) {
      into.push({ who: "agent-proposed", text: `${name}: ${JSON.stringify(item.input)}` });
      continue;
    }
    if (WRITES.has(name)) {
      const input = (item.input ?? {}) as { file_path?: string; content?: string; old_string?: string; new_string?: string };
      const where = input.file_path ?? "?";
      const body = input.content ?? input.new_string ?? "";
      into.push({ who: "agent-wrote", text: `${where} (${body.length} знаков)\n${body.slice(0, 400)}` });
    }
  }
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  const dumpIndex = process.argv.indexOf("--dump");
  const dumpPath = dumpIndex > 0 ? process.argv[dumpIndex + 1] : null;

  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  files.sort();

  const totals = { owner: 0, agent: 0, "agent-wrote": 0, "agent-proposed": 0 } as Record<Who, number>;
  const counts = { owner: 0, agent: 0, "agent-wrote": 0, "agent-proposed": 0 } as Record<Who, number>;
  let rawBytes = 0;
  const dumped: Line[] = [];

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    rawBytes += text.length;
    const lines: Line[] = [];
    for (const raw of text.split("\n")) {
      if (raw.trim() === "") continue;
      let record: Raw;
      try {
        record = JSON.parse(raw) as Raw;
      } catch {
        continue;
      }
      collect(record, lines);
    }
    for (const line of lines) {
      totals[line.who] += line.text.length;
      counts[line.who] += 1;
      if (dumpPath) dumped.push({ ...line, text: `${line.text}` });
    }
  }

  const stream = Object.values(totals).reduce((sum, part) => sum + part, 0);
  console.log(`файлов: ${files.length}, транскрипт ${(rawBytes / 1048576).toFixed(1)} МБ\n`);
  console.log(`${"кто".padEnd(16)} ${"штук".padStart(7)} ${"объём".padStart(10)}  доля`);
  for (const who of ["owner", "agent", "agent-wrote", "agent-proposed"] as Who[]) {
    console.log(
      `${who.padEnd(16)} ${String(counts[who]).padStart(7)} `
      + `${(totals[who] / 1024).toFixed(0).padStart(8)} КБ  ${((totals[who] / rawBytes) * 100).toFixed(2)}%`,
    );
  }
  console.log(`\nпоток решений: ${(stream / 1024).toFixed(0)} КБ = ${((stream / rawBytes) * 100).toFixed(1)}% `
    + `транскрипта, ≈${Math.round(stream / 3.2).toLocaleString("ru")} токенов`);

  if (dumpPath) {
    // JSONL: ответы сами содержат пустые строки, склейка через "\n\n" их режет.
    await writeFile(dumpPath, dumped.map((line) => JSON.stringify(line)).join("\n") + "\n", "utf8");
    console.log(`\nвыгружено в ${dumpPath} (${dumped.length} записей)`);
  }
}

await main();
