/**
 * Замер детектора по окнам: форма + предмет + подключённость.
 *
 * Разметка приходит от автора: реплика владельца про велосипед плюс окно
 * до неё. Совпало — если детектор назвал функцию, которую автор и просил
 * переделать.
 */
import { readFileSync, readdirSync } from "node:fs";
import { corpus, countUses, detectBikes, ownFunctions, readyFunctions, relativeTo } from "../src/detect.ts";

interface Case {
  name: string;
  transcript: string;
  repo: string;
  roots: string[];
  known: string[];
  expectClean: boolean;
}

const CASES: Case[] = [
  {
    name: "tokenplan/очередь операций",
    transcript: "C:/Users/stigm/.claude/projects/E--repos-tokenplan/dbe2b0f9-0de9-4e77-abb7-0b8c5d32cff9.jsonl",
    repo: "E:/repos/agent-teams-ai",
    roots: ["src", "agent-teams-controller/src"],
    known: ["TeamOperationQueue"],
    expectClean: false,
  },
  {
    name: "tokenplan/без претензии",
    transcript: "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl",
    repo: "E:/repos/agent-teams-ai",
    roots: ["src", "agent-teams-controller/src"],
    known: [],
    expectClean: true,
  },
];

const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor"]);

function repoTexts(repo: string, roots: string[]): string[] {
  const texts: string[] = [];
  const walk = (dir: string, d: number): void => {
    if (d > 7) return;
    let entries;
    try {
      entries = readdirSync(`${repo}/${dir}`, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) walk(rel, d + 1);
        continue;
      }
      if (!/\.(ts|tsx|js|mjs|cjs)$/.test(e.name) || /\.(test|spec|d)\./.test(e.name)) continue;
      try {
        texts.push(readFileSync(`${repo}/${rel}`, "utf8"));
      } catch {}
    }
  };
  for (const r of roots) walk(r, 0);
  return texts;
}

for (const c of CASES) {
  const started = Date.now();
  const window = await ownFunctions(c.transcript, /\/src\/.*\.(ts|tsx|js|mjs|cjs)$|\/internal\/.*\.js$/);
  const written = new Set(window.map((w) => relativeTo(w.fn.source, c.repo)));
  const ready = readyFunctions(c.repo, written, c.roots);
  const uses = countUses(repoTexts(c.repo, c.roots));
  const result = detectBikes(window, corpus(ready), { uses });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`\n### ${c.name} (${seconds} с)`);
  console.log(`своих ${window.length}, готовых ${ready.length}, находок ${result.verdicts.length}`);

  console.log("форма ≥0.5, всё:");
  for (const v of result.verdicts.slice(0, 10)) {
    const mark = c.known.includes(v.own) ? " ★" : "  ";
    console.log(`${mark}${v.shape.toFixed(3)} предм ${v.topic.toFixed(2)}  готовое ${String(v.readyUses).padStart(3)}×  своё ${String(v.ownUses).padStart(3)}×  ${v.own.padEnd(28)} → ${v.ready}`);
  }

  // Правило RepoReuse: готовое в репозитории живое, своё — нет.
  const byRule = result.verdicts.filter((v) => v.readyUses >= 3 && v.ownUses === 0);
  console.log(`по правилу «готовое зовётся, своё нет»: ${byRule.length}`);
  for (const v of byRule) {
    const mark = c.known.includes(v.own) ? " ★" : "  ";
    console.log(`${mark}${v.shape.toFixed(3)}  ${v.own.padEnd(28)} → ${v.ready} (готовое ${v.readyUses}×)`);
  }
  if (c.known.length) {
    const hit = c.known.filter((k) => byRule.some((v) => v.own === k));
    console.log(`разметка: ${c.known.length}, найдено правилом ${hit.length}`);
  }
  if (c.expectClean) console.log(`окно без претензии: ложных по правилу ${byRule.length}`);
}
