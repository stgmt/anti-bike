/**
 * Проверка AST-графа зависимостей на живых данных.
 *
 * Вопрос: можно ли из транскрипта достать, ЧТО агент написал и ЧТО вызвал.
 * RepoReuse считает reuse по вызову: есть ребро вызова — использовал,
 * нет — переписал. Проверяем, есть ли у нас такие данные.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const FILE = "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const stream = createReadStream(FILE, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

let toolCalls = 0, withContent = 0, shell = 0, shellsWithDefs = 0;
const tools = new Map<string, number>();
const samples: string[] = [];

for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b?.type !== "tool_use") continue;
    toolCalls += 1;
    const name = b.name ?? "?";
    tools.set(name, (tools.get(name) ?? 0) + 1);
    const input = b.input ?? {};
    // 1. Прямая запись: тело файла есть.
    if (typeof input.content === "string" && input.content.length > 0) withContent += 1;
    // 2. Правка через оболочку: тело внутри команды.
    const cmd = typeof input.command === "string" ? input.command : "";
    if (cmd) {
      shell += 1;
      // Есть ли в команде объявление функции или класса?
      if (/(function\s+\w+|class\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|def\s+\w+|export\s+(?:async\s+)?function)/.test(cmd)) {
        shellsWithDefs += 1;
        if (samples.length < 3) samples.push(cmd.slice(0, 400));
      }
    }
    // 3. ctx_execute: код внутри input.
    if (typeof input.code === "string" && input.code.length > 0) {
      if (/(function\s+\w+|class\s+\w+|export\s+(?:async\s+)?function)/.test(input.code)) {
        shellsWithDefs += 1;
        if (samples.length < 3) samples.push("[code] " + input.code.slice(0, 400));
      }
    }
  }
}

console.log(`вызовов инструментов: ${toolCalls}`);
console.log(`  с телом файла (Write/Edit): ${withContent}`);
console.log(`  через оболочку (Bash): ${shell}`);
console.log(`  оболочек с объявлениями: ${shellsWithDefs}`);
console.log(`\nинструменты:`);
for (const [n, c] of [...tools.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${n}: ${c}`);
console.log(`\nпримеры объявлений в оболочке:`);
for (const s of samples) console.log(`  ${s.replace(/\s+/g, " ").slice(0, 200)}`);
