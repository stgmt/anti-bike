/**
 * Сколько верхних пар — дословные копии, а сколько разошлись.
 *
 * Замер честности прогона по репозиториям: форма 1,000 не доказывает копию
 * (два коротких тела из одних `if`/`return` дают ту же единицу). Здесь тела
 * читаются с диска и сравниваются без пробелов: совпало — копия, нет — разная
 * работа с общим именем.
 *
 * Ничего не зовёт. Вход — antibike-repos.json, который пишет scan-repo.ts.
 */
import { readFileSync } from "node:fs";

import { functionsIn } from "../src/bodies.ts";

const INPUT = process.argv[2] ?? "antibike-repos.json";
const MIN_SHAPE = Number(process.argv[3] ?? "0.9");

interface Row {
  repo: string;
  own: string;
  ownFile: string;
  ready: string;
  readyFile: string;
  shape: number;
  sameName: boolean;
}

const data = JSON.parse(readFileSync(INPUT, "utf8")) as { rows: Row[] };
const bodyOf = (repo: string, file: string, name: string): string | null => {
  try {
    const text = readFileSync(`${repo}/${file}`, "utf8");
    const fn = functionsIn(text, file).find((f) => f.name === name);
    return fn ? fn.body.replace(/\s+/g, "") : null;
  } catch {
    return null;
  }
};

const rows = data.rows.filter((r) => r.sameName && r.shape >= MIN_SHAPE);
let exact = 0;
let diverged = 0;
let unknown = 0;
const exactRows: string[] = [];
const divergedRows: string[] = [];

for (const r of rows) {
  const a = bodyOf(r.repo, r.ownFile, r.own);
  const b = bodyOf(r.repo, r.readyFile, r.ready);
  if (!a || !b) {
    unknown += 1;
    continue;
  }
  if (a === b) {
    exact += 1;
    exactRows.push(`${r.shape.toFixed(3)} ${r.own}  ${r.ownFile} → ${r.readyFile}`);
  } else {
    diverged += 1;
    divergedRows.push(`${r.shape.toFixed(3)} ${r.own}  ${r.ownFile} → ${r.readyFile}`);
  }
}

console.log(`одно имя и форма ≥${MIN_SHAPE}: ${rows.length}`);
console.log(`  тела совпадают дословно: ${exact}`);
console.log(`  тела разошлись:          ${diverged}`);
console.log(`  не прочитал:             ${unknown}`);
console.log("\nразошлись:");
for (const line of divergedRows) console.log(`  ${line}`);
