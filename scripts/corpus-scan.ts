/**
 * Прогон по всем транскриптам: какие окна писали код и в какие репозитории.
 *
 * Корень проекта ищется по маркеру вверх от файла: `.git`, `package.json`,
 * `pyproject.toml`, `go.mod`. Прежняя версия знала только `/src/` и теряла
 * окна, которые писали в worktrees и во временные копии (`E:/tmp/...`).
 */
import { readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";

const ROOT = "C:/Users/stigm/.claude/projects";
const OUT = process.argv[2] ?? "C:/Users/stigm/AppData/Local/Temp/antibike-scan.json";

const EXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|go|java|cs|rs)$/;
const TEST = /\.(test|spec)\.|\.testCases\.|(^|\/)test_|(^|\/)tests\/|_test\.go$|Test\.java$/;
const MARKERS = [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml"];

/** Ближайший вверх каталог с признаком проекта. */
function projectRootOf(file: string): string | null {
  const norm = file.split("\\").join("/");
  let dir = dirname(norm);
  for (let i = 0; i < 12; i += 1) {
    for (const marker of MARKERS) {
      if (existsSync(`${dir}/${marker}`)) return dir;
    }
    const up = dirname(dir);
    if (up === dir || up === "." ) break;
    dir = up;
  }
  return null;
}

interface WindowInfo {
  project: string;
  file: string;
  repos: Record<string, { files: number; bytes: number }>;
  edits: number;
  first: string;
  last: string;
}

const out: WindowInfo[] = [];
const projects = readdirSync(ROOT);
let seen = 0;
for (const project of projects) {
  const dir = `${ROOT}/${project}`;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    continue;
  }
  // Транскрипты субагентов лежат в <сессия>/subagents/*.jsonl. Замер: их 906
  // при 170 сессиях верхнего уровня, и правки кода идут оттуда же.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      for (const f of readdirSync(`${dir}/${entry.name}/subagents`)) {
        if (f.endsWith(".jsonl")) files.push(`${entry.name}/subagents/${f}`);
      }
    } catch {}
  }
  for (const name of files) {
    const path = `${dir}/${name}`;
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      continue;
    }
    if (size < 2000) continue;
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    const repos = new Map<string, { files: number; bytes: number }>();
    let edits = 0;
    let first = "";
    let last = "";
    for await (const line of lines) {
      if (!line.includes("tool_use")) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const ts = String(rec.timestamp ?? "");
      if (ts) {
        if (!first) first = ts;
        last = ts;
      }
      const content = rec.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content) {
        if (b?.type !== "tool_use") continue;
        if (b.name !== "Write" && b.name !== "Edit") continue;
        const input = b.input ?? {};
        const raw = String(input.file_path ?? "");
        if (!raw) continue;
        const norm = raw.split("\\").join("/");
        if (!EXT.test(norm) || TEST.test(norm)) continue;
        const body =
          typeof input.content === "string" ? input.content : typeof input.new_string === "string" ? input.new_string : "";
        if (!body) continue;
        edits += 1;
        const root = projectRootOf(raw);
        if (!root) continue;
        const entry = repos.get(root) ?? { files: 0, bytes: 0 };
        entry.files += 1;
        entry.bytes += body.length;
        repos.set(root, entry);
      }
    }
    seen += 1;
    if (repos.size === 0) continue;
    out.push({ project, file: name, repos: Object.fromEntries(repos), edits, first, last });
    if (out.length % 40 === 0) process.stderr.write(`  окон с кодом: ${out.length}\n`);
  }
}

writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");
const repos = new Map<string, number>();
for (const w of out) for (const r of Object.keys(w.repos)) repos.set(r, (repos.get(r) ?? 0) + 1);
console.log(`прочитано окон: ${seen}, с правками кода: ${out.length}`);
console.log(`репозиториев: ${repos.size}`);
for (const [r, n] of [...repos].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)} окон  ${r}`);
}
console.log(`\nсписок: ${OUT}`);
