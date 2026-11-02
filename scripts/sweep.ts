/**
 * Подбор порогов на выборке: цель найти велосипед и не сыпать ложными.
 *
 * Решается не порогом по одному числу, а сочетанием: форма (редкие токены)
 * плюс предмет (слова) плюс подключённость (готовое зовётся, своё нет).
 * Печатается сетка, а не одно «лучшее» число: видно, где ломается.
 */
import { readFileSync, readdirSync } from "node:fs";
import { corpus, countUses, detectBikes, ownFunctions, readyFunctions, relativeTo } from "../src/detect.ts";

interface Case {
  name: string;
  transcript: string;
  repo: string;
  roots: string[];
  exts: string[];
  known: string[];
  clean: boolean;
}

const CASES: Case[] = [
  {
    name: "очередь/разметка",
    transcript: "C:/Users/stigm/.claude/projects/E--repos-tokenplan/dbe2b0f9-0de9-4e77-abb7-0b8c5d32cff9.jsonl",
    repo: "E:/repos/agent-teams-ai",
    roots: ["src", "agent-teams-controller/src"],
    exts: ["ts", "tsx", "js", "mjs", "cjs"],
    known: ["TeamOperationQueue"],
    clean: false,
  },
  {
    name: "форк/без претензии",
    transcript: "C:/Users/stigm/.claude/projects/E--repos-tokenplan/4a524b84-b325-4bc7-b07c-de9d61182593.jsonl",
    repo: "E:/repos/agent-teams-ai",
    roots: ["src", "agent-teams-controller/src"],
    exts: ["ts", "tsx", "js", "mjs", "cjs"],
    known: [],
    clean: true,
  },
  {
    name: "reels/без претензии",
    transcript: "C:/Users/stigm/.claude/projects/E--repos-presentation-reels/6698f30b-e875-4f11-919b-b2aef069f40e.jsonl",
    repo: "E:/repos/presentation-reels",
    roots: ["src/presentation_reels"],
    exts: ["py"],
    known: [],
    clean: true,
  },
];

const SKIP = new Set(["node_modules", "dist", "build", "out", ".git", "coverage", "landing", ".venv", "vendor"]);

function texts(repo: string, roots: string[], exts: string[]): string[] {
  const out: string[] = [];
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
      if (!exts.some((x) => e.name.endsWith(`.${x}`)) || /\.(test|spec|d)\.|\.testCases\./.test(e.name)) continue;
      try {
        out.push(readFileSync(`${repo}/${rel}`, "utf8"));
      } catch {}
    }
  };
  for (const r of roots) walk(r, 0);
  return out;
}

const prepared: { c: Case; verdicts: ReturnType<typeof detectBikes>["verdicts"]; own: number }[] = [];
for (const c of CASES) {
  const filter = new RegExp(`/src/.*\\.(?:${c.exts.join("|")})$|/internal/.*\\.js$`);
  const window = await ownFunctions(c.transcript, filter);
  const written = new Set(window.map((w) => relativeTo(w.fn.source, c.repo)));
  const ready = readyFunctions(c.repo, written, c.roots, c.exts);
  const uses = countUses(texts(c.repo, c.roots, c.exts));
  const result = detectBikes(window, corpus(ready), { uses });
  prepared.push({ c, verdicts: result.verdicts, own: window.length });
  console.log(`${c.name}: своих ${window.length}, форма≥0.5 ${result.verdicts.length}`);
}

const GRID = [
  { tokens: 40, shape: 0.5, topic: 0.15, uses: 0 },
  { tokens: 40, shape: 0.5, topic: 0.3, uses: 0 },
  { tokens: 40, shape: 0.55, topic: 0.3, uses: 3 },
  { tokens: 40, shape: 0.5, topic: 0.3, uses: 3 },
  { tokens: 40, shape: 0.55, topic: 0.4, uses: 3 },
  { tokens: 40, shape: 0.6, topic: 0.4, uses: 3 },
  { tokens: 60, shape: 0.55, topic: 0.4, uses: 3 },
];

console.log("\nток  форма предмет готовое  | разметка | ложных (два чистых окна)");
for (const g of GRID) {
  let knownHit = 0;
  let knownTotal = 0;
  const noise: number[] = [];
  for (const p of prepared) {
    const hits = p.verdicts.filter(
      (v) => v.tokens >= g.tokens && v.shape >= g.shape && v.topic >= g.topic && v.readyUses >= g.uses,
    );
    if (p.c.clean) noise.push(hits.length);
    else {
      knownTotal += p.c.known.length;
      knownHit += p.c.known.filter((k) => hits.some((v) => v.own === k)).length;
    }
  }
  console.log(
    `${String(g.tokens).padStart(3)} ${g.shape.toFixed(2)}  ${g.topic.toFixed(2)}   ${g.uses}×      | ${knownHit}/${knownTotal}      | ${noise.join(" + ")} = ${noise.reduce((a, b) => a + b, 0)}`,
  );
}

// Что именно остаётся на строгом режиме.
console.log("\nостатки при 60/0.55/0.40/3:");
for (const p of prepared) {
  const hits = p.verdicts.filter((v) => v.tokens >= 60 && v.shape >= 0.55 && v.topic >= 0.4 && v.readyUses >= 3);
  console.log(`  ${p.c.name}: ${hits.length}`);
  for (const v of hits) {
    const mark = p.c.known.includes(v.own) ? " ★" : "  ";
    console.log(`${mark}  ${v.shape.toFixed(3)} предм ${v.topic.toFixed(2)} готовое ${v.readyUses}×  ${v.own.padEnd(28)} → ${v.ready}  [${v.readyFile}]`);
  }
}
