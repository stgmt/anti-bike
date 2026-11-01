/**
 * RepoReuse по-настоящему: чего окно НЕ вызвало из того, что зовёт проект.
 *
 * Метрика статьи — reuse rate: доля готовых целей, которые агент вызвал.
 * Считаем обратное: какие часто вызываемые функции проекта окно не зовёт.
 * И ровно это признак велосипеда: агент сделал своё, не позвав готовое.
 */
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { buildGraph, declarationsIn, callsIn } from "../src/astgraph.ts";

const run = promisify(execFile);
const FILE = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const REPO = "E:/repos/agent-teams-ai";

// 1. Граф окна.
const chunks: { code: string; source: string }[] = [];
const lines = createInterface({ input: createReadStream(FILE, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b?.type !== "tool_use") continue;
    const input = b.input ?? {};
    if (typeof input.content === "string") chunks.push({ code: input.content, source: String(input.file_path ?? "?") });
    if (typeof input.new_string === "string") chunks.push({ code: input.new_string, source: String(input.file_path ?? "?") });
    if (typeof input.code === "string") chunks.push({ code: input.code, source: `[${b.name}]` });
    if (typeof input.command === "string") chunks.push({ code: input.command, source: "[Bash]" });
  }
}
const g = buildGraph(chunks);
const windowCalls = new Set([...g.called]);

// 2. Что зовёт проект: частые вызовы в подсистеме, близкой к окну.
const dirs = [
  "src/main/services/team/provisioning",
  "src/features/anthropic-runtime-profile",
  "src/renderer/utils",
];
const callers = new Map<string, number>();
const decls = new Map<string, string>();
for (const dir of dirs) {
  const { stdout } = await run("rg", ["-n", "--no-heading", "-g", "*.ts", "-g", "!*test*", ".", dir], {
    cwd: REPO, maxBuffer: 32 * 1024 * 1024,
  }).catch(() => ({ stdout: "" }));
  const text = stdout;
  if (dir === dirs[0]) console.log(`DEBUG ${dir}: ${stdout.length} знаков`);
  for (const name of callsIn(text)) callers.set(name, (callers.get(name) ?? 0) + 1);
  for (const d of declarationsIn(text, dir)) if (!decls.has(d.name)) decls.set(d.name, dir);
}

// 3. Готовое, которое проект зовёт, а окно нет.
const missed = [...callers.entries()]
  .filter(([name, count]) => count >= 2 && decls.has(name) && !windowCalls.has(name))
  .sort((a, b) => b[1] - a[1]);

console.log(`вызовов в окне: ${windowCalls.size}`);
console.log(`готовых функций в подсистеме: ${decls.size}`);
console.log(`\nготовое, которое проект зовёт, а окно НЕ вызвало: ${missed.length}`);
for (const [name, count] of missed.slice(0, 18)) {
  const near = [...windowCalls].some((w) => w.toLowerCase().includes("effort") && name.toLowerCase().includes("effort"));
  console.log(`  ${name.padEnd(40)} вызовов в проекте ${String(count).padStart(3)}${near ? "   ← про effort" : ""}`);
}
