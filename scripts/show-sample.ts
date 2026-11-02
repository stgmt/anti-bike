/**
 * Показывает пары из прогона по репозиториям вместе с телами.
 *
 * Нужен для ручной проверки: форма и имя не доказывают, что работа одна и та
 * же. Читать тела приходится глазами.
 *
 * `--same` — только одноимённые; `--min` — порог формы; `--n` — сколько пар.
 */
import { readFileSync } from "node:fs";

import { functionsIn } from "../src/bodies.ts";

const INPUT = process.argv[2] ?? "antibike-repos.json";
const onlySame = process.argv.includes("--same");
const minShape = Number(process.argv[process.argv.indexOf("--min") + 1] ?? "0.9");
const limit = Number(process.argv[process.argv.indexOf("--n") + 1] ?? "8");
const skip = Number(process.argv[process.argv.indexOf("--skip") + 1] ?? "0");

interface Row {
  repo: string;
  own: string;
  ownFile: string;
  ready: string;
  readyFile: string;
  shape: number;
  topic: number;
  sameName: boolean;
}

const data = JSON.parse(readFileSync(INPUT, "utf8")) as { rows: Row[] };
const bodyOf = (repo: string, file: string, name: string): string => {
  try {
    const fn = functionsIn(readFileSync(`${repo}/${file}`, "utf8"), file).find((f) => f.name === name);
    return fn ? fn.body : "(тело не разобрано)";
  } catch {
    return "(файла нет)";
  }
};

const rows = data.rows.filter((r) => r.shape >= minShape && (!onlySame || r.sameName)).slice(skip, skip + limit);
for (const [i, r] of rows.entries()) {
  console.log(`\n${"=".repeat(70)}\n${i + 1}. форма ${r.shape.toFixed(3)} предмет ${r.topic.toFixed(2)}  ${r.repo}`);
  console.log(`СВОЁ   ${r.own}  [${r.ownFile}]`);
  console.log("-".repeat(70));
  console.log(bodyOf(r.repo, r.ownFile, r.own).slice(0, 700));
  console.log(`\nГОТОВОЕ ${r.ready}  [${r.readyFile}]`);
  console.log("-".repeat(70));
  console.log(bodyOf(r.repo, r.readyFile, r.ready).slice(0, 700));
}
