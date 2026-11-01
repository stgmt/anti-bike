/**
 * Второй проход: отсекаем законную новую работу.
 *
 * Признак велосипеда требует двух условий сразу (RepoReuse):
 *   1. своё объявлено и не подключено;
 *   2. рядом есть готовое, которое проект зовёт, а окно не позвало.
 *
 * Второе условие отделяет новую фичу от повторного изобретения.
 */
import { appendFile, readdir, writeFile } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildGraph, declarationsIn, callsIn } from "../src/astgraph.ts";

const run = promisify(execFile);
const ROOT = "C:/Users/stigm/.claude/projects";
const OUT = "bench/hunt2.jsonl";
await writeFile(OUT, "", "utf8");

const repoCache = new Map<string, Set<string>>();

function repoOf(project: string): string {
  const base = project.split("--claude-worktrees")[0].replace(/^[eE]--/, "E--");
  return base.replace(/^E--/, "E:/").replace(/--/g, "/").replace(/-/g, "/");
}

/** Имена, которые проект объявляет и зовёт: это и есть готовое. */
async function readyNames(repo: string): Promise<Set<string>> {
  const cached = repoCache.get(repo);
  if (cached) return cached;
  const names = new Set<string>();
  if (!existsSync(repo)) { repoCache.set(repo, names); return names; }
  try {
    const root = existsSync(`${repo}/src`) ? "src" : ".";
    const { stdout } = await run("rg", ["-n", "--no-heading", "-g", "*.ts", "-g", "*.tsx", "-g", "*.js", "-g", "!*test*", "-g", "!node_modules", ".", root], {
      cwd: repo, maxBuffer: 512 * 1024 * 1024, timeout: 60_000,
    });
    const calls = callsIn(stdout);
    for (const d of declarationsIn(stdout, repo)) {
      if (calls.has(d.name)) names.add(d.name);
    }
  } catch { /* репо нет — пустой набор */ }
  repoCache.set(repo, names);
  return names;
}

async function chunksOf(file: string) {
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
let sessions = 0, strict = 0;
for (const project of projects) {
  let files: string[];
  try { files = (await readdir(`${ROOT}/${project}`)).filter((n) => n.endsWith(".jsonl")); } catch { continue; }
  for (const file of files) {
    const chunks = await chunksOf(`${ROOT}/${project}/${file}`);
    if (chunks.length < 3) continue;
    const g = buildGraph(chunks);
    if (g.declared.length === 0) continue;
    sessions += 1;

    const repo = repoOf(project);
    const ready = await readyNames(repo);
    if (ready.size === 0) continue;

    const called = new Set([...g.called]);
    const orphans = g.declared.filter((d) => (g.outside.get(d.name) ?? 0) === 0);
    // Готовое, которое проект зовёт, а окно не позвало ни разу.
    const notCalled = [...ready].filter((n) => !called.has(n));
    if (orphans.length === 0 || notCalled.length === 0) continue;

    strict += 1;
    console.log(`  ${project}/${file.slice(0,8)}: своих ${orphans.length}, готовых не позвано ${notCalled.length}`);
    await appendFile(OUT, JSON.stringify({
      project, file, repo,
      declared: g.declared.length,
      ready: ready.size,
      notCalledCount: notCalled.length,
      orphanNames: orphans.map((d) => d.name),
      notCalledSample: notCalled.slice(0, 25),
    }) + "\n", "utf8");
  }
}
console.log(`сессий с объявлениями: ${sessions}`);
console.log(`прошли оба условия: ${strict}`);
