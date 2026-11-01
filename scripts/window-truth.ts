/**
 * Что окно на самом деле сделало с готовым.
 *
 * Вопрос: написал ли агент своё вместо готового, или воспользовался готовым.
 * Смотрим по коду окна: есть ли вызов готового и есть ли своё объявление.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { buildGraph, callsIn } from "../src/astgraph.ts";

const FILE = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
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
const all = chunks.map((c) => c.code).join("\n");

console.log(`объявлений в окне: ${g.declared.length}`);
console.log(`вызовов (имя+скобка): ${callsIn(all).size}\n`);

const READY = ["resolveAnthropicEffortSupport", "resolveAnthropicRuntimeSelection", "providerPrepareDiagnostics", "normalizeEffortLevels"];
console.log("готовое в подсистеме effort:");
for (const name of READY) {
  console.log(`  ${name.padEnd(38)} вызвано ${String(g.outside.get(name) ?? 0).padStart(3)} раз`);
}

console.log("\nчто окно объявило про effort:");
for (const d of g.declared) {
  if (!/effort/i.test(d.name)) continue;
  console.log(`  ${d.kind.padEnd(6)} ${d.name.padEnd(42)} вызвано вне объявления ${g.outside.get(d.name) ?? 0}`);
}
