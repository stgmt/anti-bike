/**
 * Что агент сделал до претензии автора.
 *
 * От претензии назад: собираем ходы агента до предыдущей реплики владельца —
 * это и есть окно, в котором родился велосипед.
 *
 * Запуск: node --experimental-strip-types scripts/before-complaint.ts <проект> "<фраза>"
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = "C:/Users/stigm/.claude/projects";

interface Raw {
  type?: string;
  isCompactSummary?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

interface Piece {
  who: "owner" | "agent" | "tool";
  text: string;
  tool?: string;
}

function pieces(raw: string): Piece[] {
  const out: Piece[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    let record: Raw;
    try {
      record = JSON.parse(line) as Raw;
    } catch {
      continue;
    }
    if (record.type === "api-request-blob") continue;
    if (record.isCompactSummary || record.isMeta) continue;
    const content = record.message?.content;
    const role = record.message?.role ?? record.type;

    if (record.type === "user" || role === "user") {
      if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) continue;
      const text = typeof content === "string" ? content : "";
      if (text.trim() !== "" && !text.startsWith("<")) out.push({ who: "owner", text });
      continue;
    }
    if (record.type !== "assistant" || !Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const item = block as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
      if (item.type === "text" && (item.text ?? "").trim() !== "") {
        out.push({ who: "agent", text: item.text ?? "" });
        continue;
      }
      if (item.type !== "tool_use") continue;
      const input = item.input ?? {};
      const body = (input.content ?? input.new_string ?? input.command ?? "") as unknown;
      const text = typeof body === "string" ? body : JSON.stringify(body);
      out.push({ who: "tool", text, tool: item.name ?? "?" });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const project = process.argv[2];
  const phrase = process.argv[3];
  const dir = join(ROOT, project);
  for (const file of (await readdir(dir)).filter((name) => name.endsWith(".jsonl"))) {
    const raw = await readFile(join(dir, file), "utf8");
    if (!raw.includes(phrase)) continue;
    const list = pieces(raw);
    const at = list.findIndex((item) => item.who === "owner" && item.text.includes(phrase));
    if (at < 0) {
      console.log(`${file.slice(0, 8)}: реплика не найдена среди ходов`);
      continue;
    }
    let start = at - 1;
    while (start >= 0 && list[start].who !== "owner") start -= 1;
    start += 1;
    const window = list.slice(start, at);
    console.log(`файл ${file.slice(0, 8)}: претензия на ходе ${at}, окно ${start}..${at - 1} (${window.length} ходов)`);

    const tools = window.filter((item) => item.who === "tool");
    const writes = tools.filter((item) => ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(item.tool ?? ""));
    console.log(`  вызовов ${tools.length}, из них записей файлов ${writes.length}`);
    const counts = new Map<string, number>();
    for (const item of tools) counts.set(item.tool ?? "?", (counts.get(item.tool ?? "?") ?? 0) + 1);
    console.log(`  инструменты: ${[...counts.entries()].map(([n, c]) => `${n}×${c}`).join(", ")}`);

    const text = window
      .map((item) => (item.who === "tool" ? `[${item.tool}] ${item.text}` : item.text))
      .join("\n\n");
    await writeFile(`bench/tokenplan-window.txt`, text, "utf8");
    console.log(`  выгружено ${text.length} знаков в bench/tokenplan-window.txt\n`);
    console.log(text.replace(/\s+/g, " ").slice(0, 700));
  }
}

await main();
