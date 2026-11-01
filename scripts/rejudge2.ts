/**
 * Меняются ли ВЕРДИКТЫ от исправленного разбора.
 *
 * Сводки уже есть, окно заново не снимаем. Классификатор зовём только на тех
 * окнах, где разбор изменил вход: без этого нельзя сказать, ловит ли гейт.
 */
import { readFileSync } from "node:fs";
import { proposedNames } from "../src/judge.ts";
import { findDeclarations, splitByExistence } from "../src/exists.ts";
import { classify } from "../src/classify.ts";

const KEY_FILE = "C:/Users/stigm/OneDrive/Desktop/machine-transfer-secrets-20260712/drone/lm-saas-repo-secrets.env";
const key = /sk-or-v1-[A-Za-z0-9]+/.exec(readFileSync(KEY_FILE, "utf8"))![0];
const READY = readFileSync("bench/ready-carousel.txt", "utf8").trim();
const roots = ["E:/repos/carousel-demo/carousel"];

const rows = readFileSync("bench/detect2-journal.jsonl", "utf8")
  .split("\n").filter(Boolean).map((l) => JSON.parse(l));
const changed = rows.filter((r: any) => r.summary && proposedNames(r.summary).length !== (r.proposed ?? []).length);
console.log(`окон с изменённым разбором: ${changed.length}\n`);

let flipped = 0;
for (const r of changed) {
  const names = proposedNames(r.summary);
  const { found } = await findDeclarations(names, { roots });
  const { exists, absent } = splitByExistence(names, found);
  const v = await classify(r.summary, READY, { apiKey: key });
  const wasBike = r.kind === "bike";
  const isBike = v.bike;
  if (wasBike !== isBike) flipped += 1;
  console.log(`окно ${r.window}: было ${wasBike ? "BIKE" : "clean"} ${Number(r.score ?? 0).toFixed(3)}`
    + ` → стало ${isBike ? "BIKE" : "clean"} ${v.score.toFixed(3)}${wasBike !== isBike ? "   ← ИЗМЕНИЛСЯ" : ""}`);
  console.log(`  имена: ${names.map((n: string) => n.slice(0, 50)).join(" | ")}`);
  console.log(`  есть в репо ${exists.length}, нет ${absent.length}`);
  console.log();
}
console.log(`вердиктов изменилось: ${flipped} из ${changed.length}`);
