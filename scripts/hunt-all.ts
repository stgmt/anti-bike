/**
 * Поиск велосипедов по всем сессиям машинной проверкой, без модели.
 *
 * Признак: окно объявило своё имя и ни разу не вызвало его вне объявления,
 * при том что рядом в проекте есть готовое, которое проект зовёт.
 *
 * Пишет журнал в bench/hunt.jsonl — доказательства собираются по ходу,
 * чтобы упавший прогон не потерял найденное.
 */
import { appendFile, readdir, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { buildGraph } from "../src/astgraph.ts";

const ROOT = "C:/Users/stigm/.claude/projects";
const OUT = "bench/hunt.jsonl";
await writeFile(OUT, "", "utf8");

/** Проект транскрипта → репозиторий на диске. */
function repoOf(project: string): string | null {
  const base = project.split("--claude-worktrees")[0].replace(/^[eE]--/, "E--");
  const path = base.replace(/^E--/, "E:/").replace(/--/g, "/").replace(/-/g, "/");
  return path;
}

async function chunksOf(file: string): Promise<{ code: string; source: string }[]> {
  const chunks: { code: string; source: string }[] = [];
  const lines = createInterface({ input: createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.includes("tool_use")) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const content = rec.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (b?.type !== "tool_use") continue;
      const input = b.input ?? {};
      if (typeof input.content === "string" && input.content.length > 200) chunks.push({ code: input.content, source: String(input.file_path ?? "?") });
      if (typeof input.new_string === "string" && input.new_string.length > 200) chunks.push({ code: input.new_string, source: String(input.file_path ?? "?") });
      if (typeof input.code === "string" && input.code.length > 200) chunks.push({ code: input.code, source: `[${b.name}]` });
    }
  }
  return chunks;
}

const projects = await readdir(ROOT);
let scanned = 0, withDecl = 0, orphaned = 0;
for (const project of projects) {
  let files: string[];
  try { files = (await readdir(`${ROOT}/${project}`)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
  for (const file of files) {
    const chunks = await chunksOf(`${ROOT}/${project}/${file}`);
    if (chunks.length < 3) continue;
    scanned += 1;
    const g = buildGraph(chunks);
    if (g.declared.length === 0) continue;
    withDecl += 1;
    // Своё: объявлено, ни разу не вызвано вне объявления.
    const orphans = g.declared.filter((d) => (g.outside.get(d.name) ?? 0) === 0);
    if (orphans.length === 0) continue;
    orphaned += 1;
    await appendFile(OUT, JSON.stringify({
      project, file,
      repo: repoOf(project),
      declared: g.declared.length,
      orphanNames: orphans.map((d) => d.name).slice(0, 40),
    }) + "\n", "utf8");
  }
}
console.log(`сессий с кодом: ${scanned}`);
console.log(`  с объявлениями: ${withDecl}`);
console.log(`  с неподключённым своим кодом: ${orphaned}`);
