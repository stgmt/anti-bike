/**
 * Полный прогон: все транскрипты, все репозитории, один отчёт.
 *
 * Порядок: окна → группировка по чекауту (ближайший `.git`) → корпус
 * репозитория строится один раз → детектор по каждому окну.
 *
 * Корень по `.git`, а не по `go.mod`/`package.json`: подпакеты тех же
 * репозиториев (`gateway`, `agent-teams-controller`) иначе считались бы
 * отдельными репозиториями, и готовое искалось бы только внутри подпакета.
 */
import { readdirSync, statSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { dirname } from "node:path";
import { corpus, countUses, detectBikes, relativeTo, readyFunctions, type WindowFunction } from "../src/detect.ts";
import { functionsIn } from "../src/bodies.ts";
import { absoluteOf, existedAt } from "../src/history.ts";

const ROOT = "C:/Users/stigm/.claude/projects";
const OUT = process.argv[2] ?? "C:/Users/stigm/AppData/Local/Temp/antibike-all.json";
const REPORT = process.argv[3] ?? "C:/Users/stigm/AppData/Local/Temp/antibike-all.txt";

const EXT = /\.(ts|tsx|js|mjs|cjs|jsx|py|go)$/;
const TEST = /\.(test|spec)\.|\.testCases\.|(^|\/)test_|(^|\/)tests\/|_test\.go$|(^|\/)conftest\.py$/;

/** Известные копии репозиториев, которых уже нет на диске. */
const ALIASES: [RegExp, string][] = [
  [/^E:\/tmp\/pub\/merge/, "E:/repos/agent-teams-ai"],
  [/^E:\/tmp\/agentteams-live-fix/, "E:/repos/agent-teams-ai"],
];

function checkoutOf(file: string): string | null {
  const norm = file.split("\\").join("/");
  const alias = ALIASES.find(([re]) => re.test(norm));
  if (alias) return alias[1];
  let dir = dirname(norm);
  for (let i = 0; i < 14; i += 1) {
    if (existsSync(`${dir}/.git`)) return dir;
    const up = dirname(dir);
    if (up === dir || up === ".") break;
    dir = up;
  }
  return null;
}

interface Hit {
  project: string;
  /** Чекаут, где лежит готовое: один проект транскриптов бывает у двух репозиториев. */
  checkout: string;
  window: string;
  ts: string;
  edit: number;
  own: string;
  ready: string;
  readyFile: string;
  shape: number;
  topic: number;
  tokens: number;
  readyUses: number;
  ownUses: number;
}

interface WindowRecord {
  project: string;
  file: string;
  checkout: string;
  first: string;
  last: string;
  edits: number;
  /** Своё: имя → тело (самое длинное). */
  written: { name: string; body: string; source: string; via: "Write" | "Edit" }[];
}

const windows: WindowRecord[] = [];
let scanned = 0;

for (const project of readdirSync(ROOT)) {
  const dir = `${ROOT}/${project}`;
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    continue;
  }
  // Субагенты: <сессия>/subagents/*.jsonl — их 906 при 170 сессиях верхнего
  // уровня, и правки кода идут оттуда тоже.
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
    try {
      if (statSync(path).size < 2000) continue;
    } catch {
      continue;
    }
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    const byName = new Map<string, WindowRecord["written"][number]>();
    const checkouts = new Map<string, number>();
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
        const checkout = checkoutOf(raw);
        if (!checkout) continue;
        edits += 1;
        checkouts.set(checkout, (checkouts.get(checkout) ?? 0) + 1);
        for (const fn of functionsIn(body, norm)) {
          const prev = byName.get(fn.name);
          if (!prev || fn.body.length > prev.body.length) {
            byName.set(fn.name, { name: fn.name, body: fn.body, source: norm, via: b.name === "Write" ? "Write" : "Edit" });
          }
        }
      }
    }
    scanned += 1;
    if (checkouts.size === 0 || byName.size === 0) continue;
    // Окно могло писать в два чекаута; берём тот, куда писал больше.
    const [checkout] = [...checkouts].sort((a, b) => b[1] - a[1])[0]!;
    windows.push({ project, file: name, checkout, first, last, edits, written: [...byName.values()] });
    if (windows.length % 20 === 0) process.stderr.write(`  окон: ${windows.length}\n`);
  }
}

console.error(`прочитано: ${scanned}, окон с кодом: ${windows.length}`);

// Группировка: корпус строится один раз на чекаут.
const byCheckout = new Map<string, WindowRecord[]>();
for (const w of windows) {
  const list = byCheckout.get(w.checkout) ?? [];
  list.push(w);
  byCheckout.set(w.checkout, list);
}

const hits: Hit[] = [];
const repoRows: { checkout: string; windows: number; ready: number; hits: number; missing: boolean }[] = [];

for (const [checkout, list] of byCheckout) {
  if (!existsSync(checkout)) {
    repoRows.push({ checkout, windows: list.length, ready: 0, hits: 0, missing: true });
    continue;
  }
  const writtenFiles = new Set<string>();
  for (const w of list) for (const fn of w.written) writtenFiles.add(relativeTo(fn.source, checkout));
  const exts = [...new Set([...writtenFiles].map((f) => f.split(".").pop()!).filter(Boolean))];
  // Корни ищем по факту: репозитории разные, и жёсткий список уже терял
  // `src/presentation_reels` (лежит в `python/`) — 0 готовых у 57 окон.
  // Корни — по факту, а не списком: у carousel-demo код в `carousel/`, у
  // ai_halava в `halava/`. Список терял репозитории целиком.
  const ready = readyFunctions(checkout, writtenFiles, undefined, exts);
  const c = corpus(ready);

  // Частоты имён по исходникам того же чекаута.
  const texts: string[] = [];
  const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor", "site"]);
  const walk = (dirRel: string, d: number): void => {
    if (d > 6) return;
    let entries;
    try {
      entries = readdirSync(`${checkout}/${dirRel}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dirRel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(rel, d + 1);
        continue;
      }
      if (!exts.some((x) => e.name.endsWith(`.${x}`)) || TEST.test(e.name)) continue;
      try {
        texts.push(readFileSync(`${checkout}/${rel}`, "utf8"));
      } catch {}
    }
  };
  const skipDirs = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor", "site", "__pycache__", ".mypy_cache"]);
  const walkAll = (dirRel: string, d: number): void => {
    if (d > 8) return;
    let entries;
    try {
      entries = readdirSync(`${checkout}/${dirRel}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dirRel}/${e.name}`;
      if (e.isDirectory()) {
        if (!skipDirs.has(e.name) && !e.name.startsWith(".")) walkAll(rel, d + 1);
        continue;
      }
      if (!exts.some((x) => e.name.endsWith(`.${x}`)) || TEST.test(e.name)) continue;
      try {
        texts.push(readFileSync(`${checkout}/${rel}`, "utf8"));
      } catch {}
    }
  };
  walkAll(".", 0);
  const uses = countUses(texts);

  let repoHits = 0;
  for (const w of list) {
    const wf: WindowFunction[] = w.written.map((fn) => ({
      fn: { name: fn.name, body: fn.body, source: fn.source, shape: "" },
      via: fn.via,
    }));
    const result = detectBikes(wf, c, { uses });
    for (const v of result.verdicts) {
      // Готовое должно было существовать на момент окна. Файл, добавленный
      // позже, велосипедом быть не может: сравнивать не с чем. Неизвестный
      // файл (не в git, или временный) не отбрасываем — помечаем.
      const before = existedAt(absoluteOf(checkout, v.readyFile), w.first);
      if (before === false) continue;
      repoHits += 1;
      hits.push({
        project: w.project,
        checkout: w.checkout,
        window: `${w.first.slice(0, 10)} ${w.file.slice(0, 8)}`,
        ts: w.first,
        edit: w.edits,
        own: v.own,
        ready: v.ready,
        readyFile: v.readyFile,
        shape: v.shape,
        topic: v.topic,
        tokens: v.tokens,
        readyUses: v.readyUses,
        ownUses: v.ownUses,
      });
    }
  }
  repoRows.push({ checkout, windows: list.length, ready: ready.length, hits: repoHits, missing: false });
  console.error(`  ${checkout}: окон ${list.length}, готовых ${ready.length}, находок ${repoHits}`);
}

hits.sort((a, b) => b.shape - a.shape || a.ts.localeCompare(b.ts));
writeFileSync(OUT, JSON.stringify({ hits, repos: repoRows, windows: windows.length }, null, 1), "utf8");

const lines: string[] = [];
lines.push(`окон с кодом: ${windows.length}`);
lines.push(`чекаутов: ${repoRows.length}`);
for (const r of repoRows.sort((a, b) => b.hits - a.hits)) {
  lines.push(`  ${String(r.hits).padStart(4)} находок  ${String(r.windows).padStart(3)} окон  ${String(r.ready).padStart(6)} готовых  ${r.missing ? "нет на диске " : ""}${r.checkout}`);
}
lines.push("");
lines.push(`всего находок: ${hits.length}`);
lines.push("");
lines.push("по порядку формы:");
for (const h of hits) {
  lines.push(
    `${h.shape.toFixed(3)} предм ${h.topic.toFixed(2)} ток ${String(h.tokens).padStart(4)} готовое ${String(h.readyUses).padStart(3)}× своё ${String(h.ownUses).padStart(3)}×  ${h.own} → ${h.ready}  [${h.readyFile}]  ${h.project} ${h.window}`,
  );
}
writeFileSync(REPORT, lines.join("\n"), "utf8");
console.log(lines.slice(0, 40).join("\n"));
console.log(`\nотчёт: ${REPORT}`);
