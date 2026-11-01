/**
 * Из чего состоит настоящий транскрипт: где байты и где смысл.
 *
 * Вызов Stop-хука получает путь к транскрипту. Один час работы агента — это
 * 89 МБ (≈22 млн токенов), в контекст это не влезет ни у одной модели.
 * Здесь считается, какая доля приходится на прочитанные файлы (tool_result),
 * на текст агента и на его вызовы инструментов. От этого зависит, что вообще
 * можно отдать самаризатору.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface Raw {
  type?: string;
  message?: { role?: string; content?: unknown };
}

interface Shard {
  assistantText: number;
  assistantThinking: number;
  toolUseName: number;
  toolUseInput: number;
  toolResultText: number;
  toolResultOther: number;
  other: number;
}

const EMPTY: Shard = {
  assistantText: 0,
  assistantThinking: 0,
  toolUseName: 0,
  toolUseInput: 0,
  toolResultText: 0,
  toolResultOther: 0,
  other: 0,
};

function sizeOf(value: unknown): number {
  if (typeof value === "string") return value.length;
  if (value === null || value === undefined) return 0;
  return JSON.stringify(value).length;
}

function add(into: Shard, content: unknown, role: string | undefined): void {
  if (typeof content === "string") {
    if (role === "assistant") into.assistantText += content.length;
    else into.toolResultText += content.length;
    return;
  }
  if (!Array.isArray(content)) {
    into.other += sizeOf(content);
    return;
  }
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const item = block as { type?: string; text?: string; thinking?: string; name?: string; input?: unknown };
    switch (item.type) {
      case "text":
        if (role === "assistant") into.assistantText += sizeOf(item.text);
        else into.toolResultText += sizeOf(item.text);
        break;
      case "thinking":
        into.assistantThinking += sizeOf(item.thinking);
        break;
      case "tool_use":
        into.toolUseName += sizeOf(item.name);
        into.toolUseInput += sizeOf(item.input);
        break;
      case "tool_result":
        into.toolResultText += sizeOf((block as { content?: unknown }).content);
        break;
      default:
        into.toolResultOther += sizeOf(block);
    }
  }
}

function mb(chars: number): string {
  return (chars / 1048576).toFixed(2).padStart(7);
}

function share(part: number, total: number): string {
  return `${((part / Math.max(total, 1)) * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) {
    console.error("нужно: scripts/transcript-shape.ts <каталог проекта>");
    process.exit(2);
  }
  const files = (await readdir(dir)).filter((name) => name.endsWith(".jsonl"));
  files.sort();

  for (const file of files) {
    const text = await readFile(join(dir, file), "utf8");
    const total = text.length;
    const shard = { ...EMPTY };
    let turns = 0;
    let assistantTurns = 0;
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let record: Raw;
      try {
        record = JSON.parse(line) as Raw;
      } catch {
        shard.other += line.length;
        continue;
      }
      turns += 1;
      if (record.type === "assistant") assistantTurns += 1;
      add(shard, record.message?.content, record.message?.role ?? record.type);
    }
    const useful = shard.assistantText + shard.toolUseInput + shard.toolUseName;
    console.log(`\n${file}  (${(total / 1048576).toFixed(1)} МБ, записей ${turns}, ответов агента ${assistantTurns})`);
    console.log(`  текст агента        ${mb(shard.assistantText)} МБ ${share(shard.assistantText, total)}`);
    console.log(`  рассуждение         ${mb(shard.assistantThinking)} МБ ${share(shard.assistantThinking, total)}`);
    console.log(`  вход инструментов   ${mb(shard.toolUseInput)} МБ ${share(shard.toolUseInput, total)}`);
    console.log(`  выход инструментов  ${mb(shard.toolResultText)} МБ ${share(shard.toolResultText, total)}`);
    console.log(`  прочее              ${mb(shard.toolResultOther + shard.other)} МБ ${share(shard.toolResultOther + shard.other, total)}`);
    console.log(`  → смысл без чтений: ${mb(useful)} МБ ${share(useful, total)}`);
  }
}

await main();
