/**
 * Проверка AST-графа на подтверждённом велосипеде.
 *
 * Ожидание: createAnthropicEffortProbe объявлен в окне и ни разу не вызван
 * как готовое — это велосипед. Штатная проверка resolveAnthropicEffortSupport
 * у проекта есть, но окно её не использовало.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { buildGraph, bikes } from "../src/astgraph.ts";

const FILE = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const stream = createReadStream(FILE, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });

const chunks: { code: string; source: string }[] = [];
for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b?.type !== "tool_use") continue;
    const input = b.input ?? {};
    const where = String(input.file_path ?? input.path ?? b.name ?? "?");
    if (typeof input.content === "string") chunks.push({ code: input.content, source: where });
    if (typeof input.new_string === "string") chunks.push({ code: input.new_string, source: where });
    if (typeof input.code === "string") chunks.push({ code: input.code, source: `[${b.name}]` });
    if (typeof input.command === "string") chunks.push({ code: input.command, source: "[Bash]" });
  }
}

const g = buildGraph(chunks);
console.log(`кусков: ${chunks.length}, объявлений: ${g.declared.length}, вызовов: ${g.called.size}`);

// Имена, которые были в проекте до окна: всё, что вызывает само окно из готового.
const BEFORE = new Set(["resolveAnthropicEffortSupport", "providerPrepareDiagnostics", "TeamModelSelector", "runProviderPrepareDiagnostics"]);
const found = bikes(g, BEFORE, g.outside);

console.log(`\nобъявлено в окне и ни разу не вызвано: ${found.length}`);
for (const d of found.slice(0, 15)) console.log(`  ${d.kind.padEnd(6)} ${d.name.padEnd(42)} ${d.source.split("\\").join("/").split("/").pop()?.slice(0, 40)}`);

const target = g.declared.find((d) => d.name === "createAnthropicEffortProbe");
console.log(`\nэталон createAnthropicEffortProbe: ${target ? "ОБЪЯВЛЕН ✓" : "не найден ✗"}`);
console.log(`  вызовов вне своего объявления: ${g.outside.get("createAnthropicEffortProbe") ?? 0}`);
