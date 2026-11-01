/**
 * Сопоставление: своё неподключённое против готового непозванного.
 *
 * Условие велосипеда по RepoReuse: окно написало своё, не подключило его, и
 * НЕ ПОЗВАЛО готовое, которое отвечает на ту же задачу. Сопоставляем по
 * редким словам: если и своё, и готовое говорят об effort — это велосипед.
 */
import { readFileSync } from "node:fs";

interface Row {
  project: string; file: string; repo: string;
  declared: number; ready: number;
  orphanNames: string[]; notCalledSample: string[];
}

const rows: Row[] = readFileSync("bench/hunt2.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));

/** Слова, по которым видно предмет: effort, catalog, launch, retry, lock. */
const TOPIC = /(effort|efforts|catalog|launch|probe|retry|mutex|lock|queue|fallback|cache|timeout|schema|auth|session)/i;

const scored = rows.map((r) => {
  const own = r.orphanNames.filter((n) => TOPIC.test(n));
  const ready = r.notCalledSample.filter((n) => TOPIC.test(n));
  return { ...r, own, ready, topic: own.length > 0 && ready.length > 0 };
}).filter((r) => r.topic);

console.log(`сессий с совпадением по предмету: ${scored.length}\n`);
for (const r of scored.slice(0, 10)) {
  console.log(`### ${r.project.replace(/--claude-worktrees.*/, "")}/${r.file.slice(0, 8)}`);
  console.log(`  своё:   ${r.own.slice(0, 5).join(", ")}`);
  console.log(`  готовое: ${r.ready.slice(0, 5).join(", ")}`);
  console.log();
}
