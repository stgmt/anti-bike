/**
 * Ищет в транскриптах всех проектов подтверждённые велосипеды.
 *
 * Подтверждённый — не догадка классификатора, а прямое высказывание автора или
 * агента: «завелосипедил», «не по сдк», «свой вместо». Здесь собираются окна,
 * где такие слова произнесены, чтобы потом проверить на них гейт.
 *
 * Запуск: node --experimental-strip-types scripts/find-bikes.ts [--limit N]
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type Turn, readTranscript } from "../src/window.ts";

const ROOT = "C:/Users/stigm/.claude/projects";

/** Слова, которыми автор или агент называют велосипед прямо. */
const MARKERS = [
  "завелосипедил",
  "велосипед",
  "не по сдк",
  "свой вместо",
  "вместо готового",
];

export interface BikeHint {
  project: string;
  file: string;
  line: number;
  author: string;
  marker: string;
  quote: string;
}

function hits(project: string, file: string, turns: Turn[]): BikeHint[] {
  const found: BikeHint[] = [];
  for (const turn of turns) {
    const lower = turn.text.toLowerCase();
    for (const marker of MARKERS) {
      if (!lower.includes(marker)) continue;
      found.push({
        project,
        file,
        line: 0,
        author: turn.author,
        marker,
        quote: turn.text.replace(/\s+/g, " ").slice(0, 300),
      });
      break;
    }
  }
  return found;
}

async function main(): Promise<void> {
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex > 0 ? Number(process.argv[limitIndex + 1]) : 100;
  const dirs = await readdir(ROOT, { withFileTypes: true });
  const all: BikeHint[] = [];
  let scanned = 0;

  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const project = dir.name;
    let files: string[];
    try {
      files = (await readdir(join(ROOT, project))).filter((name) => name.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const file of files) {
      let raw: string;
      try {
        raw = await readFile(join(ROOT, project, file), "utf8");
      } catch {
        continue;
      }
      if (raw.length < 5_000) continue;
      scanned += 1;
      all.push(...hits(project, file, readTranscript(raw)));
      if (all.length >= limit * 4) break;
    }
    if (all.length >= limit * 4) break;
  }

  // Авторские высказывания важнее агентских: агент часто сам себя называет.
  const owner = all.filter((item) => item.author === "owner");
  const agent = all.filter((item) => item.author !== "owner");
  console.log(`проектов прочитано: ${scanned} файлов, находок: ${all.length} ` +
    `(автор ${owner.length}, агент ${agent.length})\n`);

  const byProject = new Map<string, number>();
  for (const item of all) byProject.set(item.project, (byProject.get(item.project) ?? 0) + 1);
  console.log("по проектам:");
  for (const [project, count] of [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(count).padStart(4)} ${project}`);
  }

  console.log("\nслова автора:");
  for (const item of owner.slice(0, 25)) {
    console.log(`  [${item.marker}] ${item.project.slice(0, 30)}`);
    console.log(`    ${item.quote.slice(0, 200)}`);
  }

  await writeFile("bench/bike-hints.json", JSON.stringify({ owner, agent, scanned }, null, 2), "utf8");
}

await main();
