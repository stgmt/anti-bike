/**
 * Проверка RepoReuse на подтверждённом велосипеде.
 *
 * Вопрос: находит ли путь «написано своё + готовое не вызвано + готовое похоже
 * по задаче» тот случай, который модель пропускала три раза подряд.
 */
import { createReadStream } from "node:fs";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { buildGraph } from "../src/astgraph.ts";
import { candidates, nearest } from "../src/reuse.ts";

const FILE = process.argv[2] ?? "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl";
const REPO = "E:/repos/agent-teams-ai";

const chunks: { code: string; source: string }[] = [];
const stream = createReadStream(FILE, { encoding: "utf8" });
const lines = createInterface({ input: stream, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.includes("tool_use")) continue;
  let rec: any;
  try { rec = JSON.parse(line); } catch { continue; }
  const content = rec.message?.content;
  if (!Array.isArray(content)) continue;
  for (const b of content) {
    if (b?.type !== "tool_use") continue;
    const input = b.input ?? {};
    const where = String(input.file_path ?? b.name ?? "?");
    if (typeof input.content === "string") chunks.push({ code: input.content, source: where });
    if (typeof input.new_string === "string") chunks.push({ code: input.new_string, source: where });
    if (typeof input.code === "string") chunks.push({ code: input.code, source: `[${b.name}]` });
    if (typeof input.command === "string") chunks.push({ code: input.command, source: "[Bash]" });
  }
}

const g = buildGraph(chunks);
console.log(`объявлений в окне: ${g.declared.length}`);

// Готовое: что уже было в проекте. Читаем по имени из подтверждённого случая.
const READY_FILES: [string, string][] = [
  ["resolveAnthropicEffortSupport", "src/features/anthropic-runtime-profile/core/domain/resolveAnthropicRuntimeProfile.ts"],
  ["normalizeEffortLevels", "src/features/anthropic-runtime-profile/core/domain/resolveAnthropicRuntimeProfile.ts"],
];
const ready = READY_FILES.map(([name, file]) => ({ name, body: readFileSync(`${REPO}/${file}`, "utf8") }));

const before = new Set(ready.map((r) => r.name));
const found = candidates({ declared: g.declared, outside: g.outside, before });
console.log(`кандидатов (написано, не вызвано, до окна не было): ${found.length}\n`);

const scored = found
  .map((c) => ({ ...c, near: nearest(c.decl, ready) }))
  .filter((c) => (c.near?.score ?? 0) > 0.15)
  .sort((a, b) => (b.near!.score) - (a.near!.score));

console.log(`похожих на готовое (порог 0,15): ${scored.length}`);
for (const c of scored.slice(0, 12)) {
  console.log(`  ${c.decl.name.padEnd(38)} ~ ${c.near!.name.padEnd(34)} ${(c.near!.score).toFixed(3)}`);
}

const target = scored.find((c) => c.decl.name === "createAnthropicEffortProbe");
console.log(`\nэталон createAnthropicEffortProbe: ${target ? `НАЙДЕН, похож на ${target.near!.name} (${target.near!.score.toFixed(3)})` : "не найден"}`);
