/**
 * Второй проход: арбитр по парам, которые прошли форму.
 *
 * Берёт отчёт полного прогона и спрашивает у модели про каждую пару, одна ли
 * у них работа. Платно, поэтому список пар сначала печатается.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { functionsIn } from "../src/bodies.ts";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { judgePairCached } from "../src/verdict.ts";

const KEY_FILE = process.env.ANTIBIKE_KEY_FILE;
if (!KEY_FILE) throw new Error("нужен ANTIBIKE_KEY_FILE — env с ключом OpenRouter");
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];

interface Hit {
  project: string;
  checkout: string;
  window: string;
  ts: string;
  own: string;
  ready: string;
  readyFile: string;
  shape: number;
  topic: number;
  tokens: number;
  readyUses: number;
  ownUses: number;
}

const report = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as { hits: Hit[] };
const PROJECTS = process.env.ANTIBIKE_PROJECTS ?? `${process.env.USERPROFILE ?? process.env.HOME}/.claude/projects`;

// Пары по правилу подключённости: готовое живое, своё нет.
const RULE = process.env.RULE !== "off";
const pairs = report.hits.filter((h) => (RULE ? h.readyUses >= 3 && h.ownUses === 0 : true) && h.tokens >= 40);
const unique = new Map<string, Hit>();
for (const h of pairs) {
  const key2 = `${h.own}|${h.ready}`;
  if (!unique.has(key2)) unique.set(key2, h);
}
console.log(`пар после правила: ${unique.size} (из ${report.hits.length} находок)`);

// Своё тело ищем по транскрипту окна, готовое — в файле репозитория.
const bodyCache = new Map<string, { name: string; body: string }[]>();

async function ownBody(h: Hit): Promise<{ name: string; body: string } | null> {
  const projectDir = `${PROJECTS}/${h.project}`;
  const prefix = h.window.slice(11);
  // Своё тело бывает и у субагента: <сессия>/subagents/agent-*.jsonl. Раньше
  // субагенты искались только когда прямого файла сессии нет, и пары, где
  // функция написана субагентом, молча терялись — 8 из 30.
  const candidates: string[] = [];
  const direct = (await import("node:fs")).readdirSync(projectDir).find((f) => f.startsWith(prefix) && f.endsWith(".jsonl"));
  if (direct) candidates.push(`${projectDir}/${direct}`);
  for (const entry of (await import("node:fs")).readdirSync(projectDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      for (const f of (await import("node:fs")).readdirSync(`${projectDir}/${entry.name}/subagents`)) {
        if (f.startsWith("agent-") && f.endsWith(".jsonl")) candidates.push(`${projectDir}/${entry.name}/subagents/${f}`);
      }
    } catch {}
  }
  if (candidates.length === 0) return null;
  const cacheKey = candidates.join("|");
  let fns = bodyCache.get(cacheKey);
  if (!fns) {
    fns = [];
    const byName = new Map<string, { name: string; body: string }>();
    for (const single of candidates) {
    const lines = createInterface({
      input: createReadStream(single, { encoding: "utf8" }),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      if (!line.includes("tool_use")) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      const c = rec.message?.content;
      if (!Array.isArray(c)) continue;
      for (const b of c) {
        if (b?.type !== "tool_use") continue;
        if (b.name !== "Write" && b.name !== "Edit") continue;
        const p = String(b.input?.file_path ?? "").split("\\").join("/");
        const body =
          typeof b.input?.content === "string" ? b.input.content : typeof b.input?.new_string === "string" ? b.input.new_string : "";
        if (!body) continue;
        for (const fn of functionsIn(body, p)) {
          const prev = byName.get(fn.name);
          if (!prev || fn.body.length > prev.body.length) byName.set(fn.name, { name: fn.name, body: fn.body });
        }
      }
    }
    }
    fns = [...byName.values()];
    bodyCache.set(cacheKey, fns);
  }
  return fns.find((f) => f.name === h.own) ?? null;
}

const results: (Hit & { same: boolean; why: string })[] = [];
for (const h of unique.values()) {
  const own = await ownBody(h);
  // Чекаут берём из находки: один проект транскриптов пишет и в tokenplan,
  // и в agent-teams-ai, поэтому таблица «проект → репозиторий» врала.
  const checkout = h.checkout;
  if (!own || !checkout) {
    console.log(`  пропуск ${h.own}: ${!own ? "нет своего тела" : "нет чекаута"}`);
    continue;
  }
  const readyFns = functionsIn(readFileSync(`${checkout}/${h.readyFile}`, "utf8"), h.readyFile);
  const ready = readyFns.find((f) => f.name === h.ready);
  if (!ready) {
    console.log(`  пропуск ${h.own}: нет готового тела в ${h.readyFile}`);
    continue;
  }
  const verdict = await judgePairCached({ name: own.name, body: own.body }, { name: ready.name, body: ready.body }, { apiKey: key });
  results.push({ ...h, same: verdict.same, why: verdict.why });
  console.log(`  ${verdict.same ? "ВЕЛОСИПЕД" : "нет     "}  ${h.own} → ${h.ready}  (${verdict.why})`);
}

writeFileSync(process.argv[3] ?? "antibike-arbitrated.json", JSON.stringify(results, null, 1), "utf8");
const yes = results.filter((r) => r.same);
console.log(`\nвсего пар: ${results.length}, велосипедов: ${yes.length}`);
for (const r of yes.sort((a, b) => b.shape - a.shape)) {
  console.log(`  ${r.shape.toFixed(3)}  ${r.own} → ${r.ready}  [${r.readyFile}]  ${r.project}`);
}
