/**
 * Проверка одного окна машинным признаком RepoReuse.
 *
 * Вход: транскрипт и проект. Выход: что окно объявило своим, что из готового
 * оно вызвало, и какие готовые механизмы по тому же предмету остались не
 * позваны. Без модели: всё по коду.
 */
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildGraph, callsIn, declarationsIn } from "../src/astgraph.ts";

const run = promisify(execFile);

export interface WindowVerdict {
  declared: number;
  own: string[];
  readyCalled: string[];
  readyByTopic: string[];
  verdict: "bike" | "own-work" | "no-signal";
  why: string;
}

const TOPIC = /(effort|catalog|launch|probe|retry|mutex|lockfile|queue|fallback|atomic|rename|lock)/i;

export async function verifyWindow(file: string, repo: string): Promise<WindowVerdict> {
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
  const g = buildGraph(chunks);
  if (g.declared.length === 0) return { declared: 0, own: [], readyCalled: [], readyByTopic: [], verdict: "no-signal", why: "окно не объявило ничего" };

  const own = g.declared.filter((d) => (g.outside.get(d.name) ?? 0) === 0).map((d) => d.name);
  if (!existsSync(repo)) return { declared: g.declared.length, own, readyCalled: [], readyByTopic: [], verdict: "no-signal", why: `нет репозитория ${repo}` };

  const root = existsSync(`${repo}/src`) ? "src" : ".";
  let stdout = "";
  try {
    ({ stdout } = await run("rg", ["-n", "--no-heading", "-g", "*.ts", "-g", "*.tsx", "-g", "*.js", "-g", "!*test*", "-g", "!node_modules", ".", root],
      { cwd: repo, maxBuffer: 512 * 1024 * 1024, timeout: 60_000 }));
  } catch { /* репо пустое */ }

  const readyDecl = declarationsIn(stdout, repo);
  const readyCalls = callsIn(stdout);
  const ready = readyDecl.filter((d) => readyCalls.has(d.name));
  const readyCalled = ready.filter((d) => g.called.has(d.name)).map((d) => d.name);
  const notCalled = ready.filter((d) => !g.called.has(d.name));
  const ownTopic = own.filter((n) => TOPIC.test(n));
  const readyByTopic = notCalled.filter((d) => TOPIC.test(d.name)).map((d) => d.name);

  if (ownTopic.length > 0 && readyByTopic.length > 0) {
    return { declared: g.declared.length, own, readyCalled, readyByTopic, verdict: "bike",
      why: `своё по предмету (${ownTopic.slice(0, 3).join(", ")}) при непозванном готовом (${readyByTopic.slice(0, 3).join(", ")})` };
  }
  return { declared: g.declared.length, own, readyCalled, readyByTopic, verdict: "own-work",
    why: ownTopic.length === 0 ? "своё не по готовому предмету" : "готовое того же предмета окно позвало" };
}

if (process.argv[1]?.endsWith("verify-window.ts")) {
  const [file, repo] = process.argv.slice(2);
  const v = await verifyWindow(file!, repo!);
  console.log(JSON.stringify(v, null, 2));
}
