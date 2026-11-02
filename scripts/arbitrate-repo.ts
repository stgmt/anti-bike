/**
 * Арбитр по парам прогона на репозиториях.
 *
 * Берёт `antibike-repos.json` и спрашивает у модели про каждую пару, одна ли у
 * них работа. Платно, поэтому список пар сначала печатается. Ответы кешируются
 * в `.cache/arbiter.json`, повторный прогон по тем же парам бесплатен.
 *
 * Отбор для арбитра — одноимённые пары, добавленные позже, с формой не ниже
 * порога. Порог берётся из прогона, а не из головы: обоснование — в отчёте.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { functionsIn } from "../src/bodies.ts";
import { judgePairCached } from "../src/verdict.ts";

const KEY_FILE = process.env.ANTIBIKE_KEY_FILE;
if (!KEY_FILE) throw new Error("нужен ANTIBIKE_KEY_FILE — env с ключом OpenRouter");
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];

interface Row {
  repo: string;
  own: string;
  ownFile: string;
  ready: string;
  readyFile: string;
  shape: number;
  topic: number;
  tokens: number;
  readyUses: number;
  ownUses: number;
  ownInner: number;
  sameName: boolean;
}

const INPUT = process.argv[2] ?? "antibike-repos.json";
const MIN_SHAPE = Number(process.env.MIN_SHAPE ?? "0.9");
const ONLY_SAME = process.env.ONLY_SAME !== "off";
const LIMIT = Number(process.env.LIMIT ?? "0");

const data = JSON.parse(readFileSync(INPUT, "utf8")) as { rows: Row[] };
let pairs = data.rows.filter((r) => r.shape >= MIN_SHAPE && (!ONLY_SAME || r.sameName));
pairs = pairs.sort((a, b) => b.shape - a.shape);
if (LIMIT > 0) pairs = pairs.slice(0, LIMIT);
console.log(`пар на арбитра: ${pairs.length} (форма ≥${MIN_SHAPE}${ONLY_SAME ? ", одно имя" : ""})`);

const bodyOf = (repo: string, file: string, name: string): string | null => {
  try {
    return functionsIn(readFileSync(`${repo}/${file}`, "utf8"), file).find((f) => f.name === name)?.body ?? null;
  } catch {
    return null;
  }
};

const results: (Row & { same: boolean; why: string })[] = [];
for (const [i, r] of pairs.entries()) {
  const own = bodyOf(r.repo, r.ownFile, r.own);
  const ready = bodyOf(r.repo, r.readyFile, r.ready);
  if (!own || !ready) {
    console.log(`  пропуск ${r.own}: ${!own ? "нет своего тела" : "нет готового тела"}`);
    continue;
  }
  const verdict = await judgePairCached({ name: r.own, body: own }, { name: r.ready, body: ready }, { apiKey: key });
  results.push({ ...r, same: verdict.same, why: verdict.why });
  console.log(`  ${String(i + 1).padStart(4)}/${pairs.length} ${verdict.same ? "ВЕЛОСИПЕД" : "нет     "}  ${r.own} → ${r.ready}  (${verdict.why})`);
}

const out = process.argv[3] ?? "antibike-repos-arb.json";
writeFileSync(out, JSON.stringify(results, null, 1), "utf8");
const yes = results.filter((r) => r.same);
console.log(`\nвсего пар: ${results.length}, велосипедов: ${yes.length} → ${out}`);
for (const r of yes.sort((a, b) => b.shape - a.shape)) {
  console.log(`  ${r.shape.toFixed(3)}  ${r.own} → ${r.ready}  [${r.ownFile} → ${r.readyFile}]  ${r.repo}`);
}
